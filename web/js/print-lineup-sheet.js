// Print Lineup on the web: the church laptop's printed lineup (shared/print-lineup-html.js) for a Holy Mass plan or a Praise & Worship plan,
// as ONE paper sheet shared by every place that prints: the Holy Mass editor, the Praise & Worship editor and the Planner's calendar cards.
//
// A plan becomes a plain `lineup` (printLineupFromPlan), and the lineup becomes markup (sheetHtml). The sheet holds titles only: song titles with
// their keys, prayer titles, Scripture citations, reading names, durations and the planner's cues. Lyrics, prayer words and Bible text are
// never on the website, so they cannot reach the page. Every value written into markup goes through esc(). printSheet() fills the page's
// print-only #setlist-print section and opens the browser's Print dialog (or Save as PDF); planner.css hides everything else while it prints.
import {
  READING_NAMES,
  describeEntries,
  massFromItems,
  massRows,
  massSections,
  praiseBreakdown,
  praiseFromItems,
  praiseSegmentsFor,
  praiseTemplateFor,
  shortDate,
} from './plan-model.js';
import { rowFilled } from './mass-workspace.js';
import { MASS_PLAN, PRAISE_PLAN } from './sample-data.js';
import { languageName, sectionName, slotName } from './mass-language.js';
import { scheduleText } from './schedule-ui.js';
import { dayReadingsFor } from './day-readings.js';
import { liturgicalDay } from './planner-calendar.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
const two = (n) => String(n).padStart(2, '0');

export const BADGES = Object.freeze({
  mass: 'HOLY MASS LITURGICAL PLAN',
  pw: 'PRAISE & WORSHIP LINEUP',
});
/** The pill on each item: what kind of thing it is. */
export const TYPE_PILLS = Object.freeze({ song: 'SONG', prayer: 'PRAYER', scripture: 'SCRIPTURE', reading: 'READING', note: 'NOTE' });

/** "ordinary-time" as "Ordinary Time". */
export const seasonLabel = (season) => String(season ?? '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/**
 * What kind of item an entry (from describeEntries) is. A song is a song; the day's named readings are READING and carry their Ordo reference;
 * a Prayers-catalog title or a Scripture reference is PRAYER or SCRIPTURE; anything else the planner typed or the Content Hub holds is a NOTE.
 */
export function itemType(entry) {
  if (entry.songId) return 'song';
  if (entry.contentType === 'scripture' && READING_NAMES.includes(entry.title)) return 'reading';
  if (entry.badge === 'prayer') return 'prayer';
  if (entry.badge === 'scripture') return 'scripture';
  return 'note';
}

/** An entry as it prints: its kind, its title, a song's key and a reading's reference (from the day's Ordo, by name). */
export function printItem(entry, citations = {}) {
  const type = itemType(entry);
  return { type, title: String(entry.title ?? ''), key: type === 'song' ? String(entry.key ?? '') : '', citation: type === 'reading' ? String(citations[entry.title] ?? '') : '' };
}

const citationsOf = (date) => Object.fromEntries(dayReadingsFor(date).readings.map((r) => [r.type, r.citation]));

/**
 * A plan as a lineup. `plan` is as plan-get returns it (its items are the ones to print: an editor passes the items it would save, so the
 * paper matches the screen, unsaved changes included). `songs` are the plan's songs. `church` is the parish's name for the letterhead.
 *
 *   { type: 'mass' | 'pw', church, title, date, dateText, dayName, season, schedule, totals: { items, minutes }, sections }
 *   section: { heading, minutes, entries };  entry: { number, name, items: [{ type, title, key, citation }], minutes, cue }
 */
export function printLineupFromPlan(plan, songs = [], { church = '' } = {}) {
  const isPw = plan.kind === 'pw';
  const day = liturgicalDay(plan.date);
  const head = {
    type: isPw ? 'pw' : 'mass',
    church: String(church ?? '').trim(),
    title: String(plan.name ?? ''),
    date: plan.date,
    dateText: shortDate(plan.date),
    dayName: isPw ? '' : day.name,
    season: isPw ? '' : seasonLabel(day.season),
    schedule: '',
  };
  return isPw ? { ...head, ...praiseBody(plan, songs) } : { ...head, schedule: massSchedule(plan), ...massBody(plan, songs) };
}

/** "6:00 AM · English · EN": the time, the schedule language and the language its texts are in. Whatever is set. */
function massSchedule(plan) {
  const code = ['EN', 'TL', 'CEB'].includes(plan.language) ? plan.language : '';
  const named = scheduleText(plan);
  const language = !named.includes(languageName(code || 'EN')) && !plan.massLanguage && code ? languageName(code) : '';
  return [named, language, code].filter(Boolean).join(' · ');
}

function massBody(plan, songs) {
  const rows = massRows(MASS_PLAN);
  const { segments, notes } = massFromItems(plan.items ?? [], rows);
  const citations = citationsOf(plan.date);
  const language = plan.language ?? 'EN';
  const sections = massSections(MASS_PLAN)
    .map((section) => {
      const entries = section.rows
        .filter((row) => rowFilled(row, segments, notes))
        .map((row) => ({
          number: row.slot ? two(row.n) : '',
          name: slotName(row, language),
          items: describeEntries(segments[row.id], songs, plan.contentHubItems ?? []).map((e) => printItem(e, citations)),
          minutes: null,
          cue: String(notes[row.id] ?? '').trim(),
        }));
      return { heading: `${section.number}. ${sectionName(section, language)}`, minutes: null, entries };
    })
    .filter((section) => section.entries.length > 0);
  return { sections, totals: { items: sections.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.items.length, 0), 0), minutes: null } };
}

function praiseBody(plan, songs) {
  const segs = praiseSegmentsFor(plan.items ?? [], PRAISE_PLAN);
  const template = praiseTemplateFor(plan.items ?? [], PRAISE_PLAN);
  const state = { ...praiseFromItems(plan.items ?? [], segs), contentHubItems: plan.contentHubItems ?? [] };
  const breakdown = praiseBreakdown(template, segs, state, songs);
  let number = 0;
  const sections = breakdown.sections
    .map((section) => ({
      heading: section.title,
      minutes: section.minutes || null,
      entries: section.rows
        .map((row) => {
          number += 1;
          return { number: two(number), name: row.name, items: row.entries.map((e) => printItem(e)), minutes: row.minutes || null, cue: row.note.trim() };
        }),
    }))
    .filter((section) => section.entries.length > 0);
  return { sections, totals: { items: sections.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.items.length, 0), 0), minutes: breakdown.total } };
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

function itemHtml(item) {
  const key = item.key ? `<span class="pl-key">Key ${esc(item.key)}</span>` : '';
  const cite = item.citation ? `<span class="pl-cite">${esc(item.citation)}</span>` : '';
  return `<li class="pl-item" data-type="${esc(item.type)}"><span class="pl-pill is-${esc(item.type)}">${esc(TYPE_PILLS[item.type] ?? TYPE_PILLS.note)}</span><span class="pl-item-title">${esc(item.title)}</span>${cite}${key}</li>`;
}

function rowHtml(entry) {
  const items = entry.items.length
    ? `<ul class="pl-items">${entry.items.map(itemHtml).join('')}</ul>`
    : '<span class="pl-empty-line" aria-hidden="true"></span>';
  // A slot named like its one item (a reading's own name) is not printed twice.
  const name = entry.items.length === 1 && same(entry.name, entry.items[0].title) ? '' : entry.name;
  const cue = entry.cue ? `<p class="pl-cue"><span>Cue</span>${esc(entry.cue)}</p>` : '';
  const minutes = entry.minutes ? `<span class="pl-min">${esc(entry.minutes)} min</span>` : '';
  return `<li class="pl-row"><span class="pl-num">${esc(entry.number)}</span><div class="pl-body">${name ? `<span class="pl-name">${esc(name)}</span>` : ''}${items}${cue}</div>${minutes}</li>`;
}

/** The lineup as the printed sheet's markup: letterhead, plan facts, then each part or section with its numbered rows. */
export function sheetHtml(lineup) {
  const facts = [lineup.dateText, lineup.dayName, lineup.season, lineup.schedule].filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join('<span class="pl-sep" aria-hidden="true">·</span>');
  const totals = [
    `${lineup.totals.items} ${lineup.totals.items === 1 ? 'item' : 'items'}`,
    lineup.totals.minutes ? `${lineup.totals.minutes} min total` : '',
  ].filter(Boolean).join(' · ');
  // The sections sit in a two-column grid under the full-width letterhead, as on the laptop's printed lineup.
  const body = lineup.sections.length
    ? `<div class="pl-columns">${lineup.sections
        .map((section) => `
    <section class="pl-section">
      <div class="pl-section-head"><h2>${esc(section.heading)}</h2>${section.minutes ? `<span class="pl-section-min">${esc(section.minutes)} MIN</span>` : ''}</div>
      <ol class="pl-rows">${section.entries.map(rowHtml).join('')}</ol>
    </section>`)
        .join('')}
    </div>`
    : '<p class="pl-empty">Nothing is planned yet.</p>';
  return `
  <article class="pl-sheet" data-type="${esc(lineup.type)}">
    <header class="pl-head">
      <div class="pl-top"><span class="pl-parish">${esc(lineup.church)}</span><span class="pl-badge">${esc(BADGES[lineup.type] ?? BADGES.mass)}</span></div>
      <h1 class="pl-title">${esc(lineup.title)}</h1>
      <p class="pl-facts">${facts}</p>
      <p class="pl-totals">${esc(totals)}</p>
    </header>${body}
  </article>`;
}

/** The sheet's file name, which the browser offers for Save as PDF. */
export const sheetFileName = (lineup) => `Lineup - ${lineup.title}`.trim();

/**
 * Prints the lineup: fills `host` (the page's #setlist-print), marks the page as printing, and opens the Print dialog. The page's own title is
 * put back, and the sheet taken away, when printing ends. `win` is the window to print (the tests give a stand-in).
 */
export function printSheet(lineup, { host = document.getElementById('setlist-print'), doc = document, win = window } = {}) {
  if (!host) return false;
  host.innerHTML = sheetHtml(lineup);
  doc.body.classList.add('is-printing-setlist');
  const title = doc.title;
  doc.title = sheetFileName(lineup);
  win.addEventListener('afterprint', () => {
    doc.body.classList.remove('is-printing-setlist');
    doc.title = title;
  }, { once: true });
  win.print();
  return true;
}
