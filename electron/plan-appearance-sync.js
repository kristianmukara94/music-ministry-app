// Plan Appearance over Cloud Sync: what the laptop sends with a plan and how it takes a pulled one. Pure (no Electron, no database handle
// beyond the two small readers passed in), so the tests run it under plain Node.
//
// The website keeps `appearance` as a sanitized object (shared/plan-appearance.js) in the plan's body. A laptop that keeps Plan Appearance
// sends it with every plan; a server from before it sends no `appearance` key at all, and then the laptop's own look stays.
//
// A picture or motion clip is a Media Library id that exists only on one laptop. The website carries the address along untouched (it cannot
// look inside), and the laptop takes it back as follows:
//   - the incoming look names no picture, but this laptop's plan has one of the same kind (a colour or font was edited on the web): keep the
//     laptop's picture, so a web edit never loses it;
//   - the incoming look names a picture this laptop's Media Library holds: keep it;
//   - the incoming look names a picture this laptop does not hold: fall back to the colour (portablePlanAppearance).
import { parsePlanAppearance, portablePlanAppearance, sanitizePlanAppearance, serializePlanAppearance } from '../shared/plan-appearance.js';

/** Whether the database keeps Plan Appearance for this plan table (a test database built from part of the migration list may not). */
export const hasAppearanceColumn = (db, table) =>
  db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = 'appearance_json'`).get().n === 1;

/**
 * What the laptop sends for a plan: the stored appearance as a sanitized object, always an object (a plan with none sends the default look, so
 * "cleared on the laptop" reaches the website). Undefined when this database keeps none, so the server leaves its own.
 */
export function appearanceToSend(json, supported) {
  return supported ? sanitizePlanAppearance(parsePlanAppearance(json)) : undefined;
}

/**
 * The `appearance_json` text to store for a pulled plan, or `undefined` to leave the column alone. `incoming` is the server's `appearance`
 * (an object, null for a plan nobody ever gave a look, or absent from an older server); `localJson` is the column now; `hasMedia(id)` says
 * whether this laptop's Media Library holds an item.
 */
export function pulledAppearance(incoming, localJson, hasMedia) {
  // An older server, or a plan whose look was never set on the website: the laptop's own look stays.
  if (incoming === undefined || incoming === null || typeof incoming !== 'object') return undefined;
  const next = sanitizePlanAppearance(incoming);
  const local = parsePlanAppearance(localJson);
  const bg = next.background;
  if (!bg.mediaPath && bg.type !== 'color' && local.background.mediaPath && local.background.type === bg.type) {
    next.background = { ...bg, mediaPath: local.background.mediaPath, mediaId: local.background.mediaId };
  }
  return serializePlanAppearance(portablePlanAppearance(next, hasMedia));
}
