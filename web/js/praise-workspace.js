// The Praise & Worship Plan Editor laid out as the church laptop's Praise & Worship planner: a Library on the left (Songs, Prayers, Scripture, with
// INSERT INTO SEGMENT and ADD SELECTED) and the LINEUP on the right, in sections with their minute totals, numbered segment rows with a status,
// their length, Edit and Delete.
//
// Pure markup builders and rules, so the tests run them without a browser; web/js/praise.js wires them to the page. The Library lists song titles,
// categories and keys, prayer titles and Scripture references only: lyrics, prayer words and Bible text stay on the church laptop. Every value
// written into markup goes through esc().
import { PRAYER_CATALOG, filterPrayers } from './prayer-scripture.js';
import { librarySongs, libraryCategories, songMeta, SERVICE_FILTERS } from './mass-workspace.js';
import { MAX_MINUTES, MIN_MINUTES } from './plan-model.js';
import { SEGMENT_TYPES, groupOrder, groupTitle, segmentStatus, segmentSubtitle, typeOfKind } from './praise-lineup.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lower = (value) => String(value ?? '').trim().toLowerCase();
const two = (n) => String(n).padStart(2, '0');

// ---- The Library ----

export const PW_TABS = Object.freeze([
  { id: 'songs', label: 'Songs' },
  { id: 'prayers', label: 'Prayers' },
  { id: 'scripture', label: 'Scripture' },
]);
export const pwTabOf = (value) => (PW_TABS.some((tab) => tab.id === value) ? value : 'songs');

/** What the Prayers tab calls each of the catalog's groups, in this planner's words. */
export const PW_PRAYER_KIND = Object.freeze({ mass: 'Liturgical Prayer', devotional: 'Community Prayer' });

/** The tab bar: an underlined tab for each, the Prayers tab with how many prayers it holds. */
export function pwTabsHtml(active, { prayers = PRAYER_CATALOG.length } = {}) {
  return PW_TABS.map((tab) => {
    const on = tab.id === active;
    const count = tab.id === 'prayers' ? `<span class="pw-tab-count">${prayers}</span>` : '';
    return `<button type="button" role="tab" id="lib-tab-${tab.id}" aria-selected="${on}" aria-controls="lib-panel" tabindex="${on ? 0 : -1}" class="pw-tab${on ? ' is-on' : ''}" data-lib-tab="${tab.id}">${esc(tab.label)}${count}</button>`;
  }).join('');
}

/** The gold pill beside "Library": which segment INSERT INTO SEGMENT and ADD add to. */
export function pwTargetPillHtml(target) {
  if (!target) return '<span class="pw-target is-none">Pick a segment</span>';
  return `<span class="pw-target" title="${esc(`Adds to segment ${two(target.n)} · ${target.name}`)}">Adds to segment ${two(target.n)} · <strong>${esc(target.name)}</strong></span>`;
}

/** INSERT INTO SEGMENT puts the highlighted item in the target segment; ADD SELECTED makes a new segment of it. */
export function pwActionBarHtml({ canEdit = true, hasPick = false, hasTarget = false } = {}) {
  return `<div class="pw-actionbar" role="group" aria-label="Library actions">
        <button type="button" class="btn-quiet pw-act" data-pw-insert${canEdit && hasPick && hasTarget ? '' : ' disabled'}>Insert into segment</button>
        <button type="button" class="btn-primary pw-act" data-pw-add-selected${canEdit && hasPick ? '' : ' disabled'}>Add selected</button>
      </div>`;
}

const SEARCH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

/** The Songs tab's search and category. The service is Praise & Worship; the category choices are the laptop's. */
export function pwSongControlsHtml(view, songs) {
  const options = libraryCategories(songs, view.service).map((c) =>
    `<option value="${esc(c.id)}"${c.id === view.category ? ' selected' : ''}>${esc(c.label)} (${c.count})</option>`).join('');
  const service = SERVICE_FILTERS.map((f) => `<button type="button" class="lp-seg${f.id === view.service ? ' is-on' : ''}" data-lib-service="${f.id}" aria-pressed="${f.id === view.service}">${esc(f.label)}</button>`).join('');
  return `
      <div class="lp-segs" role="group" aria-label="Service">${service}</div>
      <label class="lp-category"><span>Song category</span><select data-lib-category>${options}</select></label>`;
}

/** The search box every tab shares. */
export const pwSearchHtml = (query, tab) => `<label class="lp-search pw-search">${SEARCH_ICON}
        <input type="search" data-lib-search aria-label="Search the ${esc(tab)} library" placeholder="${tab === 'songs' ? 'Search title, category, composer' : 'Search prayers'}" value="${esc(query)}" autocomplete="off">
      </label>`;

function cardHtml({ pick, id, title, meta, picked, held, canEdit, addAttr }) {
  return `<li class="pw-card${picked ? ' is-picked' : ''}${held ? ' is-added' : ''}" data-pw-pick="${esc(pick)}:${esc(id)}" aria-selected="${picked}">
          <span class="pw-card-text"><strong>${esc(title)}</strong><span>${esc(meta)}</span></span>
          <button type="button" class="pw-add" ${addAttr}="${esc(id)}" aria-pressed="${held}" aria-label="${held ? 'Take out' : 'Add'} ${esc(title)}"${canEdit ? '' : ' disabled'}>${held ? 'Added' : 'Add'}</button>
        </li>`;
}

/** The song cards: title, category · language · key, and ADD (ADDED while the song is in the target segment; pressing it then takes it out). */
export function pwSongCardsHtml(list, { picked = '', held = new Set(), canEdit = true, songs = list } = {}) {
  if (songs.length === 0) return '<p class="lp-empty">No songs yet. Songs are added on the church laptop and appear here after it syncs.</p>';
  if (list.length === 0) return '<p class="lp-empty">No songs match. Try another category, or clear the search.</p>';
  return `<ul class="pw-cards">${list.map((song) => cardHtml({ pick: 'song', id: song.id, title: song.title, meta: songMeta(song), picked: picked === `song:${song.id}`, held: held.has(song.id), canEdit, addAttr: 'data-pw-add-song' })).join('')}</ul>`;
}

/** The prayer cards: title, Liturgical Prayer or Community Prayer, and ADD. A prayer is held by its title. */
export function pwPrayerCardsHtml({ query = '', picked = '', held = new Set(), canEdit = true } = {}) {
  const list = filterPrayers(query, 'all');
  if (!list.length) return '<p class="lp-empty">No prayers match. Clear the search to see them all.</p>';
  return `<ul class="pw-cards">${list.map((p) => cardHtml({ pick: 'prayer', id: p.id, title: p.title, meta: PW_PRAYER_KIND[p.group] ?? 'Prayer', picked: picked === `prayer:${p.id}`, held: held.has(lower(p.title)), canEdit, addAttr: 'data-pw-add-prayer' })).join('')}</ul>`;
}

// ---- The LINEUP ----

const ICON = {
  prayer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M6 9h12"/></svg>',
  song: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  scripture: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
};

/** The LINEUP heading: the title, how many segments, and + Add Segment. */
export function lineupHeadHtml({ count = 0, canEdit = true, open = false } = {}) {
  return `<h2 class="pw-lineup-title">Lineup</h2>
      <span class="pw-count" aria-label="${count} segment${count === 1 ? '' : 's'}">${count}</span>
      <button type="button" class="btn-quiet pw-add-segment" data-open-add-segment aria-expanded="${open}"${canEdit ? '' : ' disabled'}>+ Add segment</button>`;
}

/** The form under + Add Segment: a title, what it holds, the section, its minutes, and any laptop segment that was taken out, to put back. */
export function addSegmentFormHtml({ draft = {}, groups = [], removed = [], error = '', canEdit = true } = {}) {
  const lock = canEdit ? '' : ' disabled';
  const types = SEGMENT_TYPES.map((t) => `<option value="${t.id}"${t.id === (draft.type ?? 'prayer') ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
  const sections = groups.map((g) => `<option value="${esc(g)}"${g === (draft.group ?? 'praise') ? ' selected' : ''}>${esc(groupTitle(g))}</option>`).join('');
  const back = removed.length
    ? `<div class="pw-restore"><span class="pw-restore-label">Put back</span>${removed.map((s) => `<button type="button" class="pw-chip" data-restore-segment="${esc(s.id)}"${lock}>${esc(s.name)}</button>`).join('')}</div>`
    : '';
  return `<form class="pw-addform" data-add-segment-form autocomplete="off">
        <label class="lp-field"><span>Segment title</span><input type="text" data-asf="name" maxlength="80" placeholder="Sample Segment Title" value="${esc(draft.name ?? '')}"${lock}></label>
        <div class="pw-addform-row">
          <label class="lp-field"><span>Holds</span><select data-asf="type"${lock}>${types}</select></label>
          <label class="lp-field"><span>Section</span><select data-asf="group"${lock}>${sections}</select></label>
          <label class="lp-field"><span>Minutes</span><input type="number" data-asf="minutes" min="${MIN_MINUTES}" max="${MAX_MINUTES}" inputmode="numeric" value="${esc(draft.minutes ?? 5)}"${lock}></label>
        </div>
        <p class="lp-popover-error" role="alert" data-asf-error>${esc(error)}</p>
        <div class="pw-addform-actions"><button type="submit" class="btn-primary" data-submit-segment${lock}>Add segment</button><button type="button" class="btn-quiet" data-cancel-segment>Cancel</button></div>
        ${back}
      </form>`;
}

/**
 * One segment's panel under its row: its name (a segment added here can be renamed), its minutes, what it holds with Move up / Move down / Remove,
 * a field for plain text, the Content Hub, the musician cue, and Clear segment.
 */
export function pwEditPanelHtml(row, { canEdit = true, entriesHtml = '', hubHtml = '' } = {}) {
  const lock = canEdit ? '' : ' disabled';
  const holds = row.entries.length > 0 || Boolean(row.note);
  return `<div class="pw-panel" data-panel="${esc(row.id)}">
          <div class="pw-panel-row">
            <label class="lp-field pw-panel-name"><span>Segment title</span>
              <input type="text" data-role="panel-name" maxlength="80" value="${esc(row.name)}"${row.custom && canEdit ? '' : ' disabled'}>
            </label>
            <label class="lp-field pw-panel-min"><span>Minutes</span>
              <input type="number" data-role="panel-minutes" min="${MIN_MINUTES}" max="${MAX_MINUTES}" inputmode="numeric" value="${esc(row.minutes)}"${lock}>
            </label>
          </div>
          ${row.custom ? '' : '<p class="lp-lib-hint">The laptop names this segment. Its title is the same on both.</p>'}
          ${entriesHtml}
          <label class="lp-field"><span>Add words or a short note</span>
            <textarea data-role="panel-text" rows="2" maxlength="500" placeholder="e.g. Sung by the youth choir"${lock}></textarea>
          </label>
          <div><button type="button" class="btn-quiet" data-use-text="${esc(row.id)}"${lock}>Add this text</button></div>
          ${hubHtml}
          <label class="lp-field"><span>Musician cue</span>
            <textarea data-role="panel-note" rows="2" maxlength="1000" placeholder="${row.kind === 'song' ? 'e.g. Capo 2, repeat the chorus twice' : 'e.g. Speaker to confirm'}"${lock}>${esc(row.note)}</textarea>
          </label>
          <div class="pw-panel-actions">
            <button type="button" class="btn-primary" data-save-panel="${esc(row.id)}"${lock}>Save changes</button>
            ${holds ? `<button type="button" class="btn-quiet is-danger" data-clear-segment="${esc(row.id)}"${lock}>Clear segment</button>` : ''}
            <button type="button" class="btn-quiet" data-close="${esc(row.id)}">Close</button>
          </div>
        </div>`;
}

/**
 * One numbered segment row. `row` is a praiseRow (with its entries and minutes). Left: grip, ↑ ↓, the number, a type badge, the title and subtitle (the
 * part that selects the segment as the Library's target). Right: the status, the length, Edit and Delete.
 */
export function pwRowHtml(row, { active = false, open = false, canEdit = true, structure = true, first = false, last = false, panelHtml = '' } = {}) {
  const type = typeOfKind(row.kind);
  const status = segmentStatus(row);
  const lock = canEdit ? '' : ' disabled';
  // Moving and deleting change the lineup itself, which a plan from the earlier layout does not allow.
  const lockStructure = canEdit && structure ? '' : ' disabled';
  const move = (delta) => `<button type="button" class="pw-move" data-seg-move="${esc(row.id)}" data-delta="${delta}" aria-label="${esc(`${delta < 0 ? 'Move up' : 'Move down'}: ${row.name}`)}" title="${delta < 0 ? 'Move up' : 'Move down'}"${!canEdit || !structure || (delta < 0 ? first : last) ? ' disabled' : ''}>${delta < 0 ? '↑' : '↓'}</button>`;
  return `
        <div class="pw-row${active ? ' is-active' : ''}${open ? ' is-open' : ''}" data-seg="${esc(row.id)}">
          <div class="pw-row-main">
            <span class="pw-grip" draggable="${canEdit && structure}" data-drag-seg="${esc(row.id)}" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
            <span class="pw-moves">${move(-1)}${move(1)}</span>
            <button type="button" class="pw-row-select" data-select-seg="${esc(row.id)}" aria-pressed="${active}" title="${active ? 'The Library adds to this segment' : 'Make this the segment the Library adds to'}">
              <span class="pw-num">${two(row.n)}</span>
              <span class="pw-icon is-${type}">${ICON[type]}</span>
              <span class="pw-row-text"><strong>${esc(row.name)}</strong><span class="pw-row-sub">${esc(segmentSubtitle(row))}</span></span>
            </button>
            <span class="pw-status is-${status.tone}">${esc(status.label)}</span>
            <span class="pw-min" data-minutes="${esc(row.id)}">${row.minutes} min</span>
            <button type="button" class="pw-icon-btn" data-edit-seg="${esc(row.id)}" aria-expanded="${open}" aria-label="${esc(`Edit ${row.name}`)}" title="Edit"${lock}>${ICON.edit}</button>
            <button type="button" class="pw-icon-btn is-danger" data-delete-seg="${esc(row.id)}" aria-label="${esc(`Delete ${row.name}`)}" title="Delete"${lockStructure}>${ICON.trash}</button>
          </div>${open ? panelHtml : ''}
        </div>`;
}

/** One section card: its heading with the minutes, then its rows (or a line saying it is empty). */
export function pwSectionHtml(section, rowsHtml) {
  return `
      <section class="pw-section" data-section="${esc(section.group)}" aria-label="${esc(section.title)}">
        <header class="pw-section-head"><h3 class="pw-section-title">${esc(section.title)}</h3><span class="pw-section-min" data-section-minutes="${esc(section.group)}">${section.minutes} min</span></header>
        ${rowsHtml || '<p class="pw-section-empty">No segments here yet.</p>'}
      </section>`;
}

/** The sections in order, each with its rows drawn by `rowHtml(row, first, last)` (first and last of the whole lineup, for the arrows). */
export function pwLineupHtml(sections, rowHtml) {
  const all = sections.flatMap((s) => s.rows);
  return sections.map((section) => pwSectionHtml(section, section.rows.map((row) => rowHtml(row, all[0]?.id === row.id, all[all.length - 1]?.id === row.id)).join(''))).join('');
}

export { librarySongs, groupOrder };
