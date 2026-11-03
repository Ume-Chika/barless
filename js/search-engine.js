// js/search-engine.js - 統合検索（開いているタブ・クイックURL・TopSites・Googleサジェスト・履歴）

import { state, userSettings } from './state.js';
import { getBrowserFaviconUrl, normalizeUrlForDedupe } from './utils.js';

export function searchCustomUrls(query) {
  if (!userSettings.customUrls || userSettings.customUrls.length === 0) return [];
  const qLower = query.toLowerCase().trim();
  if (!qLower) return [];

  const matched = userSettings.customUrls.filter(u => {
    const uLower = u.toLowerCase();
    return uLower.includes(qLower) || uLower.replace(/^(https?|brave|chrome):\/\//, '').includes(qLower);
  });

  return matched.slice(0, 3).map(url => {
    const isInternal = url.startsWith('brave://') || url.startsWith('chrome://');
    return {
      type: 'custom_url',
      title: url,
      url,
      favIconUrl: isInternal ? '' : getBrowserFaviconUrl(url),
      badge: 'クイック',
      iconType: isInternal ? 'settings' : 'link'
    };
  });
}

// 開いているタブから一致検索（最優先で最大3件）
export function searchOpenTabs(query) {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return [];

  const matches = state.allTabs.filter(tab => {
    if (tab.isNewTabSlot) return false;
    const haystack = `${tab.title || ''} ${tab.url || ''}`.toLowerCase();
    return keywords.every(kw => haystack.includes(kw));
  });

  matches.sort((a, b) => Number(a.active) - Number(b.active));

  return matches.slice(0, 3).map(tab => ({
    type: 'tab',
    tabId: tab.id,
    title: tab.title || tab.url || '新しいタブ',
    url: tab.url || '',
    favIconUrl: tab.favIconUrl || '',
    badge: 'タブへ移動',
    iconType: 'doc'
  }));
}

// 履歴検索（chrome.history の typedCount / visitCount を活用）
export async function searchHistory(query) {
  try {
    const results = (await chrome.history.search({ text: query, maxResults: 30, startTime: 0 })) || [];
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const qLower = query.toLowerCase();

    const filtered = results.filter(h => {
      if (!h.url || h.url.startsWith('chrome-extension://')) return false;
      const baseUrl = h.url.split('?')[0].toLowerCase();
      const title = (h.title || '').toLowerCase();
      return keywords.every(kw => baseUrl.includes(kw) || title.includes(kw));
    });

    filtered.sort((a, b) => {
      const score = (item) => {
        let s = (item.typedCount || 0) * 25 + (item.visitCount || 0);
        try {
          const u = new URL(item.url);
          const host = u.hostname.replace(/^www\./i, '').toLowerCase();
          if (host.startsWith(qLower)) {
            s += (u.pathname === '/' && !u.search) ? 5000 : 500;
          }
        } catch (_) {}
        return s;
      };
      return score(b) - score(a);
    });

    return filtered;
  } catch (err) {
    console.warn('履歴検索失敗:', err);
    return [];
  }
}

// Googleサジェスト取得（client=chrome）
export async function fetchGoogleSuggestions(query) {
  if (!userSettings.enableSuggest) return [];
  const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;

  let list = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data = await res.json();
      list = data[1] || [];
    }
  } catch (_) {}

  const qLower = query.toLowerCase();
  const prefixMatches = list.filter(s => s.toLowerCase().startsWith(qLower));
  const others = list.filter(s => !s.toLowerCase().startsWith(qLower));
  return [...prefixMatches, ...others];
}

// ゼロプレフィックス提案（未入力時：開いているタブ以外の Top Sites 4件 ＋ 最近の履歴 5件）
export async function getZeroPrefixSuggestions() {
  const openUrlSet = new Set(state.allTabs.map(t => normalizeUrlForDedupe(t.url)).filter(Boolean));
  const seenUrls = new Set();

  const [rawTopSites, rawHistory] = await Promise.all([
    chrome.topSites ? chrome.topSites.get().catch(() => []) : Promise.resolve([]),
    chrome.history.search({ text: '', maxResults: 50, startTime: 0 }).catch(() => [])
  ]);

  const topSiteItems = [];
  for (const site of rawTopSites || []) {
    if (!site.url) continue;
    const norm = normalizeUrlForDedupe(site.url);
    if (!norm || openUrlSet.has(norm) || seenUrls.has(norm)) continue;
    seenUrls.add(norm);

    topSiteItems.push({
      type: 'top_site',
      title: site.title || site.url,
      url: site.url,
      favIconUrl: getBrowserFaviconUrl(site.url),
      badge: 'よく行く',
      iconType: 'link'
    });
    if (topSiteItems.length >= 4) break;
  }

  const historyItems = [];
  const maxHistory = 9 - topSiteItems.length;
  for (const h of rawHistory || []) {
    if (!h.url || h.url.startsWith('chrome-extension://')) continue;
    const norm = normalizeUrlForDedupe(h.url);
    if (!norm || openUrlSet.has(norm) || seenUrls.has(norm)) continue;
    seenUrls.add(norm);

    const isSettings = h.url.startsWith('brave://') || h.url.startsWith('chrome://');
    historyItems.push({
      type: 'recent_history',
      title: h.title || h.url,
      url: h.url,
      favIconUrl: isSettings ? '' : getBrowserFaviconUrl(h.url),
      badge: isSettings ? '設定' : '最近',
      iconType: isSettings ? 'settings' : 'history'
    });
    if (historyItems.length >= maxHistory) break;
  }

  return [...topSiteItems, ...historyItems];
}
