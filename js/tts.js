// Sprachausgabe über die eingebauten iOS-Stimmen — kostenlos und offline.

let voices = [];
let unlocked = false;
let currentDone = null;
let watchdog = null;

/** Sprachen, die dem bolivianischen Hochlandspanisch am nächsten kommen — in dieser Reihenfolge. */
const PREFERRED = ['es-PE', 'es-CO', 'es-MX', 'es-CL', 'es-AR', 'es-US', 'es-ES'];

function loadVoices() {
  voices = (window.speechSynthesis?.getVoices() || []).filter(v => /^es(-|_)/i.test(v.lang));
  voices.sort((a, b) => {
    const norm = l => l.replace('_', '-');
    const ai = PREFERRED.indexOf(norm(a.lang)), bi = PREFERRED.indexOf(norm(b.lang));
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
  });
  return voices;
}

export function availableVoices() {
  if (!voices.length) loadVoices();
  return voices;
}

export const supported = () => 'speechSynthesis' in window;

if (supported()) {
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

/** Muss einmal aus einer echten Nutzerhandlung heraus laufen, sonst bleibt iOS stumm. */
export function unlock() {
  if (unlocked || !supported()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    unlocked = true;
    loadVoices();
  } catch { /* egal */ }
}

/** Entfernt alles, was vorgelesen albern klingt (Markdown, Emojis, Klammerzusätze). */
export function cleanForSpeech(text = '') {
  return text
    .replace(/[*_`#>]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Zerlegt lange Antworten — iOS bricht sonst mittendrin ab. */
function chunk(text, max = 170) {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const out = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > max && buf) { out.push(buf.trim()); buf = s; }
    else buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

function pickVoice(settings) {
  const list = availableVoices();
  if (!list.length) return null;
  if (settings.voiceURI) {
    const exact = list.find(v => v.voiceURI === settings.voiceURI);
    if (exact) return exact;
  }
  const lang = (settings.speechLang || 'es-MX').toLowerCase();
  return list.find(v => v.lang.replace('_', '-').toLowerCase() === lang)
      || list.find(v => v.lang.toLowerCase().startsWith('es'))
      || list[0];
}

export function cancel() {
  clearTimeout(watchdog);
  watchdog = null;
  if (supported()) { try { window.speechSynthesis.cancel(); } catch { /* egal */ } }
  const done = currentDone;
  currentDone = null;
  done?.();
}

export const isSpeaking = () => !!currentDone;

/**
 * Liest Text vor. Das Promise löst auf, wenn alles gesprochen (oder abgebrochen) wurde.
 */
export function speak(text, settings) {
  const clean = cleanForSpeech(text);
  if (!clean || !supported()) return Promise.resolve();

  cancel();

  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      watchdog = null;
      if (currentDone === finish) currentDone = null;
      resolve();
    };
    currentDone = finish;

    const voice = pickVoice(settings);
    const pieces = chunk(clean);
    let spoken = 0;

    // Sicherheitsnetz: iOS meldet gelegentlich kein 'end'.
    const arm = () => {
      clearTimeout(watchdog);
      const remaining = pieces.slice(spoken).join(' ').length;
      const estimate = 2500 + (remaining / Math.max(0.5, settings.speechRate || 1)) * 110;
      watchdog = setTimeout(finish, Math.min(90000, estimate));
    };

    pieces.forEach((piece, i) => {
      const u = new SpeechSynthesisUtterance(piece);
      if (voice) u.voice = voice;
      u.lang  = voice?.lang || settings.speechLang || 'es-MX';
      u.rate  = Math.max(0.5, Math.min(1.6, settings.speechRate || 1));
      u.pitch = 1.02;
      u.onend = () => { spoken = i + 1; if (spoken >= pieces.length) finish(); else arm(); };
      u.onerror = () => { if (i === pieces.length - 1) finish(); };
      try { window.speechSynthesis.speak(u); } catch { finish(); }
    });

    arm();
  });
}
