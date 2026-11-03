// js/search-view.js - Searchモード候補一覧描画・選択制御

import { state, userSettings } from './state.js';
import { createSvgIcon, createFaviconElement, getBrowserFaviconUrl, extractDomain } from './utils.js';
import { searchCustomUrls, searchOpenTabs, searchHistory, fetchGoogleSuggestions, getZeroPrefixSuggestions } from './search-engine.js';
import { executeItem } from './actions.js';
import { updateViewMode } from './navigation.js';

export function updateSuggestSelection() {
  const suggestionList = document.getElementById('suggestionList');
  if (!suggestionList) return;
  Array.from(suggestionList.children).forEach((item, idx) => {
    const isSelected = idx === state.selectedSuggestIdx;
    item.classList.toggle('selected', isSelected);
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    if (isSelected) {
      item.scrollIntoView({ block: 'nearest' });
    }
  });
}

export function moveSuggestSelection(delta) {
  const len = state.currentItems.length;
  if (len === 0) return;
  state.selectedSuggestIdx = (state.selectedSuggestIdx + delta + len) % len;
  updateSuggestSelection();
}

export function renderCombinedList(items) {
  const suggestionList = document.getElementById('suggestionList');
  if (!suggestionList) return;

  if (state.selectedSuggestIdx >= items.length) {
    state.selectedSuggestIdx = 0;
  }

  const frag = document.createDocumentFragment();
  items.forEach((item, idx) => {
    const isSelected = idx === state.selectedSuggestIdx;
    const li = document.createElement('li');
    li.className = 'suggestion-item' + (isSelected ? ' selected' : '');
    li.dataset.index = idx;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', isSelected ? 'true' : 'false');

    if (item.favIconUrl) {
      li.appendChild(createFaviconElement(item.favIconUrl, item.iconType || 'doc'));
    } else {
      li.appendChild(createSvgIcon(item.iconType));
    }

    const content = document.createElement('div');
    content.className = 'suggest-content';

    const text = document.createElement('span');
    text.className = 'suggest-text';
    text.textContent = item.title;
    content.appendChild(text);

    if (item.url) {
      const domain = extractDomain(item.url);
      if (domain) {
        const domainSpan = document.createElement('span');
        domainSpan.className = 'suggest-domain';
        domainSpan.textContent = domain;
        content.appendChild(domainSpan);
      }
    }
    li.appendChild(content);

    const badge = document.createElement('span');
    badge.className = 'suggest-badge' + (item.type === 'tab' ? ' badge-tab' : '');
    badge.textContent = item.badge;
    li.appendChild(badge);

    li.addEventListener('click', () => executeItem(item));
    frag.appendChild(li);
  });

  suggestionList.replaceChildren(frag);
  updateViewMode(true);
}

export async function renderZeroPrefixSuggestions() {
  try {
    state.currentItems = await getZeroPrefixSuggestions();
    state.selectedSuggestIdx = 0;
    renderCombinedList(state.currentItems);
  } catch (err) {
    console.warn('ゼロプレフィックス提案生成失敗:', err);
  }
}

// 候補の更新（①開いているタブ → ②クイックURL → ③よく行くサイト → ④入力文字でWeb検索 → ⑤サジェスト → ⑥履歴）
export async function updateSuggestionsAndHistory(query) {
  const searchInput = document.getElementById('searchInput');
  const qLower = query.toLowerCase().trim();
  const customItems = searchCustomUrls(query);
  const tabItems = searchOpenTabs(query);

  const engineBadge = {
    brave: 'Brave 検索',
    duckduckgo: 'DuckDuckGo',
    google: 'Google 検索'
  }[userSettings.searchEngine] || 'Web 検索';

  const rawSearchItem = {
    type: 'search',
    title: query,
    url: null,
    badge: engineBadge,
    iconType: 'search'
  };

  state.selectedSuggestIdx = 0;
  const baseItems = [...tabItems, ...customItems];
  state.currentItems = [...baseItems, rawSearchItem];
  renderCombinedList(state.currentItems);

  const [historyItems, suggestions] = await Promise.all([
    searchHistory(query),
    fetchGoogleSuggestions(query)
  ]);

  if (searchInput && searchInput.value.trim() !== query) return;

  const seenUrls = new Set([...tabItems.map(t => t.url), ...customItems.map(c => c.url)].filter(Boolean));

  let topSiteItem = null;
  if (historyItems.length > 0) {
    const best = historyItems[0];
    try {
      const u = new URL(best.url);
      const host = u.hostname.replace(/^www\./i, '').toLowerCase();
      const isTopDomainMatch = host.startsWith(qLower)
        && ((u.pathname === '/' && !u.search) || (best.typedCount || 0) > 0 || (best.visitCount || 0) >= 3);
      if (isTopDomainMatch && !seenUrls.has(best.url)) {
        seenUrls.add(best.url);
        topSiteItem = {
          type: 'history',
          title: best.title || host,
          url: best.url,
          favIconUrl: getBrowserFaviconUrl(best.url),
          badge: '履歴',
          iconType: 'history'
        };
      }
    } catch (_) {}
  }

  const items = topSiteItem
    ? [...baseItems, topSiteItem, rawSearchItem]
    : [...baseItems, rawSearchItem];

  let suggestCount = 0;
  for (const s of suggestions) {
    if (s.toLowerCase() === qLower) continue;
    items.push({
      type: 'suggest',
      title: s,
      url: null,
      badge: '候補',
      iconType: 'search'
    });
    if (++suggestCount >= 4) break;
  }

  const maxBottomHistory = topSiteItem ? 2 : 3;
  let historyCount = 0;
  for (const h of historyItems) {
    if (!h.url || seenUrls.has(h.url)) continue;
    seenUrls.add(h.url);

    const isSettings = h.url.startsWith('brave://') || h.url.startsWith('chrome://');
    items.push({
      type: 'history',
      title: h.title || h.url,
      url: h.url,
      favIconUrl: isSettings ? '' : getBrowserFaviconUrl(h.url),
      badge: isSettings ? '設定' : '履歴',
      iconType: isSettings ? 'settings' : 'history'
    });
    if (++historyCount >= maxBottomHistory) break;
  }

  state.currentItems = items.slice(0, 9);
  renderCombinedList(state.currentItems);
}
