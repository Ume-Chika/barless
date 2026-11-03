// js/slots-view.js - Jumpモード 9スロットタブ一覧描画・選択制御

import { SLOT_COUNT } from './constants.js';
import { createSvgIcon, createFaviconElement, isProtectedFromClose, copyTabUrl } from './utils.js';
import { state, userSettings } from './state.js';
import { jumpToTab, handleShiftClickTab, closeTab, openNewTabSlot } from './actions.js';

export function updateSlotSelection() {
  const slotList = document.getElementById('slotList');
  if (!slotList) return;
  Array.from(slotList.children).forEach((item, idx) => {
    const isSelected = idx === state.selectedSlot;
    item.classList.toggle('selected', isSelected);
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
}

export function clampSlotAndRender() {
  const visibleCount = Math.min(SLOT_COUNT, state.allTabs.length - state.startIndex);
  state.selectedSlot = Math.min(state.selectedSlot, Math.max(0, visibleCount - 1));
  renderSlots();
}

export function slidePage(delta) {
  const nextStart = state.startIndex + delta * SLOT_COUNT;
  if (nextStart < 0 || nextStart >= state.allTabs.length) return;
  state.startIndex = nextStart;
  clampSlotAndRender();
}

export function moveSlotSelection(step) {
  const visibleCount = Math.min(SLOT_COUNT, state.allTabs.length - state.startIndex);
  if (visibleCount === 0) return;
  state.selectedSlot = (state.selectedSlot + step + visibleCount) % visibleCount;
  updateSlotSelection();
}

// スロットアイテム左端の縦線（タブグループ色 / 分割ビュー括りバー）を描画
function renderGroupIndicator(li, currentSlice, slotIdx, tab) {
  const groupId = (tab.groupId && tab.groupId !== -1) ? tab.groupId : (tab.borrowedGroupId || null);
  const splitId = (tab.splitViewId && tab.splitViewId !== -1) ? tab.splitViewId : null;

  // タブグループにもSplitにも属していなければバーは不要
  if (!groupId && !splitId) return;

  // 色：タブグループ所属（出張中含む）ならグループ色、それ以外（グループ外Split）ならグレー
  const color = (groupId && (state.groupColorMap[groupId] || tab.borrowedGroupColor)) || '#71717a';

  // 隣接スロットとの接続性（グループ内同士、または同一Split実体ペア同士）
  const isConnected = (otherTab) => {
    if (!otherTab) return false;
    const sameGroup = Boolean(tab.groupId && tab.groupId !== -1 && otherTab.groupId && otherTab.groupId !== -1 && tab.groupId === otherTab.groupId);
    const otherSplitId = (otherTab.splitViewId && otherTab.splitViewId !== -1) ? otherTab.splitViewId : null;
    const sameSplit = Boolean(splitId && otherSplitId && splitId === otherSplitId);
    return sameGroup || sameSplit;
  };

  const hasPrev = isConnected(currentSlice[slotIdx - 1]);
  const hasNext = isConnected(currentSlice[slotIdx + 1]);
  const posClass = (hasPrev && hasNext) ? 'group-middle'
    : (!hasPrev && hasNext) ? 'group-start'
    : (hasPrev && !hasNext) ? 'group-end'
    : 'group-single';

  const bar = document.createElement('div');
  bar.className = `group-indicator ${posClass}`;
  bar.style.backgroundColor = color;
  li.appendChild(bar);
}

export function renderSlots() {
  const slotList = document.getElementById('slotList');
  const pageInfo = document.getElementById('pageInfo');
  if (!slotList) return;

  const frag = document.createDocumentFragment();
  const currentSlice = state.allTabs.slice(state.startIndex, state.startIndex + SLOT_COUNT);

  currentSlice.forEach((tab, slotIdx) => {
    const isSplitTarget = tab.id === state.splitFirstTabId;
    const isGhost = Boolean(tab.isGhost);
    const isSelected = slotIdx === state.selectedSlot;
    const li = document.createElement('li');
    li.className = 'slot-item'
      + (tab.active ? ' is-active-tab' : '')
      + (isSelected ? ' selected' : '')
      + (isSplitTarget ? ' is-split-selected' : '')
      + (isGhost ? ' is-ghost-tab' : '');
    li.dataset.slotIndex = slotIdx;
    li.dataset.tabId = tab.id;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', isSelected ? 'true' : 'false');

    // タブグループ / Split 縦インジケーター描画
    renderGroupIndicator(li, currentSlice, slotIdx, tab);

    if (userSettings.showSlotNumbers !== false) {
      const keyBadge = document.createElement('span');
      keyBadge.className = 'slot-key';
      keyBadge.textContent = slotIdx + 1;
      li.appendChild(keyBadge);
    }

    if (tab.isNewTabSlot) {
      li.appendChild(createSvgIcon('plus'));
    } else {
      li.appendChild(createFaviconElement(tab.favIconUrl));
    }

    const title = document.createElement('span');
    title.className = 'slot-title';
    title.textContent = tab.title || '新しいタブ';
    li.appendChild(title);

    if (isGhost) {
      const ghostBadge = document.createElement('span');
      ghostBadge.className = 'slot-split-badge slot-ghost-badge';
      ghostBadge.textContent = '出張中';
      li.appendChild(ghostBadge);
    } else if (isSplitTarget) {
      const splitBadge = document.createElement('span');
      splitBadge.className = 'slot-split-badge';
      splitBadge.textContent = 'SPLIT 1/2';
      li.appendChild(splitBadge);
    }

    if (tab.audible) {
      const audible = document.createElement('span');
      audible.className = 'slot-audible';
      audible.title = '音声を再生中';
      audible.appendChild(createSvgIcon('volume'));
      li.appendChild(audible);
    }

    if (!tab.isNewTabSlot && !isGhost) {
      const actions = document.createElement('div');
      actions.className = 'slot-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'slot-action-btn slot-copy-btn';
      copyBtn.title = 'URLをコピー';
      copyBtn.setAttribute('aria-label', 'URLをコピー');
      copyBtn.appendChild(createSvgIcon('link'));
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyTabUrl(tab.url, copyBtn);
      });
      actions.appendChild(copyBtn);

      if (!isProtectedFromClose(tab)) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'slot-action-btn';
        closeBtn.title = 'タブを閉じる';
        closeBtn.setAttribute('aria-label', 'タブを閉じる');
        closeBtn.appendChild(createSvgIcon('close'));
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(tab.id);
        });
        actions.appendChild(closeBtn);
      }
      li.appendChild(actions);
    }

    li.addEventListener('click', (e) => {
      if (tab.isNewTabSlot) return openNewTabSlot(tab);
      if (e.shiftKey) {
        e.preventDefault();
        return handleShiftClickTab(tab);
      }
      jumpToTab(tab.isGhost ? tab.targetTabId : tab.id);
    });

    frag.appendChild(li);
  });

  slotList.replaceChildren(frag);

  if (pageInfo) {
    const totalPages = Math.max(1, Math.ceil(state.allTabs.length / SLOT_COUNT));
    const currentPage = Math.floor(state.startIndex / SLOT_COUNT) + 1;
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
  }
}
