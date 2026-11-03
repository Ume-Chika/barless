// js/state.js - ポップアップ状態・ユーザー設定・タブ初期化管理

import { COLOR_MAP, DEFAULT_SETTINGS, isNewTabUrl } from './constants.js';
import { insertGroupGhosts } from './state-ghosts.js';

export const state = {
  allTabs: [],
  groupColorMap: {},
  checkedOutTabs: {},
  browserDisplayedTabIds: new Set(),
  deferredCloseTabIds: new Set(),
  startIndex: 0,
  selectedSlot: 0,
  splitFirstTabId: null,
  currentMode: 'jump', // 'jump' | 'search'
  currentItems: [],
  selectedSuggestIdx: 0,
  deleteCooldownUntil: 0,
  isComposing: false,
  lastCompositionEndTime: 0
};

export let userSettings = { ...DEFAULT_SETTINGS };

export function applyGuideVisibility(isSearching = state.currentMode === 'search') {
  const guide = document.getElementById('shortcutsGuide');
  const footer = document.querySelector('.footer');
  if (!guide || !footer) return;
  const showGuide = userSettings.showShortcutsGuide !== false;
  guide.style.display = showGuide ? 'flex' : 'none';
  footer.style.display = (!showGuide && isSearching) ? 'none' : 'flex';
}

export function getSearchUrl(query) {
  const q = encodeURIComponent(query);
  switch (userSettings.searchEngine) {
    case 'brave':
      return `https://search.brave.com/search?q=${q}`;
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${q}`;
    case 'google':
    default:
      return `https://www.google.com/search?q=${q}`;
  }
}

export function buildDisplayTabs(rawTabs) {
  let displayTabs = [...rawTabs];

  // スマート返却有効時：持ち出し中タブの元の位置にゴーストスロットを挿入
  if (userSettings.smartGroupReturn) {
    insertGroupGhosts(displayTabs, state.checkedOutTabs);
  }

  if (!userSettings.showNewTabSlot) {
    return displayTabs;
  }
  const normalTabs = displayTabs.filter(t => !isNewTabUrl(t.url || t.pendingUrl));
  const emptyTabs = displayTabs.filter(t => isNewTabUrl(t.url || t.pendingUrl));

  let newTabSlotObj;
  if (emptyTabs.length > 0) {
    newTabSlotObj = emptyTabs.find(t => t.active) || emptyTabs[0];
    newTabSlotObj.isNewTabSlot = true;
    newTabSlotObj.title = '新しいタブ';
  } else {
    newTabSlotObj = {
      id: 'virtual-newtab',
      isVirtualNewTab: true,
      isNewTabSlot: true,
      title: '新しいタブ',
      url: 'chrome://newtab/',
      favIconUrl: '',
      active: false
    };
  }
  return [...normalTabs, newTabSlotObj];
}

export async function fetchAndInitTabs(onSettingsChanged) {
  // ネイティブ操作等で分割が解除されたり別ウィンドウへ切り離された貸出タブがあれば、HUD初期化前に即時調停
  const currentWin = await chrome.windows.getCurrent().catch(() => null);
  await chrome.runtime.sendMessage({
    type: 'RECONCILE_CHECKED_OUT_TABS',
    windowId: currentWin ? currentWin.id : undefined
  }).catch(() => {});

  const storageArea = chrome.storage.session || chrome.storage.local;
  const [storedSettings, sessionData, tabs, groups] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS).catch(() => DEFAULT_SETTINGS),
    storageArea.get(['checkedOutTabs', 'restoredTabMeta']).catch(() => ({})),
    chrome.tabs.query({ currentWindow: true }),
    chrome.tabGroups ? chrome.tabGroups.query({}).catch(() => []) : Promise.resolve([])
  ]);

  if (storedSettings) {
    userSettings = storedSettings;
    applyGuideVisibility();
  }
  state.checkedOutTabs = sessionData.checkedOutTabs || {};
  const restoredMeta = sessionData.restoredTabMeta || {};

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      for (const [key, change] of Object.entries(changes)) {
        userSettings[key] = change.newValue;
      }
      applyGuideVisibility();
      if (onSettingsChanged) onSettingsChanged();
    }
  });

  if (!tabs || tabs.length === 0) return null;

  // 補填直後のタブ（まだページロード中でタイトルが未取得）に元のタイトル・ファビコンを先行適用
  tabs.forEach(t => {
    const meta = restoredMeta[t.id];
    if (meta) {
      if (!t.title || t.title === '新しいタブ' || t.title === 'New Tab') {
        if (meta.title) t.title = meta.title;
      }
      if (!t.favIconUrl && meta.favIconUrl) {
        t.favIconUrl = meta.favIconUrl;
      }
    }
  });

  state.allTabs = buildDisplayTabs(tabs);

  const activeTab = tabs.find(t => t.active);
  if (activeTab) {
    state.browserDisplayedTabIds.add(activeTab.id);
    if (activeTab.splitViewId && activeTab.splitViewId !== -1) {
      tabs.forEach(t => {
        if (t.splitViewId === activeTab.splitViewId) {
          state.browserDisplayedTabIds.add(t.id);
        }
      });
    }
  }

  (groups || []).forEach(g => {
    state.groupColorMap[g.id] = COLOR_MAP[g.color] || '#8ab4f8';
  });

  return state.allTabs;
}
