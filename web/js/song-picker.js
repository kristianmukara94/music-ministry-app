// The song picker both planners share: a dialog that lists the church's songs the way the church laptop files them. Two tabs, Holy Mass
// and Praise & Worship, keep the two kinds of song apart (a General song is sung in both, so it is under each). Under a tab, the category
// buttons narrow the list to one part of the Mass or one kind of praise song. Opened from a step, it starts on the plan's own tab and the
// step's own category. The rules are in lineup-templates.js, which the laptop and the server share. Every value written into markup goes
// through esc().
import { esc } from './shell.js';
import { LANGUAGE_CODE } from './sample-data.js';
import { ALL_CATEGORIES, SERVICE_TYPES, filterPickerSongs, pickerCategoryLabel, pickerPillsFor, serviceTypeOf } from './lineup-templates.js';

const NO_SONGS = 'No songs yet. Songs are added from the church laptop.';

let dialog = null;
let ctx = null;
let view = null;

const otherType = () => SERVICE_TYPES.find((type) => type.id !== view.serviceType);
const shownSongs = () => filterPickerSongs(ctx.songs, view);

/** A category the tab has no button for (another tab's, or one no song uses any more) falls back to All, so the list is never stuck empty. */
function settleCategory() {
  const pills = pickerPillsFor(ctx.songs, view.serviceType);
  if (!pills.some((pill) => pill.id === view.category)) view.category = ALL_CATEGORIES;
}

function tabsHtml() {
  return SERVICE_TYPES.map((type) => {
    const on = type.id === view.serviceType;
    return `<button type="button" role="tab" id="picker-tab-${type.id}" aria-selected="${on}" aria-controls="picker-list" tabindex="${on ? 0 : -1}" class="${on ? 'is-on' : ''}" data-picker-type="${type.id}">${esc(type.label)}</button>`;
  }).join('');
}

function pillsHtml() {
  return pickerPillsFor(ctx.songs, view.serviceType, { query: view.query }).map((pill) => {
    const on = pill.id === view.category;
    return `<button type="button" class="picker-pill${on ? ' is-on' : ''}" aria-pressed="${on}" data-picker-category="${esc(pill.id)}">${esc(pill.label)}<span class="picker-pill-count">${pill.count}</span></button>`;
  }).join('');
}

/** What the list says when it has nothing to show, with the way out: the whole tab, or the other tab when the search has songs there. */
function emptyHtml() {
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
    if (inTab > 0) actions.push(`<button type="button" class="btn-quiet" data-picker-category="${ALL_CATEGORIES}">Show ${esc(type.allLabel)} (${inTab})</button>`);
  }
  const other = otherType();
  const inOther = filterPickerSongs(ctx.songs, { serviceType: other.id, query }).length;
  if (inOther > 0) actions.push(`<button type="button" class="btn-quiet" data-picker-type="${other.id}">Look under ${esc(other.label)} (${inOther})</button>`);
  if (query) actions.push('<button type="button" class="btn-quiet" data-picker-action="clear-search">Clear the search</button>');
  return `<div class="picker-empty"><p>${esc(message)}</p>${actions.length ? `<div class="picker-empty-actions">${actions.join('')}</div>` : ''}</div>`;
}

function listHtml() {
  const shown = shownSongs();
  if (shown.length === 0) return emptyHtml();
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

function statusText() {
  const shown = shownSongs().length;
  const chosen = ctx.chosenIds().size;
  return `${shown} song${shown === 1 ? '' : 's'} shown${chosen ? ` · ${chosen} in this step` : ''}`;
}

function render() {
  dialog.innerHTML = `
    <div class="dialog-body picker-body">
      <div class="hub-head">
        <div><h2 id="picker-title">Choose a song</h2><p class="muted">${esc(ctx.slotName ? `For ${ctx.slotName}. ` : '')}A step can hold more than one song.</p></div>
        <button type="button" class="hub-close" data-picker-action="close" aria-label="Close the song list">×</button>
      </div>
      <div class="picker-tabs" role="tablist" aria-label="Service type">${tabsHtml()}</div>
      <input class="picker-search" data-picker-search type="search" aria-label="Search songs by title" placeholder="Search songs by title" value="${esc(view.query)}">
      <div class="picker-pills" role="group" aria-label="Song category" data-picker-pills>${pillsHtml()}</div>
      <div class="picker-list" id="picker-list" role="tabpanel" aria-labelledby="picker-tab-${view.serviceType}" data-picker-list>${listHtml()}</div>
      <div class="picker-foot">
        <span class="muted" data-picker-status aria-live="polite">${esc(statusText())}</span>
        <button type="button" class="btn-primary" data-picker-action="close">Done</button>
      </div>
    </div>`;
}

/** On a phone the category buttons are one row that scrolls sideways, so the chosen one is brought into view. */
const showChosenPill = () => dialog.querySelector('.picker-pill.is-on')?.scrollIntoView({ block: 'nearest', inline: 'center' });

/** Redraws the category buttons and the list, and leaves the search box alone so typing is never interrupted. */
function refresh() {
  dialog.querySelector('[data-picker-pills]').innerHTML = pillsHtml();
  dialog.querySelector('[data-picker-list]').innerHTML = listHtml();
  dialog.querySelector('[data-picker-status]').textContent = statusText();
  showChosenPill();
}

function showType(id, { focus = false } = {}) {
  if (!serviceTypeOf(id)) return;
  view.serviceType = id;
  settleCategory();
  render();
  showChosenPill();
  if (focus) dialog.querySelector(`[data-picker-type="${id}"]`)?.focus();
}

function onClick(event) {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const { pickerType, pickerCategory, pickerSong, pickerAction } = button.dataset;
  if (pickerType) {
    showType(pickerType, { focus: button.getAttribute('role') === 'tab' });
  } else if (pickerCategory !== undefined) {
    view.category = pickerCategory;
    refresh();
    dialog.querySelector('.picker-pill.is-on')?.focus();
  } else if (pickerSong) {
    ctx.onToggle(pickerSong);
    refresh();
    // The button was redrawn, so the keyboard goes back to the same song.
    [...dialog.querySelectorAll('[data-picker-song]')].find((b) => b.dataset.pickerSong === pickerSong)?.focus();
  } else if (pickerAction === 'clear-search') {
    view.query = '';
    render();
    dialog.querySelector('[data-picker-search]')?.focus();
  } else if (pickerAction === 'close') {
    dialog.close();
  }
}

function onInput(event) {
  if (event.target.dataset?.pickerSearch === undefined) return;
  view.query = event.target.value;
  refresh();
}

/** Arrow keys move between the two tabs, as in any tab list. */
function onKeydown(event) {
  if (event.target.getAttribute?.('role') !== 'tab') return;
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const ids = SERVICE_TYPES.map((type) => type.id);
  showType(ids[(ids.indexOf(view.serviceType) + step + ids.length) % ids.length], { focus: true });
}

/**
 * Opens the song picker for a step. `songs` is the church's list (removed songs left out). `serviceType` ('mass' or 'praise_worship') is
 * the tab it opens on, the plan's own; `category` is the category it opens on, the step's own ('all', or none, for every song).
 * `chosenIds()` returns the ids of the songs the step holds now, and `onToggle(songId)` adds a song to the step or takes it out again.
 */
export function openSongPicker({ songs, serviceType, category = ALL_CATEGORIES, slotName = '', canEdit = true, chosenIds, onToggle }) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'modal picker-modal';
    dialog.setAttribute('aria-labelledby', 'picker-title');
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('input', onInput);
    dialog.addEventListener('keydown', onKeydown);
    document.body.append(dialog);
  }
  ctx = { songs, slotName, canEdit, chosenIds, onToggle };
  view = { serviceType: serviceTypeOf(serviceType) ? serviceType : SERVICE_TYPES[0].id, category: category || ALL_CATEGORIES, query: '' };
  render();
  dialog.showModal();
  showChosenPill();
  // On a phone the keyboard would cover the list, so the search box is only focused where there is a real keyboard.
  if (window.matchMedia('(min-width: 561px)').matches) dialog.querySelector('[data-picker-search]')?.focus();
}
