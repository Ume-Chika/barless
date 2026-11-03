// js/background-split.js - 分割ビュー管理・操作ディスパッチ（ファサード）

import { activateAndWakeTab } from './background-tabs.js';
import {
  pendingSplitTabIds,
  getCheckedOutTabs,
  saveCheckedOutTabs,
  updateCheckedOutTabInfo,
  updateRemappedGroupIds,
  getGroupRelativeIndex,
  getLogicalIndex
} from './split-state.js';
import { placeTabInGroup, reconcileCheckedOutTabs } from './split-reconcile.js';
import {
  getLogicalPlacement,
  checkCanDisplayInGroupWithoutReorder,
  prepareTabForSplit
} from './split-planner.js';

// テスト・外部モジュール用エクスポート
export {
  pendingSplitTabIds,
  getCheckedOutTabs,
  updateCheckedOutTabInfo,
  reconcileCheckedOutTabs
};

// 選択タブと新規URL（検索結果・履歴等）の2画面分割
export async function openSplitWithUrl(firstTabId, url) {
  pendingSplitTabIds.add(firstTabId);
  let targetActiveTabId = null;
  let targetWindowId = undefined;

  try {
    const origLeft = await chrome.tabs.get(firstTabId);
    targetWindowId = origLeft.windowId;

    const checkedOutMap = await getCheckedOutTabs();
    const leftRel = await getGroupRelativeIndex(origLeft, checkedOutMap);
    const leftLog = getLogicalIndex(origLeft, checkedOutMap);
    const leftTab = await prepareTabForSplit(firstTabId, leftRel, leftLog);

    const rightTab = await chrome.tabs.create({
      windowId: targetWindowId,
      url,
      active: false
    });
    pendingSplitTabIds.add(rightTab.id);

    try {
      await chrome.tabs.move(leftTab.id, { index: -1 });
      await chrome.tabs.move(rightTab.id, { index: -1 });
    } catch (_) {}

    const freshLeft = await chrome.tabs.get(leftTab.id);
    const freshRight = await chrome.tabs.get(rightTab.id);
    targetActiveTabId = freshRight.id;

    if (chrome.tabs.createSplit) {
      await chrome.tabs.createSplit([freshLeft.id, freshRight.id]);
    }
  } finally {
    pendingSplitTabIds.clear();
  }

  await reconcileCheckedOutTabs(targetWindowId);
  await activateAndWakeTab(targetActiveTabId, targetWindowId);
}

// 2つの既存タブを分割ビューにする
export async function openSplitTabs(firstTabId, secondTabId) {
  pendingSplitTabIds.add(firstTabId);
  pendingSplitTabIds.add(secondTabId);
  let targetActiveTabId = secondTabId;
  let targetWindowId = undefined;

  try {
    const orig1 = await chrome.tabs.get(firstTabId);
    const orig2 = await chrome.tabs.get(secondTabId);
    targetWindowId = orig1.windowId;

    let leftId = firstTabId;
    let rightId = secondTabId;
    if (orig1.splitViewId && orig1.splitViewId !== -1 && orig1.splitViewId === orig2.splitViewId) {
      const [curLeft, curRight] = orig1.index < orig2.index ? [orig1, orig2] : [orig2, orig1];
      leftId = curRight.id;
      rightId = curLeft.id;
    }

    const tabLeft = (leftId === firstTabId) ? orig1 : orig2;
    const tabRight = (rightId === secondTabId) ? orig2 : orig1;
    const checkedOutMap = await getCheckedOutTabs();

    const p1 = getLogicalPlacement(tabLeft, checkedOutMap);
    const p2 = getLogicalPlacement(tabRight, checkedOutMap);

    if (orig1.splitViewId && orig1.splitViewId !== -1 && chrome.tabs.unsplit) {
      try { await chrome.tabs.unsplit(orig1.splitViewId); } catch (_) {}
    }
    if (orig2.splitViewId && orig2.splitViewId !== -1 && chrome.tabs.unsplit) {
      try { await chrome.tabs.unsplit(orig2.splitViewId); } catch (_) {}
    }

    const canDisplayInGroup = await checkCanDisplayInGroupWithoutReorder(p1, p2, targetWindowId, checkedOutMap);

    if (canDisplayInGroup) {
      let mapModified = false;
      if (p1.isCheckout) {
        const effectiveGroupId = await placeTabInGroup(leftId, checkedOutMap[leftId], targetWindowId, checkedOutMap);
        updateRemappedGroupIds(checkedOutMap, p1.groupId, effectiveGroupId);
        delete checkedOutMap[leftId];
        mapModified = true;
      }
      if (p2.isCheckout) {
        const effectiveGroupId = await placeTabInGroup(rightId, checkedOutMap[rightId], targetWindowId, checkedOutMap);
        updateRemappedGroupIds(checkedOutMap, p2.groupId, effectiveGroupId);
        delete checkedOutMap[rightId];
        mapModified = true;
      }
      if (mapModified) await saveCheckedOutTabs(checkedOutMap);

      if (chrome.tabs.createSplit) {
        await chrome.tabs.createSplit([leftId, rightId]);
      }
      await reconcileCheckedOutTabs(targetWindowId);
      await activateAndWakeTab(targetActiveTabId, targetWindowId);
      return;
    }

    // YES出張
    const leftRel = await getGroupRelativeIndex(tabLeft, checkedOutMap);
    const rightRel = await getGroupRelativeIndex(tabRight, checkedOutMap);
    const leftLog = getLogicalIndex(tabLeft, checkedOutMap);
    const rightLog = getLogicalIndex(tabRight, checkedOutMap);

    const leftTab = await prepareTabForSplit(leftId, leftRel, leftLog);
    const rightTab = await prepareTabForSplit(rightId, rightRel, rightLog);

    try {
      await chrome.tabs.move(leftTab.id, { index: -1 });
      await chrome.tabs.move(rightTab.id, { index: -1 });
    } catch (_) {}

    const freshLeft = await chrome.tabs.get(leftTab.id);
    const freshRight = await chrome.tabs.get(rightTab.id);
    targetActiveTabId = freshRight.id;

    if (chrome.tabs.createSplit) {
      await chrome.tabs.createSplit([freshLeft.id, freshRight.id]);
    }
  } finally {
    pendingSplitTabIds.clear();
  }

  await reconcileCheckedOutTabs(targetWindowId);
  await activateAndWakeTab(targetActiveTabId, targetWindowId);
}

// 分割ビューの解除
export async function unsplitAndActivate(tabId, splitViewId, windowId) {
  if (chrome.tabs.unsplit && splitViewId && splitViewId !== -1) {
    try { await chrome.tabs.unsplit(splitViewId); } catch (_) {}
  }
  await reconcileCheckedOutTabs(windowId);
  await activateAndWakeTab(tabId, windowId);
}
