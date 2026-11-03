// js/keyboard.js - キーボードショートカット・トラックパッドスワイプ制御

import { state } from './state.js';
import { isProtectedFromClose } from './utils.js';
import { slidePage, moveSlotSelection, renderSlots } from './slots-view.js';
import { moveSuggestSelection } from './search-view.js';
import { jumpToTab, handleShiftClickTab, closeTab, executeItem, performSearch } from './actions.js';
import { setMode } from './navigation.js';

let swipeAccumX = 0;
let swipeCooldownUntil = 0;
let swipeResetTimer = null;

export function handleWheelSwipe(e) {
  if (state.currentMode !== 'jump' || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();

  clearTimeout(swipeResetTimer);
  swipeResetTimer = setTimeout(() => { swipeAccumX = 0; }, 120);

  const now = Date.now();
  if (now < swipeCooldownUntil) return;

  swipeAccumX += e.deltaX;
  if (Math.abs(swipeAccumX) >= 35) {
    slidePage(swipeAccumX > 0 ? 1 : -1);
    swipeAccumX = 0;
    swipeCooldownUntil = now + 320;
  }
}

export function handleKeyDown(e) {
  const suggestionList = document.getElementById('suggestionList');
  const searchInput = document.getElementById('searchInput');
  const isSuggesting = suggestionList && suggestionList.style.display === 'flex';
  const isComposing = state.isComposing || e.isComposing;
  const isImeEnter = e.key === 'Enter' && (isComposing || (Date.now() - state.lastCompositionEndTime < 60));

  if (e.key === 'Tab' && !isComposing) {
    e.preventDefault();
    setMode(state.currentMode === 'jump' ? 'search' : 'jump');
    return;
  }

  if (e.key === 'Escape' && !isComposing) {
    e.preventDefault();
    if (state.splitFirstTabId) {
      state.splitFirstTabId = null;
      renderSlots();
      return;
    }
    if (state.currentMode === 'search' || searchInput?.value) {
      if (searchInput) searchInput.value = '';
      setMode('jump');
      return;
    }
    window.close();
    return;
  }

  if (isSuggesting) {
    if (e.key === 'ArrowDown' && !isComposing) {
      e.preventDefault();
      moveSuggestSelection(1);
      return;
    }
    if (e.key === 'ArrowUp' && !isComposing) {
      e.preventDefault();
      moveSuggestSelection(-1);
      return;
    }
    if (e.key === 'Enter') {
      if (isImeEnter) return;
      e.preventDefault();
      const target = state.currentItems[state.selectedSuggestIdx] || { title: searchInput.value, url: null };
      executeItem(target);
      return;
    }
    return;
  }

  if (state.currentMode === 'jump') {
    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isComposing) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
      window.close();
      return;
    }

    const num = Number(e.key) || (e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0);
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && num >= 1 && num <= 9) {
      e.preventDefault();
      const targetTab = state.allTabs[state.startIndex + num - 1];
      if (targetTab) jumpToTab(targetTab.isGhost ? targetTab.targetTabId : targetTab.id);
      return;
    }

    if (isComposing) return;

    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
      if (searchInput.selectionStart !== searchInput.selectionEnd) return;
      e.preventDefault();
      const slotList = document.getElementById('slotList');
      slotList?.children[state.selectedSlot]?.querySelector('.slot-copy-btn')?.click();
      return;
    }

    const isDeleteKey = (!e.metaKey && !e.ctrlKey && !e.altKey) && (
      e.key === 'Delete' || e.key === 'Backspace'
    );
    if (isDeleteKey) {
      e.preventDefault();
      if (e.repeat || Date.now() < state.deleteCooldownUntil) {
        return;
      }
      const targetTab = state.allTabs[state.startIndex + state.selectedSlot];
      if (targetTab && !isProtectedFromClose(targetTab)) {
        closeTab(targetTab.id);
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      slidePage(-1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      slidePage(1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSlotSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSlotSelection(-1);
      return;
    }
    if (e.key === 'Enter' && !isImeEnter) {
      e.preventDefault();
      const targetTab = state.allTabs[state.startIndex + state.selectedSlot];
      if (targetTab) {
        if (e.shiftKey) {
          handleShiftClickTab(targetTab);
        } else if (targetTab.isGhost) {
          jumpToTab(targetTab.targetTabId);
        } else {
          jumpToTab(targetTab.id);
        }
      }
      return;
    }
  }

  if (state.currentMode === 'search' && !isSuggesting && e.key === 'Enter' && !isImeEnter) {
    e.preventDefault();
    if (searchInput.value.trim()) {
      performSearch(searchInput.value);
    }
  }
}
