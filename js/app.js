// Start und Navigation.

import { $, $$ } from './util.js';
import { settings, applyTheme, vocabStats } from './store.js';
import { reacquireWakeLock } from './audio.js';
import { initConversation, conversationActions, refreshConversation, isListening } from './views/conversation.js';
import { initDictionary, dictionaryActions, renderDictionary } from './views/dictionary.js';
import { initQuiz, quizActions, renderQuiz } from './views/quiz.js';
import { initSettings, settingsActions, renderSettings } from './views/settings.js';

const VIEWS = {
  chat:     { title: 'Gespräch',      node: '#view-chat',     actions: conversationActions, refresh: refreshConversation },
  dict:     { title: 'Wörterbuch',    node: '#view-dict',     actions: dictionaryActions,   refresh: renderDictionary },
  quiz:     { title: 'Abfrage',       node: '#view-quiz',     actions: quizActions,         refresh: renderQuiz },
  settings: { title: 'Einstellungen', node: '#view-settings', actions: settingsActions,     refresh: renderSettings },
};

let currentView = 'chat';

function go(name) {
  if (!VIEWS[name]) return;
  currentView = name;

  for (const [key, view] of Object.entries(VIEWS)) {
    $(view.node).hidden = key !== name;
  }
  $$('#tabbar .tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));

  const view = VIEWS[name];
  $('#view-title').textContent = name === 'chat' ? settings.renaName : view.title;

  const actions = $('#appbar-actions');
  actions.innerHTML = '';
  for (const btn of view.actions() || []) actions.append(btn);

  view.refresh?.();
  try { history.replaceState(null, '', `#${name}`); } catch { /* egal */ }
}

function updateBadges() {
  const stats = vocabStats();
  const dict = $('#badge-dict');
  const quiz = $('#badge-quiz');
  dict.textContent = String(stats.total);
  dict.hidden = !stats.total;
  quiz.textContent = String(stats.due);
  quiz.hidden = !stats.due;
}

function boot() {
  applyTheme();

  initConversation();
  initDictionary();
  initQuiz();
  initSettings();

  $('#tabbar').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) go(tab.dataset.tab);
  });

  document.addEventListener('nav:go', e => go(e.detail));
  document.addEventListener('conversation:refresh', () => {
    refreshConversation();
    if (currentView === 'chat') $('#view-title').textContent = settings.renaName;
  });
  document.addEventListener('vocab:changed', updateBadges);
  document.addEventListener('settings:changed', updateBadges);

  // Bildschirmsperre nach dem Zurückschalten wieder verhindern.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && settings.keepAwake && isListening()) reacquireWakeLock();
  });

  // Beim Aufräumen soll ein Wisch nicht versehentlich die Seite neu laden.
  window.addEventListener('beforeunload', e => {
    if (isListening()) { e.preventDefault(); e.returnValue = ''; }
  });

  const start = (location.hash || '').replace('#', '');
  go(VIEWS[start] ? start : 'chat');
  updateBadges();

  registerServiceWorker();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' });
  } catch (err) {
    console.warn('Service Worker nicht registriert:', err);
  }
}

/* Unerwartete Fehler nicht stillschweigend schlucken. */
window.addEventListener('error', e => console.error('Fehler:', e.message));
window.addEventListener('unhandledrejection', e => console.error('Nicht behandelt:', e.reason));

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
