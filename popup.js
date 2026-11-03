// popup.js - エントリーポイント＆入力イベントリスナー (ES Module)

import { SLOT_COUNT } from './js/constants.js';
import { state, fetchAndInitTabs } from './js/state.js';
import { renderSlots } from './js/slots-view.js';
import { updateSuggestionsAndHistory } from './js/search-view.js';
import { setMode, promoteToSearchMode } from './js/navigation.js';
import { handleKeyDown, handleWheelSwipe } from './js/keyboard.js';

const searchInput = document.getElementById('searchInput');
let debounceTimer = null;

searchInput.addEventListener('compositionstart', () => {
  state.isComposing = true;
});

searchInput.addEventListener('compositionend', () => {
  state.isComposing = false;
  state.lastCompositionEndTime = Date.now();
  const query = searchInput.value.trim();
  if (query) {
    promoteToSearchMode();
    updateSuggestionsAndHistory(query);
  } else {
    searchInput.value = '';
    setMode('jump');
  }
});

searchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  if (!query) {
    clearTimeout(debounceTimer);
    if (!state.isComposing) {
      searchInput.value = '';
      setMode('jump');
    }
    return;
  }

  promoteToSearchMode();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updateSuggestionsAndHistory(query);
  }, 60);
});

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('wheel', handleWheelSwipe, { passive: false });

async function init() {
  try {
    const tabs = await fetchAndInitTabs(() => renderSlots());
    if (!tabs) return;

    const activeIdx = Math.max(0, tabs.findIndex(t => t.active));
    state.startIndex = Math.floor(activeIdx / SLOT_COUNT) * SLOT_COUNT;
    state.selectedSlot = activeIdx % SLOT_COUNT;

    renderSlots();
    if (state.currentMode !== 'jump' || searchInput.value) {
      setMode(searchInput.value ? 'search' : 'jump');
    }
  } catch (err) {
    console.error('初期化失敗:', err);
  }
}

init();
