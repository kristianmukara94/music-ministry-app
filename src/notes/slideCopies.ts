import type { Note } from './types';

/**
 * The Notes & Prayers entries Go Live makes as one plan's or one lineup card's own copy of an item's words (Edit slide on air, Add slide and
 * Delete slide on a prayer, a reading, a Mass part). Copy-on-write: the first change makes a copy, filed under its owner in the notes table
 * (`copy_owner`), and later changes go to that copy. Every write goes through `bridge.notes.saveCopy`, which the main process refuses for any
 * note that is not a copy with the same owner, so a Liturgical Content Hub entry, the Lectionary and Song Lyrics are never written from air.
 */

/** The owner of a Holy Mass plan's copies. */
export const massCopyOwner = (planId: number): string => `mass:${planId}`;

/** The owner of a lineup card's copies: the card is the lineup's, so its key is only unique within the lineup. */
export const cardCopyOwner = (sessionId: number, cardKey: string): string => `pw:${sessionId}:${cardKey}`;

/** Whether `note` is the copy `owner` made, so a change goes to it in place. Any other note (a Hub entry, another plan's copy) is copied first. */
export const isCopyFor = (note: Pick<Note, 'copyOwner'> | null | undefined, owner: string): boolean => Boolean(note?.copyOwner) && note!.copyOwner === owner;

/** Whether `note` is a Go Live copy rather than a Liturgical Content Hub entry. The Hub and the pickers leave copies out. */
export const isGoLiveCopy = (note: Pick<Note, 'copyOwner'>): boolean => Boolean(note.copyOwner);
