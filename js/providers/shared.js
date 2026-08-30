// Gemeinsame Bausteine aller KI-Anbieter: Fehler, JSON-Auswertung, Nutzungszähler.

const K_USAGE = 'rena.usage.v1';
export const TIMEOUT_MS = 75000;

/* ─────────── Fehler ─────────── */

export class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false, cors = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
    this.cors = cors;
  }
}

export function describeHttpError(status, body, label = 'Der Anbieter') {
  const apiMsg = body?.error?.message || body?.message || body?.detail || '';
  switch (status) {
    case 400:
      return new ProviderError(
        /api.?key|invalid.?key/i.test(apiMsg)
          ? 'Der API-Schlüssel wird nicht akzeptiert. Bitte in den Einstellungen prüfen.'
          : `Die Anfrage wurde abgelehnt: ${apiMsg || 'ungültige Anfrage'}`,
        { status });
    case 401:
    case 403:
      return new ProviderError('Kein Zugriff — API-Schlüssel fehlt, ist abgelaufen oder nicht freigeschaltet.', { status });
    case 404:
      return new ProviderError('Dieses Modell gibt es nicht (mehr). Wähle in den Einstellungen ein anderes.', { status });
    case 413:
      return new ProviderError('Die Sprachaufnahme war zu lang. Stell „Längste Äußerung" kürzer.', { status });
    case 422:
      return new ProviderError(`Die Anfrage passt nicht zum Modell: ${apiMsg || 'ungültige Angaben'}`, { status });
    case 429:
      return new ProviderError('Gratis-Kontingent vorerst aufgebraucht. Warte kurz oder nimm ein kleineres Modell.', { status, retryable: true });
    case 500: case 502: case 503: case 504:
      return new ProviderError(`${label} antwortet gerade nicht. Gleich noch mal versuchen.`, { status, retryable: true });
    default:
      return new ProviderError(apiMsg || `Unerwarteter Fehler (HTTP ${status}).`, { status, retryable: status >= 500 });
  }
}

/** Netzwerkfehler eines fetch-Aufrufs deuten — inklusive CORS-Sperre. */
export function describeNetworkError(err, label = 'Der Anbieter') {
  if (err.name === 'AbortError') {
    return new ProviderError('Zeitüberschreitung — die Antwort hat zu lange gedauert.', { retryable: true });
  }
  // Ein blockierter CORS-Aufruf ist im Browser von einem Verbindungsabbruch nicht zu unterscheiden.
  return new ProviderError(
    `Keine Verbindung zu ${label}. Entweder ist gerade kein Internet da — oder der Anbieter erlaubt keine ` +
    'direkten Aufrufe aus dem Browser (CORS). Prüf das mit „Verbindung testen" in den Einstellungen.',
    { retryable: true, cors: true });
}

/* ─────────── Nutzungszähler ─────────── */

export function usageToday() {
  try {
    const u = JSON.parse(localStorage.getItem(K_USAGE) || '{}');
    return u.day === today() ? (u.count || 0) : 0;
  } catch { return 0; }
}

export function bumpUsage() {
  try {
    localStorage.setItem(K_USAGE, JSON.stringify({ day: today(), count: usageToday() + 1 }));
  } catch { /* egal */ }
}

const today = () => new Date().toISOString().slice(0, 10);

/* ─────────── HTTP ─────────── */

/**
 * Ein JSON-Aufruf mit Zeitlimit, einem Wiederholungsversuch und deutschen Fehlermeldungen.
 * @param {string} url
 * @param {RequestInit} init
 * @param {{label?:string, retries?:number, raw?:boolean}} opts
 */
export async function request(url, init, { label = 'dem Anbieter', retries = 1 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      throw describeNetworkError(err, label);
    }

    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch { /* kein JSON */ }
      const error = describeHttpError(res.status, body, label);
      if (error.retryable && retries > 0) {
        await new Promise(r => setTimeout(r, 1400));
        return request(url, init, { label, retries: retries - 1 });
      }
      throw error;
    }

    bumpUsage();
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────── JSON aus einer Modellantwort ─────────── */

export function parseModelJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new ProviderError('Das Modell hat nichts zurückgegeben.');
  try {
    return JSON.parse(trimmed);
  } catch { /* weiter unten */ }

  // Manche Modelle verpacken die Antwort in einen Code-Block oder plaudern davor.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* weiter */ } }
  const braced = trimmed.match(/\{[\s\S]*\}/);
  if (braced) { try { return JSON.parse(braced[0]); } catch { /* weiter */ } }

  throw new ProviderError('Die Antwort war nicht lesbar (kein gültiges JSON).');
}

/** Bringt jede Anbieter-Antwort auf dieselbe Form. */
export function normalizeTurn(out, fallbackHeard = '') {
  return {
    heard:       (out.heard || fallbackHeard || '').trim(),
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
