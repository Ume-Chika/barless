// js/utils.js - DOM生成・アイコン生成・URL処理ユーティリティ

import { ICON_PATHS } from './constants.js';

const svgTemplateCache = {};

// SVGアイコン生成（テンプレートキャッシュ＋cloneNodeで文字列パースを最小化）
export function createSvgIcon(type = 'doc') {
  if (!svgTemplateCache[type]) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('aria-hidden', 'true');
    if (type === 'doc' || type === 'plus') {
      svg.setAttribute('class', 'slot-icon-svg');
    } else if (type === 'search' || type === 'history' || type === 'settings') {
      svg.setAttribute('class', 'suggest-icon');
    }
    svg.innerHTML = ICON_PATHS[type] || ICON_PATHS.doc;
    svgTemplateCache[type] = svg;
  }
  return svgTemplateCache[type].cloneNode(true);
}

// ブラウザ内蔵ファビコンキャッシュURL取得（favicon権限）
export function getBrowserFaviconUrl(pageUrl) {
  if (!pageUrl || pageUrl.startsWith('brave://') || pageUrl.startsWith('chrome://')) return '';
  try {
    const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    faviconUrl.searchParams.set('pageUrl', pageUrl);
    faviconUrl.searchParams.set('size', '32');
    return faviconUrl.toString();
  } catch (_) {
    return '';
  }
}

// ファビコン要素生成（エラー時SVGフォールバック）
export function createFaviconElement(favIconUrl, fallbackType = 'doc') {
  if (favIconUrl && !favIconUrl.startsWith('chrome://')) {
    const img = document.createElement('img');
    img.className = 'slot-icon';
    img.src = favIconUrl;
    img.addEventListener('error', () => {
      img.replaceWith(createSvgIcon(fallbackType));
    }, { once: true });
    return img;
  }
  return createSvgIcon(fallbackType);
}

// URL重複比較用の正規化（プロトコル、www、末尾スラッシュを除去した小文字文字列）
export function normalizeUrlForDedupe(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/$/, '').toLowerCase();
    return `${host}${path}`;
  } catch (_) {
    return url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
  }
}

// URLからホスト名・内部スキームを抽出（1行スリム表示用）
export function extractDomain(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'brave:' || u.protocol === 'chrome:') {
      const target = u.hostname || u.pathname.replace(/^\//, '');
      return `${u.protocol}//${target}`;
    }
    return u.host.replace(/^www\./i, '');
  } catch (_) {
    return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  }
}

// 入力文字列が直接開くべきURL・ドメインか判定（コードファイル名等は除外）
export function isLikelyUrl(input) {
  if (/^(https?|brave|chrome):\/\//i.test(input)) return true;
  if (/\s/.test(input)) return false;
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(input)) return true;
  if (!input.includes('/') && /\.(js|ts|jsx|tsx|mjs|cjs|md|json|py|rb|go|rs|vue|svelte|css|html|txt|sh|yml|yaml)$/i.test(input)) {
    return false;
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(input);
}

// タブが閉じる操作（×ボタン、Deleteキー）から保護されているか判定
export function isProtectedFromClose(tab) {
  if (!tab) return true;
  if (tab.isGhost || tab.isNewTabSlot) return true;
  if (tab.borrowedGroupId) return true;
  if (tab.groupId && tab.groupId !== -1) return true;
  return false;
}

// タブURLをクリップボードにコピーし、ボタンのフィードバックを表示
export async function copyTabUrl(url, buttonEl) {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    if (buttonEl) {
      buttonEl.classList.add('is-copied');
      buttonEl.replaceChildren(createSvgIcon('check'));
      setTimeout(() => {
        buttonEl.classList.remove('is-copied');
        buttonEl.replaceChildren(createSvgIcon('link'));
      }, 1200);
    }
  } catch (_) {}
}
