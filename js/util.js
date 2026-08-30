// Kleine DOM- und Allzweck-Helfer.

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function debounce(fn, ms = 220) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const DAY = 86400000;

export function relativeDay(ts) {
  if (!ts) return '';
  const diff = Math.round((ts - Date.now()) / DAY);
  if (diff <= 0)  return 'jetzt fällig';
  if (diff === 1) return 'morgen';
  return `in ${diff} Tagen`;
}

/** Zerlegt einen Satz in Wörter (inkl. spanischer Sonderzeichen) für den Wort-Picker. */
export function splitWords(text = '') {
  return text.split(/[^\p{L}\p{M}'’-]+/u).filter(w => w.length > 1);
}

/** Für Vergleiche: Kleinschreibung, ohne Akzente und Satzzeichen. */
export function normalize(s = '') {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:"'`´()\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ───────────────── Toast ───────────────── */

export function toast(message, kind = '') {
  const host = $('#toast-host');
  if (!host) return;
  const node = el('div', { class: `toast ${kind}`, text: message });
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, kind === 'err' ? 4200 : 2100);
}

/* ───────────────── Sheet (Bottom-Dialog) ───────────────── */

let sheetCloser = null;

export function openSheet(build) {
  const host = $('#sheet-host');
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  sheet.append(el('div', { class: 'sheet-grip' }));
  build(sheet, closeSheet);
  host.hidden = false;
  document.body.style.overflow = 'hidden';
  sheetCloser = closeSheet;
  const first = sheet.querySelector('input, textarea, select');
  if (first && !first.hasAttribute('data-nofocus')) setTimeout(() => first.focus(), 260);
}

export function closeSheet() {
  const host = $('#sheet-host');
  if (!host || host.hidden) return;
  host.hidden = true;
  document.body.style.overflow = '';
  sheetCloser = null;
}

document.addEventListener('DOMContentLoaded', () => {
  $('#sheet-scrim')?.addEventListener('click', () => sheetCloser?.());
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') sheetCloser?.(); });

/** Ja/Nein-Rückfrage als Sheet. Liefert ein Promise<boolean>. */
export function confirmSheet({ title, body, confirmLabel = 'Ja', danger = false }) {
  return new Promise(resolve => {
    openSheet((sheet, close) => {
      sheet.append(
        el('h3', { text: title }),
        body ? el('p', { class: 'sub', text: body }) : null,
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn ghost', onclick: () => { close(); resolve(false); }, text: 'Abbrechen' }),
          el('button', {
            class: danger ? 'btn danger' : 'btn',
            onclick: () => { close(); resolve(true); },
            text: confirmLabel
          })
        )
      );
    });
  });
}
