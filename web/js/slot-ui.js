// The parts both planners share on the page: the list of what a step holds, with its key selectors, and the Content Hub dialog. Every value
// written into markup goes through esc().
import { esc } from './shell.js';
import { keyChoices } from './song-keys.js';
import {
  HUB_CATEGORIES,
  HUB_TEMPLATES,
  HUB_TYPES,
  MAX_HUB_ITEMS,
  MAX_HUB_SPEAKER,
  MAX_HUB_TEXT,
  MAX_HUB_TITLE,
  checkHubDraft,
  hubTypeLabel,
  templateText,
  visibleHubItems,
  withHubItem,
} from './content-hub.js';

const SOURCE_LABEL = { list: 'Song', hub: 'Content Hub', text: 'Typed note' };

/** A filled step's short view: each title with its key badge or source tag. A row that already says where its one item came from passes `tags: false`. */
export function entrySummaryHtml(entries, { tags = true } = {}) {
  return entries.map((entry) => {
    const badge = entry.songId
      ? entry.key ? `<span class="key-badge${entry.keyTransposed ? ' is-transposed' : ''}">Key: ${esc(entry.key)}</span>` : ''
      : tags ? `<span class="content-tag">${esc(SOURCE_LABEL[entry.source])}</span>` : '';
    return `<span class="entry-line"><span class="entry-title">${esc(entry.title)}</span>${badge}</span>`;
  }).join('');
}

/** What a step holds, in the drawer or panel: each item with its key for this plan (songs only) and Remove. */
export function entryListHtml(entries, rowId, canEdit) {
  if (entries.length === 0) return '<p class="entry-empty">Nothing here yet. Add a song, type text, or choose from the Hub. A step can hold more than one.</p>';
  const lock = canEdit ? '' : 'disabled';
  const rows = entries.map((entry) => {
    const key = entry.songId
      ? `<label class="entry-key">Key
          <select data-role="entry-key" data-for="${esc(rowId)}" data-index="${entry.index}" aria-label="Key for ${esc(entry.title)}" ${lock}>
            ${keyChoices(entry.originalKey, entry.keyTransposed).map((c) => `<option value="${esc(c.value)}" ${c.value === entry.keyTransposed ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
        </label>`
      : `<span class="content-tag">${esc(SOURCE_LABEL[entry.source])}</span>`;
    return `<li class="slot-entry">
        <span class="entry-title">${esc(entry.title)}</span>
        ${key}
        <button type="button" class="btn-link-danger" data-remove-entry="${entry.index}" data-for="${esc(rowId)}" aria-label="Remove ${esc(entry.title)}" ${lock}>Remove</button>
      </li>`;
  }).join('');
  return `<ul class="entry-list" aria-label="In this step">${rows}</ul>`;
}

/** The two ways into the Hub, from any step. */
export function hubButtonsHtml(canEdit) {
  const lock = canEdit ? '' : 'disabled';
  return `<div class="hub-buttons">
      <button type="button" data-hub="choose" class="btn-quiet" ${lock}>Choose from Hub</button>
      <button type="button" data-hub="new" class="btn-quiet" ${lock}>New Hub entry</button>
    </div>`;
}

const EMPTY_DRAFT = () => ({ id: '', type: 'prayer', title: '', category: HUB_CATEGORIES.prayer[0], text: '', speakerNote: '' });

let dialog = null;
let ctx = null;
let view = null;

const render = () => {
  dialog.innerHTML = `
    <div class="dialog-body hub-body">
      <div class="hub-head">
        <div><h2 id="hub-title">Liturgical Content Hub</h2><p class="muted">${esc(ctx.slotName ? `For ${ctx.slotName}. ` : '')}Entries are saved with this plan when you save it.</p></div>
        <button type="button" class="hub-close" data-hub-action="close" aria-label="Close the Content Hub">×</button>
      </div>
      <div class="hub-tabs" role="tablist" aria-label="Content Hub">
        <button type="button" role="tab" aria-selected="${view.tab === 'choose'}" class="${view.tab === 'choose' ? 'is-on' : ''}" data-hub-tab="choose">Choose from Hub</button>
        <button type="button" role="tab" aria-selected="${view.tab === 'new'}" class="${view.tab === 'new' ? 'is-on' : ''}" data-hub-tab="new">${view.draft.id ? 'Edit entry' : 'New entry'}</button>
      </div>
      ${view.tab === 'choose' ? chooseHtml() : formHtml()}
    </div>`;
};

function chooseHtml() {
  const typeOptions = [`<option value="">All types</option>`, ...HUB_TYPES.map((t) => `<option value="${t.value}" ${view.type === t.value ? 'selected' : ''}>${esc(t.label)}</option>`)].join('');
  return `
    <div class="hub-filters">
      <input data-hub-field="query" type="search" aria-label="Search the Hub" placeholder="Search the Hub" value="${esc(view.query)}">
      <select data-hub-field="filter" aria-label="Filter by type">${typeOptions}</select>
    </div>
    <div data-hub-list>${listHtml()}</div>`;
}

function listHtml() {
  const shown = visibleHubItems(ctx.items, { type: view.type, query: view.query });
  const planRows = shown.length
    ? shown.map((item) => `
        <li class="hub-row">
          <span class="hub-row-text">
            <strong>${esc(item.title)}</strong>
            <span class="muted">${esc([hubTypeLabel(item.type), item.category, item.speakerNote].filter(Boolean).join(' · '))}</span>
          </span>
          <span class="hub-row-actions">
            <button type="button" class="btn-primary" data-hub-use="${esc(item.id)}">Use</button>
            <button type="button" class="btn-quiet" data-hub-edit="${esc(item.id)}">Edit</button>
            ${ctx.usedIds().has(item.id) ? '' : `<button type="button" class="btn-link-danger" data-hub-delete="${esc(item.id)}" aria-label="Delete ${esc(item.title)}">Delete</button>`}
          </span>
        </li>`).join('')
    : `<li class="entry-empty">${ctx.items.length ? 'No entries match the search.' : 'This plan has no entries yet. Start from a standard text, or write a new one.'}</li>`;
  const q = view.query.trim().toLowerCase();
  const templates = HUB_TEMPLATES.filter((t) => (!view.type || t.type === view.type) && (!q || t.title.toLowerCase().includes(q)));
  const templateRows = templates.map((t) => `
      <li class="hub-row">
        <span class="hub-row-text"><strong>${esc(t.title)}</strong><span class="muted">${esc(t.category)}${t.text[ctx.language] ? '' : ` · Shown in English: no ${esc(ctx.languageName)} text in the planner yet`}</span></span>
        <span class="hub-row-actions"><button type="button" class="btn-quiet" data-hub-template="${esc(t.id)}">Review and add</button></span>
      </li>`).join('');
  return `
    <span class="eyebrow">IN THIS PLAN</span>
    <ul class="hub-list">${planRows}</ul>
    ${templateRows ? `<span class="eyebrow">STANDARD TEXTS</span><ul class="hub-list">${templateRows}</ul><p class="muted">Check each standard text against the approved Roman Missal before use.</p>` : ''}`;
}

function formHtml() {
  const d = view.draft;
  const categories = HUB_CATEGORIES[d.type] ?? [];
  const options = [...new Set([...categories, ...(d.category ? [d.category] : [])])];
  return `
    <div class="hub-form">
      ${view.notice ? `<p class="hub-notice">${esc(view.notice)}</p>` : ''}
      <div class="hub-form-row">
        <label class="field">Type
          <select data-hub-field="type">${HUB_TYPES.map((t) => `<option value="${t.value}" ${t.value === d.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
        </label>
        <label class="field">Category
          <select data-hub-field="category">${options.map((c) => `<option value="${esc(c)}" ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
      </div>
      <label class="field">Title
        <input data-hub-field="title" maxlength="${MAX_HUB_TITLE}" value="${esc(d.title)}" placeholder="e.g. Prayer for the parish fiesta">
      </label>
      <label class="field">Content / text body
        <textarea data-hub-field="text" rows="9" maxlength="${MAX_HUB_TEXT}" placeholder="The words, written as they are read aloud.">${esc(d.text)}</textarea>
      </label>
      <label class="field">Speaker / lead note
        <input data-hub-field="speakerNote" maxlength="${MAX_HUB_SPEAKER}" value="${esc(d.speakerNote)}" placeholder="e.g. Read by the commentator">
      </label>
      <p class="form-error" data-hub-error role="alert">${esc(view.error)}</p>
      <div class="dialog-actions">
        <button type="button" class="btn-quiet" data-hub-action="back">Cancel</button>
        <button type="button" class="btn-quiet" data-hub-action="save">Save to Hub</button>
        <button type="button" class="btn-primary" data-hub-action="save-use">Save and use here</button>
      </div>
    </div>`;
}

const showForm = (draft, notice = '') => {
  view.draft = draft;
  view.notice = notice;
  view.error = '';
  view.tab = 'new';
  render();
};

function saveDraft(useAfter) {
  const { entry, error } = checkHubDraft(view.draft);
  if (error) {
    view.error = error;
    dialog.querySelector('[data-hub-error]').textContent = error;
    return;
  }
  if (!entry.id && ctx.items.length >= MAX_HUB_ITEMS) {
    view.error = `A plan can have up to ${MAX_HUB_ITEMS} Content Hub entries.`;
    dialog.querySelector('[data-hub-error]').textContent = view.error;
    return;
  }
  const saved = entry.id ? entry : { ...entry, id: crypto.randomUUID() };
  ctx.items = withHubItem(ctx.items, saved);
  ctx.onChange(ctx.items);
  if (useAfter) {
    ctx.onUse(saved);
    dialog.close();
    return;
  }
  view.draft = EMPTY_DRAFT();
  view.notice = '';
  view.error = '';
  view.tab = 'choose';
  render();
}

function onClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  const { hubTab, hubUse, hubEdit, hubDelete, hubTemplate, hubAction } = button.dataset;
  if (hubTab) {
    view.tab = hubTab;
    render();
  } else if (hubUse) {
    ctx.onUse(ctx.items.find((item) => item.id === hubUse));
    dialog.close();
  } else if (hubEdit) {
    showForm({ ...ctx.items.find((item) => item.id === hubEdit) });
  } else if (hubDelete) {
    ctx.items = ctx.items.filter((item) => item.id !== hubDelete);
    ctx.onChange(ctx.items);
    render();
  } else if (hubTemplate) {
    const template = HUB_TEMPLATES.find((t) => t.id === hubTemplate);
    const { text, fellBack } = templateText(template, ctx.language);
    showForm(
      { id: '', type: template.type, category: template.category, title: template.title, text, speakerNote: template.speakerNote },
      fellBack ? `The planner has no ${ctx.languageName} text for this yet, so the English is shown. Replace it with the approved ${ctx.languageName} text.` : 'Check this text against the approved Roman Missal, then save it.',
    );
  } else if (hubAction === 'close') {
    dialog.close();
  } else if (hubAction === 'back') {
    view.draft = EMPTY_DRAFT();
    view.notice = '';
    view.error = '';
    view.tab = 'choose';
    render();
  } else if (hubAction === 'save' || hubAction === 'save-use') {
    saveDraft(hubAction === 'save-use');
  }
}

function onInput(event) {
  const field = event.target.dataset?.hubField;
  if (!field) return;
  if (field === 'query') {
    view.query = event.target.value;
    dialog.querySelector('[data-hub-list]').innerHTML = listHtml();
  } else if (field === 'filter') {
    view.type = event.target.value;
    dialog.querySelector('[data-hub-list]').innerHTML = listHtml();
  } else if (field === 'type') {
    view.draft.type = event.target.value;
    view.draft.category = (HUB_CATEGORIES[view.draft.type] ?? [''])[0];
    render();
    dialog.querySelector('[data-hub-field="type"]')?.focus();
  } else {
    view.draft[field] = event.target.value;
  }
}

/**
 * Opens the Content Hub. `items` are the plan's entries. `onChange(items)` is called when entries are added, edited or deleted, and `onUse(entry)` when one is
 * put in the step. `usedIds()` says which entries a step uses, so those cannot be deleted from under it. `language` is the plan's (EN, TL or CEB).
 */
export function openContentHub({ items, slotName, language = 'EN', languageName = 'English', mode = 'choose', usedIds, onChange, onUse }) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'modal hub-modal';
    dialog.setAttribute('aria-labelledby', 'hub-title');
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('input', onInput);
    document.body.append(dialog);
  }
  ctx = { items, slotName, language, languageName, usedIds, onChange, onUse };
  view = { tab: mode === 'new' ? 'new' : 'choose', query: '', type: '', draft: EMPTY_DRAFT(), notice: '', error: '' };
  render();
  dialog.showModal();
}
