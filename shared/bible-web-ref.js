// The Scripture references the website's planners (web/js/prayer-scripture.js) put in a plan, and how the laptop reads and writes them. A reference is
// plain text, "Sample Book 1:1-6 (WEB)": a book, a chapter, a verse or an inclusive range, and the translation in brackets (the ones the laptop's offline
// Bible has: WEB, TGL, CEB). It is only the reference. The verses are read from the laptop's own Bible, and never leave it.
import { BIBLE_TRANSLATION_IDS, formatSourceId, parseSourceId } from './bible-ref.js';

const TAIL = /^(.*?)\s*\(\s*([A-Za-z]{2,5})\s*\)\s*$/;
const TYPED = /^(.*?)\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/;
const MAX_TEXT = 200;

/**
 * Reads a reference as the website writes it. Returns { book, chapter, from, to, translationId } (`translationId` null when none is named), or null when the
 * text is not a reference or names a translation the laptop does not have.
 */
export function parseWebReference(text) {
  let body = String(text ?? '').trim();
  let translationId = null;
  const tail = TAIL.exec(body);
  if (tail) {
    translationId = tail[2].toUpperCase();
    if (!BIBLE_TRANSLATION_IDS.includes(translationId)) return null;
    body = tail[1];
  }
  const match = TYPED.exec(body);
  if (!match || !match[1].trim()) return null;
  const from = Number(match[3]);
  const to = match[4] === undefined ? from : Number(match[4]);
  const chapter = Number(match[2]);
  if (chapter < 1 || from < 1 || to < from) return null;
  return { book: match[1].replace(/\s+/g, ' ').trim(), chapter, from, to, translationId };
}

/** The reference text for a passage: "Sample Book 1:1-6 (WEB)". */
export function webReferenceText({ book, chapter, from, to, translationId }) {
  return `${book} ${chapter}:${from}${to > from ? `-${to}` : ''}${translationId ? ` (${translationId})` : ''}`.slice(0, MAX_TEXT);
}

/**
 * The reference to send for a Bible row of a plan: the row's own label when that is already a reference (so a passage the website wrote comes back as
 * the same text), otherwise one made from the row's source id. Null when the source id is not a passage.
 */
export function webReferenceOfRow(sourceId, label) {
  const ref = parseSourceId(sourceId);
  if (!ref) return null;
  const own = parseWebReference(label);
  // A label is trusted only when it says the same passage as the id and its book is a short name, so nothing but a reference ever leaves the laptop.
  const sameRange = own && own.chapter === ref.chapter && own.from === ref.from && own.to === ref.to;
  const shortName = own && own.book.length <= 40 && /^[\p{L}\d.' ]+$/u.test(own.book) && own.book.split(' ').length <= 4;
  if (sameRange && shortName) return webReferenceText({ ...own, translationId: own.translationId ?? ref.translationId });
  return webReferenceText({ book: ref.bookName, chapter: ref.chapter, from: ref.from, to: ref.to, translationId: ref.translationId });
}

/** A source id for the laptop's Bible row, from a reference and the translation's own name for the book. */
export const sourceIdOf = (ref, translationId, bookName) => formatSourceId(translationId, bookName, ref.chapter, ref.to > ref.from ? `${ref.from}-${ref.to}` : String(ref.from));
