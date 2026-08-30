// Gesprächsansicht: Freihand-Mikrofon, Chatverlauf, Vokabelvorschläge, Abfrage-Modus.

import { $, el, toast, clamp, confirmSheet } from '../util.js';
import {
  settings, saveSettings, history, pushHistory, clearHistory,
  markHistoryVocabSaved, addVocab, findVocab, gradeVocab, dueVocab, vocab,
} from '../store.js';
import { VoiceEngine, keepAwake } from '../audio.js';
import * as tts from '../tts.js';
import { converse, GeminiError } from '../gemini.js';
import { greeting } from '../persona.js';
import { openVocabSheet } from './vocabsheet.js';

const QUIZ_BATCH = 12;

let engine = null;
let busy = false;
let quizMode = false;
let pendingQuizId = '';
let listening = false;

const dom = {};

/* ═══════════════ Aufbau ═══════════════ */

export function initConversation() {
  dom.scroll   = $('#chat-scroll');
  dom.list     = $('#chat-list');
  dom.micBtn   = $('#btn-mic');
  dom.micState = $('#mic-state-text');
  dom.level    = $('#level-fill');
  dom.kbBtn    = $('#btn-keyboard');
  dom.quizBtn  = $('#btn-quiz-toggle');
  dom.form     = $('#text-form');
  dom.input    = $('#text-input');

  dom.micBtn.addEventListener('click', toggleMic);
  dom.kbBtn.addEventListener('click', () => {
    dom.form.hidden = !dom.form.hidden;
    dom.kbBtn.classList.toggle('is-on', !dom.form.hidden);
    if (!dom.form.hidden) dom.input.focus();
  });
  dom.quizBtn.addEventListener('click', () => setQuizMode(!quizMode));

  dom.form.addEventListener('submit', e => {
    e.preventDefault();
    const text = dom.input.value.trim();
    if (!text) return;
    dom.input.value = '';
    sendTurn({ text });
  });

  document.addEventListener('vocab:changed', () => { /* Chips aktualisieren sich beim Neuzeichnen */ });

  render();
  if (!history.length) showGreeting();
}

/** Kopfzeilen-Knöpfe der Gesprächsansicht. */
export function conversationActions() {
  const stop = el('button', {
    class: 'bar-btn', title: 'Vorlesen abbrechen',
    html: '<span>🔇</span>', onclick: () => { tts.cancel(); setState(listening ? 'listening' : 'idle'); },
  });
  const reset = el('button', {
    class: 'bar-btn', title: 'Neues Gespräch',
    html: '<span>↺</span>',
    onclick: async () => {
      if (!await confirmSheet({
        title: 'Neues Gespräch?',
        body: 'Der bisherige Verlauf wird gelöscht. Dein Wörterbuch bleibt unangetastet.',
        confirmLabel: 'Neu anfangen',
      })) return;
      clearHistory();
      setQuizMode(false);
      render();
      showGreeting();
    },
  });
  return [stop, reset];
}

/* ═══════════════ Zustand ═══════════════ */

const STATE_LABEL = {
  idle:      'Mikrofon aus',
  starting:  'Mikrofon startet …',
  listening: 'Ich höre zu …',
  hearing:   'Du sprichst …',
  thinking:  'Rena überlegt …',
  speaking:  'Rena spricht …',
};

function setState(state) {
  dom.micState.textContent = STATE_LABEL[state] || '';
  dom.micState.className = 'mic-state' +
    (state === 'hearing' ? ' hot' : (state === 'thinking' || state === 'speaking') ? ' thinking' : '');
  dom.micBtn.classList.toggle('hearing', state === 'hearing');
  if (state === 'idle') dom.level.style.width = '0%';
}

function setQuizMode(on) {
  quizMode = on;
  pendingQuizId = '';
  dom.quizBtn.classList.toggle('is-on', on);
  if (on) {
    if (!vocab.length) {
      quizMode = false;
      dom.quizBtn.classList.remove('is-on');
      toast('Dein Wörterbuch ist noch leer.', 'err');
      return;
    }
    addSystemLine('🎯 Abfrage-Modus an — Rena fragt dich jetzt aus deinem Wörterbuch ab.');
    if (!busy) sendTurn({ text: 'Bitte fang jetzt an, mich aus meinem Wörterbuch abzufragen.', silentUser: true });
  } else {
    addSystemLine('Abfrage-Modus aus.');
  }
}

/* ═══════════════ Mikrofon ═══════════════ */

async function toggleMic() {
  if (listening) {
    stopMic();
    return;
  }
  tts.unlock();                       // muss aus der Nutzerhandlung heraus geschehen
  setState('starting');

  if (!settings.apiKey) {
    setState('idle');
    toast('Erst den API-Schlüssel in den Einstellungen eintragen.', 'err');
    document.dispatchEvent(new CustomEvent('nav:go', { detail: 'settings' }));
    return;
  }

  engine = new VoiceEngine(settings);
  engine.addEventListener('level', e => {
    const { rms, threshold } = e.detail;
    dom.level.style.width = `${clamp((rms / Math.max(threshold * 2.2, 0.001)) * 100, 0, 100)}%`;
  });
  engine.addEventListener('speechstart', () => {
    if (settings.bargeIn && tts.isSpeaking()) tts.cancel();
    setState('hearing');
  });
  engine.addEventListener('utterance', e => {
    setState('thinking');
    sendTurn({ audio: e.detail });
  });

  try {
    await engine.start();
  } catch (err) {
    engine = null;
    setState('idle');
    toast(err.message, 'err');
    return;
  }

  listening = true;
  dom.micBtn.classList.add('on');
  dom.micBtn.setAttribute('aria-label', 'Mikrofon stoppen');
  setState('listening');
  if (settings.keepAwake) keepAwake(true);
  toast('Mikrofon läuft — sprich einfach drauflos.', 'ok');
}

function stopMic() {
  listening = false;
  engine?.stop();
  engine = null;
  tts.cancel();
  dom.micBtn.classList.remove('on', 'hearing');
  dom.micBtn.setAttribute('aria-label', 'Mikrofon starten');
  setState('idle');
  keepAwake(false);
}

export function isListening() { return listening; }
export function pauseMic() { if (listening) engine?.setPaused(true); }
export function resumeMic() { if (listening && !busy) engine?.setPaused(false); }

/* ═══════════════ Gesprächszug ═══════════════ */

async function sendTurn({ text, audio, silentUser = false }) {
  if (busy) return;
  busy = true;
  engine?.setPaused(true);
  setState('thinking');

  if (text && !silentUser) {
    pushHistory('user', text);
    renderTurn(history[history.length - 1]);
  }
  const thinking = showThinking();

  try {
    const modelHistory = history
      .filter(h => h.role === 'user' || h.role === 'model')
      .map(h => ({ role: h.role, text: h.text }));
    // Der eigene, gerade angehängte Zug darf nicht doppelt mitgeschickt werden.
    if (text && !silentUser) modelHistory.pop();

    const res = await converse({
      settings,
      history: modelHistory,
      text: silentUser ? text : (audio ? undefined : text),
      audio,
      quizMode,
      quizItems: quizMode ? quizItemsForPrompt() : undefined,
      dictSample: dictSampleForPrompt(),
    });

    thinking.remove();

    // Was Rena verstanden hat, erscheint nachträglich als eigene Sprechblase.
    if (audio) {
      const heard = res.heard || '…';
      pushHistory('user', heard, { lang: res.heardLang, viaVoice: true });
      renderTurn(history[history.length - 1]);
    }

    applyQuizResult(res);

    const turn = pushHistory('model', res.reply, {
      de: res.translation,
      correction: res.correction,
      vocab: res.vocab,
      savedVocab: [],
    });
    renderTurn(turn);

    handleAction(res, turn);
    scrollToEnd();

    if (settings.autoSpeak) {
      setState('speaking');
      const wasMuted = !settings.bargeIn;
      if (wasMuted) engine?.setMuted(true);
      engine?.setPaused(false);
      await tts.speak(res.reply, settings);
      if (wasMuted) {
        // kurze Nachlaufzeit, damit der Lautsprecher-Nachhall nicht als Sprache zählt
        await new Promise(r => setTimeout(r, 260));
        engine?.setMuted(false);
      }
    }

  } catch (err) {
    thinking.remove();
    const message = err instanceof GeminiError ? err.message : (err.message || 'Unbekannter Fehler.');
    addSystemLine(`⚠️ ${message}`, true);
    toast(message, 'err');
  } finally {
    busy = false;
    engine?.setMuted(false);
    engine?.setPaused(false);
    setState(listening ? 'listening' : 'idle');
    scrollToEnd();
  }
}

function handleAction(res, turn) {
  switch (res.action) {
    case 'save_vocab':
      if (res.vocab?.length) {
        let n = 0;
        for (const v of res.vocab) {
          addVocab({ ...v, source: 'conversation' });
          markHistoryVocabSaved(turn.id, v.es);
          n++;
        }
        render();
        toast(n === 1 ? `„${res.vocab[0].es}“ aufgenommen.` : `${n} Einträge aufgenommen.`, 'ok');
      }
      break;
    case 'start_quiz':
      if (!quizMode) { quizMode = true; dom.quizBtn.classList.add('is-on'); addSystemLine('🎯 Abfrage-Modus an.'); }
      break;
    case 'stop_quiz':
      if (quizMode) { quizMode = false; pendingQuizId = ''; dom.quizBtn.classList.remove('is-on'); addSystemLine('Abfrage-Modus aus.'); }
      break;
    case 'slower':
      saveSettings({ speechRate: Math.max(0.5, +(settings.speechRate - 0.15).toFixed(2)) });
      toast(`Sprechtempo: ${settings.speechRate.toFixed(2)}×`);
      break;
    default:
      break;
  }

  if (settings.autoSaveVocab && res.action !== 'save_vocab' && res.vocab?.length) {
    for (const v of res.vocab) {
      addVocab({ ...v, source: 'conversation' });
      markHistoryVocabSaved(turn.id, v.es);
    }
    render();
  }
}

function applyQuizResult(res) {
  if (res.quizResult?.id) {
    const graded = gradeVocab(res.quizResult.id, res.quizResult.correct ? 'yes' : 'no');
    if (graded) document.dispatchEvent(new CustomEvent('vocab:changed'));
  }
  pendingQuizId = res.quizAskedId || '';
}

function quizItemsForPrompt() {
  const due = dueVocab(QUIZ_BATCH);
  const pool = due.length ? due : [...vocab].sort(() => Math.random() - 0.5).slice(0, QUIZ_BATCH);
  const list = pool.map(v => ({ id: v.id, es: v.es, de: v.de, example: v.example }));
  // Die zuletzt gestellte Frage muss in der Liste bleiben, sonst kann Rena sie nicht bewerten.
  if (pendingQuizId && !list.some(v => v.id === pendingQuizId)) {
    const asked = vocab.find(v => v.id === pendingQuizId);
    if (asked) list.unshift({ id: asked.id, es: asked.es, de: asked.de, example: asked.example });
  }
  return list;
}

function dictSampleForPrompt() {
  // Fällige zuerst — daraus kann Rena eine Abfrage starten, ohne dass die App nachhaken muss.
  const seen = new Set();
  const pick = [];
  for (const v of [...dueVocab(24), ...vocab]) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    pick.push({ id: v.id, es: v.es, de: v.de });
    if (pick.length >= 40) break;
  }
  return pick;
}

/* ═══════════════ Darstellung ═══════════════ */

function render() {
  dom.list.innerHTML = '';
  if (!history.length) {
    dom.list.append(emptyState());
    return;
  }
  for (const turn of history) renderTurn(turn, false);
  scrollToEnd();
}

function emptyState() {
  return el('div', { class: 'empty-state' },
    el('span', { class: 'big', text: '🇧🇴' }),
    el('h2', { text: `Hola, ich bin ${settings.renaName}` }),
    el('p', { text: 'Tipp auf das Mikrofon und leg los — auf Deutsch oder Spanisch. Ich antworte auf bolivianischem Spanisch und du kannst nebenher aufräumen.' }),
  );
}

function renderTurn(turn, scroll = true) {
  if (!turn) return;
  if (dom.list.querySelector('.empty-state')) dom.list.innerHTML = '';

  const node = turn.role === 'user' ? userBubble(turn) : renaBubble(turn);
  dom.list.append(node);
  if (scroll) scrollToEnd();
}

function userBubble(turn) {
  return el('div', { class: 'bubble me' },
    el('div', { class: 'es-text', text: turn.text }),
    el('div', { class: 'bubble-meta' },
      el('button', {
        class: 'mini-btn', text: '＋ Wörterbuch',
        onclick: () => openVocabSheet({ sourceText: turn.text, draft: { source: 'conversation' } }),
      }),
    ),
  );
}

function renaBubble(turn) {
  const bubble = el('div', { class: 'bubble rena' });
  bubble.append(el('div', { class: 'es-text', text: turn.text }));

  const de = el('div', { class: 'de-text', text: turn.de || '' });
  de.hidden = !settings.showTranslation || !turn.de;
  if (turn.de) bubble.append(de);

  if (turn.correction?.corrected) {
    bubble.append(el('div', { class: 'correction' },
      el('span', { class: 'was', text: turn.correction.original || '' }),
      ' → ',
      el('span', { class: 'now', text: turn.correction.corrected }),
      turn.correction.explanation ? el('span', { class: 'why', text: turn.correction.explanation }) : null,
      el('div', { class: 'bubble-meta' },
        el('button', {
          class: 'mini-btn', text: '＋ merken',
          onclick: () => openVocabSheet({
            draft: {
              es: turn.correction.corrected,
              de: '', note: turn.correction.explanation || '',
              kind: /\s/.test(turn.correction.corrected) ? 'phrase' : 'word',
              source: 'conversation',
            },
          }),
        }),
      ),
    ));
  }

  if (turn.vocab?.length) {
    const chips = el('div', { class: 'vocab-chips' });
    for (const v of turn.vocab) {
      const already = (turn.savedVocab || []).includes(v.es) || !!findVocab(v.es);
      const chip = el('button', { class: `vchip${already ? ' saved' : ''}` },
        el('span', { class: 'plus', text: already ? '✓' : '＋' }),
        el('b', { text: v.es }),
        v.de ? el('span', { text: `· ${v.de}` }) : null,
      );
      chip.onclick = () => {
        const { entry, created } = addVocab({ ...v, source: 'conversation' });
        markHistoryVocabSaved(turn.id, v.es);
        chip.classList.add('saved');
        chip.querySelector('.plus').textContent = '✓';
        toast(created ? `„${entry.es}“ aufgenommen.` : `„${entry.es}“ war schon drin.`, 'ok');
      };
      chips.append(chip);
    }
    bubble.append(chips);
  }

  const meta = el('div', { class: 'bubble-meta' });
  meta.append(el('button', {
    class: 'mini-btn', text: '🔊',
    onclick: () => { tts.unlock(); tts.speak(turn.text, settings); },
  }));
  if (turn.de) {
    const toggle = el('button', { class: `mini-btn${de.hidden ? '' : ' is-on'}`, text: 'DE' });
    toggle.onclick = () => {
      de.hidden = !de.hidden;
      toggle.classList.toggle('is-on', !de.hidden);
    };
    meta.append(toggle);
  }
  meta.append(el('button', {
    class: 'mini-btn', text: '＋ Wörterbuch',
    onclick: () => openVocabSheet({ sourceText: turn.text, draft: { source: 'conversation' } }),
  }));
  bubble.append(meta);

  return bubble;
}

function showThinking() {
  const node = el('div', { class: 'bubble rena' },
    el('span', { class: 'typing' }, el('i'), el('i'), el('i')),
  );
  dom.list.append(node);
  scrollToEnd();
  return node;
}

function addSystemLine(text, warn = false) {
  if (dom.list.querySelector('.empty-state')) dom.list.innerHTML = '';
  dom.list.append(el('div', { class: `bubble sys${warn ? ' warn' : ''}`, text }));
  scrollToEnd();
}

function showGreeting() {
  const g = greeting(settings.renaName);
  const turn = pushHistory('model', g.reply, { de: g.translation, vocab: g.vocab, savedVocab: [] });
  render();
  return turn;
}

function scrollToEnd() {
  requestAnimationFrame(() => { dom.scroll.scrollTop = dom.scroll.scrollHeight; });
}

/** Nach Einstellungsänderungen: Übersetzungen ein-/ausblenden. */
export function refreshConversation() { render(); }
