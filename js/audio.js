// Freihand-Mikrofon: Dauerhafte Aufnahme mit Sprach-/Pausenerkennung (VAD).
// Erkennt selbst, wann ein Satz zu Ende ist, und liefert ihn als WAV zurück.

const TARGET_RATE = 16000;   // reicht für Sprache und hält die Uploads klein
const NOISE_FLOOR_MIN = 0.0016;
const ABS_MIN_THRESHOLD = 0.006;

/* ─────────── WAV-Kodierung ─────────── */

/** Lineares Resampling auf TARGET_RATE. */
function resample(input, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Float32-PCM → 16-Bit-Mono-WAV. */
export function encodeWav(samples, sampleRate = TARGET_RATE) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // Größe des fmt-Blocks
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);           // Block-Align
  view.setUint16(34, 16, true);          // Bit pro Sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(bytes);
}

export function toBase64(bytes) {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

/* ─────────── Sprach-Engine ─────────── */

export class VoiceEngine extends EventTarget {
  /**
   * Ereignisse:
   *  'level'     detail {rms, threshold, speaking}
   *  'speechstart'
   *  'utterance' detail {base64, mimeType, durationMs}
   *  'error'     detail {message}
   */
  constructor(settings) {
    super();
    this.settings = settings;
    this.running = false;
    this.muted = false;          // z. B. während Rena spricht
    this.paused = false;         // während eine Antwort geholt wird

    this._ctx = null;
    this._stream = null;
    this._node = null;
    this._source = null;

    this._noiseFloor = 0.01;
    this._speaking = false;
    this._speechChunks = [];
    this._speechSamples = 0;
    this._loudSamples = 0;
    this._silenceSamples = 0;
    this._preRoll = [];
    this._preRollSamples = 0;
  }

  get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  }

  async start() {
    if (this.running) return;
    if (!this.supported) throw new Error('Dieser Browser kann das Mikrofon nicht ansprechen. Bitte Safari oder Chrome benutzen.');
    if (!window.isSecureContext) throw new Error('Das Mikrofon funktioniert nur über HTTPS (oder auf localhost).');

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Zugriff aufs Mikrofon wurde abgelehnt. In den Safari-Einstellungen für diese Seite erlauben.'
        : err.name === 'NotFoundError'
          ? 'Kein Mikrofon gefunden.'
          : `Mikrofon konnte nicht gestartet werden (${err.name}).`;
      throw new Error(msg);
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this._ctx = new Ctx();
    if (this._ctx.state === 'suspended') await this._ctx.resume();

    this._source = this._ctx.createMediaStreamSource(this._stream);
    await this._attachProcessor();

    this._reset();
    this.running = true;
    this.paused = false;
  }

  async _attachProcessor() {
    const onBlock = (rms, pcm) => this._onBlock(rms, pcm);

    if (this._ctx.audioWorklet) {
      try {
        await this._ctx.audioWorklet.addModule(new URL('./vad-worklet.js', import.meta.url));
        const node = new AudioWorkletNode(this._ctx, 'vad-processor', {
          numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1,
        });
        node.port.onmessage = e => onBlock(e.data.rms, e.data.pcm);
        this._source.connect(node);
        this._node = node;
        return;
      } catch (err) {
        console.warn('AudioWorklet nicht verfügbar, nutze Rückfallweg.', err);
      }
    }

    // Rückfallweg für ältere Browser.
    const node = this._ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = e => {
      const ch = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      onBlock(Math.sqrt(sum / ch.length), new Float32Array(ch));
    };
    this._source.connect(node);
    // ScriptProcessor braucht ein Ziel, darf aber nichts hörbar ausgeben.
    const silent = this._ctx.createGain();
    silent.gain.value = 0;
    node.connect(silent);
    silent.connect(this._ctx.destination);
    this._node = node;
    this._silentGain = silent;
  }

  stop() {
    this.running = false;
    this._speaking = false;
    try { this._node?.port?.postMessage('stop'); } catch { /* egal */ }
    try { this._node?.disconnect(); } catch { /* egal */ }
    try { this._source?.disconnect(); } catch { /* egal */ }
    try { this._silentGain?.disconnect(); } catch { /* egal */ }
    if (this._node) this._node.onaudioprocess = null;
    this._stream?.getTracks().forEach(t => t.stop());
    this._ctx?.close().catch(() => {});
    this._ctx = null; this._stream = null; this._node = null; this._source = null; this._silentGain = null;
    this._reset();
  }

  /** Während Rena spricht bzw. eine Antwort lädt: Eingang verwerfen. */
  setMuted(on) {
    if (this.muted === on) return;
    this.muted = on;
    if (on) this._reset();
  }

  setPaused(on) {
    if (this.paused === on) return;
    this.paused = on;
    if (on) this._reset();
  }

  _reset() {
    this._speaking = false;
    this._speechChunks = [];
    this._speechSamples = 0;
    this._loudSamples = 0;
    this._silenceSamples = 0;
    this._preRoll = [];
    this._preRollSamples = 0;
  }

  get _rate() { return this._ctx?.sampleRate || 48000; }

  _onBlock(rms, pcm) {
    if (!this.running) return;

    // Grundrauschen langsam nachführen — leise Umgebungen schneller, laute langsamer.
    if (rms < this._noiseFloor) this._noiseFloor = this._noiseFloor * 0.92 + rms * 0.08;
    else                       this._noiseFloor = this._noiseFloor * 0.997 + rms * 0.003;
    this._noiseFloor = Math.max(NOISE_FLOOR_MIN, this._noiseFloor);

    const threshold = Math.max(ABS_MIN_THRESHOLD, this._noiseFloor * (this.settings.sensitivity || 2.4));
    const loud = rms > threshold;

    this.dispatchEvent(new CustomEvent('level', {
      detail: { rms, threshold, speaking: this._speaking && !this.muted && !this.paused },
    }));

    if (this.muted || this.paused) return;

    const rate = this._rate;
    const n = pcm.length;

    if (!this._speaking) {
      // Vorlauf puffern, damit der Satzanfang nicht abgeschnitten wird.
      this._preRoll.push(pcm);
      this._preRollSamples += n;
      const maxPre = rate * ((this.settings.preRollMs ?? 300) / 1000);
      while (this._preRollSamples > maxPre && this._preRoll.length > 1) {
        this._preRollSamples -= this._preRoll.shift().length;
      }
      if (loud) {
        this._speaking = true;
        this._speechChunks = [...this._preRoll];
        this._speechSamples = this._preRollSamples;
        this._loudSamples = n;
        this._silenceSamples = 0;
        this._preRoll = []; this._preRollSamples = 0;
        this.dispatchEvent(new CustomEvent('speechstart'));
      }
      return;
    }

    // Läuft gerade eine Äußerung.
    this._speechChunks.push(pcm);
    this._speechSamples += n;
    if (loud) this._loudSamples += n;
    this._silenceSamples = loud ? 0 : this._silenceSamples + n;

    const silenceLimit = rate * ((this.settings.silenceMs ?? 900) / 1000);
    const maxLimit     = rate * ((this.settings.maxUtteranceMs ?? 18000) / 1000);

    if (this._silenceSamples >= silenceLimit || this._speechSamples >= maxLimit) {
      this._finishUtterance();
    }
  }

  _finishUtterance() {
    const rate = this._rate;
    const chunks = this._speechChunks;
    const total = this._speechSamples;
    const loud = this._loudSamples;
    this._reset();

    // Nur die wirklich lauten Anteile zählen — nicht Vorlaufpuffer und Schlusspause.
    const speechMs = (loud / rate) * 1000;
    if (speechMs < (this.settings.minSpeechMs ?? 280)) return;  // Türklappern, Husten …

    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }

    const wav = encodeWav(resample(merged, rate), TARGET_RATE);
    let cachedBase64 = null;
    this.dispatchEvent(new CustomEvent('utterance', {
      detail: {
        bytes: wav,
        mimeType: 'audio/wav',
        durationMs: Math.round((total / rate) * 1000),
        // Nur Gemini braucht base64 — für die anderen Anbieter wäre das verschenkte Arbeit.
        get base64() { return (cachedBase64 ??= toBase64(wav)); },
      },
    }));
  }

  /** Beendet eine laufende Äußerung sofort (Knopfdruck „fertig“). */
  flush() {
    if (this._speaking) this._finishUtterance();
  }
}

/* ─────────── Bildschirm wachhalten ─────────── */

let wakeLock = null;

export async function keepAwake(on) {
  if (!('wakeLock' in navigator)) return false;
  try {
    if (on) {
      if (wakeLock) return true;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return true;
    }
    await wakeLock?.release();
    wakeLock = null;
    return true;
  } catch {
    wakeLock = null;
    return false;
  }
}

export function reacquireWakeLock() {
  if (document.visibilityState === 'visible' && wakeLock === null) return keepAwake(true);
  return Promise.resolve(false);
}
