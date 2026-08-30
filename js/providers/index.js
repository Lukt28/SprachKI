// Anbieter-Verzeichnis: einheitlicher Zugang zu Gemini, Groq und Mistral.

import { gemini } from './gemini.js';
import { groq, mistral } from './openaiCompatible.js';
import { ProviderError, usageToday } from './shared.js';

export { ProviderError, usageToday };

export const PROVIDERS = { gemini, groq, mistral };
export const PROVIDER_LIST = [gemini, groq, mistral];

export function getProvider(id) {
  return PROVIDERS[id] || gemini;
}

/** Löst Anbieter, Schlüssel und Modelle aus den Einstellungen auf. */
export function resolve(settings, id = settings.provider) {
  const provider = getProvider(id);
  return {
    provider,
    apiKey: settings.apiKeys?.[provider.id] || '',
    model: settings.models?.[provider.id] || provider.defaultModel,
    transcribeModel: settings.transcribeModels?.[provider.id] || provider.defaultTranscribeModel,
  };
}

/* ─────────── Gesprächszug ─────────── */

export async function converse(args) {
  const { provider, apiKey, model, transcribeModel } = resolve(args.settings);
  return provider.converse({ ...args, apiKey, model, transcribeModel });
}

/* ─────────── Wörterbuch-Nachschlag ─────────── */

const LOOKUP_SYSTEM =
  'Du bist eine bolivianische Sprachlehrerin aus La Paz. Du erklärst Ausdrücke knapp und präzise für ' +
  'deutschsprachige Lernende. Beispielsätze klingen nach bolivianischem Hochlandspanisch, nicht nach Lehrbuch.';

export async function lookup(settings, term, direction = 'es') {
  const { provider, apiKey, model } = resolve(settings);
  const prompt = direction === 'de'
    ? `Wie sagt man "${term}" auf bolivianischem Spanisch (Hochland/La Paz)? Gib den spanischen Ausdruck in "es" und "${term}" in "de".`
    : `Erkläre den spanischen Ausdruck "${term}" für eine deutschsprachige Lernende. Wenn er in Bolivien anders gebraucht wird als anderswo, sag es in "note".`;
  return provider.lookup({ apiKey, model, prompt, system: LOOKUP_SYSTEM });
}

/* ─────────── Modelle ─────────── */

export function listModels(settings, id = settings.provider) {
  const { provider, apiKey } = resolve(settings, id);
  return provider.listModels(apiKey);
}

/* ─────────── Verbindungstest ─────────── */

/**
 * Prüft in einem Zug: erreichbar, CORS erlaubt, Schlüssel gültig, Modell vorhanden.
 * @returns {Promise<{ok:boolean, title:string, detail:string}>}
 */
export async function testConnection(settings, id = settings.provider) {
  const { provider, apiKey, model } = resolve(settings, id);

  if (!apiKey) {
    return { ok: false, title: 'Kein Schlüssel', detail: `Für ${provider.label} ist noch kein API-Schlüssel eingetragen.` };
  }

  try {
    const models = await provider.listModels(apiKey);
    const known = models.some(m => m.id === model);
    return {
      ok: true,
      title: 'Verbindung steht',
      detail: known
        ? `${provider.label} antwortet, der Schlüssel ist gültig und „${model}" ist verfügbar. ${models.length} Modelle gefunden.`
        : `${provider.label} antwortet und der Schlüssel ist gültig. Aber „${model}" ist nicht in der Liste — wähl unten ein anderes Modell. ${models.length} Modelle gefunden.`,
    };
  } catch (err) {
    if (err instanceof ProviderError && err.cors) {
      return {
        ok: false,
        title: 'Aus dem Browser nicht erreichbar',
        detail: `${provider.label} hat die Anfrage nicht angenommen. Entweder ist gerade kein Internet da, oder ` +
                'der Anbieter erlaubt keine direkten Aufrufe aus dem Browser. In dem Fall hilft nur ein anderer Anbieter.',
      };
    }
    return {
      ok: false,
      title: 'Fehlgeschlagen',
      detail: err instanceof ProviderError ? err.message : (err.message || 'Unbekannter Fehler.'),
    };
  }
}
