// js/actions.js - タブ移動・分割・クローズ・URLオープン処理

import { SLOT_COUNT } from './constants.js';
import { isLikelyUrl, isProtectedFromClose } from './utils.js';
import { state, userSettings, getSearchUrl, buildDisplayTabs } from './state.js';
import { clampSlotAndRender, renderSlots } from './slots-view.js';

let popupPort = null;

export async function sendAndClose(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (err) {
    console.warn('メッセージ送信失敗:', err);
  } finally {
    window.close();
  }
}

export async function openUrlOrSplit(url) {
  const type = state.splitFirstTabId ? 'OPEN_SPLIT_WITH_URL' : 'OPEN_URL';
  const targetUrl = (url && !/^[a-zA-Z0-9+-.]+:\/\//.test(url)) ? `https://${url}` : url;
  return sendAndClose({
    type,
    ...(state.splitFirstTabId ? { firstTabId: state.splitFirstTabId } : {}),
    url: targetUrl,
    cleanupEmpty: userSettings.showNewTabSlot
  });
}

export async function openNewTabSlot(tab) {
  if (tab.isVirtualNewTab) {
    return sendAndClose({ type: 'OPEN_URL', url: null, cleanupEmpty: false });
  }
  return sendAndClose({
    type: 'ACTIVATE_TAB',
    tabId: tab.id,
    windowId: tab.windowId,
    cleanupEmpty: false
  });
}

export async function jumpToTab(tabId) {
  const targetTab = state.allTabs.find(t => t.id === tabId);
  if (targetTab && targetTab.isGhost) return jumpToTab(targetTab.targetTabId);
  if (targetTab && targetTab.isNewTabSlot) return openNewTabSlot(targetTab);

  if (state.splitFirstTabId && state.splitFirstTabId !== tabId) {
    return sendAndClose({
      type: 'OPEN_SPLIT_TABS',
      firstTabId: state.splitFirstTabId,
      secondTabId: tabId,
      cleanupEmpty: userSettings.showNewTabSlot
    });
  }

  await sendAndClose({
    type: 'ACTIVATE_TAB',
    tabId,
    windowId: targetTab ? targetTab.windowId : undefined,
    cleanupEmpty: userSettings.showNewTabSlot
  });
}

export async function handleShiftClickTab(tab) {
  if (tab.isGhost) {
    const realTab = state.allTabs.find(t => t.id === tab.targetTabId);
    if (realTab) return handleShiftClickTab(realTab);
    return;
  }
  if (tab.isNewTabSlot) return openNewTabSlot(tab);

  const searchInput = document.getElementById('searchInput');
  if (!state.splitFirstTabId) {
    state.splitFirstTabId = tab.id;
    renderSlots();
    searchInput?.focus();
    return;
  }

  if (state.splitFirstTabId === tab.id) {
    state.splitFirstTabId = null;
    if (tab.splitViewId && tab.splitViewId !== -1) {
      return sendAndClose({
        type: 'UNSPLIT_AND_ACTIVATE_TAB',
        tabId: tab.id,
        splitViewId: tab.splitViewId,
        windowId: tab.windowId,
        cleanupEmpty: userSettings.showNewTabSlot
      });
    }
    renderSlots();
    searchInput?.focus();
    return;
  }

  await jumpToTab(tab.id);
}

export async function closeTab(tabId) {
  try {
    const targetTab = state.allTabs.find(t => t.id === tabId);
    if (isProtectedFromClose(targetTab)) return;
    if (state.splitFirstTabId === tabId) state.splitFirstTabId = null;

    if (state.allTabs.length <= 1) {
      await chrome.tabs.remove(tabId);
      window.close();
      return;
    }

    if (state.browserDisplayedTabIds.has(tabId)) {
      state.deferredCloseTabIds.add(tabId);
    } else {
      await chrome.tabs.remove(tabId);
    }

    const rawTabs = await chrome.tabs.query({ currentWindow: true });
    state.allTabs = buildDisplayTabs(rawTabs.filter(t => !state.deferredCloseTabIds.has(t.id)));
    if (state.allTabs.length === 0) return window.close();

    // 単独化された分割ビューのインジケータを解除
    const splitCounts = {};
    for (const t of state.allTabs) if (t.splitViewId > 0) splitCounts[t.splitViewId] = (splitCounts[t.splitViewId] || 0) + 1;
    for (const t of state.allTabs) if (t.splitViewId > 0 && splitCounts[t.splitViewId] < 2) t.splitViewId = -1;

    if (state.startIndex >= state.allTabs.length) {
      state.startIndex = Math.max(0, state.startIndex - SLOT_COUNT);
      state.selectedSlot = Math.max(0, Math.min(SLOT_COUNT, state.allTabs.length - state.startIndex) - 1);
    }

    // 新規タブスロット着地時は直前の実タブへフォールバック
    const curIdx = state.startIndex + state.selectedSlot;
    if (state.allTabs[curIdx]?.isNewTabSlot && curIdx > 0) {
      if (state.selectedSlot > 0) state.selectedSlot -= 1;
      else if (state.startIndex > 0) {
        state.startIndex = Math.max(0, state.startIndex - SLOT_COUNT);
        state.selectedSlot = Math.min(SLOT_COUNT, state.allTabs.length - state.startIndex) - 1;
      }
    }

    clampSlotAndRender();

    let fallbackActiveTabId = state.allTabs.find(t => t.active)?.id || null;
    if (!fallbackActiveTabId) {
      const nextActive = state.allTabs[state.startIndex + state.selectedSlot] || state.allTabs[0];
      if (nextActive) {
        nextActive.active = true;
        fallbackActiveTabId = nextActive.id;
        renderSlots();
      }
    }

    if (state.deferredCloseTabIds.size > 0) {
      if (!popupPort) {
        try { popupPort = chrome.runtime.connect({ name: 'no-bar-popup' }); } catch (_) {}
      }
      await chrome.runtime.sendMessage({
        type: 'SYNC_DEFERRED_CLOSES',
        tabIds: Array.from(state.deferredCloseTabIds),
        fallbackActiveTabId
      }).catch(() => {});
    }

    document.getElementById('searchInput')?.focus();
  } catch (err) {
    console.warn('タブ閉鎖失敗:', err);
  }
}

export async function performSearch(query) {
  if (!query) return;
  const trimmed = query.trim();
  const hasScheme = /^(https?|brave|chrome):\/\//i.test(trimmed);
  const targetUrl = isLikelyUrl(trimmed) ? (hasScheme ? trimmed : `https://${trimmed}`) : getSearchUrl(trimmed);
  await openUrlOrSplit(targetUrl);
}

export function executeItem(item) {
  if (item.type === 'tab' && item.tabId) {
    jumpToTab(item.tabId);
  } else if (item.url) {
    openUrlOrSplit(item.url);
  } else {
    performSearch(item.title);
  }
}
