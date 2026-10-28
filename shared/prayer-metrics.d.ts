/** Advance width in em of each printable ASCII character, in code order from 32 (space) to 126 (~). */
export const ADVANCE_EM: number[];

/** The width of a text in em, as the lineup face draws it (no kerning). */
export function textWidthEm(text: string): number;

/** How many lines one line of text takes in a box `maxEm` wide, wrapped as the browser wraps it. A blank line is one line. */
export function wrappedLineCount(line: string, maxEm: number): number;
