// The colour theme: the same themes as the church laptop (web/css/theme-tokens.css is a copy of shared/theme-tokens.css), following
// whichever theme the laptop was last painted with.
//
// This is a classic script loaded in <head> before the stylesheets, without defer or type="module", so it sets <html data-theme="…">
// before the first paint and a page never flashes the wrong theme. It is a file rather than an inline script because the site's
// Content-Security-Policy allows scripts from 'self' only (vercel.json).
//
// Where the theme comes from, first match wins:
//   1. a theme this browser chose for itself in the sidebar (localStorage apccmma.themeOverride)
//   2. the laptop's theme: from ?theme= on a link the laptop opened, or from the server (js/theme-sync.js calls receive()), kept in
//      localStorage apccmma.theme with the time the laptop chose it in apccmma.themeUpdatedAt
//   3. the laptop's default theme, Obsidian Console
// A newer laptop theme repaints the page live: only the data-theme attribute changes, so nothing typed on the page is lost.
(function () {
  var KEY = 'apccmma.theme';
  var STAMP = 'apccmma.themeUpdatedAt';
  var OVERRIDE = 'apccmma.themeOverride';
  var DEFAULT_THEME = 'obsidian';
  // Must match shared/theme-catalog.js and the canvases in theme-tokens.css (shared/theme-tokens.test.js checks both).
  var THEMES = [
    { id: 'advent', name: 'Advent', group: 'seasonal', canvas: '#130a26' },
    { id: 'christmas', name: 'Christmas', group: 'seasonal', canvas: '#fcf8ee' },
    { id: 'ordinary-time', name: 'Ordinary Time', group: 'seasonal', canvas: '#071a10' },
    { id: 'lent', name: 'Lent', group: 'seasonal', canvas: '#161019' },
    { id: 'holy-week', name: 'Holy Week', group: 'seasonal', canvas: '#1a0406' },
    { id: 'easter', name: 'Easter', group: 'seasonal', canvas: '#fffdf6' },
    { id: 'pentecost', name: 'Pentecost', group: 'seasonal', canvas: '#200a03' },
    { id: 'obsidian', name: 'Obsidian Console', group: 'signature', canvas: '#0c0d10' },
    { id: 'default', name: 'APCCMMA Default', group: 'signature', canvas: '#100306' },
    { id: 'light', name: 'APCCMMA Light', group: 'signature', canvas: '#faf6f4' },
    { id: 'classic', name: 'Classic', group: 'signature', canvas: '#0d1b2e' },
    { id: 'olive', name: 'Olive', group: 'signature', canvas: '#141a0c' },
    { id: 'black-gold', name: 'Black & Gold', group: 'dark', canvas: '#0a0a0a' },
    { id: 'deep-teal', name: 'Deep Teal', group: 'dark', canvas: '#031f1e' },
    { id: 'burgundy', name: 'Burgundy', group: 'dark', canvas: '#2a0610' },
    { id: 'wine', name: 'Wine', group: 'dark', canvas: '#15070f' },
    { id: 'slate', name: 'Slate', group: 'dark', canvas: '#111418' },
    { id: 'ice-blue', name: 'Ice Blue', group: 'light', canvas: '#eef6fb' },
    { id: 'mint', name: 'Mint', group: 'light', canvas: '#eefaf4' },
    { id: 'sage', name: 'Sage', group: 'light', canvas: '#f1f4ee' },
    { id: 'linen', name: 'Linen', group: 'light', canvas: '#f8f3ea' },
    { id: 'shell', name: 'Shell', group: 'light', canvas: '#f6f5f8' },
  ];
  var root = document.documentElement;
  var fadeTimer;

  function find(id) {
    for (var i = 0; i < THEMES.length; i += 1) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }

  // localStorage can throw in a private window: then nothing is remembered, and the page still paints.
  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function write(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      // Not saved: the theme still applies to this page.
    }
  }

  /** The laptop's theme as last heard. A value saved by the old Light / Dark switch that is not a theme id counts as nothing. */
  function synced() {
    var saved = read(KEY);
    return find(saved) ? saved : DEFAULT_THEME;
  }
  /** A theme this browser chose for itself, or null when it matches the laptop. */
  function override() {
    var saved = read(OVERRIDE);
    return find(saved) ? saved : null;
  }
  function current() {
    return override() || synced();
  }

  function apply() {
    var theme = current();
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = find(theme).canvas;
    document.dispatchEvent(new CustomEvent('apccmma:themechange', { detail: { theme: theme, synced: synced(), override: override() } }));
  }

  /** Colours fade only while the theme changes on an open page, never on load. The class comes off once the fade is over. */
  function applyWithFade() {
    root.classList.add('theme-switching');
    apply();
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(function () {
      root.classList.remove('theme-switching');
    }, 250);
  }

  /** The sidebar picker: a theme id keeps this browser on that theme; anything else ('' for "Match the laptop") follows the laptop again. */
  function choose(id) {
    write(OVERRIDE, find(id) ? id : null);
    applyWithFade();
  }

  /**
   * A theme from the server (js/theme-sync.js). It is taken when the laptop chose it after the one this page has, and then repaints the
   * page at once. Returns true when it changed what the laptop theme is.
   */
  function receive(theme, updatedAt) {
    if (!find(theme) || typeof updatedAt !== 'string' || isNaN(Date.parse(updatedAt))) return false;
    var known = read(STAMP);
    if (known && !isNaN(Date.parse(known)) && Date.parse(updatedAt) <= Date.parse(known)) return false;
    var before = current();
    var changed = read(KEY) !== theme;
    write(KEY, theme);
    write(STAMP, updatedAt);
    if (current() !== before) applyWithFade();
    else if (changed) apply();
    return changed;
  }

  // A link opened from the laptop says which theme it is in. It counts as the laptop's theme as of now, and comes off the address so a
  // bookmark does not pin it.
  (function fromAddress() {
    var match = /[?&]theme=([\w-]+)/.exec(window.location.search || '');
    if (!match || !find(match[1])) return;
    write(KEY, match[1]);
    write(STAMP, new Date().toISOString());
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete('theme');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch (e) {
      // An old browser keeps ?theme= in the address; it does no harm.
    }
  })();

  apply();

  // A theme chosen or received in another tab applies here too.
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === OVERRIDE || event.key === null) applyWithFade();
  });

  window.apccmmaTheme = {
    themes: THEMES,
    defaultTheme: DEFAULT_THEME,
    current: current,
    synced: synced,
    override: override,
    choose: choose,
    receive: receive,
  };
})();
