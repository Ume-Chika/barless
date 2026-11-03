// js/background-tabs.js - タブアクティブ化・休止復帰・遅延クローズ・空タブ管理

import { isNewTabUrl } from './constants.js';

export const bgState = {
  queuedCloseTabIds: new Set(),
  fallbackActiveTabId: null,
  explicitNavigationTriggered: false
};

// 対象タブをアクティブ化し、休止状態（discarded）であれば確実に復帰させる
export async function activateAndWakeTab(tabId, fallbackWindowId) {
  const tab = await chrome.tabs.get(tabId);
  const wasDiscarded = Boolean(tab.discarded || tab.status === 'unloaded');
  const targetWindowId = tab.windowId || fallbackWindowId;

  if (targetWindowId) {
    await chrome.windows.update(targetWindowId, { focused: true });
  }

  await chrome.tabs.update(tabId, { active: true, highlighted: true });

  if (wasDiscarded) {
    const afterTab = await chrome.tabs.get(tabId);
    if (afterTab.discarded || afterTab.status !== 'loading') {
      await chrome.tabs.reload(tabId);
    }
  }
}

export async function flushQueuedCloses(activateFallback = false) {
  if (bgState.queuedCloseTabIds.size === 0) return;
  const idsToClose = Array.from(bgState.queuedCloseTabIds);
  const nextTabId = bgState.fallbackActiveTabId;
  bgState.queuedCloseTabIds.clear();
  bgState.fallbackActiveTabId = null;

  try {
    if (activateFallback && nextTabId && !idsToClose.includes(nextTabId)) {
      try {
        await activateAndWakeTab(nextTabId);
      } catch (_) {}
    }
    await chrome.tabs.remove(idsToClose);
  } catch (err) {
    console.warn('遅延タブ閉鎖エラー:', err);
  }
}

export async function cleanupEmptyTabsInWindow(windowId, excludeTabId) {
  try {
    const queryInfo = windowId ? { windowId } : { currentWindow: true };
    const tabs = await chrome.tabs.query(queryInfo);
    const emptyIds = tabs
      .filter(t => isNewTabUrl(t.url) && t.id !== excludeTabId && !t.pinned && (!t.groupId || t.groupId === -1))
      .map(t => t.id);
    if (emptyIds.length > 0) {
      await chrome.tabs.remove(emptyIds);
    }
  } catch (err) {
    console.warn('空タブクリーンアップ失敗:', err);
  }
}
