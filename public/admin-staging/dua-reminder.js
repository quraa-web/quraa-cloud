/* QURAA staging dua reminder. Include only on the intended visitor-facing test page.
   This script does not access or modify audio/video elements and never reloads the page. */
(() => {
  'use strict';
  if (window.__QURAA_DUA_REMINDER_LOADED__) return;
  window.__QURAA_DUA_REMINDER_LOADED__ = true;
  const script = document.currentScript;
  const apiBase = (script && script.dataset.api) || 'https://quraa-api-staging.quraaweb.workers.dev';
  const STORE_KEY = 'quraa_dua_reminder_last_shown';
  let timer = null;
  let currentCard = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function removeCard() { if (timer) clearTimeout(timer); timer = null; if (currentCard) currentCard.remove(); currentCard = null; }
  function show(settings, dua) {
    if (!dua || !settings.enabled || !document.body) return;
    const intervalMs = Math.max(1, Number(settings.interval_hours) || 6) * 3600000;
    try { const last = Number(localStorage.getItem(STORE_KEY) || 0); if (Date.now() - last < intervalMs) return; } catch (_) {}
    removeCard();
    const card = document.createElement('aside');
    card.setAttribute('aria-label', 'تذكير بالدعاء');
    const size = ['small','medium','large'].includes(settings.size) ? settings.size : 'medium';
    const position = ['top-left','top-right','bottom-left','bottom-right'].includes(settings.position) ? settings.position : 'bottom-left';
    const maxWidth = size === 'small' ? '260px' : size === 'large' ? 'min(500px,calc(100vw - 28px))' : 'min(360px,calc(100vw - 28px))';
    const fontSize = size === 'small' ? '13px' : size === 'large' ? '19px' : '16px';
    const vertical = position.startsWith('top') ? 'top:14px;' : 'bottom:14px;';
    const horizontal = position.endsWith('left') ? 'left:14px;' : 'right:14px;';
    card.style.cssText = `position:fixed;${vertical}${horizontal}z-index:2147483000;width:calc(100vw - 28px);max-width:${maxWidth};padding:16px 18px;background:#fffdf5;color:#18372c;border:1px solid #d8b66a;border-radius:15px;box-shadow:0 8px 28px rgba(0,0,0,.18);font: ${fontSize}/1.8 Tahoma,Arial,sans-serif;box-sizing:border-box;`;
    card.innerHTML = `<button type="button" aria-label="إغلاق التذكير" style="float:left;border:0;background:transparent;color:#315b47;font-size:22px;cursor:pointer;line-height:1">×</button><strong style="display:block;color:#0d513b;font-size:1.08em;margin:0 28px 8px 0">${esc(dua.title || 'تذكير بالدعاء')}</strong><div style="white-space:pre-wrap">${esc(dua.text || '')}</div>${dua.source ? `<small style="display:block;margin-top:8px;color:#68796d">${esc(dua.source)}</small>` : ''}`;
    card.querySelector('button').addEventListener('click', removeCard);
    document.body.appendChild(card); currentCard = card;
    try { localStorage.setItem(STORE_KEY, String(Date.now())); } catch (_) {}
    const hideSeconds = Math.max(0, Number(settings.auto_hide_seconds) || 0);
    if (hideSeconds) timer = setTimeout(removeCard, hideSeconds * 1000);
  }
  async function init() {
    try {
      const res = await fetch(apiBase.replace(/\/+$/, '') + '/api/public/dua-reminder', { method: 'GET', credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok && data.enabled && data.settings && data.dua) show(data.settings, data.dua);
    } catch (_) { /* fail silently; must not affect Quran playback */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
