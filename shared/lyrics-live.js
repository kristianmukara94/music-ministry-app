// Song Lyrics Go Live: the projector side of the Song Lyrics setlist. Plain JS with no React, so the operator console, the preview and the
// tests share one reading of "which song and stanza is on air". The live state itself is the broadcaster: the main process reduces each
// action and sends the result to every window, so the Song Lyrics view, the preview panel and the projector all read the same frame.
import { lyricsStanzaFrame } from './stage-plan-row.js';

/**
 * The projector frame for one stanza of a setlist song. It is the plain stanza frame, plus `setlist`: which setlist the song was sent
 * from, and where in it the song sits. The setlist is a sibling of `song`, so a live edit of the song (which rebuilds `song`) keeps it.
 * Null when there is no such stanza.
 */
export function setlistStanzaFrame(hymn, stanzaIndex, setlist) {
  const frame = lyricsStanzaFrame(hymn, stanzaIndex);
  if (!frame) return null;
  if (!setlist || setlist.id == null || !(setlist.index >= 0) || !(setlist.count > 0)) return frame;
  return { ...frame, setlist: { id: setlist.id, index: setlist.index, count: setlist.count } };
}

/**
 * The live-state actions that put a song's stanza straight on the projector: stage it, then take it, as a direct projection. Null when
 * the stanza does not exist, so the caller sends nothing and the screen keeps what it has. A paused projector holds the take, as for
 * any other module.
 */
export function presentSongStanzaActions({ hymn, stanzaIndex, setlist }) {
  const frame = setlistStanzaFrame(hymn, stanzaIndex, setlist);
  return frame ? [{ type: 'projector/stage', frame }, { type: 'projector/take', source: 'DIRECT_DECK' }] : null;
}

/** The first stanza with words in it, or 0 when none has. A song whose first stanza is blank opens on the next one. */
export function firstSungStanza(stanzas) {
  const i = (stanzas ?? []).findIndex((s) => String(s?.lyricsText ?? '').trim() !== '');
  return i < 0 ? 0 : i;
}

/**
 * The song stanza the projector is showing, read from the live frame. While the projector is blacked out it reads the frame held behind
 * the blackout, with `blackout: true`, so the operator still sees their place. Null when no song stanza is on air.
 * `setlistId` and `songIndex` are null when the stanza was not sent from a setlist (the Mass Queue, Quick Live).
 */
export function lyricsOnAir(projector) {
  if (!projector) return null;
  const blackout = projector.live?.kind === 'blackout';
  const frame = blackout ? projector.beforeBlackout : projector.live;
  if (!frame || frame.kind !== 'lyrics' || !frame.song) return null;
  return {
    hymnId: frame.song.hymnId,
    stanzaIndex: frame.song.position,
    stanzaCount: frame.song.count,
    setlistId: frame.setlist?.id ?? null,
    songIndex: frame.setlist?.index ?? null,
    songCount: frame.setlist?.count ?? null,
    blackout,
  };
}

/**
 * Whether the projector shows a stanza sent from this setlist (also behind a blackout). This is what turns the Song Lyrics ON AIR badge
 * red: the module is the one running the projector.
 */
export function setlistOnAir(projector, setlistId) {
  const on = lyricsOnAir(projector);
  return Boolean(on && setlistId != null && on.setlistId === setlistId);
}

/**
 * The live-state actions for turning Song Lyrics Go Live off: the song stanza Song Lyrics put on the projector comes off (also from
 * behind a blackout, so lifting it does not bring the song back). A song stanza on the Mass Queue's or Praise & Worship's account
 * belongs to that run and stays, as does anything that is not a song stanza. Only the screen is cleared: the setlist row and the cue
 * are the view's own, so Go Live picks up where it left off.
 */
export function goLiveOffActions(projector) {
  if (!lyricsOnAir(projector)) return [];
  const source = projector.source ?? null;
  if (source === 'MASS_QUEUE' || source === 'PW_SESSION') return [];
  return [{ type: 'projector/clear' }];
}

/**
 * A short position line for the operator: "Song 2/5 · 1/4", or "1/4" for a song sent from outside a setlist. Null when no song stanza
 * is on air. 1-based, as the operator counts.
 */
export function lyricsPositionLabel(projector) {
  const on = lyricsOnAir(projector);
  if (!on) return null;
  const stanza = `${on.stanzaIndex + 1}/${on.stanzaCount}`;
  return on.songIndex != null && on.songCount ? `Song ${on.songIndex + 1}/${on.songCount} · ${stanza}` : stanza;
}

/**
 * The live-state actions for Song Lyrics' GO LIVE NOW: a library song goes straight on air without being in a setlist. Its first sung stanza is
 * staged and taken as a direct projection, and `band` (a lower third naming the song) is shown with it, or only staged when `bandStageOnly` (the
 * licence is locked). A lower third the operator switched off stays off: lowerThird/show then only stages it. Null when the song has no stanza
 * with words, so the caller says so instead of blanking the screen.
 *
 * Nothing here writes the song: the frame is built from the song as given, which the caller reads from the session copy (liveLyrics).
 */
export function goLiveNowActions({ hymn, band, bandStageOnly = false }) {
  const stanzas = hymn?.stanzas ?? [];
  if (!stanzas.some((s) => String(s?.lyricsText ?? '').trim() !== '')) return null;
  const present = presentSongStanzaActions({ hymn, stanzaIndex: firstSungStanza(stanzas), setlist: null });
  if (!present) return null;
  return band ? [...present, { type: bandStageOnly ? 'lowerThird/stage' : 'lowerThird/show', value: band }] : present;
}

/**
 * Whether a GO LIVE NOW click would cut into another run's slide: a Holy Mass queue or a Praise & Worship session on the projector (or held
 * behind a blackout). The click then asks for a second press, so a stray click during Mass never takes the screen.
 */
export function goLiveNowCutsRun(projector) {
  if (!projector) return false;
  const source = projector.source ?? null;
  if (source !== 'MASS_QUEUE' && source !== 'PW_SESSION') return false;
  const kind = projector.live?.kind;
  return kind !== 'idle' || projector.beforeBlackout != null;
}

const SECTION_LETTER = { Verse: 'V', Chorus: 'C', Bridge: 'B', Outro: 'OUT', Tag: 'T', Intro: 'IN', 'Pre-Chorus': 'PC' };

/**
 * The chip for a stanza: its short label (V1, V2, C, C2, B, OUT) and its section kind, which picks the chip's colour. A plain "Chorus" is C and a
 * numbered one C1, C2; verses always carry their number. Anything unrecognised shows its first two letters as a Tag.
 */
export function sectionChip(stanzaType) {
  const text = String(stanzaType ?? '').trim();
  const m = /^(Verse|Chorus|Bridge|Outro|Tag|Intro|Pre-Chorus)\s*(\d*)$/i.exec(text);
  if (!m) return { label: text.slice(0, 2).toUpperCase() || '?', kind: 'Tag' };
  const kind = Object.keys(SECTION_LETTER).find((k) => k.toLowerCase() === m[1].toLowerCase());
  return { label: `${SECTION_LETTER[kind]}${m[2]}`, kind: kind === 'Pre-Chorus' || kind === 'Intro' ? 'Tag' : kind };
}

/** Seconds a stanza is reckoned to last when sung, for the setlist's rough running time. */
export const SECONDS_PER_STANZA = 40;

/** A rough running time for a song with `stanzaCount` stanzas, in whole seconds. 0 for none or an unknown count. */
export function estimateSongSeconds(stanzaCount) {
  const n = Number(stanzaCount);
  return Number.isFinite(n) && n > 0 ? Math.round(n) * SECONDS_PER_STANZA : 0;
}

/** A running time as m:ss (or h:mm:ss from an hour). Empty for 0. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total === 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
