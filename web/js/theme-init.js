// The colour theme: Light, Dark or System (the default, which follows the browser's prefers-color-scheme).
//
// This is a classic script loaded in <head> before the stylesheets, without defer or type="module", so it sets
// <html data-theme="light|dark"> before the first paint and a page never flashes the wrong theme. It is a file rather than an
// inline script because the site's Content-Security-Policy allows scripts from 'self' only (vercel.json).
//
// Only an explicit Light or Dark choice is kept, in localStorage under apccmma.theme. Choosing System removes it, so the page
// follows the device again. shell.js draws the switch in the sidebar and calls window.apccmmaTheme.set().
(function () {
  var KEY = 'apccmma.theme';
  var THEME_COLOR = { dark: '#080c14', light: '#f8fafc' };
  var root = document.documentElement;
  var lightQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  /** The saved choice: 'light', 'dark' or 'system'. localStorage can throw in a private window, which means 'system'. */
  function preference() {
    try {
      var saved = localStorage.getItem(KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch (e) {
      return 'system';
    }
  }

  /** System resolves to light only when the browser asks for it, so a browser that says nothing keeps the dark design. */
  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return lightQuery && lightQuery.matches ? 'light' : 'dark';
  }

  function apply(pref) {
    var theme = resolve(pref);
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-pref', pref);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = THEME_COLOR[theme];
    document.dispatchEvent(new CustomEvent('apccmma:themechange', { detail: { preference: pref, theme: theme } }));
  }

  function set(pref) {
    if (pref !== 'light' && pref !== 'dark') pref = 'system';
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch (e) {
      // Not saved: the choice still applies to this page.
    }
    // Colours fade only while the person switches, never on load. The class comes off once the fade is over.
    root.classList.add('theme-switching');
    apply(pref);
    window.clearTimeout(set.timer);
    set.timer = window.setTimeout(function () {
      root.classList.remove('theme-switching');
    }, 250);
  }

  apply(preference());

  // On System, follow the device when it changes, for example at sunset.
  if (lightQuery) {
    var onChange = function () {
      if (preference() === 'system') apply('system');
    };
    if (lightQuery.addEventListener) lightQuery.addEventListener('change', onChange);
    else if (lightQuery.addListener) lightQuery.addListener(onChange);
  }

  // A choice made in another tab applies here too.
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === null) apply(preference());
  });

  window.apccmmaTheme = { preference: preference, set: set };
})();
