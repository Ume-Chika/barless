// js/state-ghosts.js - ゴーストスロット生成・グループ境界充填アルゴリズム

import { COLOR_MAP } from './constants.js';

// グループ境界を維持しながらゴーストスロットを安全に挿入
export function insertGroupGhosts(displayTabs, checkedOutTabs) {
  if (!checkedOutTabs || Object.keys(checkedOutTabs).length === 0) {
    return;
  }

  displayTabs.forEach(t => {
    const checkout = checkedOutTabs[t.id];
    if (checkout) {
      t.borrowedGroupColor = COLOR_MAP[checkout.groupColor] || '#8ab4f8';
      t.borrowedGroupId = checkout.groupId;
    }
  });

  const ghostsByGroup = new Map();
  for (const [tidStr, checkout] of Object.entries(checkedOutTabs)) {
    const tid = parseInt(tidStr, 10);
    const realTab = displayTabs.find(t => t.id === tid);
    const gid = checkout.groupId;
    if (!ghostsByGroup.has(gid)) ghostsByGroup.set(gid, []);
    ghostsByGroup.get(gid).push({
      tid,
      originalIndex: checkout.originalIndex || 0,
      logicalIndex: checkout.logicalIndex ?? checkout.originalIndex ?? 0,
      groupRelativeIndex: checkout.groupRelativeIndex ?? 0,
      ghostObj: {
        id: `ghost-${tid}`,
        isGhost: true,
        targetTabId: tid,
        groupId: checkout.groupId,
        borrowedGroupColor: COLOR_MAP[checkout.groupColor] || '#8ab4f8',
        title: realTab ? (realTab.title || '（出張中）') : (checkout.title || '（出張中）'),
        favIconUrl: realTab ? (realTab.favIconUrl || '') : '',
        active: false,
        url: realTab ? realTab.url : checkout.url
      }
    });
  }

  for (const ghosts of ghostsByGroup.values()) {
    ghosts.sort((a, b) => (a.groupRelativeIndex - b.groupRelativeIndex) || (a.logicalIndex - b.logicalIndex));
  }

  const sortedGroups = Array.from(ghostsByGroup.entries()).sort((a, b) => {
    const minLogA = Math.min(...a[1].map(g => g.logicalIndex));
    const minLogB = Math.min(...b[1].map(g => g.logicalIndex));
    return minLogA - minLogB;
  });

  for (const [gid, ghosts] of sortedGroups) {
    const curGroupIndices = [];
    displayTabs.forEach((t, idx) => {
      if (t.groupId === gid) curGroupIndices.push(idx);
    });

    if (curGroupIndices.length > 0) {
      // パターンA: グループ内に実体タブが存在する場合（空き相対スロット充填・一括置換）
      const minIdx = curGroupIndices[0];
      const count = curGroupIndices.length;
      const occupiedRelIndices = new Set(ghosts.map(g => g.groupRelativeIndex));

      const liveMembers = [];
      let curSlot = 0;
      for (let i = 0; i < count; i++) {
        while (occupiedRelIndices.has(curSlot)) {
          curSlot++;
        }
        liveMembers.push({
          relIndex: curSlot,
          tabObj: displayTabs[minIdx + i]
        });
        curSlot++;
      }

      const allGroupMembers = [
        ...ghosts.map(g => ({ relIndex: g.groupRelativeIndex, tabObj: g.ghostObj })),
        ...liveMembers
      ];
      allGroupMembers.sort((a, b) => a.relIndex - b.relIndex);
      displayTabs.splice(minIdx, count, ...allGroupMembers.map(m => m.tabObj));
    } else {
      // パターンB: グループ内のタブが全員出張中の場合（論理インデックス換算境界へ挿入）
      const targetLogical = typeof ghosts[0].logicalIndex === 'number'
        ? ghosts[0].logicalIndex
        : ghosts[0].originalIndex;
      let targetIdx = Math.min(displayTabs.length, Math.max(0, targetLogical));

      if (targetIdx < displayTabs.length && displayTabs[targetIdx].groupId && displayTabs[targetIdx].groupId !== -1) {
        const conflictingGroupId = displayTabs[targetIdx].groupId;
        const conflictIndices = [];
        displayTabs.forEach((t, i) => {
          if (t.groupId === conflictingGroupId) conflictIndices.push(i);
        });
        if (conflictIndices.length > 0) {
          const cMin = conflictIndices[0];
          const cMax = conflictIndices[conflictIndices.length - 1];
          targetIdx = (targetIdx - cMin < cMax + 1 - targetIdx) ? cMin : cMax + 1;
        }
      }

      ghosts.forEach((g, offset) => {
        displayTabs.splice(targetIdx + offset, 0, g.ghostObj);
      });
    }
  }
}
