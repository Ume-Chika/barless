// options.js - 設定とヘルプページ制御 (ES Module)

import { DEFAULT_SETTINGS } from './js/constants.js';

const searchEngineSelect = document.getElementById('searchEngineSelect');
const suggestToggle = document.getElementById('suggestToggle');
const shortcutsGuideToggle = document.getElementById('shortcutsGuideToggle');
const slotNumbersToggle = document.getElementById('slotNumbersToggle');
const newTabSlotToggle = document.getElementById('newTabSlotToggle');
const smartGroupReturnToggle = document.getElementById('smartGroupReturnToggle');
const saveStatus = document.getElementById('saveStatus');
const chipsContainer = document.getElementById('chipsContainer');
const customUrlInput = document.getElementById('customUrlInput');
const tagsInputBox = document.getElementById('tagsInputBox');

let saveTimeout = null;
let customUrls = [];

function showSaved() {
  saveStatus.classList.add('show');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveStatus.classList.remove('show');
  }, 1600);
}

function renderChips() {
  chipsContainer.replaceChildren();
  customUrls.forEach((url, idx) => {
    const chip = document.createElement('div');
    chip.className = 'url-chip';

    const text = document.createElement('span');
    text.className = 'chip-text';
    text.textContent = url;
    chip.appendChild(text);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'chip-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `${url} を削除`);
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      customUrls.splice(idx, 1);
      renderChips();
      saveSettings();
    });
    chip.appendChild(removeBtn);

    chipsContainer.appendChild(chip);
  });
}

// コンテナクリックで入力欄へフォーカス
tagsInputBox.addEventListener('click', (e) => {
  if (e.target !== customUrlInput && !e.target.classList.contains('chip-remove')) {
    customUrlInput.focus();
  }
});

// EnterでURL追加
customUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = customUrlInput.value.trim();
    if (!val) return;

    if (!customUrls.includes(val)) {
      customUrls.push(val);
      renderChips();
      saveSettings();
    }
    customUrlInput.value = '';
  }
});

// 設定の初期ロード
async function loadSettings() {
  try {
    const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    searchEngineSelect.value = data.searchEngine;
    suggestToggle.checked = data.enableSuggest;
    shortcutsGuideToggle.checked = data.showShortcutsGuide !== false;
    slotNumbersToggle.checked = data.showSlotNumbers !== false;
    newTabSlotToggle.checked = data.showNewTabSlot === true;
    smartGroupReturnToggle.checked = data.smartGroupReturn !== false;
    customUrls = Array.isArray(data.customUrls) ? data.customUrls : [];
    renderChips();
  } catch (err) {
    console.warn('設定読み込み失敗:', err);
  }
}

// 設定の保存
async function saveSettings() {
  try {
    await chrome.storage.sync.set({
      searchEngine: searchEngineSelect.value,
      enableSuggest: suggestToggle.checked,
      showShortcutsGuide: shortcutsGuideToggle.checked,
      showSlotNumbers: slotNumbersToggle.checked,
      showNewTabSlot: newTabSlotToggle.checked,
      smartGroupReturn: smartGroupReturnToggle.checked,
      customUrls
    });
    showSaved();
  } catch (err) {
    console.warn('設定保存失敗:', err);
  }
}

[searchEngineSelect, suggestToggle, shortcutsGuideToggle, slotNumbersToggle, newTabSlotToggle, smartGroupReturnToggle].forEach((el) => {
  el.addEventListener('change', saveSettings);
});

// ブラウザ標準ショートカット設定画面を開く
document.querySelectorAll('.shortcut-open-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
});

function applyPlatformKeys() {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
  document.querySelectorAll('[data-mac]').forEach((el) => {
    el.textContent = isMac ? el.dataset.mac : el.dataset.win;
  });
}

applyPlatformKeys();
loadSettings();
