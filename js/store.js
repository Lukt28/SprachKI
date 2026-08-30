// Persistenz: Einstellungen, Wörterbuch, Gesprächsverlauf — alles lokal auf dem Gerät.

import { uid, DAY, normalize } from './util.js';

const K_SETTINGS = 'rena.settings.v1';
const K_VOCAB    = 'rena.vocab.v1';
const K_HISTORY  = 'rena.history.v1';

export const DEFAULT_SETTINGS = {
  // KI — Schlüssel und Modelle je Anbieter, damit ein Wechsel nichts verliert
  provider: 'gemini',
  apiKeys:          { gemini: '', groq: '', mistral: '' },
  models:           { gemini: '', groq: '', mistral: '' },
  transcribeModels: { groq: '', mistral: '' },
  level: 'A2',
  correctionMode: 'gentle',      // off | gentle | strict
  germanShare: 'auto',           // much | auto | little
  renaName: 'Rena',

  // Stimme
  autoSpeak: true,
  speechRate: 0.95,
  voiceURI: '',
  speechLang: 'es-MX',
  showTranslation: false,

  // Mikrofon
  alwaysOn: true,
  silenceMs: 900,
  sensitivity: 2.4,
  minSpeechMs: 280,
  maxUtteranceMs: 18000,
  bargeIn: false,
  keepAwake: true,

  // Sonstiges
  theme: 'system',
  autoSaveVocab: false,
};

// Leitner-Intervalle je Fach (in Tagen)
export const BOX_DAYS = [0, 1, 3, 7, 21, 60];
export const MAX_BOX = 5;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Speichern fehlgeschlagen', err);
    return false;
  }
}

/* ═══════════════ Einstellungen ═══════════════ */

function loadSettings() {
  const stored = read(K_SETTINGS, {});
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    // Verschachtelte Felder zusammenführen, sonst fehlen neue Anbieter nach einem Update.
    apiKeys:          { ...DEFAULT_SETTINGS.apiKeys,          ...(stored.apiKeys || {}) },
    models:           { ...DEFAULT_SETTINGS.models,           ...(stored.models || {}) },
    transcribeModels: { ...DEFAULT_SETTINGS.transcribeModels, ...(stored.transcribeModels || {}) },
  };

  // Aus der Zeit, als es nur Gemini gab: einzelnes apiKey/model übernehmen.
  if (stored.apiKey && !merged.apiKeys.gemini) merged.apiKeys.gemini = stored.apiKey;
  if (stored.model && !merged.models.gemini)   merged.models.gemini = stored.model;
  delete merged.apiKey;
  delete merged.model;

  return merged;
}

export const settings = loadSettings();

export function saveSettings(patch = {}) {
  Object.assign(settings, patch);
  write(K_SETTINGS, settings);
  applyTheme();
  document.dispatchEvent(new CustomEvent('settings:changed', { detail: patch }));
}

/** Setzt einen Wert in einer Gruppe wie apiKeys/models, ohne die anderen zu verlieren. */
export function saveNested(group, key, value) {
  saveSettings({ [group]: { ...settings[group], [key]: value } });
}

export function applyTheme() {
  const t = settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'light' ? '#faf7f2' : '#141122';
}

/* ═══════════════ Wörterbuch ═══════════════ */

/** @type {Array} */
export let vocab = read(K_VOCAB, []);

function persistVocab() {
  write(K_VOCAB, vocab);
  document.dispatchEvent(new CustomEvent('vocab:changed'));
}

export function findVocab(es) {
  const n = normalize(es);
  return vocab.find(v => normalize(v.es) === n);
}

/**
 * Legt eine Vokabel an oder ergänzt eine vorhandene.
 * @returns {{entry: object, created: boolean}}
 */
export function addVocab({ es, de, kind = 'word', example = '', note = '', bolivian = false, source = 'manual' }) {
  es = (es || '').trim();
  de = (de || '').trim();
  if (!es) throw new Error('Spanischer Eintrag fehlt.');

  const existing = findVocab(es);
  if (existing) {
    // Vorhandenes anreichern statt duplizieren.
    if (de && !existing.de) existing.de = de;
    if (example && !existing.example) existing.example = example;
    if (note && !existing.note) existing.note = note;
    if (bolivian) existing.bolivian = true;
    existing.updatedAt = Date.now();
    persistVocab();
    return { entry: existing, created: false };
  }

  const entry = {
    id: uid(),
    es, de,
    kind: kind === 'phrase' || /\s/.test(es) ? 'phrase' : 'word',
    example, note,
    bolivian: !!bolivian,
    source,
    box: 1,
    dueAt: Date.now(),
    right: 0,
    wrong: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  vocab.unshift(entry);
  persistVocab();
  return { entry, created: true };
}

export function updateVocab(id, patch) {
  const entry = vocab.find(v => v.id === id);
  if (!entry) return null;
  Object.assign(entry, patch, { updatedAt: Date.now() });
  persistVocab();
  return entry;
}

export function removeVocab(id) {
  const i = vocab.findIndex(v => v.id === id);
  if (i < 0) return false;
  vocab.splice(i, 1);
  persistVocab();
  return true;
}

export function replaceVocab(list) {
  vocab = list;
  persistVocab();
}

/** Leitner-Bewertung. grade: 'no' | 'almost' | 'yes' */
export function gradeVocab(id, grade) {
  const entry = vocab.find(v => v.id === id);
  if (!entry) return null;
  if (grade === 'yes') {
    entry.box = Math.min(MAX_BOX, (entry.box || 1) + 1);
    entry.right = (entry.right || 0) + 1;
  } else if (grade === 'almost') {
    entry.wrong = (entry.wrong || 0) + 1;
    // Fach bleibt, aber bald wieder dran.
    entry.box = Math.max(1, entry.box || 1);
  } else {
    entry.box = 1;
    entry.wrong = (entry.wrong || 0) + 1;
  }
  const days = grade === 'almost' ? 1 : BOX_DAYS[entry.box] ?? 1;
  entry.dueAt = Date.now() + days * DAY;
  entry.lastGrade = grade;
  entry.updatedAt = Date.now();
  persistVocab();
  return entry;
}

export function dueVocab(limit = Infinity) {
  const now = Date.now();
  return vocab
    .filter(v => (v.dueAt ?? 0) <= now)
    .sort((a, b) => (a.box - b.box) || ((a.dueAt ?? 0) - (b.dueAt ?? 0)))
    .slice(0, limit);
}

export function vocabStats() {
  const now = Date.now();
  return {
    total: vocab.length,
    due: vocab.filter(v => (v.dueAt ?? 0) <= now).length,
    learned: vocab.filter(v => (v.box || 1) >= 4).length,
    fresh: vocab.filter(v => (v.box || 1) === 1).length,
  };
}

/* ═══════════════ Gesprächsverlauf ═══════════════ */

const HISTORY_MAX = 40;

/** @type {Array<{role:'user'|'model', text:string, ts:number}>} */
export let history = read(K_HISTORY, []);

export function pushHistory(role, text, extra = {}) {
  if (!text) return null;
  const turn = { id: uid(), role, text, ts: Date.now(), ...extra };
  history.push(turn);
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  write(K_HISTORY, history);
  return turn;
}

/** Merkt sich am Gesprächszug, dass ein Vorschlag ins Wörterbuch übernommen wurde. */
export function markHistoryVocabSaved(turnId, es) {
  const turn = history.find(h => h.id === turnId);
  if (!turn) return;
  turn.savedVocab = [...new Set([...(turn.savedVocab || []), es])];
  write(K_HISTORY, history);
}

export function clearHistory() {
  history = [];
  write(K_HISTORY, history);
}

/* ═══════════════ Export / Import ═══════════════ */

export function exportJson() {
  return JSON.stringify({
    app: 'Rena — bolivianisches Spanisch',
    version: 1,
    exportedAt: new Date().toISOString(),
    vocab,
  }, null, 2);
}

export function exportCsv() {
  const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const head = ['Spanisch', 'Deutsch', 'Art', 'Beispiel', 'Notiz', 'Bolivianisch', 'Fach', 'Faellig'];
  const rows = vocab.map(v => [
    v.es, v.de, v.kind === 'phrase' ? 'Satz' : 'Wort', v.example, v.note,
    v.bolivian ? 'ja' : '', v.box ?? 1,
    v.dueAt ? new Date(v.dueAt).toISOString().slice(0, 10) : '',
  ].map(esc).join(','));
  return [head.map(esc).join(','), ...rows].join('\r\n');
}

/** Importiert JSON-Export oder rohes Array. Liefert Anzahl neuer Einträge. */
export function importJson(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.vocab;
  if (!Array.isArray(list)) throw new Error('Keine Vokabelliste in der Datei gefunden.');
  let added = 0;
  for (const raw of list) {
    if (!raw || !raw.es) continue;
    const before = vocab.length;
    addVocab({
      es: raw.es, de: raw.de, kind: raw.kind, example: raw.example,
      note: raw.note, bolivian: raw.bolivian, source: raw.source || 'import',
    });
    if (vocab.length > before) added++;
  }
  return added;
}
