export function stanzaTarget(position: number, count: number, newCount: number): { position: number; moved: boolean } | null;
export function lyricsFrameAfterEdit(
  frame: any,
  hymn: { id: number; title: string; deletedAt?: string | null; stanzas: { stanzaType: string; lyricsText: string }[] } | null,
): { frame: any; moved: boolean; changed: boolean } | null;
export function findLyricsStep(steps: { kind: string; hymnId?: number; position?: number }[], hymnId: number, position: number, currentIndex: number): number | null;
