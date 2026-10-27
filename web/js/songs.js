// Song list: read only. Search by title, filter by language and category. The counts on the category chips follow the
// search and the language, so they show how many songs each chip would list.
import { LANGUAGES, SONG_CATEGORIES, SONGS, SONGS_SYNCED } from './sample-data.js';
import { esc, mountSidebar } from './shell.js';
import { guard } from './auth.js';

mountSidebar();
void guard();

const state = { q: '', cat: 'All', lang: 'All' };

const CHIP_ON = 'height:34px;padding:0 14px;border-radius:99px;border:1px solid #ecc98a;background:#2a0c18;color:#ecc98a;font-size:13px;font-weight:700;cursor:pointer';
const CHIP_OFF = 'height:34px;padding:0 14px;border-radius:99px;border:1px solid #3a1523;background:transparent;color:#dbb3bf;font-size:13px;font-weight:600;cursor:pointer';
const SEG_ON = 'height:46px;padding:0 16px;border-radius:10px;border:1px solid #ecc98a;background:#2a0c18;color:#ecc98a;font-size:14px;font-weight:700;cursor:pointer';
const SEG_OFF = 'height:46px;padding:0 16px;border-radius:10px;border:1px solid #3a1523;background:transparent;color:#dbb3bf;font-size:14px;font-weight:600;cursor:pointer';

function render() {
  const q = state.q.trim().toLowerCase();
  const base = SONGS.filter((s) => (state.lang === 'All' || s[2] === state.lang) && (!q || s[0].toLowerCase().includes(q)));
  const countOf = (c) => base.filter((s) => c === 'All' || s[1] === c).length;
  const shown = base.filter((s) => state.cat === 'All' || s[1] === state.cat);

  document.getElementById('langs').innerHTML = ['All', ...LANGUAGES].map((l) => `
          <button type="button" data-lang="${esc(l)}" aria-pressed="${state.lang === l}" style="${state.lang === l ? SEG_ON : SEG_OFF}">${l === 'All' ? 'All languages' : esc(l)}</button>`).join('');

  document.getElementById('cats').innerHTML = ['All', ...SONG_CATEGORIES].map((c) => `
        <button type="button" data-cat="${esc(c)}" aria-pressed="${state.cat === c}" style="${state.cat === c ? CHIP_ON : CHIP_OFF}">${c === 'All' ? 'All songs' : esc(c)} <span style="font-family: 'JetBrains Mono', monospace; margin-left: 6px; opacity: 0.8">${countOf(c)}</span></button>`).join('');

  document.getElementById('song-rows').innerHTML = shown.length
    ? shown.map(([title, cat, lang, key]) => `
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 13px 18px; border-bottom: 1px solid #2b1019">
          <span style="flex: 3 1 220px; min-width: 0; font-size: 15px; font-weight: 700">${esc(title)}</span>
          <span style="flex: 2 1 160px; min-width: 0"><span style="display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 99px; background: #2a0c18; border: 1px solid #55202f; font-size: 12px; font-weight: 600; color: #ecc98a">${esc(cat)}</span></span>
          <span style="flex: 1 1 90px; font-size: 14px; color: #dbb3bf">${esc(lang)}</span>
          <span style="flex: 0 0 72px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #dbb3bf">${esc(key)}</span>
        </div>`).join('')
    : `
        <div style="padding: 36px 18px; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center">
          <span style="font-size: 16px; font-weight: 700">No songs match</span>
          <span style="font-size: 13px; color: #b48d99">Try another category or clear the search.</span>
        </div>`;

  document.getElementById('footer').textContent = `Showing ${shown.length} of ${SONGS.length} songs`;
}

document.getElementById('synced').textContent = SONGS_SYNCED;

document.getElementById('song-search').addEventListener('input', (event) => {
  state.q = event.target.value;
  render();
});

document.querySelector('main').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  let selector;
  if (button.dataset.lang) {
    state.lang = button.dataset.lang;
    selector = `[data-lang="${CSS.escape(state.lang)}"]`;
  } else if (button.dataset.cat) {
    state.cat = button.dataset.cat;
    selector = `[data-cat="${CSS.escape(state.cat)}"]`;
  } else {
    return;
  }
  render();
  // The buttons are redrawn, so keep keyboard focus on the one that was pressed.
  document.querySelector(selector)?.focus();
});

render();
