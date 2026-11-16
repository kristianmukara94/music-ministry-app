import { BookOpen, Cross, Music } from 'lucide-react';

/** The icon for each card function: a music note for a song, a cross for a prayer, a book for scripture. */
export const TYPE_ICON = { prayer: Cross, song: Music, scripture: BookOpen } as const;
