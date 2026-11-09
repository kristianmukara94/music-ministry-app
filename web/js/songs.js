// The Song Library. The songs are the church's own, from the server, and are edited on the laptop. Search by title, filter by scope, language
// and category, sort, see how many upcoming plans use each song, open a song's details, and add it to a plan. Every value from the data goes
// through esc() before it reaches markup. The counts on the category chips follow the search, the language and the scope, so they show how
// many songs each chip would list.
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { listPlans, listSongs, songUsage } from './plan-api.js';
import { canCreatePlans, editorPathFor, localDate, NO_SONGS, shortDate } from './plan-model.js';
import { openAddToPlan } from './add-to-plan.js';
import {
  DEFAULT_SONG_SORT,
  LANGUAGES,
  SCOPES,
  activePlans,
  categoriesInScope,
  countsFor,
  filterSongs,
  languageBadge,
  plansBySong,
  scopeCounts,
  scopeLabel,
  sortSongs,
  syncedText,
  usedLabel,
} from './song-list.js';

mountSidebar();

const state = {
  q: '',
  scope: 'All',
  category: 'All',
  language: 'All',
  sort: DEFAULT_SONG_SORT,
  songs: [],
  lastUpdatedAt: null,
  loaded: false,
  failed: null,
  plans: [],
  usage: {},
  plansFailed: false,
  canEdit: false,
  openSong: null,
};

const table = document.getElementById('song-table');
const rows = document.getElementById('song-rows');
const search = document.getElementById('song-search-input');
const statusLine = document.getElementById('song-status');
const drawer = document.getElementById('song-drawer');

const CHIP_ON = 'height:34px;padding:0 14px;border-radius:99px;border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:700;cursor:pointer';
const CHIP_OFF = 'height:34px;padding:0 14px;border-radius:99px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:600;cursor:pointer';
const SEG_ON = 'height:46px;padding:0 16px;border-radius:8px;border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);font-size:14px;font-weight:700;cursor:pointer';
const SEG_OFF = 'height:46px;padding:0 16px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:14px;font-weight:600;cursor:pointer';
const TAB_ON = 'height:40px;padding:0 16px;border-radius:8px;border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);font-size:14px;font-weight:700;cursor:pointer';
const TAB_OFF = 'height:40px;padding:0 16px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:14px;font-weight:600;cursor:pointer';

const ICON_PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

let usedBy = new Map();
const plansOf = (songId) => usedBy.get(songId) ?? [];
const upcomingPlans = () => activePlans(state.plans, localDate());
const refreshUse = () => {
  usedBy = plansBySong(state.usage, upcomingPlans());
};
const songOf = (id) => state.songs.find((song) => song.id === id);
const canAdd = () => state.canEdit && !state.plansFailed;

function say(text, isError = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle('is-error', isError);
}

const notice = (title, detail) => `
        <div style="padding: 36px 18px; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center">
          <span style="font-size: 16px; font-weight: 700">${esc(title)}</span>
          ${detail ? `<span style="font-size: 13px; color: var(--muted)">${esc(detail)}</span>` : ''}
        </div>`;

function languagePill(language) {
  const badge = languageBadge(language);
  return badge ? `<span class="badge-pill badge-lang is-${badge.tone}" title="${esc(language)}">${badge.code}</span>` : esc(language);
}

const keyPill = (key) => (key ? `<span class="badge-pill badge-key">Key of ${esc(key)}</span>` : '');

function songRow(song) {
  const used = plansOf(song.id).length;
  return `
        <div class="song-row" data-song-row="${esc(song.id)}">
          <span class="song-cell-title"><button type="button" class="song-row-open" aria-haspopup="dialog">${esc(song.title)}</button></span>
          <span class="song-cell-category"><span class="song-category">${esc(song.category)}</span></span>
          <span>${languagePill(song.language)}</span>
          <span>${keyPill(song.key)}</span>
          <span class="song-used${used ? '' : ' is-none'}">${state.plansFailed ? '' : usedLabel(used)}</span>
          ${canAdd() ? `<span class="song-cell-action"><button type="button" class="btn-quiet song-add" data-add-song="${esc(song.id)}">${ICON_PLUS}Add to plan</button></span>` : ''}
        </div>`;
}

function renderRows() {
  table.classList.toggle('no-actions', !canAdd());
  const shown = sortSongs(filterSongs(state.songs, state), state.sort, (song) => plansOf(song.id).length);
  if (state.failed) rows.innerHTML = notice('The song list could not be loaded', state.failed);
  else if (!state.loaded) rows.innerHTML = notice('Loading songs…');
  else if (state.songs.length === 0) rows.innerHTML = notice(NO_SONGS);
  else rows.innerHTML = shown.length ? shown.map(songRow).join('') : notice('No songs match', 'Try another scope or category, or clear the search.');

  // Bound to each button, and stopped here, so the press never reaches the row's own click and opens the drawer as well.
  rows.querySelectorAll('[data-add-song]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      addToPlan(songOf(button.dataset.addSong));
    });
  });

  document.getElementById('footer').textContent = state.failed || !state.loaded ? '' : `Showing ${shown.length} of ${state.songs.length} songs`;
}

function render() {
  const counts = countsFor(state.songs, state);
  const tabs = scopeCounts(state.songs, state);

  document.getElementById('scopes').innerHTML = SCOPES.map((s) => `
          <button type="button" role="tab" data-scope="${s.value}" aria-selected="${state.scope === s.value}" style="${state.scope === s.value ? TAB_ON : TAB_OFF}">${esc(s.label)} <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; margin-left: 6px">${tabs[s.value]}</span></button>`).join('');

  document.getElementById('langs').innerHTML = ['All', ...LANGUAGES].map((l) => `
          <button type="button" data-lang="${esc(l)}" aria-pressed="${state.language === l}" style="${state.language === l ? SEG_ON : SEG_OFF}">${l === 'All' ? 'All languages' : esc(l)}</button>`).join('');

  document.getElementById('cats').innerHTML = ['All', ...categoriesInScope(state.songs, state.scope)].map((c) => `
        <button type="button" data-cat="${esc(c)}" aria-pressed="${state.category === c}" style="${state.category === c ? CHIP_ON : CHIP_OFF}">${c === 'All' ? 'All songs' : esc(c)} <span style="font-family: 'JetBrains Mono', monospace; margin-left: 6px; opacity: 0.8">${counts[c] ?? 0}</span></button>`).join('');

  document.getElementById('synced').textContent = state.failed || !state.loaded ? '' : syncedText(state.lastUpdatedAt);
  renderRows();
}

// ---- The song's details, in a drawer from the right. A dialog, so focus stays inside it and Escape closes it. ----

function planListHtml(song) {
  if (state.plansFailed) return '<p class="entry-empty">The plans could not be loaded. Reload the page to try again.</p>';
  const plans = plansOf(song.id);
  if (plans.length === 0) return '<p class="entry-empty">No upcoming plan uses this song yet.</p>';
  return `<ul class="song-plan-list">${plans.map((plan) => `
          <li><a class="song-plan-link" href="${esc(editorPathFor(plan))}"><strong>${esc(plan.name)}</strong><span>${esc(shortDate(plan.liturgical_date))} · ${plan.kind === 'pw' ? 'Praise &amp; Worship' : 'Holy Mass'}</span></a></li>`).join('')}
        </ul>`;
}

function drawerHtml(song) {
  return `
      <div class="song-drawer-body">
        <div class="hub-head">
          <div>
            <span class="eyebrow">Song details</span>
            <h2 id="song-drawer-title" class="section-title song-drawer-title">${esc(song.title)}</h2>
          </div>
          <button type="button" class="hub-close" data-drawer-close aria-label="Close song details">×</button>
        </div>
        <div class="plan-badges">
          ${keyPill(song.key)}
          <span class="plan-badge is-kind">${esc(scopeLabel(song.scope))}</span>
          ${languagePill(song.language)}
        </div>
        <dl class="song-facts">
          <div><dt>Category</dt><dd>${esc(song.category) || 'None'}</dd></div>
          ${song.ccli ? `<div><dt>CCLI number</dt><dd class="is-mono">${esc(song.ccli)}</dd></div>` : ''}
        </dl>
        <section class="song-drawer-plans" aria-label="Upcoming plans using this song">
          <span class="eyebrow">In upcoming plans</span>
          ${planListHtml(song)}
        </section>
      </div>
      ${canAdd() ? `<div class="song-drawer-foot"><button type="button" class="btn-primary song-drawer-add" data-drawer-add>${ICON_PLUS}Add to plan</button></div>` : ''}`;
}

function openDrawer(id) {
  const song = songOf(id);
  if (!song) return;
  state.openSong = id;
  drawer.innerHTML = drawerHtml(song);
  drawer.showModal();
}

drawer.addEventListener('click', (event) => {
  // The body fills the drawer, so only a press on the backdrop lands on the dialog itself.
  if (event.target === drawer || event.target.closest('[data-drawer-close]')) drawer.close();
  else if (event.target.closest('[data-drawer-add]')) addToPlan(songOf(state.openSong));
});

drawer.addEventListener('close', () => {
  state.openSong = null;
});

rows.addEventListener('click', (event) => {
  const row = event.target.closest('[data-song-row]');
  if (row) openDrawer(row.dataset.songRow);
});

// ---- Add to plan. ----

function addToPlan(song) {
  if (!song) return;
  openAddToPlan({
    song,
    plans: upcomingPlans(),
    onAdded: (plan, stepName) => {
      const planIds = state.usage[song.id] ?? [];
      if (!planIds.includes(plan.id)) state.usage = { ...state.usage, [song.id]: [...planIds, plan.id] };
      refreshUse();
      renderRows();
      say(`Added ${song.title} to ${plan.name}, ${stepName}.`);
      // The rows and the drawer were redrawn, so the button that was pressed has gone. Focus goes back to its replacement.
      if (drawer.open) {
        drawer.innerHTML = drawerHtml(song);
        drawer.querySelector('[data-drawer-add]')?.focus();
      } else {
        rows.querySelector(`[data-add-song="${CSS.escape(song.id)}"]`)?.focus();
      }
    },
  });
}

// ---- The controls above the list. ----

search.addEventListener('input', (event) => {
  state.q = event.target.value;
  render();
});

document.getElementById('song-sort').addEventListener('change', (event) => {
  state.sort = event.target.value;
  renderRows();
});

document.querySelector('main').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  let selector;
  if (button.dataset.scope) {
    state.scope = button.dataset.scope;
    // A category the new scope does not use would leave an empty list with no chip to turn off.
    if (!categoriesInScope(state.songs, state.scope).includes(state.category)) state.category = 'All';
    selector = `[data-scope="${CSS.escape(state.scope)}"]`;
  } else if (button.dataset.lang) {
    state.language = button.dataset.lang;
    selector = `[data-lang="${CSS.escape(state.language)}"]`;
  } else if (button.dataset.cat) {
    state.category = button.dataset.cat;
    selector = `[data-cat="${CSS.escape(state.category)}"]`;
  } else {
    return;
  }
  render();
  // The buttons are redrawn, so keep keyboard focus on the one that was pressed.
  document.querySelector(selector)?.focus();
});

async function load() {
  const [songs, plans, usage] = await Promise.allSettled([listSongs(), listPlans(), songUsage()]);
  state.loaded = true;
  if (songs.status === 'fulfilled') {
    state.songs = songs.value.songs ?? [];
    state.lastUpdatedAt = songs.value.lastUpdatedAt ?? null;
  } else {
    state.failed = songs.reason instanceof Error ? songs.reason.message : 'Something went wrong. Try again.';
  }
  // The songs still show when the plans cannot be read; only the counters and Add to plan wait for a reload.
  state.plansFailed = plans.status !== 'fulfilled' || usage.status !== 'fulfilled';
  if (state.plansFailed) {
    say('The plans could not be loaded, so plan counts and Add to plan are not shown. Reload the page to try again.', true);
  } else {
    state.plans = plans.value.plans ?? [];
    state.usage = usage.value.usage ?? {};
    refreshUse();
  }
  render();
}

const user = await guard();
if (user) {
  state.canEdit = canCreatePlans(user.role);

  // "/" goes to the search box, unless the person is already typing somewhere or a dialog is open. The key is added only now, so it cannot
  // move focus behind the change-password screen.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    search.focus();
  });

  render();
  await load();
}
