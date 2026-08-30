// Abfrage: Karteikarten nach Leitner-System — funktioniert auch ohne Internet.

import { $, el, toast } from '../util.js';
import { vocab, dueVocab, gradeVocab, vocabStats, settings, BOX_DAYS, MAX_BOX } from '../store.js';
import * as tts from '../tts.js';

let queue = [];
let current = null;
let revealed = false;
let direction = 'de2es';    // de2es: Deutsch zeigen, Spanisch abfragen
let sessionDone = 0;
let sessionRight = 0;

export function initQuiz() {
  document.addEventListener('vocab:changed', () => {
    if (!current) renderQuiz();
  });
  renderQuiz();
}

export function quizActions() {
  const btn = el('button', { class: 'bar-btn' });
  const paint = () => { btn.innerHTML = `<span>🔁</span><span>${direction === 'de2es' ? 'DE → ES' : 'ES → DE'}</span>`; };
  btn.onclick = () => {
    direction = direction === 'de2es' ? 'es2de' : 'de2es';
    paint();
    revealed = false;
    renderQuiz();
  };
  paint();
  return [btn];
}

function buildQueue() {
  const due = dueVocab();
  queue = due.length ? due : [...vocab].sort(() => Math.random() - 0.5).slice(0, 20);
  queue = queue.filter(v => v.de || direction === 'es2de');
  sessionDone = 0;
  sessionRight = 0;
}

function next() {
  current = queue.shift() || null;
  revealed = false;
  renderQuiz();
  if (current && direction === 'es2de') speakPrompt();
}

function speakPrompt() {
  if (!current) return;
  tts.unlock();
  tts.speak(current.es, settings);
}

export function renderQuiz() {
  const wrap = $('#quiz-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const stats = vocabStats();

  wrap.append(el('div', { class: 'quiz-head' },
    el('div', { class: 'stat' }, el('b', { text: String(stats.due) }),     el('span', { text: 'fällig' })),
    el('div', { class: 'stat' }, el('b', { text: String(stats.total) }),   el('span', { text: 'gesamt' })),
    el('div', { class: 'stat' }, el('b', { text: String(stats.learned) }), el('span', { text: 'sitzt' })),
  ));

  if (!vocab.length) {
    wrap.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big', text: '🎯' }),
      el('h2', { text: 'Noch nichts zum Abfragen' }),
      el('p', { text: `Nimm im Gespräch mit ${settings.renaName} ein paar Wörter ins Wörterbuch auf — dann kannst du sie hier üben.` }),
    ));
    return;
  }

  if (!current) {
    const finished = sessionDone > 0;
    wrap.append(el('div', { class: 'card' },
      el('div', { class: 'prompt-lang', text: finished ? 'Runde beendet' : 'Bereit?' }),
      el('div', { class: 'prompt', text: finished ? `${sessionRight} von ${sessionDone} richtig` : `${stats.due || vocab.length} Karten` }),
      el('div', { class: 'note', text: finished
        ? 'Gut gemacht. Die Karten kommen je nach Fach in 1, 3, 7, 21 oder 60 Tagen wieder.'
        : direction === 'de2es' ? 'Du siehst Deutsch und sagst es auf Spanisch.' : 'Du hörst Spanisch und sagst es auf Deutsch.' }),
    ));
    wrap.append(el('button', {
      class: 'btn', text: finished ? 'Noch eine Runde' : 'Abfrage starten',
      onclick: () => { buildQueue(); if (!queue.length) { toast('Nichts zu üben.', 'err'); return; } next(); },
    }));
    wrap.append(el('div', { class: 'btn-row', style: 'margin-top:9px' },
      el('button', {
        class: 'btn ghost', html: '<span>💬</span><span>Lieber mit Rena sprechen</span>',
        onclick: () => document.dispatchEvent(new CustomEvent('nav:go', { detail: 'chat', bubbles: true })),
      }),
    ));
    wrap.append(el('p', { class: 'field-hint', style: 'margin-top:14px; text-align:center',
      text: `Fächer: ${BOX_DAYS.slice(1).map((d, i) => `${i + 1}→${d} Tg.`).join(' · ')} — richtig beantwortet rutscht eine Karte ein Fach höher, falsch zurück auf 1.` }));
    return;
  }

  const showEs = direction === 'es2de';
  const card = el('div', { class: 'card' },
    el('div', { class: 'prompt-lang', text: showEs ? 'Spanisch' : 'Deutsch' }),
    el('div', { class: 'prompt', text: showEs ? current.es : (current.de || current.es) }),
  );

  if (revealed) {
    card.append(el('div', { class: 'answer', text: showEs ? (current.de || '—') : current.es }));
    if (current.example) card.append(el('div', { class: 'ex', text: `„${current.example}“` }));
    if (current.note)    card.append(el('div', { class: 'note', text: current.note }));
  } else {
    card.append(el('div', { class: 'note', text: 'Erst laut antworten — dann aufdecken.' }));
  }
  wrap.append(card);

  wrap.append(el('div', { class: 'btn-row', style: 'margin-bottom:9px' },
    el('button', { class: 'btn ghost', html: '<span>🔊</span><span>Vorlesen</span>',
      onclick: () => { tts.unlock(); tts.speak(current.es, settings); } }),
    el('button', { class: 'btn ghost', text: 'Überspringen', onclick: next }),
  ));

  if (!revealed) {
    wrap.append(el('button', { class: 'btn', text: 'Antwort zeigen', onclick: () => { revealed = true; renderQuiz(); } }));
  } else {
    wrap.append(el('div', { class: 'grade-row' },
      el('button', { class: 'btn g-no',  text: 'Wusste ich nicht', onclick: () => grade('no') }),
      el('button', { class: 'btn g-mid', text: 'Fast',             onclick: () => grade('almost') }),
      el('button', { class: 'btn g-yes', text: 'Gewusst',          onclick: () => grade('yes') }),
    ));
  }

  wrap.append(el('p', {
    class: 'field-hint', style: 'text-align:center; margin-top:12px',
    text: `Fach ${current.box || 1}/${MAX_BOX} · noch ${queue.length} in dieser Runde`,
  }));
}

function grade(g) {
  if (!current) return;
  gradeVocab(current.id, g);
  sessionDone++;
  if (g === 'yes') sessionRight++;
  if (g !== 'yes') queue.push(current);   // falsch beantwortete Karten kommen in dieser Runde wieder
  next();
}
