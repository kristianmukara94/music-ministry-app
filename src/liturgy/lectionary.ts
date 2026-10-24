import type { Frame, SlideLine } from '../../shared/live.js';
import type { Reading, ResponsorialPsalm } from '../types/models';

export type SundayCycle = 'A' | 'B' | 'C';
export type WeekdayCycle = 'I' | 'II';

/** First Sunday of Advent = fourth Sunday before Christmas. */
export function firstSundayOfAdvent(year: number): Date {
  const christmasDow = new Date(year, 11, 25).getDay();
  const sundayBeforeChristmas = 25 - (christmasDow === 0 ? 7 : christmasDow);
  return new Date(year, 11, sundayBeforeChristmas - 21);
}

/** The liturgical year is named for the civil year in which it mostly falls (it starts at Advent). */
export function liturgicalYear(date: Date): number {
  const y = date.getFullYear();
  return date >= firstSundayOfAdvent(y) ? y + 1 : y;
}

export function sundayCycle(date: Date): SundayCycle {
  return (['C', 'A', 'B'] as const)[liturgicalYear(date) % 3];
}

/**
 * Year I is read in the liturgical years that begin in odd-numbered calendar years (Advent 2025 starts Year I).
 * liturgicalYear() gives the ending year, one more than the starting year, so an even label means Year I.
 */
export function weekdayCycle(date: Date): WeekdayCycle {
  return liturgicalYear(date) % 2 === 0 ? 'I' : 'II';
}

/**
 * Responsorial Psalm → deck. The response opens the psalm alone (so the
 * congregation learns it), then follows every stanza, styled as `response`.
 */
export function psalmToFrame(psalm: ResponsorialPsalm, title: string): Frame {
  const response: SlideLine = { role: 'response', text: psalm.response };
  const slides: SlideLine[][] = [
    [response],
    ...psalm.stanzas.map((stanza) => [...stanza.map((text): SlideLine => ({ role: 'reader', text })), response]),
  ];
  return { kind: 'deck', title: `${title} · ${psalm.citation}`, slides, index: 0 };
}

/** Split long prose at sentence boundaries into projector-sized slides. */
export function paginate(text: string, maxChars = 320): string[] {
  const sentences = text.match(/[^.!?;]+[.!?;]+["”’]?\s*|.+$/g) ?? [text];
  const pages: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && (current + sentence).length > maxChars) {
      pages.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) pages.push(current.trim());
  return pages;
}

export function readingToFrame(reading: Reading, title: string): Frame {
  const slides: SlideLine[][] = paginate(reading.body).map((text) => [{ role: 'reader', text }]);
  if (reading.conclusion) slides.push([{ role: 'reader', text: reading.conclusion }, ...(reading.reply ? [{ role: 'response' as const, text: reading.reply }] : [])]);
  return { kind: 'deck', title: `${title} · ${reading.citation}`, slides, index: 0 };
}
