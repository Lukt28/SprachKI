// Gemeinsamer Dialog zum Anlegen und Bearbeiten von Wörterbuch-Einträgen.

import { el, openSheet, toast, splitWords, confirmSheet } from '../util.js';
import { addVocab, updateVocab, removeVocab, settings } from '../store.js';
import { lookup, ProviderError } from '../providers/index.js';

/**
 * @param {object}  o
 * @param {object} [o.entry]      vorhandener Eintrag → Bearbeiten
 * @param {object} [o.draft]      Vorbelegung {es, de, example, note, kind, bolivian}
 * @param {string} [o.sourceText] Satz, aus dem Wörter angetippt werden können
 * @param {Function}[o.onSaved]
 */
export function openVocabSheet({ entry = null, draft = {}, sourceText = '', onSaved } = {}) {
  const editing = !!entry;
  const init = entry || draft;

  openSheet((sheet, close) => {
    const esField   = el('input', { class: 'field', type: 'text', value: init.es || '', placeholder: 'z. B. la trancadera', autocapitalize: 'none' });
    const deField   = el('input', { class: 'field', type: 'text', value: init.de || '', placeholder: 'z. B. der Stau' });
    const exField   = el('textarea', { class: 'field', placeholder: 'Beispielsatz auf Spanisch (optional)' });
    const noteField = el('input', { class: 'field', type: 'text', value: init.note || '', placeholder: 'Anmerkung (optional)' });
    exField.value = init.example || '';

    let kind = init.kind || (/\s/.test(init.es || '') ? 'phrase' : 'word');
    let bolivian = !!init.bolivian;

    const kindBtn = el('button', { class: 'chip', type: 'button' });
    const boBtn   = el('button', { class: 'chip', type: 'button', text: '🇧🇴 Bolivianisch' });
    const paint = () => {
      kindBtn.textContent = kind === 'phrase' ? 'Satz / Wendung' : 'Einzelwort';
      kindBtn.classList.add('is-on');
      boBtn.classList.toggle('is-on', bolivian);
    };
    kindBtn.onclick = () => { kind = kind === 'phrase' ? 'word' : 'phrase'; paint(); };
    boBtn.onclick   = () => { bolivian = !bolivian; paint(); };
    paint();

    // Wörter aus dem Gesprächssatz antippen statt abtippen.
    let picker = null;
    if (sourceText && !editing) {
      const words = [...new Set(splitWords(sourceText))].slice(0, 40);
      if (words.length) {
        picker = el('div', { class: 'word-picker' });
        const chosen = new Set();
        for (const w of words) {
          const b = el('button', { type: 'button', text: w });
          b.onclick = () => {
            if (chosen.has(w)) chosen.delete(w); else chosen.add(w);
            b.classList.toggle('pick', chosen.has(w));
            const ordered = words.filter(x => chosen.has(x));
            esField.value = ordered.join(' ');
            kind = ordered.length > 1 ? 'phrase' : 'word';
            paint();
          };
          picker.append(b);
        }
      }
    }

    const lookupBtn = el('button', {
      class: 'btn ghost', type: 'button',
      html: '<span>✨</span><span>Rena ergänzen lassen</span>',
    });
    lookupBtn.onclick = async () => {
      const term = esField.value.trim() || deField.value.trim();
      if (!term) { toast('Erst ein Wort eintragen.', 'err'); return; }
      if (!settings.apiKeys?.[settings.provider]) { toast('Dafür fehlt der API-Schlüssel.', 'err'); return; }
      const dir = esField.value.trim() ? 'es' : 'de';
      lookupBtn.disabled = true;
      lookupBtn.innerHTML = '<span>…</span><span>Rena schlägt nach</span>';
      try {
        const r = await lookup(settings, term, dir);
        if (r.es) esField.value = r.es;
        if (r.de) deField.value = r.de;
        if (r.example && !exField.value.trim()) exField.value = r.example;
        if (r.note && !noteField.value.trim()) noteField.value = r.note;
        if (r.kind) kind = r.kind;
        if (r.bolivian) bolivian = true;
        paint();
        toast('Ergänzt.', 'ok');
      } catch (err) {
        toast(err instanceof ProviderError ? err.message : 'Nachschlagen fehlgeschlagen.', 'err');
      } finally {
        lookupBtn.disabled = false;
        lookupBtn.innerHTML = '<span>✨</span><span>Rena ergänzen lassen</span>';
      }
    };

    const save = () => {
      const es = esField.value.trim();
      if (!es) { toast('Der spanische Eintrag fehlt.', 'err'); esField.focus(); return; }
      const payload = {
        es, de: deField.value.trim(), kind,
        example: exField.value.trim(), note: noteField.value.trim(), bolivian,
      };
      if (editing) {
        updateVocab(entry.id, payload);
        toast('Gespeichert.', 'ok');
      } else {
        const { created } = addVocab({ ...payload, source: draft.source || 'manual' });
        toast(created ? `„${es}“ ins Wörterbuch aufgenommen.` : `„${es}“ war schon drin — ergänzt.`, 'ok');
      }
      close();
      onSaved?.();
    };

    sheet.append(
      el('h3', { text: editing ? 'Eintrag bearbeiten' : 'Ins Wörterbuch aufnehmen' }),
      el('p', { class: 'sub', text: picker
        ? 'Tippe Wörter im Satz an oder schreib den Eintrag selbst.'
        : 'Deutsch darf leer bleiben — Rena kann es ergänzen.' }),

      picker && el('label', { class: 'lbl', text: 'Aus dem Gespräch übernehmen' }),
      picker,

      el('label', { class: 'lbl', text: 'Spanisch' }), esField,
      el('label', { class: 'lbl', text: 'Deutsch' }),  deField,
      el('label', { class: 'lbl', text: 'Beispielsatz' }), exField,
      el('label', { class: 'lbl', text: 'Anmerkung' }), noteField,

      el('label', { class: 'lbl', text: 'Art' }),
      el('div', { class: 'chip-row' }, kindBtn, boBtn),

      el('div', { class: 'btn-row', style: 'margin-top:16px' }, lookupBtn),

      el('div', { class: 'btn-row' },
        el('button', { class: 'btn ghost', type: 'button', text: 'Abbrechen', onclick: close }),
        el('button', { class: 'btn', type: 'button', text: editing ? 'Sichern' : 'Aufnehmen', onclick: save }),
      ),

      editing && el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn danger', type: 'button', text: 'Eintrag löschen',
          onclick: async () => {
            close();
            if (await confirmSheet({
              title: `„${entry.es}“ löschen?`,
              body: 'Der Eintrag verschwindet endgültig aus dem Wörterbuch.',
              confirmLabel: 'Löschen', danger: true,
            })) {
              removeVocab(entry.id);
              toast('Gelöscht.');
              onSaved?.();
            }
          },
        }),
      ),
    );
  });
}
