// Google Gemini — schickt die Sprachaufnahme direkt mit und antwortet in einem Aufruf.

import { buildSystemPrompt } from '../persona.js';
import { request, parseModelJson, normalizeTurn, ProviderError, describeHttpError, describeNetworkError } from './shared.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const LABEL = 'Google';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    heard:       { type: 'STRING', description: 'Wörtliche Transkription der Aufnahme. Leer bei getipptem Text.' },
    heardLang:   { type: 'STRING', enum: ['de', 'es', 'mixed', 'unclear'] },
    reply:       { type: 'STRING', description: 'Renas gesprochene Antwort auf bolivianischem Spanisch.' },
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
          example:  { type: 'STRING' },
          note:     { type: 'STRING' },
          bolivian: { type: 'BOOLEAN' },
        },
        required: ['es', 'de'],
      },
    },
    action:      { type: 'STRING', enum: ['none', 'save_vocab', 'start_quiz', 'stop_quiz', 'repeat', 'slower'] },
    quizAskedId: { type: 'STRING' },
    quizResult: {
      type: 'OBJECT',
      properties: { id: { type: 'STRING' }, correct: { type: 'BOOLEAN' } },
    },
  },
  required: ['reply'],
};

const LOOKUP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    es:       { type: 'STRING' },
    de:       { type: 'STRING' },
    example:  { type: 'STRING' },
    note:     { type: 'STRING' },
    bolivian: { type: 'BOOLEAN' },
    kind:     { type: 'STRING', enum: ['word', 'phrase'] },
  },
  required: ['es', 'de'],
};

const SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

function generate(model, apiKey, payload) {
  if (!apiKey) throw new ProviderError('Kein API-Schlüssel hinterlegt. Trag ihn in den Einstellungen ein.');
  return request(`${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, { label: LABEL });
}

function extract(data) {
  const cand = data?.candidates?.[0];
  if (!cand) {
    const reason = data?.promptFeedback?.blockReason;
    throw new ProviderError(reason
      ? `Die Anfrage wurde von Googles Filter blockiert (${reason}).`
      : 'Leere Antwort von Gemini erhalten.');
  }
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') {
    throw new ProviderError('Googles Filter hat die Antwort blockiert. Formuliere es anders.');
  }
  const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text && cand.finishReason === 'MAX_TOKENS') {
    throw new ProviderError('Die Antwort wurde abgeschnitten. Versuch es noch einmal.');
  }
  return parseModelJson(text);
}

export const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  keyUrl: 'https://aistudio.google.com/apikey',
  keyHint: 'Google AI Studio → „Create API key". Beim ersten Besuch verlangt Google eine Bestätigung, den Dienst geschäftlich zu nutzen.',
  keyPlaceholder: 'AIza…',
  defaultModel: 'gemini-2.5-flash',
  fallbackModels: [
    { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash — guter Standard' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite — am sparsamsten' },
    { id: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro — am besten, kleines Kontingent' },
  ],
  note: 'Versteht die Sprachaufnahme direkt — ein Aufruf pro Antwort, beste Deutsch/Spanisch-Erkennung. Aus dem Browser nutzbar.',

  async converse({ settings, model, apiKey, history = [], text, audio, quizMode, quizItems, dictSample }) {
    const parts = [];
    if (audio) parts.push({ inlineData: { mimeType: audio.mimeType, data: audio.base64 } });
    if (text)  parts.push({ text });
    if (!parts.length) throw new ProviderError('Nichts zu senden.');
    if (audio && !text) {
      parts.push({ text: 'Das ist meine Sprachaufnahme. Transkribiere sie in "heard" und antworte darauf.' });
    }

    const data = await generate(model, apiKey, {
      systemInstruction: { parts: [{ text: buildSystemPrompt(settings, { quizMode, quizItems, dictSample }) }] },
      contents: [
        ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
        { role: 'user', parts },
      ],
      safetySettings: SAFETY,
      generationConfig: {
        temperature: 0.95,
        topP: 0.95,
        maxOutputTokens: 1400,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    return normalizeTurn(extract(data), text);
  },

  async lookup({ model, apiKey, prompt, system }) {
    const data = await generate(model, apiKey, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      safetySettings: SAFETY,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
        responseSchema: LOOKUP_SCHEMA,
      },
    });
    return extract(data);
  },

  async listModels(apiKey) {
    if (!apiKey) throw new ProviderError('Kein API-Schlüssel hinterlegt.');
    let res;
    try {
      res = await fetch(`${BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`);
    } catch (err) {
      throw describeNetworkError(err, LABEL);
    }
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch { /* kein JSON */ }
      throw describeHttpError(res.status, body, LABEL);
    }
    const data = await res.json();
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
      .filter(m => /^gemini-/.test(m.id) && !/embedding|aqa|image|tts|vision/i.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  },
};
