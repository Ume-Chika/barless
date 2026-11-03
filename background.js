// background.js - サービスワーカー (Manifest V3, ES Module)

import {
  bgState,
  activateAndWakeTab,
  flushQueuedCloses,
  cleanupEmptyTabsInWindow
} from './js/background-tabs.js';

import {
  openSplitTabs,
  openSplitWithUrl,
  unsplitAndActivate,
  updateCheckedOutTabInfo,
  reconcileCheckedOutTabs
} from './js/background-split.js';

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'no-bar-popup') return;
  bgState.explicitNavigationTriggered = false;

  port.onDisconnect.addListener(() => {
    const shouldActivateFallback = !bgState.explicitNavigationTriggered;
    bgState.explicitNavigationTriggered = false;
    flushQueuedCloses(shouldActivateFallback);
  });
});

// URL/タイトル/ファビコン変更時、貸出中タブの記録情報を最新化
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.favIconUrl) {
    updateCheckedOutTabInfo(tabId, changeInfo).catch(() => {});
  }
});

// ポップアップが閉じるのを待ってから操作を実行し、遅延クローズを確定させる
const NAV_HANDLERS = {
  ACTIVATE_TAB: async (r) => {
    await activateAndWakeTab(r.tabId, r.windowId);
    if (r.cleanupEmpty) {
      await cleanupEmptyTabsInWindow(r.windowId, r.tabId);
    }
  },
  OPEN_SPLIT_TABS: async (r) => {
    await openSplitTabs(r.firstTabId, r.secondTabId);
    if (r.cleanupEmpty) {
      await cleanupEmptyTabsInWindow(undefined, r.secondTabId);
    }
  },
  OPEN_SPLIT_WITH_URL: async (r) => {
    await openSplitWithUrl(r.firstTabId, r.url);
    if (r.cleanupEmpty) {
      await cleanupEmptyTabsInWindow(undefined, undefined);
    }
  },
  OPEN_URL: async (r) => {
    const createProps = r.url ? { url: r.url } : {};
    const newTab = await chrome.tabs.create(createProps);
    if (r.cleanupEmpty) {
      await cleanupEmptyTabsInWindow(undefined, newTab.id);
    }
  },
  UNSPLIT_AND_ACTIVATE_TAB: async (r) => {
    await unsplitAndActivate(r.tabId, r.splitViewId, r.windowId);
    if (r.cleanupEmpty) {
      await cleanupEmptyTabsInWindow(r.windowId, r.tabId);
    }
  }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SYNC_DEFERRED_CLOSES') {
    bgState.queuedCloseTabIds = new Set(request.tabIds || []);
    bgState.fallbackActiveTabId = request.fallbackActiveTabId || null;
    sendResponse({ success: true });
    return false;
  }
  if (request.type === 'RECONCILE_CHECKED_OUT_TABS') {
    reconcileCheckedOutTabs(request.windowId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.warn('RECONCILE_CHECKED_OUT_TABS エラー:', err);
        sendResponse({ success: false, error: String(err) });
      });
    return true; // 非同期処理の完了を待機してレスポンス
  }
  if (NAV_HANDLERS[request.type]) {
    bgState.explicitNavigationTriggered = true;
    (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 30));
        await NAV_HANDLERS[request.type](request);
        await flushQueuedCloses(false);
      } catch (err) {
        console.warn(`${request.type} エラー:`, err);
      }
    })();
    sendResponse({ success: true });
    return false;
  }
  sendResponse({ success: false });
  return false;
});
