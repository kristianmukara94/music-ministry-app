// Plan Appearance on the web: one plan's default slide look (background colour, font, size, weight, case, alignment, colour, shadow), set from
// the Plan Editors and the Create a plan card, and carried with the plan to the church laptop. The data is the laptop's own contract
// (shared/plan-appearance.js, byte-copied beside this file), so a look set here and a look set at the booth are the same JSON.
//
// Pure helpers first (what the tests drive: the reducer, the badge, the markup), then the browser parts: the button, the slide-over drawer
// with its live 16:9 preview, and the compact section of the Create a plan card. Every value that reaches the markup is a validated key, a
// validated hex colour or a number, or goes through esc(). Nothing here holds lyrics or Scripture: the preview shows made-up sample words.
import {
  PLAN_APPEARANCE_DEFAULT,
  PLAN_COLOR_PRESETS,
  PLAN_DIM_MAX,
  PLAN_FONTS,
  PLAN_FONT_SIZES,
  PLAN_FONT_WEIGHTS,
  PLAN_TEXT_ALIGNS,
  PLAN_TEXT_CASES,
  PLAN_TEXT_COLORS,
  PLAN_WEIGHT_CSS,
  clampDim,
  planBackgroundOf,
  planFontCss,
  planFontSizeLabel,
  planFontSizeOf,
  planTextLook,
  samePlanAppearance,
  sanitizePlanAppearance,
  stepPlanFontSize,
} from './plan-appearance.js';
import { TEXT_FONTS, normalizeHex } from './text-style.js';

export { PLAN_APPEARANCE_DEFAULT, samePlanAppearance, sanitizePlanAppearance };

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

export const GLOBAL_LABEL = 'Global Default';
export const CUSTOM_LABEL = 'Custom Look · All Slides';

/** What the global look draws when a plan sets nothing of its own, so the preview is honest about it. */
const GLOBAL_LOOK = Object.freeze({ color: '#000000', text: '#FFFFFF', font: 'sans', scale: 1, weight: 700, upper: false, align: 'center', shadow: true });

export const WEIGHT_LABELS = Object.freeze({ normal: 'Regular', semibold: 'Semi-Bold', bold: 'Bold' });
export const CASE_LABELS = Object.freeze({ none: 'As Typed', upper: 'UPPERCASE' });
export const ALIGN_LABELS = Object.freeze({ center: 'Center', left: 'Left', right: 'Right' });
/** The preview's sample slides: made-up words only. */
export const SAMPLES = Object.freeze({
  song: Object.freeze({ title: 'Sample Song Title', lines: ['Sample line one of the words', 'Sample line two of the words'] }),
  prayer: Object.freeze({ title: 'Sample Prayer Title', lines: ['Sample prayer line one', 'Sample prayer line two'] }),
});

/** Whether the plan carries a picture or clip that lives on the church laptop (kept as it is: the website cannot show it). */
export const laptopMediaOf = (appearance) => {
  const bg = sanitizePlanAppearance(appearance).background;
  return bg.mediaPath && bg.type !== 'color' ? { type: bg.type, id: bg.mediaId, path: bg.mediaPath } : null;
};

/** The button's badge: the status words and the colour swatch. */
export function appearanceSummary(appearance) {
  const clean = sanitizePlanAppearance(appearance);
  const custom = clean.enabled;
  return { custom, label: custom ? CUSTOM_LABEL : GLOBAL_LABEL, color: custom ? clean.background.color : null, media: custom ? laptopMediaOf(clean) : null };
}

/**
 * The look after one control changed. `action` is the control's name, `value` its value. Any change to a look control turns the plan's own
 * look on (the drawer's controls are only live in Custom mode, but the Create a plan card has no mode switch). The laptop's picture or clip
 * address is never touched here, so saving a colour or font edit keeps it. Returns a sanitized appearance.
 */
export function editAppearance(current, action, value) {
  const a = sanitizePlanAppearance(current);
  const bg = { ...a.background };
  const t = { ...a.typography };
  let enabled = a.enabled;
  const custom = () => {
    enabled = true;
  };
  switch (action) {
    case 'mode':
      enabled = value === 'custom';
      break;
    case 'reset':
      // Back to the default look: Use Global Default, but the picture the laptop holds stays attached to the plan.
      return sanitizePlanAppearance({ ...PLAN_APPEARANCE_DEFAULT, background: { ...PLAN_APPEARANCE_DEFAULT.background, ...(a.background.mediaPath ? { type: a.background.type, mediaPath: a.background.mediaPath } : {}) } });
    case 'bg-color': {
      const hex = normalizeHex(value);
      if (hex) bg.color = hex;
      custom();
      break;
    }
    case 'dim':
      bg.dimOpacity = clampDim(value);
      custom();
      break;
    case 'size': {
      const size = planFontSizeOf(value);
      if (size === undefined) delete t.fontSizeScale;
      else t.fontSizeScale = size;
      custom();
      break;
    }
    case 'size-step':
      t.fontSizeScale = stepPlanFontSize(t.fontSizeScale, Number(value) < 0 ? -1 : 1);
      custom();
      break;
    case 'font':
      if (PLAN_FONTS.includes(value)) t.fontFamily = value;
      else delete t.fontFamily;
      custom();
      break;
    case 'weight':
      if (PLAN_FONT_WEIGHTS.includes(value)) t.fontWeight = value;
      custom();
      break;
    case 'case':
      if (PLAN_TEXT_CASES.includes(value)) t.textCase = value;
      custom();
      break;
    case 'align':
      if (PLAN_TEXT_ALIGNS.includes(value)) t.textAlign = value;
      custom();
      break;
    case 'text-color': {
      const hex = normalizeHex(value);
      if (hex) t.textColor = hex;
      custom();
      break;
    }
    case 'shadow':
      t.textShadow = value === true || value === 'true';
      custom();
      break;
    default:
      return a;
  }
  return sanitizePlanAppearance({ enabled, background: bg, typography: t });
}

/** "Apply to All Slides": the plan's own look on, for every slide in the plan (the laptop draws it behind each slide). */
export const applyToAll = (appearance) => editAppearance(appearance, 'mode', 'custom');

/** What the website sends with a new plan: the look when it is on, and nothing when the plan follows the Global Appearance. */
export const appearanceForCreate = (appearance) => {
  const clean = sanitizePlanAppearance(appearance);
  return clean.enabled ? clean : undefined;
};

/** The size now shown: the plan's pill, or 100% when it sets none. */
export const sizeNow = (appearance) => planFontSizeOf(sanitizePlanAppearance(appearance).typography.fontSizeScale) ?? 1;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Markup

/** What a slide of the preview is drawn with: the plan's look over the global one, as inline CSS values. */
export function previewLook(appearance) {
  const clean = sanitizePlanAppearance(appearance);
  const bg = planBackgroundOf(clean);
  const t = clean.enabled ? clean.typography : {};
  const text = planTextLook(clean);
  const scale = t.fontSizeScale === 'max' ? 1.9 : (t.fontSizeScale ?? GLOBAL_LOOK.scale);
  return {
    color: bg?.color ?? GLOBAL_LOOK.color,
    dim: bg?.dim ?? 0,
    textColor: text.color ?? GLOBAL_LOOK.text,
    fontCss: planFontCss(t.fontFamily ?? GLOBAL_LOOK.font),
    scale,
    weight: text.weight ?? GLOBAL_LOOK.weight,
    upper: t.textCase ? t.textCase === 'upper' : GLOBAL_LOOK.upper,
    align: t.textAlign ?? GLOBAL_LOOK.align,
    shadow: text.shadow ?? GLOBAL_LOOK.shadow,
  };
}

/** The live 16:9 slide: a Song or Prayer sample on the plan's background, with the Title Safe 90% guide when asked. */
export function previewHtml(appearance, { sample = 'song', safe = true } = {}) {
  const look = previewLook(appearance);
  const s = SAMPLES[sample] ?? SAMPLES.song;
  const text = [
    `font-family:${look.fontCss}`,
    `color:${look.textColor}`,
    `font-weight:${look.weight}`,
    `text-align:${look.align}`,
    `text-transform:${look.upper ? 'uppercase' : 'none'}`,
    `--pa-scale:${look.scale}`,
    look.shadow ? 'text-shadow:0 0.06em 0.28em rgba(0,0,0,.85)' : 'text-shadow:none',
  ].join(';');
  return `
    <div class="pa-stage" data-sample="${esc(sample)}" role="img" aria-label="Live slide preview">
      <div class="pa-stage-bg" style="background:${look.color}"></div>
      <div class="pa-stage-dim" style="opacity:${look.dim}"></div>
      <div class="pa-stage-text" style="${esc(text)}">
        <p class="pa-stage-title">${esc(s.title)}</p>
        ${s.lines.map((line) => `<p class="pa-stage-line">${esc(line)}</p>`).join('')}
      </div>
      ${safe ? '<div class="pa-stage-safe" aria-hidden="true"></div>' : ''}
    </div>`;
}

const swatch = (hex, label, pressed, action) =>
  `<button type="button" class="pa-swatch" data-pa="${action}" data-value="${hex}" aria-pressed="${pressed}" aria-label="${esc(label)} ${hex}" title="${esc(label)} ${hex}" style="--sw:${hex}"></button>`;
const pill = (text, action, value, pressed, off = false) =>
  `<button type="button" class="bc-pill pa-pill" data-pa="${action}" data-value="${esc(value)}" aria-pressed="${pressed}"${off ? ' disabled' : ''}>${esc(text)}</button>`;

/** The button in a plan's header: its swatch and its status badge. Filled by renderAppearanceButton. */
export function appearanceButtonHtml(appearance) {
  const sum = appearanceSummary(appearance);
  const dot = sum.color ? `<span class="pa-dot" style="background:${sum.color}" aria-hidden="true"></span>` : '<span class="pa-dot is-global" aria-hidden="true"></span>';
  return `${dot}<span class="pa-btn-text">Plan Appearance</span><span class="pa-badge${sum.custom ? ' is-custom' : ''}">${esc(sum.label)}</span>`;
}

/** The drawer's controls for `appearance`. `compact` is the Create a plan card's short version. */
export function controlsHtml(appearance, { canEdit = true, compact = false } = {}) {
  const a = sanitizePlanAppearance(appearance);
  const on = a.enabled;
  const t = a.typography;
  const lock = canEdit && (on || compact) ? '' : ' disabled';
  const size = sizeNow(a);
  const colors = PLAN_COLOR_PRESETS.map((c) => swatch(c.hex, c.label, a.background.color === c.hex, 'bg-color')).join('');
  const textColors = PLAN_TEXT_COLORS.map((hex) => swatch(hex, 'Text', (t.textColor ?? GLOBAL_LOOK.text) === hex, 'text-color')).join('');
  const sizes = PLAN_FONT_SIZES.map((s) => pill(planFontSizeLabel(s), 'size', String(s), size === s)).join('');
  const fonts = PLAN_FONTS.map((key) => `<option value="${esc(key)}"${(t.fontFamily ?? GLOBAL_LOOK.font) === key ? ' selected' : ''}>${esc(TEXT_FONTS[key].label)}</option>`).join('');
  const picker = (id, label, value) => `
    <div class="pa-hex"><label for="${id}">${label}</label><input id="${id}" type="text" inputmode="text" maxlength="7" spellcheck="false" autocomplete="off" value="${value}" aria-label="${label}"${lock}></div>`;
  const media = laptopMediaOf(a);
  const mediaNote = media
    ? `<p class="pa-media" data-pa-media>${media.type === 'motion' ? 'A looping motion background' : 'A picture background'} from the church laptop is attached. It is kept as it is when you save, and shown at the booth; this preview shows the colour.</p>`
    : '';
  const lockedGroup = `<fieldset class="pa-group"${canEdit && (on || compact) ? '' : ' disabled'}>`;
  const compactHtml = `
    <div class="pa-controls is-compact">
      <div class="pa-field"><span class="pa-label">Slide background</span><div class="pa-swatches">${colors}</div>${picker('pa-bg-hex', 'Hex', a.background.color)}</div>
      <div class="pa-field"><span class="pa-label">Text color</span><div class="pa-swatches">${textColors}</div>${picker('pa-text-hex', 'Hex', t.textColor ?? GLOBAL_LOOK.text)}</div>
      <div class="pa-field"><label class="pa-label" for="pa-font">Font</label><select id="pa-font" class="bc-input" data-pa-select="font">${fonts}</select></div>
      <div class="pa-field"><span class="pa-label">Font size</span><div class="pa-pills">${sizes}</div></div>
    </div>`;
  if (compact) return compactHtml;
  return `
    <div class="pa-controls">
      <div class="pa-mode" role="group" aria-label="Plan look">
        ${pill('Use Global Default', 'mode', 'global', !on, !canEdit)}
        ${pill('Custom Plan Look (All Slides)', 'mode', 'custom', on, !canEdit)}
      </div>
      ${lockedGroup}
        <div class="pa-field"><span class="pa-label">Slide background</span><div class="pa-swatches">${colors}</div>${picker('pa-bg-hex', 'Hex', a.background.color)}
          <label class="pa-range"><span>Dim overlay <output id="pa-dim-out">${Math.round(a.background.dimOpacity * 100)}%</output></span>
            <input id="pa-dim" type="range" min="0" max="${PLAN_DIM_MAX * 100}" step="5" value="${Math.round(a.background.dimOpacity * 100)}" aria-label="Dim overlay"${lock}></label>
          ${mediaNote}
        </div>
        <div class="pa-field"><span class="pa-label">Font size</span>
          <div class="pa-size-row">
            <button type="button" class="bc-pill pa-step" data-pa="size-step" data-value="-1" aria-label="Smaller text">A−</button>
            <div class="pa-pills">${sizes}</div>
            <button type="button" class="bc-pill pa-step" data-pa="size-step" data-value="1" aria-label="Larger text">A+</button>
          </div>
        </div>
        <div class="pa-field"><label class="pa-label" for="pa-font">Font family</label><select id="pa-font" class="bc-input" data-pa-select="font">${fonts}</select></div>
        <div class="pa-field"><span class="pa-label">Font weight</span><div class="pa-pills">${PLAN_FONT_WEIGHTS.map((w) => pill(WEIGHT_LABELS[w], 'weight', w, (t.fontWeight ?? 'bold') === w)).join('')}</div></div>
        <div class="pa-field"><span class="pa-label">Text case</span><div class="pa-pills">${PLAN_TEXT_CASES.map((c) => pill(CASE_LABELS[c], 'case', c, (t.textCase ?? 'none') === c)).join('')}</div></div>
        <div class="pa-field"><span class="pa-label">Text alignment</span><div class="pa-pills">${PLAN_TEXT_ALIGNS.map((c) => pill(ALIGN_LABELS[c], 'align', c, (t.textAlign ?? 'center') === c)).join('')}</div></div>
        <div class="pa-field"><span class="pa-label">Text color</span><div class="pa-swatches">${textColors}</div>${picker('pa-text-hex', 'Hex', t.textColor ?? GLOBAL_LOOK.text)}</div>
        <label class="pa-toggle"><input id="pa-shadow" type="checkbox"${(t.textShadow ?? GLOBAL_LOOK.shadow) ? ' checked' : ''}${lock}><span>Drop shadow</span></label>
      </fieldset>
    </div>`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The browser parts

/** Fills the header button: swatch, name and status. */
export function renderAppearanceButton(button, appearance) {
  if (!button) return;
  button.innerHTML = appearanceButtonHtml(appearance);
  const sum = appearanceSummary(appearance);
  button.dataset.look = sum.custom ? 'custom' : 'global';
  button.setAttribute('aria-label', `Plan Appearance: ${sum.label}`);
}

/**
 * Opens the Plan Appearance drawer on `appearance`. Edits are a draft: Apply to All Slides (or Done) hands the look to `onApply` and closes;
 * Close (or Esc) throws the draft away. A viewer sees the look and cannot change it. Returns { close }.
 */
export function openAppearanceDrawer({ appearance, canEdit = true, onApply = () => {}, doc = document }) {
  let draft = sanitizePlanAppearance(appearance);
  let sample = 'song';
  let safe = true;
  const dialog = doc.createElement('dialog');
  dialog.className = 'pa-drawer';
  dialog.setAttribute('aria-labelledby', 'pa-title');
  dialog.innerHTML = `
    <div class="pa-panel">
      <header class="pa-head">
        <div><p class="pa-eyebrow">Plan Appearance</p><h2 id="pa-title" class="pa-title">Slide look for this plan</h2></div>
        <button type="button" class="bc-btn-quiet" data-pa-close aria-label="Close">✕</button>
      </header>
      <div class="pa-body">
        <div class="pa-sticky">
          <div id="pa-preview"></div>
          <div class="pa-preview-tools">
            <div class="pa-pills" role="group" aria-label="Preview slide">
              <button type="button" class="bc-pill pa-pill" data-pa-sample="song" aria-pressed="true">Song</button>
              <button type="button" class="bc-pill pa-pill" data-pa-sample="prayer" aria-pressed="false">Prayer</button>
            </div>
            <button type="button" class="bc-pill pa-pill" data-pa-safe aria-pressed="true">Title Safe 90%</button>
          </div>
        </div>
        <div id="pa-controls"></div>
        ${canEdit ? '' : '<p class="pa-view-only">Your account can view the look but not change it.</p>'}
      </div>
      <footer class="pa-foot">
        <button type="button" class="bc-btn-quiet" data-pa="reset"${canEdit ? '' : ' disabled'}>Reset to Default</button>
        <button type="button" class="btn-primary" data-pa-apply${canEdit ? '' : ' disabled'}>Apply to All Slides</button>
      </footer>
    </div>`;
  const preview = dialog.querySelector('#pa-preview');
  const controls = dialog.querySelector('#pa-controls');

  function draw({ keepFocus = false } = {}) {
    const focused = keepFocus ? doc.activeElement?.id : '';
    preview.innerHTML = previewHtml(draft, { sample, safe });
    controls.innerHTML = controlsHtml(draft, { canEdit });
    for (const b of dialog.querySelectorAll('[data-pa-sample]')) b.setAttribute('aria-pressed', String(b.dataset.paSample === sample));
    dialog.querySelector('[data-pa-safe]').setAttribute('aria-pressed', String(safe));
    if (focused) controls.querySelector(`#${focused}`)?.focus();
  }
  const change = (action, value) => {
    if (!canEdit) return;
    draft = editAppearance(draft, action, value);
    draw();
  };

  dialog.addEventListener('click', (event) => {
    const el = event.target.closest('button');
    if (!el) return;
    if (el.hasAttribute('data-pa-close')) dialog.close();
    else if (el.hasAttribute('data-pa-apply')) {
      draft = applyToAll(draft);
      onApply(draft);
      dialog.close();
    } else if (el.dataset.paSample) {
      sample = el.dataset.paSample;
      draw();
    } else if (el.hasAttribute('data-pa-safe')) {
      safe = !safe;
      draw();
    } else if (el.dataset.pa) change(el.dataset.pa, el.dataset.value);
  });
  dialog.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset?.paSelect === 'font') change('font', el.value);
    else if (el.id === 'pa-shadow') change('shadow', el.checked);
    else if (el.id === 'pa-bg-hex' || el.id === 'pa-text-hex') {
      // A typed colour that is not a whole hex code is put back to what it was.
      if (normalizeHex(el.value)) change(el.id === 'pa-bg-hex' ? 'bg-color' : 'text-color', el.value);
      else draw();
    }
  });
  dialog.addEventListener('input', (event) => {
    if (event.target.id !== 'pa-dim') return;
    draft = editAppearance(draft, 'dim', Number(event.target.value) / 100);
    preview.innerHTML = previewHtml(draft, { sample, safe });
    const out = dialog.querySelector('#pa-dim-out');
    if (out) out.textContent = `${Math.round(draft.background.dimOpacity * 100)}%`;
  });
  dialog.addEventListener('close', () => dialog.remove());
  // A click on the backdrop (the dialog element itself, outside the panel) closes without applying.
  dialog.addEventListener('mousedown', (event) => {
    if (event.target === dialog) dialog.close();
  });

  draw();
  doc.body.append(dialog);
  dialog.showModal();
  return { close: () => dialog.close() };
}

/**
 * Wires a plan editor's Plan Appearance button. `get()` is the editor's current look, `set(next)` takes the applied one (the editor marks the
 * plan changed and redraws), `canEdit()` says whether the signed-in role may change it. Returns { refresh }.
 */
export function mountAppearanceButton(button, { get, set, canEdit = () => true }) {
  const refresh = () => renderAppearanceButton(button, get());
  button.addEventListener('click', () => openAppearanceDrawer({ appearance: get(), canEdit: canEdit(), onApply: (next) => set(next) }));
  refresh();
  return { refresh };
}

/**
 * The Create a plan card's compact section: a collapsible group of background, text colour, font and size. `onChange(appearance)` is called
 * with the sanitized look after each change. Returns { get, set, reset }.
 */
export function mountCompactAppearance(root, { onChange = () => {} } = {}) {
  let value = sanitizePlanAppearance(null);
  const status = () => root.querySelector('[data-pa-status]');
  function draw() {
    root.querySelector('[data-pa-compact-body]').innerHTML = controlsHtml(value, { compact: true });
    const s = status();
    if (s) s.textContent = appearanceSummary(value).label;
  }
  const change = (action, v) => {
    value = editAppearance(value, action, v);
    draw();
    onChange(value);
  };
  root.addEventListener('click', (event) => {
    const el = event.target.closest('button[data-pa]');
    if (el) change(el.dataset.pa, el.dataset.value);
    else if (event.target.closest('[data-pa-compact-reset]')) {
      value = sanitizePlanAppearance(null);
      draw();
      onChange(value);
    }
  });
  root.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset?.paSelect === 'font') change('font', el.value);
    else if (el.id === 'pa-bg-hex' || el.id === 'pa-text-hex') {
      if (normalizeHex(el.value)) change(el.id === 'pa-bg-hex' ? 'bg-color' : 'text-color', el.value);
      else draw();
    }
  });
  // Enter in a colour box keeps the colour and stays on the card; it must not make the plan.
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input')) {
      event.preventDefault();
      event.target.blur();
    }
  });
  draw();
  return {
    get: () => value,
    set(next) {
      value = sanitizePlanAppearance(next);
      draw();
    },
    reset() {
      value = sanitizePlanAppearance(null);
      draw();
    },
  };
}

/** The compact section's frame (a <details>), for the Create a plan card. Built from constants. */
export const compactSectionHtml = () => `
        <details class="np-appearance" id="np-appearance">
          <summary><span>Plan Appearance (All Slides)</span><span class="pa-badge" data-pa-status>${GLOBAL_LABEL}</span></summary>
          <div data-pa-compact-body></div>
          <button type="button" class="bc-btn-quiet" data-pa-compact-reset>Reset to Default</button>
        </details>`;

export { PLAN_WEIGHT_CSS };
