// js/split-reconcile.js - タブグループ再配置・安全復帰と3原則ステートマシン調停

import {
  getCheckedOutTabs,
  saveCheckedOutTabs,
  getRestoredTabMeta,
  saveRestoredTabMeta,
  updateRemappedGroupIds,
  getPhysicalIndexForLogical,
  getSafeIndexForNewGroup,
  pendingSplitTabIds
} from './split-state.js';

let isReconciling = false;
let reconcileQueued = false;

// タブ（既存の実体または新規クローン）を元のタブグループの適切な位置へ配置する
export async function placeTabInGroup(tabId, checkout, windowId, checkedOutMap = null) {
  try {
    const winId = windowId || checkout.windowId;
    let groupExists = false;
    try {
      const g = await chrome.tabGroups.get(checkout.groupId);
      if (!winId || g.windowId === winId) {
        groupExists = true;
      }
    } catch (_) {}

    if (groupExists) {
      // 1. グループに追加（Chromeが自動的にグループの末尾に安全に合流させる）
      await chrome.tabs.group({ tabIds: tabId, groupId: checkout.groupId });

      // 2. グループ内の連続した領域内でのみ相対位置を整頓（別グループを跨ぐ移動を100%防止）
      try {
        const groupTabs = await chrome.tabs.query({
          groupId: checkout.groupId,
          ...(winId ? { windowId: winId } : {})
        });
        if (groupTabs && groupTabs.length > 1) {
          const minIndex = Math.min(...groupTabs.map(t => t.index));
          const relIdx = typeof checkout.groupRelativeIndex === 'number'
            ? checkout.groupRelativeIndex
            : (groupTabs.length - 1);
          // グループの物理範囲（minIndex 〜 minIndex + groupTabs.length - 1）内に厳密にクランプ！
          const targetIndex = Math.min(minIndex + groupTabs.length - 1, Math.max(minIndex, minIndex + relIdx));
          await chrome.tabs.move(tabId, { index: targetIndex });
        }
      } catch (_) {}
      return checkout.groupId;
    } else {
      // 元のグループが消滅している場合：同名・同色で新規作成し、論理インデックスから逆算した安全な位置へ配置
      const newGroupId = await chrome.tabs.group({ tabIds: tabId });
      await chrome.tabGroups.update(newGroupId, {
        title: checkout.groupTitle,
        color: checkout.groupColor
      });

      const checkouts = checkedOutMap || await getCheckedOutTabs();
      const targetLogical = typeof checkout.logicalIndex === 'number'
        ? checkout.logicalIndex
        : checkout.originalIndex;
      const targetPhysical = getPhysicalIndexForLogical(targetLogical, checkouts, winId, tabId);
      const safeIndex = await getSafeIndexForNewGroup(winId, targetPhysical);
      const moveFn = chrome.tabGroups.move ? chrome.tabGroups.move(newGroupId, { index: safeIndex }) : chrome.tabs.move(tabId, { index: safeIndex });
      try {
        await moveFn;
      } catch (_) {
        try { await chrome.tabs.move(tabId, { index: safeIndex }); } catch (_) {}
      }
      return newGroupId;
    }
  } catch (err) {
    console.warn(`タブ ${tabId} のグループ配置失敗:`, err);
    return null;
  }
}

// 貸出中タブの状態を調停（Barless呼び出し時に実行）
// 3原則: ①split内実体→キープ ②split外実体→返却 ③ウィンドウ内不在→URL補填復元
export async function reconcileCheckedOutTabs(targetWindowId) {
  if (isReconciling) {
    reconcileQueued = true;
    return;
  }
  isReconciling = true;
  try {
    do {
      reconcileQueued = false;
      await _executeReconciliation(targetWindowId);
    } while (reconcileQueued);
  } finally {
    isReconciling = false;
  }
}

async function _executeReconciliation(targetWindowId) {
  const map = await getCheckedOutTabs();
  const entries = Object.entries(map);
  if (entries.length === 0) return;

  let winId = targetWindowId;
  if (!winId) {
    try {
      const cur = await chrome.windows.getCurrent();
      winId = cur ? cur.id : undefined;
    } catch (_) {}
  }
  if (!winId) return;

  let windowTabs = [];
  try {
    windowTabs = await chrome.tabs.query({ windowId: winId });
  } catch (_) {
    return;
  }

  // 手前のタブ・グループから順に安全に戻るよう、論理インデックス昇順でソート
  entries.sort((a, b) => {
    const logA = a[1].logicalIndex ?? a[1].originalIndex ?? 0;
    const logB = b[1].logicalIndex ?? b[1].originalIndex ?? 0;
    return logA - logB;
  });

  let modified = false;

  for (const [tidStr, checkout] of entries) {
    const tid = parseInt(tidStr, 10);
    if (pendingSplitTabIds.has(tid)) continue;
    if (checkout.windowId && checkout.windowId !== winId) continue;

    const realTab = windowTabs.find(t => t.id === tid);

    if (realTab) {
      const isInSplit = Boolean(realTab.splitViewId && realTab.splitViewId !== -1);
      if (isInSplit) {
        // 原則①：ゴーストがある && split内に実体がある → キープ（貸出継続）
        continue;
      } else {
        // 原則②：ゴーストがある && split外に実体がある（単独化） → タブグループに返却
        delete map[tid];
        modified = true;
        const effectiveGroupId = await placeTabInGroup(tid, checkout, winId, map);
        updateRemappedGroupIds(map, checkout.groupId, effectiveGroupId);
      }
    } else {
      // 原則③：ゴーストがある && このウィンドウ内のどこにも実体がない → 新規タブで補填復元
      delete map[tid];
      modified = true;

      let restoreUrl = checkout.url || 'about:blank';
      let restoreTitle = checkout.title || '';
      let restoreFavIcon = checkout.favIconUrl || '';

      try {
        const remoteTab = await chrome.tabs.get(tid);
        if (remoteTab) {
          if (remoteTab.url || remoteTab.pendingUrl) restoreUrl = remoteTab.url || remoteTab.pendingUrl;
          if (remoteTab.title) restoreTitle = remoteTab.title;
          if (remoteTab.favIconUrl) restoreFavIcon = remoteTab.favIconUrl;
        }
      } catch (_) {}

      try {
        const clone = await chrome.tabs.create({
          windowId: winId,
          url: restoreUrl,
          active: false
        });
        const effectiveGroupId = await placeTabInGroup(clone.id, checkout, winId, map);
        updateRemappedGroupIds(map, checkout.groupId, effectiveGroupId);

        if (restoreTitle || restoreFavIcon) {
          const metaMap = await getRestoredTabMeta();
          const now = Date.now();
          for (const [k, v] of Object.entries(metaMap)) {
            if (now - (v.timestamp || 0) > 300000) delete metaMap[k];
          }
          metaMap[clone.id] = {
            title: restoreTitle,
            favIconUrl: restoreFavIcon,
            url: restoreUrl,
            timestamp: now
          };
          await saveRestoredTabMeta(metaMap);
        }
      } catch (err) {
        console.warn(`タブ ${tid} の補填復元失敗:`, err);
      }
    }
  }

  if (modified) {
    await saveCheckedOutTabs(map);
  }
}
