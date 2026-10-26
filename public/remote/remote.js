// The Primary viewer: the live screen with the controls. Each button sends one request to the laptop, which makes the same
// change the operator's arrow keys make. The laptop refuses a request while the projector is paused, and the buttons
// show that. Text is written with textContent, never as HTML.
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const prev = el('prev');
  const next = el('next');
  const sectionsList = el('sections');
  const controlError = el('control-error');
  let sectionCount = -1;

  function render(snapshot) {
    el('status').textContent = window.ApccmmaRemote.SCREEN_TEXT[snapshot.screen] ?? '';
    el('title').textContent = snapshot.title || '';
    el('position').textContent = snapshot.position || '';
    el('lines').replaceChildren(...lineElements(snapshot.lines));
    el('next-lines').replaceChildren(...lineElements(snapshot.nextLines));
    el('next-slide-empty').hidden = snapshot.nextLines.length > 0;
    el('next-item').textContent = snapshot.next || 'Nothing after this';

    el('paused').hidden = !snapshot.paused;
    const section = snapshot.sections;
    const canStep = Boolean(section) && !snapshot.paused;
    prev.disabled = !canStep || section.index <= 0;
    next.disabled = !canStep || section.index >= section.count - 1;
    renderSections(section, snapshot.paused);
    if (!snapshot.paused) controlError.textContent = '';
  }

  function lineElements(lines) {
    return lines.map((text) => {
      const line = document.createElement('p');
      line.textContent = text || ' ';
      return line;
    });
  }

  // One large button per slide, numbered from 1. Rebuilt only when the number of slides changes.
  function renderSections(section, paused) {
    sectionsList.hidden = !section || section.count < 2;
    if (!section) {
      sectionCount = -1;
      return;
    }
    if (section.count !== sectionCount) {
      sectionCount = section.count;
      sectionsList.replaceChildren(
        ...Array.from({ length: section.count }, (_, i) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = String(i + 1);
          button.dataset.index = String(i);
          button.addEventListener('click', () => control({ action: 'jump', index: i }));
          return button;
        }),
      );
    }
    for (const button of sectionsList.children) {
      const current = Number(button.dataset.index) === section.index;
      button.setAttribute('aria-current', current ? 'true' : 'false');
      button.disabled = paused;
    }
  }

  async function control(body) {
    controlError.textContent = '';
    let response;
    try {
      response = await fetch('/api/remote/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      controlError.textContent = 'Cannot reach the laptop. Check that this phone is on the same WiFi.';
      return;
    }
    if (!response.ok) {
      const reply = await response.json().catch(() => ({}));
      controlError.textContent = reply.error || 'That did not work.';
    }
  }

  prev.addEventListener('click', () => control({ action: 'previous' }));
  next.addEventListener('click', () => control({ action: 'next' }));

  window.ApccmmaRemote.start(render);
})();
