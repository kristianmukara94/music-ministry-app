// What the play button (▷) on a Holy Mass Planner row does to the live state. Pure, so the planner and its tests use the same rules.
//
// A row is one of:
//   - a plain-text response that fills a slot ("I confess to almighty God", "May the Lord accept…"): it is a 'custom' item with a slot. The Service Queue
//     cannot open it in any module, so it is turned into a text slide here and staged directly.
//   - a 'custom' item with no slot: an operator note. It is never staged, because notes are never shown to the congregation.
//   - anything else (a song, a Mass Order part, a reading, a Bible passage…): opened in the module that owns it, as before.

import { splitDeck } from './projector-autofit.js';

/**
 * The slide for a text response: titled with the slot's name, with the words as its body. Text that would not fit one screen, or that has
 * paragraphs (a blank line between them), becomes a deck of slides instead, so it is never cut off and Jump to section steps through it.
 */
export function textResponseFrame(slotName, text) {
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
  const { slides, labels } = splitDeck(
    slotName,
    paragraphs.map((lines) => lines.map((line) => ({ role: 'plain', text: line }))),
  );
  if (slides.length <= 1) return { kind: 'text', title: slotName, text, bg: null };
  return labels ? { kind: 'deck', title: slotName, slides, index: 0, labels } : { kind: 'deck', title: slotName, slides, index: 0 };
}

/**
 * The live-state actions that stage a plain-text slot item, or null when the row is not one (it is then opened in its module).
 * The cursor moves to the row first, so the Mass Queue marks it CURRENT, then the slide goes to the Stage / Preview.
 */
export function textRowActions(row, index, slotName) {
  if (!row || row.stale || row.module !== 'custom' || !row.slot) return null;
  // A row that came from the website keeps its own id in the source id, so its words are in the label.
  const fromWeb = /^web(ref)?:/.test(String(row.sourceId ?? ''));
  const text = String((fromWeb ? row.label : row.sourceId || row.label) || '').trim();
  if (!text) return null;
  return [
    { type: 'queue/cursor', index },
    { type: 'projector/stage', frame: textResponseFrame(slotName || row.label, text) },
  ];
}

/** Whether a row can be staged at all: it has a source, and is not an operator note. */
export function canStageRow(row) {
  if (!row || row.stale) return false;
  return row.module !== 'custom' || Boolean(row.slot);
}

/** The row that is staged now, as the planner marks it: the Service Queue's cursor, when the queue holds this plan. */
export function activeRowIndex({ queuePlanId, queueCursor }, planId) {
  return planId != null && queuePlanId === planId && queueCursor >= 0 ? queueCursor : null;
}

/**
 * The projector frame for one stanza of a hymn, or null when there is no such stanza. The song and the stanza's position let the projector follow
 * an edit to this song while it is live.
 */
export function lyricsStanzaFrame(hymn, index) {
  const stanza = hymn?.stanzas?.[index];
  return stanza
    ? { kind: 'lyrics', title: hymn.title, label: stanza.stanzaType, text: stanza.lyricsText, style: hymn.style, key: `song:${hymn.id}`, song: { hymnId: hymn.id, position: index, count: hymn.stanzas.length } }
    : null;
}

/**
 * The title card a Holy Mass song opens on, before its first stanza: the Praise & Worship title design, so the Intro slide switch (Title Card or
 * Solid Black) works on it too. The title and composer are on the card, with the song's Holy Mass slot above. `massSong` ties the card to its song,
 * so the Holy Mass console can step on into the stanzas. The card shows no counter: the stanzas after it do not carry one either.
 */
export function songTitleFrame(hymn, slotName) {
  return {
    kind: 'pw',
    slide: { kind: 'title', label: hymn.title, subtitle: hymn.composer ?? '' },
    segmentName: slotName || 'Holy Mass',
    type: 'song',
    index: 0,
    total: 1,
    massSong: { hymnId: hymn.id },
  };
}

/**
 * The live-state actions that stage a library song row: its title and first stanza go to the Stage, and the row becomes CURRENT. `hymn` is the song
 * as the library holds it. Null when the song is gone, deleted, or has no stanzas, so the caller can say so instead of doing nothing.
 */
export function songRowActions(row, index, hymn) {
  if (!row || row.stale || row.module !== 'lyrics' || !hymn || hymn.deletedAt) return null;
  const frame = lyricsStanzaFrame(hymn, 0);
  return frame ? [{ type: 'queue/cursor', index }, { type: 'projector/stage', frame }] : null;
}

/**
 * Which frame the operator's mirror draws. It follows the live output, except while the projector is paused or the operator has just staged a
 * row from the planner (`peek`): then it shows the staged frame, so the operator sees what was loaded. The congregation's screen is not a mirror
 * and always shows the live frame.
 */
export function mirrorSource(projector, { mirror = false, peek = false } = {}) {
  return mirror && (projector.paused || peek) ? projector.staged : projector.live;
}

/**
 * What ▷ changes in the operator's own window besides staging: the staged peek, and the floating preview panel that shows it. Nothing here touches
 * `outputs`: the Preview output is an operating-system window (the confidence monitor), and the projector is the congregation's screen. Both open only when
 * the operator turns them on, never from staging a row.
 */
export const SHOW_STAGED_UI = Object.freeze({ stagePeek: true, previewOpen: true });

/**
 * A key for a frame that stays the same while its content does. The state arrives from the main process as new objects on every update, so
 * comparing frames by identity would see a change on each update, including the one caused by staging itself.
 */
export function frameKey(frame) {
  return JSON.stringify(frame ?? null);
}

/** The status badge of the floating preview: a staged slide shows as STAGED even while the projector is off. */
export function previewBadge({ projectorOn, paused, stagePeek }) {
  if (stagePeek) return { id: 'staged', label: 'STAGED' };
  if (!projectorOn) return { id: 'off', label: 'OFF' };
  return paused ? { id: 'paused', label: 'Projector paused' } : { id: 'live', label: 'LIVE' };
}
