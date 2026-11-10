// The song picker both planners share, drawn inside the panel that opens under a step (Praise & Worship) or in the step drawer (Holy Mass).
// It lists the church's songs the way the church laptop files them. Two tabs, Holy Mass and Praise & Worship, keep the two kinds of song apart
// (a General song is sung in both, so it is under each). Under a tab, the category buttons narrow the list to one part of the Mass or one kind
// of praise song. Opened on a step, it starts on the plan's own tab and the step's own category. The rules are in lineup-templates.js, which
// the laptop and the server share. Every value written into markup goes through esc().
//
// The editors redraw their whole step list after each change (a song added, a minute changed), which redraws the panel too. So the picker keeps
// what the operator chose (tab, category, search) per step here, and is mounted again into the new panel after each redraw.
import { esc } from './shell.js';
import { LANGUAGE_CODE } from './sample-data.js';
import { ALL_CATEGORIES, SERVICE_TYPES, filterPickerSongs, pickerCategoryLabel, pickerPillsFor, serviceTypeOf } from './lineup-templates.js';

const NO_SONGS = 'No songs yet. Songs are added from the church laptop.';

// Per step key: { serviceType, category, query, focus }. `focus` is what to put the keyboard back on after the next mount.
const views = new Map();

/** A category the tab has no button for (another tab's, or one no song uses any more) falls back to All, so the list is never stuck empty. */
function settleCategory(ctx, view) {
  const pills = pickerPillsFor(ctx.songs, view.serviceType);
  if (!pills.some((pill) => pill.id === view.category)) view.category = ALL_CATEGORIES;
}

function tabsHtml(ctx, view) {
  return SERVICE_TYPES.map((type) => {
    const on = type.id === view.serviceType;
    return `<button type="button" role="tab" id="${ctx.uid}-tab-${type.id}" aria-selected="${on}" aria-controls="${ctx.uid}-list" tabindex="${on ? 0 : -1}" class="${on ? 'is-on' : ''}" data-picker-type="${type.id}">${esc(type.label)}</button>`;
  }).join('');
}

function pillsHtml(ctx, view) {
  return pickerPillsFor(ctx.songs, view.serviceType, { query: view.query }).map((pill) => {
    const on = pill.id === view.category;
    return `<button type="button" class="picker-pill${on ? ' is-on' : ''}" aria-pressed="${on}" data-picker-category="${esc(pill.id)}">${esc(pill.label)}<span class="picker-pill-count">${pill.count}</span></button>`;
  }).join('');
}

/** What the list says when it has nothing to show, with the way out: every song of the tab, the other tab, or clearing the search. */
function emptyHtml(ctx, view) {
  if (ctx.songs.length === 0) return `<p class="picker-empty">${esc(NO_SONGS)}</p>`;
  const type = serviceTypeOf(view.serviceType);
  const label = pickerCategoryLabel(view.serviceType, view.category);
  const query = view.query.trim();
  const narrowed = view.category !== ALL_CATEGORIES;
  const message = query
    ? `No songs match “${query}” under ${narrowed ? label : type.label}.`
    : narrowed ? `No songs are filed under ${label} yet.` : `No ${type.label} songs yet.`;
  const actions = [];
  if (narrowed) {
    const inTab = filterPickerSongs(ctx.songs, { serviceType: view.serviceType, query }).length;
    if (inTab > 0) actions.push(`<button type="button" class="btn-primary" data-picker-category="${ALL_CATEGORIES}">Show all songs (${inTab})</button>`);
  }
  const other = SERVICE_TYPES.find((t) => t.id !== view.serviceType);
  const inOther = filterPickerSongs(ctx.songs, { serviceType: other.id, query }).length;
  if (inOther > 0) actions.push(`<button type="button" class="btn-quiet" data-picker-type="${other.id}">Look under ${esc(other.label)} (${inOther})</button>`);
  if (query) actions.push('<button type="button" class="btn-quiet" data-picker-action="clear-search">Clear the search</button>');
  return `<div class="picker-empty"><p>${esc(message)}</p>${actions.length ? `<div class="picker-empty-actions">${actions.join('')}</div>` : ''}</div>`;
}

function listHtml(ctx, view) {
  const shown = filterPickerSongs(ctx.songs, view);
  if (shown.length === 0) return emptyHtml(ctx, view);
  const chosen = ctx.chosenIds();
  const lock = ctx.canEdit ? '' : 'disabled';
  return `<ul class="picker-songs">${shown.map((song) => {
    const added = chosen.has(song.id);
    const details = [song.category, LANGUAGE_CODE[song.language] ?? song.language, song.key ? `Key ${song.key}` : ''].filter(Boolean).join(' · ');
    return `<li class="picker-song">
        <span class="picker-song-text"><strong>${esc(song.title)}</strong><span class="muted">${esc(details)}</span></span>
        <button type="button" data-picker-song="${esc(song.id)}" aria-pressed="${added}" aria-label="${added ? 'Remove' : 'Add'} ${esc(song.title)}" class="${added ? 'btn-chosen' : 'btn-quiet'}" ${lock}>${added ? 'Added' : 'Add'}</button>
      </li>`;
  }).join('')}</ul>`;
}

function statusText(ctx, view) {
  const shown = filterPickerSongs(ctx.songs, view).length;
  const chosen = ctx.chosenIds().size;
  return `${shown} song${shown === 1 ? '' : 's'} shown${chosen ? ` · ${chosen} in this step` : ''}`;
}

function draw(root, ctx, view) {
  root.innerHTML = `
      <div class="picker-tabs" role="tablist" aria-label="Service type">${tabsHtml(ctx, view)}</div>
      <div class="picker-pills" role="group" aria-label="Song category" data-picker-pills>${pillsHtml(ctx, view)}</div>
      <input class="picker-search" data-picker-search type="search" aria-label="Search songs by title" placeholder="Search songs by title" value="${esc(view.query)}">
      <div class="picker-list" id="${ctx.uid}-list" role="tabpanel" aria-labelledby="${ctx.uid}-tab-${view.serviceType}" data-picker-list>${listHtml(ctx, view)}</div>
      <span class="muted picker-status" data-picker-status aria-live="polite">${esc(statusText(ctx, view))}</span>`;
}

/** On a phone the category buttons are one row that scrolls sideways, so the chosen one is brought into view. */
const showChosenPill = (root) => root.querySelector('.picker-pill.is-on')?.scrollIntoView({ block: 'nearest', inline: 'center' });

/** Redraws the category buttons and the list, and leaves the search box alone so typing is never interrupted. */
function refresh(root, ctx, view) {
  root.querySelector('[data-picker-pills]').innerHTML = pillsHtml(ctx, view);
  root.querySelector('[data-picker-list]').innerHTML = listHtml(ctx, view);
  root.querySelector('[data-picker-status]').textContent = statusText(ctx, view);
  showChosenPill(root);
}

function focusFor(root, focus) {
  if (!focus) return;
  const match = (selector, key, value) => [...root.querySelectorAll(selector)].find((el) => el.dataset[key] === value);
  const el =
    focus.song ? match('[data-picker-song]', 'pickerSong', focus.song)
    : focus.type ? match('[data-picker-type]', 'pickerType', focus.type)
    : focus.pill ? root.querySelector('.picker-pill.is-on')
    : focus.search ? root.querySelector('[data-picker-search]')
    : null;
  el?.focus({ preventScroll: true });
}

/**
 * Draws the song picker into `root` (an element of the step's panel). `key` names the step: its tab, category and search are kept under it
 * while the page redraws. `songs` is the church's list (removed songs left out). `serviceType` ('mass' or 'praise_worship') is the tab it
 * opens on, the plan's own; `category` is the category it opens on, the step's own ('all', or none, for every song). `chosenIds()` returns
 * the ids of the songs the step holds now, and `onToggle(songId)` adds a song to the step or takes it out again (the page then redraws, and
 * mounts the picker again).
 */
export function mountSongPicker(root, { key, songs, serviceType, category = ALL_CATEGORIES, canEdit = true, chosenIds, onToggle }) {
  if (!root) return;
  let view = views.get(key);
  if (!view) {
    view = { serviceType: serviceTypeOf(serviceType) ? serviceType : SERVICE_TYPES[0].id, category: category || ALL_CATEGORIES, query: '', focus: null };
    views.set(key, view);
  }
  const ctx = { songs, canEdit, chosenIds, onToggle, uid: `picker-${String(key).replace(/[^a-zA-Z0-9_-]/g, '_')}` };
  root.classList.add('picker-inline');
  draw(root, ctx, view);
  showChosenPill(root);
  const focus = view.focus;
  view.focus = null;
  focusFor(root, focus);

  root.onclick = (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled || !root.contains(button)) return;
    const { pickerType, pickerCategory, pickerSong, pickerAction } = button.dataset;
    if (pickerType) {
      if (!serviceTypeOf(pickerType)) return;
      view.serviceType = pickerType;
      settleCategory(ctx, view);
      draw(root, ctx, view);
      showChosenPill(root);
      if (button.getAttribute('role') === 'tab') focusFor(root, { type: pickerType });
    } else if (pickerCategory !== undefined) {
      view.category = pickerCategory;
      refresh(root, ctx, view);
      focusFor(root, { pill: true });
    } else if (pickerSong) {
      // The page redraws on the change and mounts the picker again; the keyboard goes back to the same song there.
      view.focus = { song: pickerSong };
      onToggle(pickerSong);
      if (root.isConnected) {
        view.focus = null;
        refresh(root, ctx, view);
        focusFor(root, { song: pickerSong });
      }
    } else if (pickerAction === 'clear-search') {
      view.query = '';
      draw(root, ctx, view);
      focusFor(root, { search: true });
    }
  };
  root.oninput = (event) => {
    if (event.target.dataset?.pickerSearch === undefined) return;
    view.query = event.target.value;
    refresh(root, ctx, view);
  };
  // Arrow keys move between the two tabs, as in any tab list.
  root.onkeydown = (event) => {
    if (event.target.getAttribute?.('role') !== 'tab') return;
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const ids = SERVICE_TYPES.map((type) => type.id);
    root.querySelector(`[data-picker-type="${ids[(ids.indexOf(view.serviceType) + step + ids.length) % ids.length]}"]`)?.click();
  };
}

/** Forgets what was chosen in a step's picker, so it opens on the step's own tab and category again (a plan loaded afresh). */
export function resetSongPickers() {
  views.clear();
}
