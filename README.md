# APCCMMA — Assumption Parish Church Charismatic Music Ministry App

Live presentation console for Catholic Masses: an operator dashboard and separate output windows (congregation projector, livestream lower third, and an operator mirror).

## Run

```bash
npm install
npm run dev       # Vite + Electron (operator window; outputs open from the top bar)
npm run dev:web   # browser only: outputs open as popups and sync over BroadcastChannel
npm run build     # typecheck + production bundle in dist/, then `npm start`
```

> Running from inside VS Code's Claude/extension host? Unset `ELECTRON_RUN_AS_NODE` first, otherwise Electron starts as plain Node.

## Layout

| Path | Role |
| --- | --- |
| `shared/live.js` | Live-state reducer shared by the main process and renderer (staging, pause, blackout, slide stepping) |
| `electron/main.js` | Owns the authoritative state, opens/closes output windows on the right displays, broadcasts state over IPC |
| `electron/preload.cjs` | Minimal `window.apcc` bridge (`getState`, `dispatch`, `onState`, `open`) |
| `src/live/` | Renderer mirror of live state (Zustand) + browser fallback bridge |
| `src/state/ui.ts` | Operator preferences: language, hotkeys, launchpad (persisted) |
| `src/operator/` | Dashboard, top bar, sidebar, palette (Ctrl+K), queue drawer |
| `src/output/` | Projector / mirror and lower-third views |
| `src/liturgy/` | Order of the Mass (EN/TL), lectionary cycle math, psalm & reading → slide formatting |
| `src/types/models.ts`, `db/schema.sql` | Data model for lectionary, hymns, CBCP special prayers, announcements, Mass plans |

## Content notes

- Mass Ordinary texts in `src/liturgy/massOrder.ts` must be proofread against the parish's CBCP-approved missal before use.
- Hymn lyrics (Bukas Palad, Hangad, etc.) and lectionary texts are copyrighted; import them under the ministry's license. The app ships without them.
- Oratio Imperata slots ship empty: paste the current official text when the CBCP or diocese issues one.
