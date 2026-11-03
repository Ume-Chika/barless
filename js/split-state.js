// js/split-state.js - 出張中タブのセッション管理と論理/物理インデックス写像計算

export const pendingSplitTabIds = new Set();

export async function getCheckedOutTabs() {
  const storageArea = chrome.storage.session || chrome.storage.local;
  const res = await storageArea.get('checkedOutTabs').catch(() => ({}));
  return res.checkedOutTabs || {};
}

export async function saveCheckedOutTabs(map) {
  const storageArea = chrome.storage.session || chrome.storage.local;
  await storageArea.set({ checkedOutTabs: map });
}

export async function updateCheckedOutTabInfo(tabId, changeInfo) {
  const map = await getCheckedOutTabs();
  const checkout = map[tabId];
  if (!checkout) return;

  let modified = false;
  if (changeInfo.url && changeInfo.url !== checkout.url) {
    checkout.url = changeInfo.url;
    modified = true;
  }
  if (changeInfo.title && changeInfo.title !== checkout.title) {
    checkout.title = changeInfo.title;
    modified = true;
  }
  if (changeInfo.favIconUrl && changeInfo.favIconUrl !== checkout.favIconUrl) {
    checkout.favIconUrl = changeInfo.favIconUrl;
    modified = true;
  }

  if (modified) {
    await saveCheckedOutTabs(map);
  }
}

export async function getRestoredTabMeta() {
  const storageArea = chrome.storage.session || chrome.storage.local;
  const res = await storageArea.get('restoredTabMeta').catch(() => ({}));
  return res.restoredTabMeta || {};
}

export async function saveRestoredTabMeta(map) {
  const storageArea = chrome.storage.session || chrome.storage.local;
  await storageArea.set({ restoredTabMeta: map });
}

export function updateRemappedGroupIds(map, oldGroupId, newGroupId) {
  if (!oldGroupId || !newGroupId || oldGroupId === newGroupId) return;
  for (const co of Object.values(map)) {
    if (co.groupId === oldGroupId) {
      co.groupId = newGroupId;
    }
  }
}

// 出張タブが抜けたことによるオフセットを補正し、真のグループ内相対位置を取得
export async function getGroupRelativeIndex(tab, checkedOutMap) {
  if (!tab.groupId || tab.groupId === -1) {
    return 0;
  }
  try {
    const groupTabs = await chrome.tabs.query({
      groupId: tab.groupId,
      ...(tab.windowId ? { windowId: tab.windowId } : {})
    });
    const curIdx = groupTabs.findIndex(t => t.id === tab.id);
    if (curIdx === -1) return 0;

    let offset = 0;
    const sortedCheckouts = Object.entries(checkedOutMap)
      .filter(([_, co]) => co.groupId === tab.groupId)
      .map(([_, co]) => co.groupRelativeIndex ?? 0)
      .sort((a, b) => a - b);

    for (const rel of sortedCheckouts) {
      if (rel <= curIdx + offset) {
        offset++;
      }
    }
    return curIdx + offset;
  } catch (_) {
    return 0;
  }
}

// ウィンドウ全体におけるタブの真の論理インデックス（出張中タブを考慮した絶対スロット位置）を計算
export function getLogicalIndex(tab, checkedOutMap) {
  try {
    const curIdx = tab.index;
    let offset = 0;
    const sortedCheckouts = Object.values(checkedOutMap)
      .filter(co => co.windowId === tab.windowId && typeof co.logicalIndex === 'number')
      .map(co => co.logicalIndex)
      .sort((a, b) => a - b);

    for (const logIdx of sortedCheckouts) {
      if (logIdx <= curIdx + offset) {
        offset++;
      }
    }
    return curIdx + offset;
  } catch (_) {
    return tab.index;
  }
}

// 論理インデックスから現在の物理タブバー上の目標インデックスを逆算
export function getPhysicalIndexForLogical(logicalIndex, checkedOutMap, windowId, excludeTabId) {
  let offset = 0;
  for (const [tidStr, co] of Object.entries(checkedOutMap || {})) {
    const tid = parseInt(tidStr, 10);
    if (tid === excludeTabId) continue;
    if (co.windowId === windowId && typeof co.logicalIndex === 'number') {
      if (co.logicalIndex < logicalIndex) {
        offset++;
      }
    }
  }
  return Math.max(0, logicalIndex - offset);
}

// 新規グループを再作成して配置する際、既存の他グループを真っ二つに分断しない安全なインデックスを計算
export async function getSafeIndexForNewGroup(windowId, preferredIndex) {
  try {
    const tabs = await chrome.tabs.query({ ...(windowId ? { windowId } : {}) });
    if (!tabs || tabs.length === 0) return 0;

    const groupRanges = new Map();
    for (const t of tabs) {
      if (t.groupId && t.groupId !== -1) {
        if (!groupRanges.has(t.groupId)) {
          groupRanges.set(t.groupId, { min: t.index, max: t.index });
        } else {
          const r = groupRanges.get(t.groupId);
          r.min = Math.min(r.min, t.index);
          r.max = Math.max(r.max, t.index);
        }
      }
    }

    let safeIdx = typeof preferredIndex === 'number' ? preferredIndex : tabs.length;
    safeIdx = Math.max(0, Math.min(tabs.length, safeIdx));

    // いずれかのグループの内部（min < safeIdx <= max）に割り込む場合、そのグループの末尾直後へ退避
    let changed = true;
    while (changed) {
      changed = false;
      for (const [_, range] of groupRanges) {
        if (safeIdx > range.min && safeIdx <= range.max) {
          safeIdx = range.max + 1;
          changed = true;
          break;
        }
      }
    }

    return safeIdx;
  } catch (_) {
    return preferredIndex ?? 0;
  }
}
