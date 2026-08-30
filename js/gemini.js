// Anbindung an die Gemini-API (kostenloses Kontingent aus Google AI Studio).
// Die Anfragen gehen direkt vom iPhone an Google — kein eigener Server nötig.

import { buildSystemPrompt } from './persona.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 75000;
const K_USAGE = 'rena.usage.v1';

/* ─────────── Antwort-Schema ─────────── */

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    heard: {
      type: 'STRING',
      description: 'Wörtliche Transkription dessen, was in der Aufnahme gesagt wurde. Leer bei getipptem Text.',
    },
    heardLang: { type: 'STRING', enum: ['de', 'es', 'mixed', 'unclear'] },
    reply: {
      type: 'STRING',
      description: 'Renas gesprochene Antwort auf bolivianischem Spanisch. Kurz, ohne Formatierung.',
    },
    translation: { type: 'STRING', description: 'Schlichte deutsche Übersetzung von reply.' },
    correction: {
      type: 'OBJECT',
      description: 'Nur ausfüllen, wenn ein Fehler korrigiert werden soll.',
      properties: {
        original:    { type: 'STRING' },
        corrected:   { type: 'STRING' },
        explanation: { type: 'STRING', description: 'Eine kurze Erklärung auf Deutsch.' },
      },
    },
    vocab: {
      type: 'ARRAY',
      description: '0–3 Vorschläge fürs Wörterbuch.',
      items: {
        type: 'OBJECT',
        properties: {
          es:       { type: 'STRING' },
          de:       { type: 'STRING' },
          kind:     { type: 'STRING', enum: ['word', 'phrase'] },
          example:  { type: 'STRING', description: 'Kurzer Beispielsatz auf Spanisch.' },
          note:     { type: 'STRING', description: 'Kurze Anmerkung auf Deutsch, z. B. zur Region.' },
          bolivian: { type: 'BOOLEAN', description: 'true, wenn typisch bolivianisch.' },
        },
        required: ['es', 'de'],
      },
    },
    action: { type: 'STRING', enum: ['none', 'save_vocab', 'start_quiz', 'stop_quiz', 'repeat', 'slower'] },
    quizAskedId: { type: 'STRING', description: 'ID der Vokabel, nach der gerade gefragt wird.' },
    quizResult: {
      type: 'OBJECT',
      description: 'Bewertung der vorigen Abfrage-Antwort.',
      properties: {
        id:      { type: 'STRING' },
        correct: { type: 'BOOLEAN' },
      },
    },
  },
  required: ['reply'],
};

const SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

/* ─────────── Nutzungszähler (fürs Gratis-Kontingent) ─────────── */

export function usageToday() {
  try {
    const u = JSON.parse(localStorage.getItem(K_USAGE) || '{}');
    const day = new Date().toISOString().slice(0, 10);
    return u.day === day ? (u.count || 0) : 0;
  } catch { return 0; }
}

function bumpUsage() {
  const day = new Date().toISOString().slice(0, 10);
  try {
    localStorage.setItem(K_USAGE, JSON.stringify({ day, count: usageToday() + 1 }));
  } catch { /* egal */ }
}

/* ─────────── Fehler ─────────── */

export class GeminiError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.retryable = retryable;
  }
}

function describeHttpError(status, body) {
  const apiMsg = body?.error?.message || '';
  switch (status) {
    case 400:
      return new GeminiError(
        /api key not valid|API_KEY_INVALID/i.test(apiMsg)
          ? 'Der API-Schlüssel wird nicht akzeptiert. Bitte in den Einstellungen prüfen.'
          : `Die Anfrage wurde abgelehnt: ${apiMsg || 'ungültige Anfrage'}`,
        { status });
    case 401:
    case 403:
      return new GeminiError('Kein Zugriff — API-Schlüssel fehlt, ist abgelaufen oder nicht freigeschaltet.', { status });
    case 404:
      return new GeminiError('Dieses Modell gibt es nicht (mehr). Wähle in den Einstellungen ein anderes.', { status });
    case 429:
      return new GeminiError('Gratis-Kontingent vorerst aufgebraucht. Warte kurz oder nimm ein kleineres Modell.', { status, retryable: true });
    case 500: case 502: case 503: case 504:
      return new GeminiError('Google antwortet gerade nicht. Gleich noch mal versuchen.', { status, retryable: true });
    default:
      return new GeminiError(apiMsg || `Unerwarteter Fehler (HTTP ${status}).`, { status, retryable: status >= 500 });
  }
}

/* ─────────── Basis-Aufruf ─────────── */

async function callApi(path, apiKey, payload, { retries = 1 } = {}) {
  if (!apiKey) throw new GeminiError('Kein API-Schlüssel hinterlegt. Trag ihn in den Einstellungen ein.');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch { /* kein JSON */ }
      const err = describeHttpError(res.status, body);
      if (err.retryable && retries > 0) {
        await new Promise(r => setTimeout(r, 1400));
        return callApi(path, apiKey, payload, { retries: retries - 1 });
      }
      throw err;
    }

    bumpUsage();
    return res.json();

  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (err.name === 'AbortError') throw new GeminiError('Zeitüberschreitung — die Antwort hat zu lange gedauert.', { retryable: true });
    throw new GeminiError('Keine Verbindung zu Google. Ist das Internet erreichbar?', { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(data) {
  const cand = data?.candidates?.[0];

  if (!cand) {
    const reason = data?.promptFeedback?.blockReason;
    throw new GeminiError(reason
      ? `Die Anfrage wurde von Googles Filter blockiert (${reason}).`
      : 'Leere Antwort von Gemini erhalten.');
  }
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') {
    throw new GeminiError('Googles Filter hat die Antwort blockiert. Formuliere es anders.');
  }

  const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) {
    if (cand.finishReason === 'MAX_TOKENS') {
      throw new GeminiError('Die Antwort wurde abgeschnitten. Versuch es noch einmal.');
    }
    throw new GeminiError('Gemini hat nichts zurückgegeben.');
  }

  try {
    return JSON.parse(text);
  } catch {
    // Falls das Modell doch mal einen Code-Block drumherum baut.
    const fenced = text.match(/\{[\s\S]*\}/);
    if (fenced) { try { return JSON.parse(fenced[0]); } catch { /* fällt durch */ } }
    throw new GeminiError('Die Antwort war nicht lesbar (kein gültiges JSON).');
  }
}

/* ─────────── Gesprächszug ─────────── */

/**
 * Ein Zug im Gespräch mit Rena.
 * @param {object}  o
 * @param {object}  o.settings
 * @param {Array}   o.history        [{role:'user'|'model', text}]
 * @param {string} [o.text]          getippte Eingabe
 * @param {{base64:string, mimeType:string}} [o.audio]  Sprachaufnahme
 * @param {boolean}[o.quizMode]
 * @param {Array}  [o.quizItems]
 * @param {Array}  [o.dictSample]
 */
export async function converse({ settings, history = [], text, audio, quizMode, quizItems, dictSample }) {
  const parts = [];
  if (audio) parts.push({ inlineData: { mimeType: audio.mimeType, data: audio.base64 } });
  if (text)  parts.push({ text });
  if (!parts.length) throw new GeminiError('Nichts zu senden.');

  if (audio && !text) {
    parts.push({ text: 'Das ist meine Sprachaufnahme. Transkribiere sie in "heard" und antworte darauf.' });
  }

  const contents = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts },
  ];

  const data = await callApi(`/models/${encodeURIComponent(settings.model)}:generateContent`, settings.apiKey, {
    systemInstruction: { parts: [{ text: buildSystemPrompt(settings, { quizMode, quizItems, dictSample }) }] },
    contents,
    safetySettings: SAFETY,
    generationConfig: {
      temperature: 0.95,
      topP: 0.95,
      maxOutputTokens: 1400,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const out = extractJson(data);
  return {
    heard:       (out.heard || '').trim(),
    heardLang:   out.heardLang || 'unclear',
    reply:       (out.reply || '').trim(),
    translation: (out.translation || '').trim(),
    correction:  out.correction?.corrected ? out.correction : null,
    vocab:       Array.isArray(out.vocab) ? out.vocab.filter(v => v?.es) : [],
    action:      out.action || 'none',
    quizAskedId: out.quizAskedId || '',
    quizResult:  out.quizResult?.id ? out.quizResult : null,
  };
}

/* ─────────── Wörterbuch-Hilfe ─────────── */

const LOOKUP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    es:       { type: 'STRING', description: 'Der Ausdruck, sauber geschrieben.' },
    de:       { type: 'STRING', description: 'Deutsche Übersetzung.' },
    example:  { type: 'STRING', description: 'Kurzer bolivianischer Beispielsatz.' },
    note:     { type: 'STRING', description: 'Eine kurze deutsche Anmerkung zu Gebrauch oder Region.' },
    bolivian: { type: 'BOOLEAN' },
    kind:     { type: 'STRING', enum: ['word', 'phrase'] },
  },
  required: ['es', 'de'],
};

/** Schlägt einen Ausdruck nach und füllt Übersetzung, Beispiel und Notiz. */
export async function lookup(settings, term, direction = 'es') {
  const prompt = direction === 'de'
    ? `Wie sagt man "${term}" auf bolivianischem Spanisch (Hochland/La Paz)? Gib den spanischen Ausdruck in "es" und "${term}" in "de".`
    : `Erkläre den spanischen Ausdruck "${term}" für eine deutschsprachige Lernende. Wenn er in Bolivien anders gebraucht wird als anderswo, sag es in "note".`;

  const data = await callApi(`/models/${encodeURIComponent(settings.model)}:generateContent`, settings.apiKey, {
    systemInstruction: { parts: [{ text:
      'Du bist eine bolivianische Sprachlehrerin aus La Paz. Du erklärst Ausdrücke knapp und präzise für deutschsprachige Lernende. ' +
      'Beispielsätze klingen nach bolivianischem Hochlandspanisch, nicht nach Lehrbuch. Antworte nur im vorgegebenen JSON-Format.' }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    safetySettings: SAFETY,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 500,
      responseMimeType: 'application/json',
      responseSchema: LOOKUP_SCHEMA,
    },
  });

  return extractJson(data);
}

/* ─────────── Modelle auflisten ─────────── */

export async function listModels(apiKey) {
  if (!apiKey) throw new GeminiError('Kein API-Schlüssel hinterlegt.');
  let res;
  try {
    res = await fetch(`${BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`);
  } catch {
    throw new GeminiError('Keine Verbindung zu Google.');
  }
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* kein JSON */ }
    throw describeHttpError(res.status, body);
  }
  const data = await res.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({
      id: m.name.replace(/^models\//, ''),
      label: m.displayName || m.name,
    }))
    .filter(m => /^gemini-/.test(m.id) && !/embedding|aqa|image|tts|vision/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
