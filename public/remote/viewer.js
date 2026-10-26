// The Secondary viewer: read-only. It shows the current slide, the item title, and the next item title, and nothing that
// changes the screen. Text is written with textContent, never as HTML.
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  function render(snapshot) {
    el('status').textContent = window.ApccmmaRemote.SCREEN_TEXT[snapshot.screen] ?? '';
    el('title').textContent = snapshot.title || '';
    el('position').textContent = snapshot.position || '';
    el('lines').replaceChildren(
      ...snapshot.lines.map((text) => {
        const line = document.createElement('p');
        line.textContent = text || ' ';
        return line;
      }),
    );
    el('next-item').textContent = snapshot.next || 'Nothing after this';
  }

  window.ApccmmaRemote.start(render);
})();
