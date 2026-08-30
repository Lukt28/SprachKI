// Wörterbuch: durchsuchen, filtern, bearbeiten.

import { $, el, debounce, normalize, relativeDay } from '../util.js';
import { vocab, settings, MAX_BOX } from '../store.js';
import { openVocabSheet } from './vocabsheet.js';

let filter = 'all';
let query = '';

export function initDictionary() {
  const search = $('#dict-search');
  search.addEventListener('input', debounce(() => {
    query = search.value.trim();
    renderDictionary();
  }, 160));

  $('#dict-filters').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filter = chip.dataset.filter;
    [...$('#dict-filters').children].forEach(c => c.classList.toggle('is-on', c === chip));
    renderDictionary();
  });

  document.addEventListener('vocab:changed', () => renderDictionary());
  renderDictionary();
}

export function dictionaryActions() {
  return [el('button', {
    class: 'bar-btn', html: '<span>＋</span><span>Neu</span>',
    onclick: () => openVocabSheet({ onSaved: renderDictionary }),
  })];
}

function matches(entry) {
  if (filter === 'due' && (entry.dueAt ?? 0) > Date.now()) return false;
  if (filter === 'word' && entry.kind === 'phrase') return false;
  if (filter === 'phrase' && entry.kind !== 'phrase') return false;
  if (filter === 'bolivia' && !entry.bolivian) return false;
  if (!query) return true;
  const q = normalize(query);
  return [entry.es, entry.de, entry.example, entry.note]
    .some(f => f && normalize(f).includes(q));
}

export function renderDictionary() {
  const list = $('#dict-list');
  if (!list) return;
  list.innerHTML = '';

  const items = vocab.filter(matches);

  if (!items.length) {
    list.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big', text: vocab.length ? '🔍' : '📖' }),
      el('h2', { text: vocab.length ? 'Nichts gefunden' : 'Noch keine Vokabeln' }),
      el('p', { text: vocab.length
        ? 'Ändere den Suchbegriff oder den Filter.'
        : `Sag im Gespräch einfach „${settings.renaName}, merk dir das“ — oder tipp oben rechts auf ＋.` }),
    ));
    return;
  }

  const now = Date.now();
  const groups = [
    ['Jetzt fällig', items.filter(v => (v.dueAt ?? 0) <= now)],
    ['Später dran',  items.filter(v => (v.dueAt ?? 0) >  now)],
  ];

  for (const [title, group] of groups) {
    if (!group.length) continue;
    list.append(el('div', { class: 'dict-group', text: `${title} · ${group.length}` }));
    for (const entry of group) list.append(entryRow(entry));
  }
}

function entryRow(entry) {
  const dots = el('div', { class: 'box-dots', title: `Fach ${entry.box || 1} von ${MAX_BOX}` });
  for (let i = 1; i <= MAX_BOX; i++) dots.append(el('i', { class: i <= (entry.box || 1) ? 'on' : '' }));

  const tags = el('div', { class: 'entry-tags' });
  if (entry.bolivian) tags.append(el('span', { class: 'tag bo', text: '🇧🇴 Bolivien' }));
  tags.append(el('span', { class: 'tag', text: entry.kind === 'phrase' ? 'Wendung' : 'Wort' }));
  if ((entry.dueAt ?? 0) <= Date.now()) tags.append(el('span', { class: 'tag due', text: 'fällig' }));
  else tags.append(el('span', { class: 'tag', text: relativeDay(entry.dueAt) }));
  if (entry.right || entry.wrong) {
    tags.append(el('span', { class: 'tag', text: `${entry.right || 0}✓ / ${entry.wrong || 0}✗` }));
  }

  const row = el('div', { class: 'entry' },
    el('div', { class: 'entry-main' },
      el('div', { class: 'es', text: entry.es }),
      el('div', { class: 'de', text: entry.de || '—' }),
      entry.example ? el('div', { class: 'ex', text: `„${entry.example}“` }) : null,
      entry.note ? el('div', { class: 'note', text: entry.note }) : null,
      tags,
    ),
    dots,
  );
  row.addEventListener('click', () => openVocabSheet({ entry, onSaved: renderDictionary }));
  return row;
}
