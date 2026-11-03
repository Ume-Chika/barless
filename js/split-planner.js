// js/split-planner.js - 分割前判定（案C並び替え要否判定）と出張タブ準備

import { DEFAULT_SETTINGS } from './constants.js';
import {
  getCheckedOutTabs,
  saveCheckedOutTabs,
  getGroupRelativeIndex,
  getLogicalIndex
} from './split-state.js';

// タブの論理的な配置情報を取得（出張中ならゴースト情報、通常なら物理タブ情報）
export function getLogicalPlacement(tab, checkedOutMap) {
  const checkout = checkedOutMap[tab.id];
  if (checkout) {
    return {
      id: tab.id,
      isCheckout: true,
      groupId: checkout.groupId,
      groupRelativeIndex: checkout.groupRelativeIndex ?? 0,
      windowId: checkout.windowId,
      url: checkout.url
    };
  }
  return {
    id: tab.id,
    isCheckout: false,
    groupId: (tab.groupId && tab.groupId !== -1) ? tab.groupId : null,
    groupRelativeIndex: null,
    windowId: tab.windowId,
    url: tab.url || ''
  };
}

// 案C判定モデル：「同じグループ内で並び替え不要で表示できるかどうか」
export async function checkCanDisplayInGroupWithoutReorder(p1, p2, targetWindowId, checkedOutMap) {
  if (!p1.groupId || !p2.groupId || p1.groupId !== p2.groupId) return false;

  let gid = p1.groupId;

  // 両タブとも出張中で相対位置が保持されている場合は即座に判定
  if (typeof p1.groupRelativeIndex === 'number' && typeof p2.groupRelativeIndex === 'number') {
    return p2.groupRelativeIndex === p1.groupRelativeIndex + 1;
  }

  let groupTabs = [];
  try {
    groupTabs = await chrome.tabs.query({
      groupId: gid,
      ...(targetWindowId ? { windowId: targetWindowId } : {})
    });
  } catch (_) {
    return false;
  }
  if (!groupTabs || groupTabs.length === 0) return false;

  groupTabs.sort((a, b) => a.index - b.index);

  const getEffectiveRelativeIndex = (p) => {
    if (typeof p.groupRelativeIndex === 'number') {
      return p.groupRelativeIndex;
    }
    const curIdx = groupTabs.findIndex(t => t.id === p.id);
    if (curIdx === -1) return -1;
    let offset = 0;
    const sortedCheckouts = Object.values(checkedOutMap)
      .filter(co => co.groupId === gid)
      .map(co => co.groupRelativeIndex ?? 0)
      .sort((a, b) => a - b);
    for (const rel of sortedCheckouts) {
      if (rel <= curIdx + offset) offset++;
    }
    return curIdx + offset;
  };

  const rel1 = getEffectiveRelativeIndex(p1);
  const rel2 = getEffectiveRelativeIndex(p2);

  if (rel1 === -1 || rel2 === -1) return false;
  return rel2 === rel1 + 1;
}

// 分割ビュー用にタブを準備する
export async function prepareTabForSplit(tabId, precalculatedRelativeIndex = null, precalculatedLogicalIndex = null) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.splitViewId && tab.splitViewId !== -1 && chrome.tabs.unsplit) {
    try { await chrome.tabs.unsplit(tab.splitViewId); } catch (_) {}
  }

  const inGroup = Boolean(tab.groupId && tab.groupId !== -1);
  if (inGroup) {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS).catch(() => DEFAULT_SETTINGS);
    if (settings.smartGroupReturn) {
      let groupTitle = '';
      let groupColor = 'grey';
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        groupTitle = group.title || '';
        groupColor = group.color || 'grey';
      } catch (_) {}

      const map = await getCheckedOutTabs();
      const groupRelativeIndex = (typeof precalculatedRelativeIndex === 'number')
        ? precalculatedRelativeIndex
        : await getGroupRelativeIndex(tab, map);

      const logicalIndex = (typeof precalculatedLogicalIndex === 'number')
        ? precalculatedLogicalIndex
        : getLogicalIndex(tab, map);

      map[tab.id] = {
        groupId: tab.groupId,
        groupTitle,
        groupColor,
        originalIndex: tab.index,
        logicalIndex,
        groupRelativeIndex,
        windowId: tab.windowId,
        url: tab.url || '',
        title: tab.title || '',
        favIconUrl: tab.favIconUrl || ''
      };
      await saveCheckedOutTabs(map);
      try { await chrome.tabs.ungroup(tab.id); } catch (_) {}
      return await chrome.tabs.get(tab.id);
    }
  }

  if (inGroup || tab.pinned) {
    return await chrome.tabs.create({
      windowId: tab.windowId,
      ...(tab.url ? { url: tab.url } : {}),
      active: false
    });
  }

  return await chrome.tabs.get(tab.id);
}
