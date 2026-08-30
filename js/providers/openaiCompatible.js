// Baukasten für Anbieter mit OpenAI-kompatibler Schnittstelle (Groq, Mistral).
//
// Diese Anbieter nehmen Audio nicht im Chat entgegen. Ein Gesprächszug braucht deshalb
// zwei Aufrufe: erst die Aufnahme transkribieren, dann den Text beantworten. Die
// Spracherkennung erkennt Deutsch und Spanisch von selbst — das Umschalten entfällt
// also trotzdem.

import { buildSystemPrompt } from '../persona.js';
import {
  request, parseModelJson, normalizeTurn, ProviderError,
  describeHttpError, describeNetworkError, bumpUsage, TIMEOUT_MS,
} from './shared.js';

const LANG_MAP = { de: 'de', german: 'de', deutsch: 'de', es: 'es', spanish: 'es', español: 'es', espanol: 'es' };

export function createOpenAiCompatible(config) {
  const {
    id, label, baseUrl, keyUrl, keyHint, keyPlaceholder, note,
    defaultModel, fallbackModels,
    defaultTranscribeModel, transcribeModels,
    isChatModel,
  } = config;

  const auth = apiKey => {
    if (!apiKey) throw new ProviderError('Kein API-Schlüssel hinterlegt. Trag ihn in den Einstellungen ein.');
    return { Authorization: `Bearer ${apiKey}` };
  };

  /** Schritt 1: Sprachaufnahme zu Text. */
  async function transcribe({ apiKey, audio, model }) {
    const form = new FormData();
    form.append('file', new Blob([audio.bytes], { type: audio.mimeType }), 'aufnahme.wav');
    form.append('model', model || defaultTranscribeModel);
    form.append('response_format', 'json');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      let res;
      try {
        // Content-Type absichtlich nicht setzen — der Browser ergänzt die Multipart-Grenze.
        res = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: 'POST', headers: auth(apiKey), body: form, signal: ctrl.signal,
        });
      } catch (err) {
        throw describeNetworkError(err, label);
      }
      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch { /* kein JSON */ }
        throw describeHttpError(res.status, body, label);
      }
      bumpUsage();
      const data = await res.json();
      return {
        text: (data.text || '').trim(),
        lang: LANG_MAP[String(data.language || '').toLowerCase()] || '',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Schritt 2: Text beantworten, Antwort als JSON. */
  function chat({ apiKey, model, messages, temperature = 0.95, maxTokens = 1400 }) {
    return request(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...auth(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    }, { label });
  }

  function extract(data) {
    const choice = data?.choices?.[0];
    if (!choice) throw new ProviderError(`Leere Antwort von ${label}.`);
    if (choice.finish_reason === 'length') {
      throw new ProviderError('Die Antwort wurde abgeschnitten. Versuch es noch einmal.');
    }
    return parseModelJson(choice.message?.content || '');
  }

  return {
    id, label, keyUrl, keyHint, keyPlaceholder, note,
    defaultModel, fallbackModels,
    defaultTranscribeModel, transcribeModels,
    needsTranscription: true,

    async converse({ settings, model, transcribeModel, apiKey, history = [], text, audio, quizMode, quizItems, dictSample }) {
      let userText = text;
      let detectedLang = '';

      if (audio) {
        const heard = await transcribe({ apiKey, audio, model: transcribeModel });
        if (!heard.text) {
          // Nichts Verwertbares aufgenommen — lieber freundlich nachfragen als raten.
          return normalizeTurn({
            heard: '', heardLang: 'unclear',
            reply: 'Perdón, no te escuché bien. ¿Me repites por favor?',
            translation: 'Entschuldige, ich habe dich nicht gut verstanden. Wiederholst du das bitte?',
            action: 'none',
          });
        }
        userText = heard.text;
        detectedLang = heard.lang;
      }
      if (!userText) throw new ProviderError('Nichts zu senden.');

      const system = buildSystemPrompt(settings, { quizMode, quizItems, dictSample, jsonContract: true });
      const messages = [
        { role: 'system', content: system },
        ...history.map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text })),
        { role: 'user', content: userText },
      ];

      const out = extract(await chat({ apiKey, model, messages }));
      const turn = normalizeTurn(out, userText);
      // Die Spracherkennung weiß es besser als das Sprachmodell.
      if (detectedLang) turn.heardLang = detectedLang;
      turn.heard = turn.heard || userText;
      return turn;
    },

    async lookup({ model, apiKey, prompt, system }) {
      const out = extract(await chat({
        apiKey, model, temperature: 0.4, maxTokens: 500,
        messages: [
          { role: 'system', content: `${system}\n\nAntworte ausschließlich mit einem JSON-Objekt der Form:\n{"es":"…","de":"…","example":"…","note":"…","bolivian":true,"kind":"word"}` },
          { role: 'user', content: prompt },
        ],
      }));
      return out;
    },

    async listModels(apiKey) {
      let res;
      try {
        res = await fetch(`${baseUrl}/models`, { headers: auth(apiKey) });
      } catch (err) {
        throw describeNetworkError(err, label);
      }
      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch { /* kein JSON */ }
        throw describeHttpError(res.status, body, label);
      }
      const data = await res.json();
      return (data.data || [])
        .map(m => ({ id: m.id, label: m.id }))
        .filter(m => isChatModel(m.id))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}

/* ═══════════════ Groq ═══════════════ */

export const groq = createOpenAiCompatible({
  id: 'groq',
  label: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyUrl: 'https://console.groq.com/keys',
  keyHint: 'console.groq.com → API Keys → „Create API Key". Kein Gewerbe-Nachweis nötig.',
  keyPlaceholder: 'gsk_…',
  note: 'Sehr schnell, großzügiges Gratis-Kontingent, und laut Nutzungsbedingungen kein Training auf deinen Eingaben. Transkribiert mit Whisper (erkennt Deutsch und Spanisch automatisch).',
  defaultModel: 'llama-3.3-70b-versatile',
  fallbackModels: [
    { id: 'llama-3.3-70b-versatile',      label: 'Llama 3.3 70B — guter Standard' },
    { id: 'llama-3.1-8b-instant',         label: 'Llama 3.1 8B — am schnellsten' },
    { id: 'openai/gpt-oss-120b',          label: 'GPT-OSS 120B' },
    { id: 'moonshotai/kimi-k2-instruct',  label: 'Kimi K2' },
    { id: 'qwen/qwen3-32b',               label: 'Qwen3 32B' },
  ],
  defaultTranscribeModel: 'whisper-large-v3-turbo',
  transcribeModels: [
    { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo — schnell' },
    { id: 'whisper-large-v3',       label: 'Whisper Large v3 — genauer' },
  ],
  isChatModel: id => !/whisper|tts|guard|embed|distil/i.test(id),
});

/* ═══════════════ Mistral ═══════════════ */

export const mistral = createOpenAiCompatible({
  id: 'mistral',
  label: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  keyUrl: 'https://console.mistral.ai/api-keys',
  keyHint: 'console.mistral.ai → API Keys. Französischer Anbieter mit echten Verbraucher-AGB.',
  keyPlaceholder: 'Schlüssel einfügen',
  note: 'Europäischer Anbieter — für private Nutzung juristisch der sauberste Weg. Transkribiert mit Voxtral.',
  defaultModel: 'mistral-small-latest',
  fallbackModels: [
    { id: 'mistral-small-latest',  label: 'Mistral Small — Gratis-Kontingent' },
    { id: 'mistral-medium-latest', label: 'Mistral Medium' },
    { id: 'mistral-large-latest',  label: 'Mistral Large — am besten' },
    { id: 'ministral-8b-latest',   label: 'Ministral 8B — am schnellsten' },
  ],
  defaultTranscribeModel: 'voxtral-mini-latest',
  transcribeModels: [
    { id: 'voxtral-mini-latest',  label: 'Voxtral Mini — schnell' },
    { id: 'voxtral-small-latest', label: 'Voxtral Small — genauer' },
  ],
  isChatModel: id => !/voxtral|embed|ocr|moderation|codestral-embed/i.test(id),
});
