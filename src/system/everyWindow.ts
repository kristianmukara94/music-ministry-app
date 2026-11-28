// Modules that start listening the moment they are imported. Every window of the app (console, projector, lower third, mirror, editor)
// has always had all of them, so they are imported here by name: loading the console's pages on demand must not take a listener away from
// an output window, or leave the console without it until a page is opened. A new module that does work at import belongs in this list.
import '../live/store'; // the live state from the main process
import '../theme/store'; // repaints a window when the theme is changed in another one
import '../state/region'; // the clock's time zone and format
import '../liturgy/massOrderStore'; // the parish's own words for the Holy Mass Order
import '../live/liveSongs'; // edits to a song or prayer that is on screen
import '../praise-worship/store'; // edits to songs, notes and lineups behind the live Praise & Worship session
