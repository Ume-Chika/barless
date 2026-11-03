// js/navigation.js - モード切替（Jump / Search）と表示同期

import { state, applyGuideVisibility } from './state.js';
import { renderZeroPrefixSuggestions, updateSuggestionsAndHistory } from './search-view.js';

export function updateViewMode(isSearching) {
  const slotList = document.getElementById('slotList');
  const suggestionList = document.getElementById('suggestionList');
  const pagination = document.getElementById('pagination');
  const shortcutsGuide = document.getElementById('shortcutsGuide');
  const searchInput = document.getElementById('searchInput');

  searchInput?.setAttribute('aria-expanded', isSearching ? 'true' : 'false');
  searchInput?.setAttribute('aria-controls', isSearching ? 'suggestionList' : 'slotList');

  if (isSearching) {
    if (slotList) slotList.style.display = 'none';
    if (suggestionList) suggestionList.style.display = 'flex';
    if (pagination) pagination.style.display = 'none';
    if (shortcutsGuide) {
      shortcutsGuide.innerHTML = `
        <span><kbd>↑</kbd><kbd>↓</kbd> 選択</span>
        <span><kbd>Enter</kbd> 決定</span>
        <span><kbd>Tab</kbd> ジャンプ切替</span>
      `;
    }
  } else {
    if (slotList) slotList.style.display = 'flex';
    if (suggestionList) suggestionList.style.display = 'none';
    if (pagination) pagination.style.display = 'flex';
    if (shortcutsGuide) {
      shortcutsGuide.innerHTML = `
        <span><kbd>1</kbd>-<kbd>9</kbd> 移動</span>
        <span><kbd>←</kbd><kbd>→</kbd> ページ</span>
        <span><kbd>Tab</kbd> 検索切替</span>
        <span><kbd>?</kbd> ヘルプ</span>
      `;
    }
  }

  applyGuideVisibility(isSearching);
}

export function promoteToSearchMode() {
  if (state.currentMode === 'search') return;
  state.currentMode = 'search';
  const modeTag = document.getElementById('modeTag');
  const searchInput = document.getElementById('searchInput');
  if (modeTag) {
    modeTag.className = 'mode-tag mode-search';
    modeTag.textContent = 'Search';
  }
  searchInput?.classList.add('active');
}

export function setMode(mode) {
  const modeTag = document.getElementById('modeTag');
  const searchInput = document.getElementById('searchInput');

  if (mode === 'jump') {
    if (state.currentMode === 'search') {
      state.deleteCooldownUntil = Date.now() + 400;
    }
    state.currentMode = 'jump';
    if (modeTag) {
      modeTag.className = 'mode-tag mode-jump';
      modeTag.textContent = 'Jump';
    }
    searchInput?.classList.remove('active');
    updateViewMode(false);
  } else {
    promoteToSearchMode();
    const query = searchInput ? searchInput.value.trim() : '';
    if (query) {
      updateSuggestionsAndHistory(query);
    } else {
      renderZeroPrefixSuggestions();
    }
  }
  searchInput?.focus();
}
