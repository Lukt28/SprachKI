// AudioWorklet: sammelt Rohaudio in Blöcken und meldet Lautstärke + PCM an den Hauptthread.
// Läuft im Audio-Renderthread, deshalb hier bewusst nur das Nötigste.

const CHUNK = 1024; // Samples pro Nachricht (~21 ms bei 48 kHz)

class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(CHUNK);
    this._n = 0;
    this._live = true;
    this.port.onmessage = e => {
      if (e.data === 'stop') this._live = false;
    };
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return this._live;

    for (let i = 0; i < ch.length; i++) {
      this._buf[this._n++] = ch[i];
      if (this._n === CHUNK) {
        let sum = 0;
        for (let k = 0; k < CHUNK; k++) sum += this._buf[k] * this._buf[k];
        const copy = new Float32Array(this._buf);
        this.port.postMessage({ rms: Math.sqrt(sum / CHUNK), pcm: copy }, [copy.buffer]);
        this._n = 0;
      }
    }
    return this._live;
  }
}

registerProcessor('vad-processor', VadProcessor);
