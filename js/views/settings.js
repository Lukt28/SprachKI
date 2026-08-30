// Einstellungen: KI-Zugang, Stimme, Mikrofon, Daten.

import { $, el, toast, confirmSheet, openSheet } from '../util.js';
import {
  settings, saveSettings, saveNested, DEFAULT_SETTINGS, vocab, vocabStats,
  exportJson, exportCsv, importJson, replaceVocab, clearHistory,
} from '../store.js';
import * as tts from '../tts.js';
import {
  PROVIDER_LIST, getProvider, resolve, listModels, testConnection, usageToday, ProviderError,
} from '../providers/index.js';

// Geladene Modelllisten je Anbieter, damit der Wechsel nicht jedes Mal neu lädt.
const modelCache = {};

export function initSettings() {
  renderSettings();
  document.addEventListener('vocab:changed', () => {
    if (!$('#view-settings').hidden) renderSettings();
  });
}

export function settingsActions() { return []; }

/* ─────────── Bausteine ─────────── */

function group(title, ...rows) {
  return el('div', { class: 'group' },
    el('h2', { text: title }),
    el('div', { class: 'card-list' }, ...rows.filter(Boolean)),
  );
}

function toggleRow(title, hint, key, onChange) {
  const sw = el('div', { class: `switch${settings[key] ? ' on' : ''}`, role: 'switch', tabindex: '0' });
  const flip = () => {
    const value = !settings[key];
    saveSettings({ [key]: value });
    sw.classList.toggle('on', value);
    onChange?.(value);
  };
  sw.onclick = flip;
  sw.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  return el('div', { class: 'row' },
    el('div', { class: 'row-label' }, el('b', { text: title }), hint ? el('span', { text: hint }) : null),
    sw,
  );
}

function selectRow(title, hint, key, options, onChange) {
  const sel = el('select', { class: 'field' });
  for (const o of options) {
    sel.append(el('option', { value: o.value, text: o.label, selected: String(settings[key]) === String(o.value) }));
  }
  sel.value = settings[key];
  sel.onchange = () => { saveSettings({ [key]: sel.value }); onChange?.(sel.value); };
  return el('div', { class: 'row stack' },
    el('div', { class: 'row-label' }, el('b', { text: title }), hint ? el('span', { text: hint }) : null),
    sel,
  );
}

function sliderRow(title, hint, key, { min, max, step, format }) {
  const out = el('span', { class: 'slider-val', text: format(settings[key]) });
  const input = el('input', { type: 'range', min, max, step, value: settings[key] });
  input.oninput = () => { out.textContent = format(+input.value); };
  input.onchange = () => saveSettings({ [key]: +input.value });
  return el('div', { class: 'row stack' },
    el('div', { class: 'row-label' }, el('b', { text: title }), hint ? el('span', { text: hint }) : null),
    el('div', { class: 'slider-row' }, input, out),
  );
}

/* ─────────── Ansicht ─────────── */

export function renderSettings() {
  const wrap = $('#settings-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.append(
    apiGroup(),
    renaGroup(),
    voiceGroup(),
    micGroup(),
    dataGroup(),
    aboutGroup(),
  );
}

function apiGroup() {
  const provider = getProvider(settings.provider);
  const { apiKey, model, transcribeModel } = resolve(settings);

  /* Anbieterauswahl */
  const chips = el('div', { class: 'chip-row' });
  for (const p of PROVIDER_LIST) {
    const chip = el('button', {
      class: `chip${p.id === provider.id ? ' is-on' : ''}`, type: 'button', text: p.label,
      onclick: () => { saveSettings({ provider: p.id }); renderSettings(); },
    });
    chips.append(chip);
  }

  /* Schlüssel */
  const key = el('input', {
    class: 'field', type: 'password', value: apiKey,
    placeholder: provider.keyPlaceholder, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
  });
  const reveal = el('button', { class: 'chip', type: 'button', text: '👁 Anzeigen' });
  reveal.onclick = () => {
    const hidden = key.type === 'password';
    key.type = hidden ? 'text' : 'password';
    reveal.textContent = hidden ? '🙈 Verbergen' : '👁 Anzeigen';
  };
  key.onchange = () => {
    saveNested('apiKeys', provider.id, key.value.trim());
    delete modelCache[provider.id];
    toast(key.value.trim() ? 'Schlüssel gespeichert.' : 'Schlüssel entfernt.');
  };

  /* Verbindungstest */
  const testResult = el('p', { class: 'field-hint' });
  const testBtn = el('button', { class: 'chip', type: 'button', text: '⇄ Verbindung testen' });
  testBtn.onclick = async () => {
    testBtn.disabled = true;
    testBtn.textContent = '… prüft';
    testResult.textContent = '';
    const res = await testConnection(settings);
    testResult.innerHTML = '';
    testResult.append(
      el('b', { text: `${res.ok ? '✓' : '✗'} ${res.title} — `, style: `color:var(--${res.ok ? 'ok' : 'danger'})` }),
      res.detail,
    );
    testBtn.disabled = false;
    testBtn.textContent = '⇄ Verbindung testen';
  };

  /* Chat-Modell */
  const modelSel = el('select', { class: 'field' });
  const paintModels = () => {
    const list = modelCache[provider.id] || provider.fallbackModels;
    modelSel.innerHTML = '';
    if (!list.some(m => m.id === model)) {
      modelSel.append(el('option', { value: model, text: `${model} (aktuell)` }));
    }
    for (const m of list) modelSel.append(el('option', { value: m.id, text: m.label || m.id }));
    modelSel.value = model;
  };
  paintModels();
  modelSel.onchange = () => { saveNested('models', provider.id, modelSel.value); toast(`Modell: ${modelSel.value}`); };

  const loadBtn = el('button', { class: 'chip', type: 'button', text: '↻ Verfügbare Modelle laden' });
  loadBtn.onclick = async () => {
    loadBtn.textContent = '… lädt';
    loadBtn.disabled = true;
    try {
      const list = await listModels(settings);
      if (!list.length) throw new ProviderError('Keine passenden Modelle gefunden.');
      modelCache[provider.id] = list;
      paintModels();
      toast(`${list.length} Modelle geladen.`, 'ok');
    } catch (err) {
      toast(err instanceof ProviderError ? err.message : 'Konnte Modelle nicht laden.', 'err');
    } finally {
      loadBtn.textContent = '↻ Verfügbare Modelle laden';
      loadBtn.disabled = false;
    }
  };

  /* Transkriptionsmodell — nur bei Anbietern, die dafür einen zweiten Aufruf brauchen */
  let transcribeRow = null;
  if (provider.needsTranscription) {
    const sel = el('select', { class: 'field' });
    for (const m of provider.transcribeModels) {
      sel.append(el('option', { value: m.id, text: m.label }));
    }
    sel.value = transcribeModel;
    sel.onchange = () => saveNested('transcribeModels', provider.id, sel.value);
    transcribeRow = el('div', { class: 'row stack' },
      el('div', { class: 'row-label' },
        el('b', { text: 'Spracherkennung' }),
        el('span', { text: `${provider.label} nimmt Audio nicht direkt im Gespräch entgegen. Deine Aufnahme wird deshalb erst hiermit in Text umgewandelt — Deutsch und Spanisch erkennt es von selbst.` }),
      ),
      sel,
    );
  }

  return group('KI-Anbieter',
    el('div', { class: 'row stack' },
      el('div', { class: 'row-label' },
        el('b', { text: 'Anbieter' }),
        el('span', { text: provider.note }),
      ),
      chips,
    ),
    el('div', { class: 'row stack' },
      el('div', { class: 'row-label' },
        el('b', { text: `API-Schlüssel für ${provider.label}` }),
        el('span', { text: 'Bleibt nur auf diesem iPhone gespeichert und geht ausschließlich an den gewählten Anbieter. Schlüssel anderer Anbieter bleiben erhalten, wenn du wechselst.' }),
      ),
      key,
      el('div', { class: 'chip-row' }, reveal, testBtn),
      el('p', { class: 'field-hint' },
        `${provider.keyHint} `,
        el('a', { href: provider.keyUrl, target: '_blank', rel: 'noopener', text: provider.keyUrl.replace('https://', '') }),
      ),
      testResult,
    ),
    el('div', { class: 'row stack' },
      el('div', { class: 'row-label' },
        el('b', { text: 'Modell' }),
        el('span', { text: `Heute schon ${usageToday()} Anfragen gestellt. Bei „Kontingent aufgebraucht" hilft ein kleineres Modell.` }),
      ),
      modelSel,
      el('div', { class: 'chip-row' }, loadBtn),
    ),
    transcribeRow,
  );
}

function renaGroup() {
  const name = el('input', { class: 'field', type: 'text', value: settings.renaName, placeholder: 'Rena' });
  name.onchange = () => {
    saveSettings({ renaName: name.value.trim() || 'Rena' });
    toast(`Sie heißt jetzt ${settings.renaName}.`);
    document.dispatchEvent(new CustomEvent('conversation:refresh'));
  };

  return group('Rena',
    el('div', { class: 'row stack' },
      el('div', { class: 'row-label' }, el('b', { text: 'Name' }), el('span', { text: 'So sprichst du sie an — auch bei Sprachbefehlen.' })),
      name,
    ),
    selectRow('Dein Niveau', 'Bestimmt Tempo, Wortschatz und wie viel Deutsch sie benutzt.', 'level', [
      { value: 'A1', label: 'A1 — ganz am Anfang' },
      { value: 'A2', label: 'A2 — Grundlagen sitzen' },
      { value: 'B1', label: 'B1 — Alltag klappt' },
      { value: 'B2', label: 'B2 — flüssig' },
      { value: 'C1', label: 'C1 — fast wie zu Hause' },
    ], () => document.dispatchEvent(new CustomEvent('conversation:refresh'))),
    selectRow('Korrekturen', 'Korrekturen erscheinen im Chat, nicht im gesprochenen Text.', 'correctionMode', [
      { value: 'off',    label: 'Aus — einfach reden lassen' },
      { value: 'gentle', label: 'Sanft — nur wichtige Fehler' },
      { value: 'strict', label: 'Streng — jeden Fehler' },
    ]),
    selectRow('Wie viel Deutsch?', 'Wie oft sie auf Deutsch nachhilft.', 'germanShare', [
      { value: 'much',   label: 'Viel — fast alles auch auf Deutsch' },
      { value: 'auto',   label: 'Nach Bedarf' },
      { value: 'little', label: 'Wenig — möglichst nur Spanisch' },
    ]),
    toggleRow('Vorschläge automatisch aufnehmen', 'Renas Vokabelvorschläge landen ohne Antippen im Wörterbuch.', 'autoSaveVocab'),
  );
}

function voiceGroup() {
  const voices = tts.availableVoices();
  const voiceSel = el('select', { class: 'field' });
  voiceSel.append(el('option', { value: '', text: voices.length ? 'Automatisch (beste Übereinstimmung)' : 'Keine spanische Stimme gefunden' }));
  for (const v of voices) {
    voiceSel.append(el('option', { value: v.voiceURI, text: `${v.name} · ${v.lang}` }));
  }
  voiceSel.value = settings.voiceURI || '';
  voiceSel.onchange = () => {
    const chosen = voices.find(v => v.voiceURI === voiceSel.value);
    saveSettings({ voiceURI: voiceSel.value, speechLang: chosen?.lang?.replace('_', '-') || settings.speechLang });
    tts.unlock();
    tts.speak('Hola, soy Rena. ¿Cómo estás pues?', settings);
  };

  return group('Stimme',
    toggleRow('Antworten vorlesen', 'Nötig fürs Aufräumen — sonst musst du mitlesen.', 'autoSpeak'),
    el('div', { class: 'row stack' },
      el('div', { class: 'row-label' },
        el('b', { text: 'Stimme' }),
        el('span', { text: voices.length
          ? 'Peruanisch oder kolumbianisch klingt dem bolivianischen Hochland am ähnlichsten.'
          : 'Unter Einstellungen → Bedienungshilfen → Vorlesen → Stimmen eine spanische Stimme laden.' }),
      ),
      voiceSel,
    ),
    sliderRow('Sprechtempo', 'Zum Üben ruhig langsamer stellen.', 'speechRate',
      { min: 0.5, max: 1.4, step: 0.05, format: v => `${v.toFixed(2)}×` }),
    toggleRow('Übersetzung immer zeigen', 'Sonst blendest du sie pro Antwort mit „DE“ ein.', 'showTranslation',
      () => document.dispatchEvent(new CustomEvent('conversation:refresh'))),
    el('div', { class: 'row' },
      el('div', { class: 'row-label' }, el('b', { text: 'Stimme testen' })),
      el('button', {
        class: 'chip', text: '▶︎ Anhören',
        onclick: () => { tts.unlock(); tts.speak('Buen día, ¿cómo amaneciste? Aquí en La Paz hace frío, alalau.', settings); },
      }),
    ),
  );
}

function micGroup() {
  return group('Mikrofon',
    sliderRow('Sprechpause bis zur Antwort', 'Wie lange Rena wartet, bevor sie antwortet. Länger = du kannst länger überlegen.',
      'silenceMs', { min: 400, max: 2500, step: 100, format: v => `${(v / 1000).toFixed(1)} s` }),
    sliderRow('Empfindlichkeit', 'Niedriger = reagiert auf Leiseres. Höher = ignoriert Nebengeräusche wie Staubsauger.',
      'sensitivity', { min: 1.4, max: 5, step: 0.1, format: v => v.toFixed(1) }),
    sliderRow('Längste Äußerung', 'Danach schickt Rena ab, auch wenn du weiterredest.',
      'maxUtteranceMs', { min: 6000, max: 30000, step: 1000, format: v => `${v / 1000} s` }),
    toggleRow('Dazwischenreden erlaubt', 'An: Du kannst Rena unterbrechen. Aus: Das Mikrofon pausiert, während sie spricht — sicherer bei lauten Lautsprechern.', 'bargeIn'),
    toggleRow('Bildschirm anlassen', 'Verhindert, dass sich das iPhone beim Aufräumen sperrt und das Mikrofon abschaltet.', 'keepAwake'),
  );
}

function dataGroup() {
  const stats = vocabStats();

  const download = (filename, text, type) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const shareOrDownload = async (filename, text, type) => {
    // Auf dem iPhone ist Teilen zuverlässiger als ein Download-Link.
    try {
      const file = new File([text], filename, { type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    download(filename, text, type);
  };

  const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const added = importJson(await file.text());
      renderSettings();
      toast(added ? `${added} neue Einträge importiert.` : 'Alles war schon vorhanden.', 'ok');
    } catch (err) {
      toast(`Import fehlgeschlagen: ${err.message}`, 'err');
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return group('Wörterbuch & Daten',
    el('div', { class: 'row' },
      el('div', { class: 'row-label' },
        el('b', { text: `${stats.total} Einträge` }),
        el('span', { text: `${stats.due} fällig · ${stats.learned} sitzen sicher · ${stats.fresh} frisch` }),
      ),
    ),
    el('div', { class: 'row stack' },
      el('div', { class: 'row-label' }, el('b', { text: 'Sichern' }), el('span', { text: 'Alles liegt nur auf diesem Gerät — sichere es ab und zu.' })),
      el('div', { class: 'chip-row' },
        el('button', { class: 'chip', text: '⤓ JSON', onclick: () => shareOrDownload(`rena-woerterbuch-${stamp}.json`, exportJson(), 'application/json') }),
        el('button', { class: 'chip', text: '⤓ CSV (Excel/Anki)', onclick: () => shareOrDownload(`rena-woerterbuch-${stamp}.csv`, exportCsv(), 'text/csv') }),
        el('button', { class: 'chip', text: '⤒ JSON einlesen', onclick: () => fileInput.click() }),
        fileInput,
      ),
    ),
    el('div', { class: 'row stack' },
      el('div', { class: 'row-label' }, el('b', { text: 'Zurücksetzen' })),
      el('div', { class: 'chip-row' },
        el('button', {
          class: 'chip', text: 'Gespräch löschen',
          onclick: async () => {
            if (!await confirmSheet({ title: 'Gesprächsverlauf löschen?', body: 'Das Wörterbuch bleibt erhalten.', confirmLabel: 'Löschen', danger: true })) return;
            clearHistory();
            document.dispatchEvent(new CustomEvent('conversation:refresh'));
            toast('Verlauf gelöscht.');
          },
        }),
        el('button', {
          class: 'chip', text: 'Lernstand zurücksetzen',
          onclick: async () => {
            if (!await confirmSheet({ title: 'Lernstand zurücksetzen?', body: 'Alle Vokabeln landen wieder in Fach 1. Die Einträge selbst bleiben.', confirmLabel: 'Zurücksetzen' })) return;
            replaceVocab(vocab.map(v => ({ ...v, box: 1, dueAt: Date.now(), right: 0, wrong: 0 })));
            renderSettings();
            toast('Lernstand zurückgesetzt.');
          },
        }),
        el('button', {
          class: 'chip', text: '⚠︎ Wörterbuch leeren',
          onclick: async () => {
            if (!await confirmSheet({
              title: 'Wirklich alles löschen?',
              body: `${vocab.length} Einträge werden unwiderruflich entfernt. Sichere lieber vorher.`,
              confirmLabel: 'Alles löschen', danger: true,
            })) return;
            replaceVocab([]);
            renderSettings();
            toast('Wörterbuch geleert.');
          },
        }),
      ),
    ),
  );
}

function aboutGroup() {
  return group('Darstellung & Info',
    selectRow('Erscheinungsbild', null, 'theme', [
      { value: 'system', label: 'Wie das iPhone' },
      { value: 'dark',   label: 'Dunkel' },
      { value: 'light',  label: 'Hell' },
    ]),
    el('div', { class: 'row' },
      el('div', { class: 'row-label' }, el('b', { text: 'Sprachbefehle' }), el('span', { text: 'Was du Rena im Gespräch sagen kannst.' })),
      el('button', { class: 'chip', text: 'Zeigen', onclick: showCommands }),
    ),
    el('div', { class: 'row' },
      el('div', { class: 'row-label' }, el('b', { text: 'Alle Einstellungen zurücksetzen' })),
      el('button', {
        class: 'chip', text: 'Zurücksetzen',
        onclick: async () => {
          if (!await confirmSheet({ title: 'Einstellungen zurücksetzen?', body: 'Deine API-Schlüssel, die Modellwahl und dein Wörterbuch bleiben erhalten.', confirmLabel: 'Zurücksetzen' })) return;
          saveSettings({
            ...DEFAULT_SETTINGS,
            provider: settings.provider,
            apiKeys: settings.apiKeys,
            models: settings.models,
            transcribeModels: settings.transcribeModels,
          });
          renderSettings();
          document.dispatchEvent(new CustomEvent('conversation:refresh'));
          toast('Zurückgesetzt.');
        },
      }),
    ),
  );
}

function showCommands() {
  const rows = [
    ['„Rena, merk dir das“', 'Nimmt das gerade Besprochene ins Wörterbuch auf.'],
    ['„Apunta esa palabra“', 'Dasselbe auf Spanisch.'],
    ['„Frag mich ab“ / „Pregúntame“', 'Startet die Abfrage aus deinem Wörterbuch.'],
    ['„Ya basta“ / „Stopp, genug“', 'Beendet die Abfrage, das Gespräch geht weiter.'],
    ['„Más despacio“ / „Langsamer“', 'Senkt das Sprechtempo.'],
    ['„¿Cómo se dice …?“', 'Fragt nach einem Wort — meist gleich mit Vorschlag fürs Wörterbuch.'],
    ['„Erklär mir das auf Deutsch“', 'Rena wechselt für diese Erklärung ins Deutsche.'],
  ];
  openSheet(sheet => {
    sheet.append(
      el('h3', { text: 'Sprachbefehle' }),
      el('p', { class: 'sub', text: 'Alles freihändig, mitten im Gespräch — du musst nichts antippen.' }),
      el('div', { class: 'card-list' },
        ...rows.map(([cmd, desc]) => el('div', { class: 'row' },
          el('div', { class: 'row-label' }, el('b', { text: cmd }), el('span', { text: desc })),
        )),
      ),
    );
  });
}
