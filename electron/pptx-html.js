import path from 'node:path';
import JSZip from 'jszip';

/**
 * A built-in PowerPoint renderer, for computers that have neither PowerPoint (automation) nor LibreOffice. It reads the .pptx
 * itself: the theme, the slide master and layout, and each slide's shapes, pictures, tables and text, with PowerPoint's
 * inheritance rules (slide -> layout -> master -> theme). It writes one HTML page that draws every visible slide at a fixed
 * pixel width; electron/pptx-render.js photographs each one. This file has no Electron dependency, so it can be tested.
 */

const EMU_PT = 12700;
export const SLIDE_WIDTH_PX = 1920;

// ---------------------------------------------------------------- XML

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** A small XML reader. Element names lose their namespace prefix (`a:solidFill` -> `solidFill`); attribute names keep theirs. */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = token.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[3] !== undefined) {
      if (m[2]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      const node = { name: m[3].replace(/^.*:/, ''), attrs, kids: [], text: '' };
      top.kids.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  return root.kids[0] ?? root;
}

const kids = (n, name) => (n?.kids ? n.kids.filter((k) => k.name === name) : []);
const kid = (n, name) => (n?.kids ? n.kids.find((k) => k.name === name) : undefined);
const at = (n, name) => (n ? n.attrs[name] : undefined);
const num = (v, d = 0) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const path_ = (n, ...names) => names.reduce((cur, name) => kid(cur, name), n);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- colour

const PRESET_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080',
  orange: 'FFA500', purple: '800080', cyan: '00FFFF', magenta: 'FF00FF', lime: '00FF00', navy: '000080', teal: '008080', maroon: '800000',
  silver: 'C0C0C0', brown: 'A52A2A', pink: 'FFC0CB', gold: 'FFD700', darkBlue: '00008B', darkRed: '8B0000', darkGreen: '006400',
  lightGray: 'D3D3D3', darkGray: 'A9A9A9', ltGray: 'D3D3D3', dkGray: 'A9A9A9',
};

const hexRgb = (h) => ({ r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function fromHsl({ h, s, l }, a) {
  const f = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: f(p, q, h + 1 / 3) * 255, g: f(p, q, h) * 255, b: f(p, q, h - 1 / 3) * 255, a };
}

const COLOR_NAMES = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);
const colorChild = (n) => (n?.kids ? n.kids.find((k) => COLOR_NAMES.has(k.name)) : undefined);

/** The colour inside `parent` (a solidFill, a gradient stop, a ref...) as {r,g,b,a}, with its modifiers applied. Null when there is none. */
function resolveColor(parent, env) {
  const c = colorChild(parent);
  if (!c) return null;
  let col;
  const val = at(c, 'val');
  if (c.name === 'srgbClr') col = hexRgb(String(val).padEnd(6, '0'));
  else if (c.name === 'sysClr') col = hexRgb(at(c, 'lastClr') ?? (val === 'window' ? 'FFFFFF' : '000000'));
  else if (c.name === 'prstClr') col = hexRgb(PRESET_COLORS[val] ?? '000000');
  else if (c.name === 'scrgbClr') col = { r: num(at(c, 'r')) / 1000 * 2.55, g: num(at(c, 'g')) / 1000 * 2.55, b: num(at(c, 'b')) / 1000 * 2.55, a: 1 };
  else if (c.name === 'hslClr') col = fromHsl({ h: num(at(c, 'hue')) / 21600000, s: num(at(c, 'sat')) / 100000, l: num(at(c, 'lum')) / 100000 }, 1);
  else if (val === 'phClr') col = env.phClr ? { ...env.phClr } : hexRgb('000000');
  else {
    const mapped = env.clrMap[val] ?? val;
    col = hexRgb(env.theme.colors[mapped] ?? env.theme.colors[val] ?? '000000');
  }
  for (const mod of c.kids) {
    const v = num(at(mod, 'val')) / 100000;
    switch (mod.name) {
      case 'alpha': col.a = v; break;
      case 'alphaMod': col.a *= v; break;
      case 'alphaOff': col.a = clamp(col.a + v, 0, 1); break;
      case 'lumMod': { const h = toHsl(col); col = fromHsl({ ...h, l: clamp(h.l * v, 0, 1) }, col.a); break; }
      case 'lumOff': { const h = toHsl(col); col = fromHsl({ ...h, l: clamp(h.l + v, 0, 1) }, col.a); break; }
      case 'satMod': { const h = toHsl(col); col = fromHsl({ ...h, s: clamp(h.s * v, 0, 1) }, col.a); break; }
      case 'satOff': { const h = toHsl(col); col = fromHsl({ ...h, s: clamp(h.s + v, 0, 1) }, col.a); break; }
      case 'hueOff': { const h = toHsl(col); col = fromHsl({ ...h, h: (h.h + num(at(mod, 'val')) / 21600000 + 1) % 1 }, col.a); break; }
      case 'tint': col = { r: col.r + (255 - col.r) * (1 - v), g: col.g + (255 - col.g) * (1 - v), b: col.b + (255 - col.b) * (1 - v), a: col.a }; break;
      case 'shade': col = { r: col.r * v, g: col.g * v, b: col.b * v, a: col.a }; break;
      case 'gray': { const y = 0.3 * col.r + 0.59 * col.g + 0.11 * col.b; col = { r: y, g: y, b: y, a: col.a }; break; }
      case 'inv': col = { r: 255 - col.r, g: 255 - col.g, b: 255 - col.b, a: col.a }; break;
      default: break;
    }
  }
  return col;
}

const css = (c) => `rgba(${Math.round(clamp(c.r, 0, 255))},${Math.round(clamp(c.g, 0, 255))},${Math.round(clamp(c.b, 0, 255))},${r2(c.a)})`;
const solidCss = (c) => (c ? css(c) : 'transparent');

// ---------------------------------------------------------------- fills and lines

const FILL_NAMES = new Set(['solidFill', 'gradFill', 'blipFill', 'noFill', 'pattFill', 'grpFill']);
const fillChild = (n) => (n?.kids ? n.kids.find((k) => FILL_NAMES.has(k.name)) : undefined);

/** A fill node as a plain description: none, solid, grad, blip or patt. Returns undefined when the parent sets no fill. */
function parseFill(parent, env) {
  const f = fillChild(parent);
  if (!f) return undefined;
  if (f.name === 'noFill') return { type: 'none' };
  if (f.name === 'grpFill') return undefined;
  if (f.name === 'solidFill') return { type: 'solid', c: resolveColor(f, env) };
  if (f.name === 'pattFill') return { type: 'solid', c: resolveColor(kid(f, 'fgClr'), env), alphaMul: 0.5 };
  if (f.name === 'gradFill') {
    const stops = kids(kid(f, 'gsLst'), 'gs')
      .map((gs) => ({ pos: num(at(gs, 'pos')) / 100000, c: resolveColor(gs, env) }))
      .filter((s) => s.c);
    const lin = kid(f, 'lin');
    return { type: 'grad', stops, ang: num(at(lin, 'ang')) / 60000, path: at(kid(f, 'path'), 'path') ?? null };
  }
  const blip = kid(f, 'blip');
  const rid = at(blip, 'r:embed');
  return { type: 'blip', rid, env, alpha: num(at(kid(blip, 'alphaModFix'), 'amt'), 100000) / 100000, tile: Boolean(kid(f, 'tile')) };
}

function gradientStops(stops) {
  return stops.map((s) => `${css(s.c)} ${r2(s.pos * 100)}%`).join(',');
}

async function fillCss(fill, env) {
  if (!fill || fill.type === 'none') return 'transparent';
  if (fill.type === 'solid') return solidCss(fill.c);
  if (fill.type === 'grad') {
    if (fill.stops.length === 0) return 'transparent';
    if (fill.path) return `radial-gradient(circle at 50% 50%,${gradientStops(fill.stops)})`;
    return `linear-gradient(${r2(fill.ang + 90)}deg,${gradientStops(fill.stops)})`;
  }
  const url = fill.rid ? await env.media(fill.rid, fill.env.part) : null;
  return url ? `url('${url}') center/${fill.tile ? 'auto' : '100% 100%'}` : 'transparent';
}

/** A fill as an SVG paint. Gradients and pictures are added to `defs`. */
async function fillSvg(fill, env, defs) {
  if (!fill || fill.type === 'none') return { paint: 'none', opacity: 1 };
  if (fill.type === 'solid') return fill.c ? { paint: `rgb(${Math.round(fill.c.r)},${Math.round(fill.c.g)},${Math.round(fill.c.b)})`, opacity: fill.c.a * (fill.alphaMul ?? 1) } : { paint: 'none', opacity: 1 };
  const id = `f${env.uid()}`;
  if (fill.type === 'grad') {
    const stops = fill.stops.map((s) => `<stop offset="${r2(s.pos * 100)}%" stop-color="rgb(${Math.round(s.c.r)},${Math.round(s.c.g)},${Math.round(s.c.b)})" stop-opacity="${r2(s.c.a)}"/>`).join('');
    if (fill.path) defs.push(`<radialGradient id="${id}" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`);
    else {
      const rad = (fill.ang * Math.PI) / 180;
      const dx = Math.cos(rad) / 2, dy = Math.sin(rad) / 2;
      defs.push(`<linearGradient id="${id}" x1="${r2(0.5 - dx)}" y1="${r2(0.5 - dy)}" x2="${r2(0.5 + dx)}" y2="${r2(0.5 + dy)}">${stops}</linearGradient>`);
    }
    return { paint: `url(#${id})`, opacity: 1 };
  }
  const url = fill.rid ? await env.media(fill.rid, fill.env.part) : null;
  if (!url) return { paint: 'none', opacity: 1 };
  defs.push(`<pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${esc(url)}" width="1" height="1" preserveAspectRatio="none"/></pattern>`);
  return { paint: `url(#${id})`, opacity: fill.alpha };
}

/** A line (`a:ln`) as {w (px), fill, dash, cap, head, tail}. `base` is the theme line it starts from. */
function parseLn(ln, env, base) {
  const out = { w: base?.w ?? 0, fill: base?.fill, dash: base?.dash, head: base?.head, tail: base?.tail };
  if (!ln) return out;
  if (at(ln, 'w') !== undefined) out.w = num(at(ln, 'w')) * env.k;
  const fill = parseFill(ln, env);
  if (fill) out.fill = fill;
  const dash = at(kid(ln, 'prstDash'), 'val');
  if (dash) out.dash = dash;
  const head = kid(ln, 'headEnd'), tail = kid(ln, 'tailEnd');
  if (head && at(head, 'type') && at(head, 'type') !== 'none') out.head = at(head, 'type');
  if (tail && at(tail, 'type') && at(tail, 'type') !== 'none') out.tail = at(tail, 'type');
  return out;
}

const DASHES = { dash: '4 3', sysDash: '3 1', dot: '1 3', sysDot: '1 1', lgDash: '8 3', dashDot: '4 3 1 3', lgDashDot: '8 3 1 3', lgDashDotDot: '8 3 1 3 1 3', sysDashDot: '3 1 1 1', sysDashDotDot: '3 1 1 1 1 1' };

// ---------------------------------------------------------------- geometry

const poly = (pts) => `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' L')} Z`;

function roundedRect(w, h, tl, tr, br, bl) {
  return `M${r2(tl)} 0 H${r2(w - tr)} ${tr ? `A${r2(tr)} ${r2(tr)} 0 0 1 ${r2(w)} ${r2(tr)}` : ''} V${r2(h - br)} ${br ? `A${r2(br)} ${r2(br)} 0 0 1 ${r2(w - br)} ${r2(h)}` : ''} H${r2(bl)} ${bl ? `A${r2(bl)} ${r2(bl)} 0 0 1 0 ${r2(h - bl)}` : ''} V${r2(tl)} ${tl ? `A${r2(tl)} ${r2(tl)} 0 0 1 ${r2(tl)} 0` : ''} Z`;
}

const LINE_ONLY = new Set(['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5', 'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5', 'arc', 'leftBracket', 'rightBracket', 'leftBrace', 'rightBrace']);

/** The outline of a preset shape. Unknown presets are drawn as rectangles. */
function presetPath(prst, w, h, av) {
  const adj = (name, d) => (av[name] !== undefined ? av[name] : d) / 100000;
  const ss = Math.min(w, h);
  switch (prst) {
    case 'ellipse': case 'flowChartConnector': case 'cloud': case 'flowChartSummingJunction': case 'flowChartOr':
      return `M0 ${r2(h / 2)} A${r2(w / 2)} ${r2(h / 2)} 0 1 0 ${r2(w)} ${r2(h / 2)} A${r2(w / 2)} ${r2(h / 2)} 0 1 0 0 ${r2(h / 2)} Z`;
    case 'donut': {
      const t = ss * adj('adj', 25000);
      const ow = w / 2, oh = h / 2, iw = ow - t, ih = oh - t;
      return `M0 ${r2(oh)} A${r2(ow)} ${r2(oh)} 0 1 0 ${r2(w)} ${r2(oh)} A${r2(ow)} ${r2(oh)} 0 1 0 0 ${r2(oh)} Z M${r2(t)} ${r2(oh)} A${r2(iw)} ${r2(ih)} 0 1 1 ${r2(w - t)} ${r2(oh)} A${r2(iw)} ${r2(ih)} 0 1 1 ${r2(t)} ${r2(oh)} Z`;
    }
    case 'roundRect': case 'wedgeRoundRectCallout': case 'flowChartAlternateProcess': {
      const r = ss * Math.min(adj('adj', 16667), 0.5);
      return roundedRect(w, h, r, r, r, r);
    }
    case 'flowChartTerminator': return roundedRect(w, h, h / 2, h / 2, h / 2, h / 2);
    case 'round2SameRect': {
      const a = ss * Math.min(adj('adj1', 16667), 0.5), b = ss * Math.min(adj('adj2', 0), 0.5);
      return roundedRect(w, h, a, a, b, b);
    }
    case 'round1Rect': { const r = ss * Math.min(adj('adj', 16667), 0.5); return roundedRect(w, h, 0, r, 0, 0); }
    case 'triangle': return poly([[w * adj('adj', 50000), 0], [w, h], [0, h]]);
    case 'rtTriangle': return poly([[0, 0], [0, h], [w, h]]);
    case 'diamond': case 'flowChartDecision': return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram': { const x = ss * adj('adj', 25000); return poly([[x, 0], [w, 0], [w - x, h], [0, h]]); }
    case 'trapezoid': { const x = ss * adj('adj', 25000); return poly([[0, h], [x, 0], [w - x, 0], [w, h]]); }
    case 'hexagon': { const x = ss * adj('adj', 25000); return poly([[0, h / 2], [x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h]]); }
    case 'octagon': { const x = ss * adj('adj', 29289); return poly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]); }
    case 'homePlate': { const x = w - ss * adj('adj', 50000); return poly([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]]); }
    case 'chevron': { const x = ss * adj('adj', 50000); return poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]); }
    case 'rightArrow': case 'leftArrow': {
      const sh = (h * adj('adj1', 50000)) / 2, hl = ss * adj('adj2', 50000), mid = h / 2;
      const pts = [[0, mid - sh], [w - hl, mid - sh], [w - hl, 0], [w, mid], [w - hl, h], [w - hl, mid + sh], [0, mid + sh]];
      return poly(prst === 'rightArrow' ? pts : pts.map(([x, y]) => [w - x, y]));
    }
    case 'upArrow': case 'downArrow': {
      const sh = (w * adj('adj1', 50000)) / 2, hl = ss * adj('adj2', 50000), mid = w / 2;
      const pts = [[mid - sh, h], [mid - sh, hl], [0, hl], [mid, 0], [w, hl], [mid + sh, hl], [mid + sh, h]];
      return poly(prst === 'upArrow' ? pts : pts.map(([x, y]) => [x, h - y]));
    }
    case 'plus': { const x = ss * adj('adj', 25000); return poly([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]]); }
    case 'star5': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 === 0 ? 1 : 0.382;
        pts.push([w / 2 + (w / 2) * rad * Math.cos(a), h / 2 + (h / 2) * rad * Math.sin(a)]);
      }
      return poly(pts);
    }
    case 'line': case 'straightConnector1': return `M0 0 L${r2(w)} ${r2(h)}`;
    case 'bentConnector2': return `M0 0 H${r2(w)} V${r2(h)}`;
    case 'bentConnector3': return `M0 0 H${r2(w * adj('adj1', 50000))} V${r2(h)} H${r2(w)}`;
    case 'curvedConnector3': return `M0 0 C${r2(w / 2)} 0 ${r2(w / 2)} ${r2(h)} ${r2(w)} ${r2(h)}`;
    default: return `M0 0 H${r2(w)} V${r2(h)} H0 Z`;
  }
}

/** A custom shape (`custGeom`) as one SVG path in the shape's own pixels. */
function customPath(geom, w, h) {
  const out = [];
  for (const p of kids(kid(geom, 'pathLst'), 'path')) {
    const pw = num(at(p, 'w'), w) || w, ph = num(at(p, 'h'), h) || h;
    const sx = w / pw, sy = h / ph;
    const pt = (n) => [num(at(n, 'x')) * sx, num(at(n, 'y')) * sy];
    let cx = 0, cy = 0;
    let d = '';
    for (const cmd of p.kids) {
      const pts = kids(cmd, 'pt').map(pt);
      if (cmd.name === 'moveTo') { [cx, cy] = pts[0]; d += `M${r2(cx)} ${r2(cy)} `; }
      else if (cmd.name === 'lnTo') { [cx, cy] = pts[0]; d += `L${r2(cx)} ${r2(cy)} `; }
      else if (cmd.name === 'cubicBezTo') { d += `C${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' ')} `; [cx, cy] = pts[2]; }
      else if (cmd.name === 'quadBezTo') { d += `Q${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' ')} `; [cx, cy] = pts[1]; }
      else if (cmd.name === 'arcTo') {
        const wr = num(at(cmd, 'wR')) * sx, hr = num(at(cmd, 'hR')) * sy;
        const st = (num(at(cmd, 'stAng')) / 60000) * (Math.PI / 180), sw = (num(at(cmd, 'swAng')) / 60000) * (Math.PI / 180);
        const ox = cx - wr * Math.cos(st), oy = cy - hr * Math.sin(st);
        const ex = ox + wr * Math.cos(st + sw), ey = oy + hr * Math.sin(st + sw);
        d += `A${r2(wr)} ${r2(hr)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${r2(ex)} ${r2(ey)} `;
        cx = ex; cy = ey;
      } else if (cmd.name === 'close') d += 'Z ';
    }
    out.push({ d: d.trim(), fill: at(p, 'fill') !== 'none', stroke: at(p, 'stroke') !== '0' && at(p, 'stroke') !== 'false' });
  }
  return out;
}

// ---------------------------------------------------------------- text

const WINGDINGS = { '§': '▪', 'Ø': '➢', 'v': '❖', 'ü': '✓', 'l': '●', 'n': '■', 'q': '❑', 'ß': '➔', 'è': '➔', 'û': '✗', 'á': '◆', '¡': '❍' };
const SYMBOL = { '·': '•', 'o': 'o', '§': '▪', '-': '–' };

function romanOf(n) {
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

function autoNumber(type, n) {
  const style = String(type).replace(/(Period|ParenR|ParenBoth|Plain|Dash)$/, '');
  const suffix = /Period$/.test(type) ? '.' : /ParenR$/.test(type) ? ')' : '';
  const prefix = /ParenBoth$/.test(type) ? '(' : '';
  const close = /ParenBoth$/.test(type) ? ')' : suffix;
  let body;
  if (style === 'alphaLc') body = String.fromCharCode(96 + ((n - 1) % 26) + 1);
  else if (style === 'alphaUc') body = String.fromCharCode(64 + ((n - 1) % 26) + 1);
  else if (style === 'romanLc') body = romanOf(n);
  else if (style === 'romanUc') body = romanOf(n).toUpperCase();
  else body = String(n);
  return `${prefix}${body}${close}`;
}

/** Merges `a:lvlNpPr` / `a:pPr` into `out`: attributes, spacing, bullet, and the run defaults (`defRPr`). */
function mergePPr(out, pPr) {
  for (const a of ['marL', 'indent', 'algn']) if (at(pPr, a) !== undefined) out[a] = at(pPr, a);
  for (const k of pPr.kids) {
    if (k.name === 'lnSpc' || k.name === 'spcBef' || k.name === 'spcAft') out[k.name] = k;
    else if (k.name === 'buNone') out.bullet = { none: true };
    else if (k.name === 'buChar') out.bullet = { char: at(k, 'char') };
    else if (k.name === 'buAutoNum') out.bullet = { auto: at(k, 'type'), startAt: num(at(k, 'startAt'), 1) };
    else if (k.name === 'buFont') out.buFont = at(k, 'typeface');
    else if (k.name === 'buClr') out.buClr = k;
    else if (k.name === 'buSzPct') out.buSz = num(at(k, 'val')) / 100000;
    else if (k.name === 'defRPr') out.rprs.push(k);
  }
}

function mergeRPr(list) {
  const out = {};
  for (const r of list) {
    if (r.name === undefined) { Object.assign(out, r); continue; }
    for (const a of ['sz', 'b', 'i', 'u', 'strike', 'baseline', 'cap', 'spc']) if (at(r, a) !== undefined) out[a] = at(r, a);
    const fill = fillChild(r);
    if (fill) out.fillNode = r;
    const latin = kid(r, 'latin');
    if (latin && at(latin, 'typeface')) out.font = at(latin, 'typeface');
    if (kid(r, 'hlinkClick')) out.link = true;
  }
  return out;
}

function fontFamily(face, env) {
  let name = face;
  if (name === '+mj-lt' || name === '+mj-ea') name = env.theme.major;
  else if (name === '+mn-lt' || name === '+mn-ea') name = env.theme.minor;
  if (!name) return '';
  return `'${String(name).replace(/['"]/g, '')}',`;
}

/**
 * The paragraphs of a text body as HTML. `chain` lists the list-style nodes from most to least specific. Sizes are in slide pixels,
 * multiplied by the page's `--k` so a box that overflows can be shrunk to fit.
 */
function renderParagraphs(txBody, env, opts) {
  const { chain, baseRpr = [], defaultColor, fontScale = 1, lnReduce = 0 } = opts;
  const paras = kids(txBody, 'p');
  const counters = {};
  let html = '';
  paras.forEach((p, pi) => {
    const pPr = kid(p, 'pPr');
    const lvl = clamp(num(at(pPr, 'lvl')), 0, 8);
    const props = { rprs: [] };
    for (const src of [...chain].reverse()) {
      const l = kid(src, `lvl${lvl + 1}pPr`);
      if (l) mergePPr(props, l);
    }
    if (pPr) mergePPr(props, pPr);
    const runs = p.kids.filter((k) => k.name === 'r' || k.name === 'br' || k.name === 'fld');
    const end = kid(p, 'endParaRPr');
    const textOf = (n) => (kid(n, 't')?.text ?? '');
    const allText = runs.map((r) => (r.name === 'br' ? '' : textOf(r))).join('');

    const baseList = [...baseRpr, ...props.rprs];
    const sizeOf = (rp) => (num(rp.sz, 1800) / 100) * EMU_PT * env.k * fontScale;
    const paraRpr = mergeRPr(baseList);
    const lead = mergeRPr([...baseList, ...(end ? [end] : [])]);
    const leadPx = sizeOf(lead);

    const lnSpcNode = props.lnSpc;
    let lineHeight = 1.2;
    if (lnSpcNode) {
      const pct = kid(lnSpcNode, 'spcPct'), pts = kid(lnSpcNode, 'spcPts');
      if (pct) lineHeight = (num(at(pct, 'val')) / 100000) * 1.2;
      else if (pts) lineHeight = `${r2((num(at(pts, 'val')) / 100) * EMU_PT * env.k)}px`;
    }
    if (typeof lineHeight === 'number') lineHeight = r2(Math.max(0.6, lineHeight - lnReduce));
    const spaceOf = (node) => {
      if (!node) return 0;
      const pct = kid(node, 'spcPct'), pts = kid(node, 'spcPts');
      if (pts) return (num(at(pts, 'val')) / 100) * EMU_PT * env.k;
      if (pct) return (num(at(pct, 'val')) / 100000) * leadPx * 1.2;
      return 0;
    };
    const before = pi === 0 ? 0 : spaceOf(props.spcBef), after = spaceOf(props.spcAft);

    const marL = num(props.marL) * env.k, indent = num(props.indent) * env.k;
    const algn = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[props.algn] ?? 'left';

    // The bullet. A paragraph with no text has none.
    let bulletHtml = '';
    const bullet = props.bullet;
    if (bullet && !bullet.none && allText.length > 0) {
      let glyph = '';
      if (bullet.char) glyph = props.buFont && /wingdings/i.test(props.buFont) ? WINGDINGS[bullet.char] ?? '•' : props.buFont && /symbol/i.test(props.buFont) ? SYMBOL[bullet.char] ?? bullet.char : bullet.char;
      else if (bullet.auto) {
        const key = `${lvl}`;
        for (const k of Object.keys(counters)) if (Number(k) > lvl) delete counters[k];
        counters[key] = counters[key] === undefined ? bullet.startAt : counters[key] + 1;
        glyph = autoNumber(bullet.auto, counters[key]);
      }
      const color = props.buClr ? resolveColor(props.buClr, env) : null;
      const textColor = color ?? (paraRpr.fillNode ? resolveColor(fillChild(paraRpr.fillNode), env) : defaultColor);
      const width = indent < 0 ? `width:${r2(-indent)}px;` : 'padding-right:0.4em;';
      bulletHtml = `<span style="display:inline-block;${width}text-indent:0;color:${solidCss(textColor)};${props.buSz ? `font-size:${r2(props.buSz * 100)}%;` : ''}white-space:pre">${esc(glyph)}</span>`;
    } else if (allText.length === 0 || (bullet && bullet.none)) {
      bulletHtml = '';
    }
    if (!(bullet && !bullet.none && allText.length > 0) && indent < 0 && marL + indent < 0) {
      // A negative indent with no bullet would start left of the box.
    }

    let inner = '';
    for (const r of runs) {
      if (r.name === 'br') { inner += '<br>'; continue; }
      const rp = mergeRPr([...baseList, ...(kid(r, 'rPr') ? [kid(r, 'rPr')] : [])]);
      let text = textOf(r);
      if (r.name === 'fld' && at(r, 'type') === 'slidenum') text = String(env.slideNo);
      if (text === '') continue;
      const style = [];
      style.push(`font-size:calc(${r2(sizeOf(rp))}px * var(--k))`);
      const fam = fontFamily(rp.font ?? '+mn-lt', env);
      if (fam) style.push(`font-family:${fam}'Segoe UI',Arial,sans-serif`);
      if (rp.b === '1' || rp.b === 'true') style.push('font-weight:700');
      if (rp.i === '1' || rp.i === 'true') style.push('font-style:italic');
      const deco = [];
      if (rp.u && rp.u !== 'none') deco.push('underline');
      if (rp.strike && rp.strike !== 'noStrike') deco.push('line-through');
      if (rp.link && !deco.includes('underline')) deco.push('underline');
      if (deco.length) style.push(`text-decoration:${deco.join(' ')}`);
      if (rp.cap === 'all') style.push('text-transform:uppercase');
      else if (rp.cap === 'small') style.push('font-variant:small-caps');
      if (rp.spc) style.push(`letter-spacing:${r2((num(rp.spc) / 100) * EMU_PT * env.k)}px`);
      if (rp.baseline && num(rp.baseline) !== 0) style.push(`vertical-align:${num(rp.baseline) > 0 ? 'super' : 'sub'};font-size:calc(${r2(sizeOf(rp) * 0.65)}px * var(--k))`);
      const col = rp.link ? resolveColor({ kids: [{ name: 'schemeClr', attrs: { val: 'hlink' }, kids: [] }] }, env) : rp.fillNode ? resolveColor(fillChild(rp.fillNode), env) : null;
      style.push(`color:${solidCss(col ?? defaultColor)}`);
      const hl = kid(rp.fillNode ?? {}, 'highlight');
      if (hl) style.push(`background:${solidCss(resolveColor(hl, env))}`);
      inner += `<span style="${style.join(';')}">${esc(text).replace(/\t/g, '&emsp;')}</span>`;
    }
    if (allText.length === 0 && !runs.some((r) => r.name === 'br')) inner = `<span style="font-size:calc(${r2(leadPx)}px * var(--k))">&#8203;</span>`;

    const wrap = opts.noWrap ? 'white-space:pre;' : 'white-space:pre-wrap;overflow-wrap:break-word;';
    html += `<div style="${wrap}margin:${r2(before)}px 0 ${r2(after)}px 0;padding-left:${r2(Math.max(0, marL))}px;text-indent:${r2(indent)}px;text-align:${algn};line-height:${lineHeight}">${bulletHtml}${inner}</div>`;
  });
  return html;
}

// ---------------------------------------------------------------- deck loading

const REL_TYPE = (t) => t.replace(/^.*\//, '');

async function readRels(zip, partPath) {
  const dir = path.posix.dirname(partPath);
  const relsFile = zip.file(`${dir}/_rels/${path.posix.basename(partPath)}.rels`);
  const map = {};
  if (!relsFile) return map;
  const root = parseXml(await relsFile.async('string'));
  for (const r of kids(root, 'Relationship')) {
    if (at(r, 'TargetMode') === 'External') continue;
    const target = at(r, 'Target');
    map[at(r, 'Id')] = { type: REL_TYPE(at(r, 'Type')), target: target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(dir, target)) };
  }
  return map;
}

async function readXml(zip, name) {
  const f = zip.file(name);
  return f ? parseXml(await f.async('string')) : null;
}

function parseTheme(root) {
  const colors = {};
  const scheme = path_(root, 'themeElements', 'clrScheme');
  for (const c of scheme?.kids ?? []) {
    const inner = c.kids[0];
    if (inner) colors[c.name] = at(inner, 'lastClr') ?? at(inner, 'val') ?? '000000';
  }
  const fonts = path_(root, 'themeElements', 'fontScheme');
  const fmt = path_(root, 'themeElements', 'fmtScheme');
  return {
    colors,
    major: at(path_(fonts, 'majorFont', 'latin'), 'typeface') ?? 'Calibri Light',
    minor: at(path_(fonts, 'minorFont', 'latin'), 'typeface') ?? 'Calibri',
    fills: kid(fmt, 'fillStyleLst')?.kids ?? [],
    lines: kid(fmt, 'lnStyleLst')?.kids ?? [],
    bgFills: kid(fmt, 'bgFillStyleLst')?.kids ?? [],
  };
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };

/** Order of the slides as the presentation lists them, with each slide's part path. Hidden slides are flagged. */
export async function slideParts(zip) {
  const pres = await readXml(zip, 'ppt/presentation.xml');
  const rels = await readRels(zip, 'ppt/presentation.xml');
  const ids = kids(kid(pres, 'sldIdLst'), 'sldId');
  const parts = ids.map((s) => rels[at(s, 'r:id')]?.target).filter(Boolean);
  if (parts.length > 0) return parts;
  // No usable list: fall back to the file names, in number order.
  return Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
}

/**
 * Builds the page for a deck. `media(zipPath)` receives a media file's path in the package and returns a URL the page can load.
 * Resolves to { html, slideWidth, slideHeight, count }, where `count` is the number of visible slides, in slide order.
 */
export async function buildDeckHtml(source, { media }) {
  const zip = source instanceof JSZip ? source : await JSZip.loadAsync(source);
  const pres = await readXml(zip, 'ppt/presentation.xml');
  if (!pres) throw new Error('This is not a PowerPoint (.pptx) file.');
  const sz = kid(pres, 'sldSz');
  const slideW = num(at(sz, 'cx'), 12192000), slideH = num(at(sz, 'cy'), 6858000);
  const k = SLIDE_WIDTH_PX / slideW; // pixels per EMU
  const pageH = Math.round(slideH * k);
  const parts = await slideParts(zip);
  if (parts.length === 0) throw new Error('This PowerPoint file has no slides.');

  const presRels = await readRels(zip, 'ppt/presentation.xml');
  const defaultTextStyle = kid(pres, 'defaultTextStyle');
  const tableStyles = await readXml(zip, 'ppt/tableStyles.xml');

  const cache = new Map();
  const loadPart = async (name) => {
    if (!cache.has(name)) cache.set(name, readXml(zip, name));
    return cache.get(name);
  };
  const mediaCache = new Map();
  let seq = 0;
  const uid = () => (seq += 1);

  const themeCache = new Map();
  const themeFor = async (masterName) => {
    if (!themeCache.has(masterName)) {
      const rels = await readRels(zip, masterName);
      const t = Object.values(rels).find((r) => r.type === 'theme');
      themeCache.set(masterName, t ? parseTheme(await loadPart(t.target)) : parseTheme(null));
    }
    return themeCache.get(masterName);
  };

  async function build() {
  const slides = [];
  let visibleNo = 0;
  for (let si = 0; si < parts.length; si++) {
    const slideName = parts[si];
    const slide = await loadPart(slideName);
    if (!slide) continue;
    if (at(slide, 'show') === '0') continue;
    visibleNo += 1;
    const slideRels = await readRels(zip, slideName);
    const layoutName = Object.values(slideRels).find((r) => r.type === 'slideLayout')?.target;
    const layout = layoutName ? await loadPart(layoutName) : null;
    const layoutRels = layoutName ? await readRels(zip, layoutName) : {};
    const masterName = Object.values(layoutRels).find((r) => r.type === 'slideMaster')?.target ?? Object.values(presRels).find((r) => r.type === 'slideMaster')?.target;
    const master = masterName ? await loadPart(masterName) : null;
    const theme = await themeFor(masterName ?? 'none');

    const baseClr = {};
    for (const [key, val] of Object.entries(master ? kid(master, 'clrMap')?.attrs ?? {} : {})) baseClr[key] = val;
    const override = (n) => kid(kid(n, 'clrMapOvr'), 'overrideClrMapping')?.attrs;
    const clrMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', ...baseClr, ...(override(layout) ?? {}), ...(override(slide) ?? {}) };

    const mediaFor = async (rid, partName) => {
      const rels = partName === slideName ? slideRels : partName === layoutName ? layoutRels : await readRels(zip, partName);
      const target = rels[rid]?.target;
      if (!target) return null;
      return mediaUrl(target);
    };
    const mediaUrl = async (target) => {
      if (!mediaCache.has(target)) {
        const ext = path.posix.extname(target).slice(1).toLowerCase();
        // The URL goes inside quoted style attributes, so a quote in it is escaped.
        mediaCache.set(target, MIME[ext] && zip.file(target) ? Promise.resolve(media(target)).then((u) => (u ? String(u).replace(/['"]/g, (c) => (c === "'" ? '%27' : '%22')) : u)) : Promise.resolve(null));
      }
      return mediaCache.get(target);
    };
    const env = { theme, clrMap, k, uid, slideNo: visibleNo, media: mediaFor, mediaUrl, phClr: null, part: slideName };

    // Layout and master shapes sit under the slide's own. Placeholders there are templates, not content, so they are not drawn.
    const showMaster = at(slide, 'showMasterSp') !== '0';
    const showMasterOfLayout = at(layout, 'showMasterSp') !== '0';
    const out = [];
    const ctxFor = (partName, root) => ({ ...env, part: partName, root });
    if (showMaster && showMasterOfLayout && master) out.push(await renderTree(path_(master, 'cSld', 'spTree'), ctxFor(masterName, master), { skipPlaceholders: true, layout, master }));
    if (showMaster && layout) out.push(await renderTree(path_(layout, 'cSld', 'spTree'), ctxFor(layoutName, layout), { skipPlaceholders: true, layout, master }));
    out.push(await renderTree(path_(slide, 'cSld', 'spTree'), ctxFor(slideName, slide), { layout, master }));

    // The background: the slide's own, else the layout's, else the master's.
    let bg = 'rgb(255,255,255)';
    for (const [node, partName] of [[slide, slideName], [layout, layoutName], [master, masterName]]) {
      const bgNode = path_(node, 'cSld', 'bg');
      if (!bgNode) continue;
      const benv = { ...env, part: partName };
      const props = kid(bgNode, 'bgPr');
      if (props) {
        bg = await fillCss(parseFill(props, benv), benv);
      } else {
        const ref = kid(bgNode, 'bgRef');
        const idx = num(at(ref, 'idx'));
        const style = theme.bgFills[idx - 1001] ?? theme.fills[idx - 1];
        const phClr = resolveColor(ref, benv);
        const fenv = { ...benv, phClr };
        bg = style ? await fillCss(parseFill({ kids: [style] }, fenv), fenv) : solidCss(phClr);
      }
      break;
    }
    slides.push(`<div class="slide" id="s${visibleNo}" style="width:${SLIDE_WIDTH_PX}px;height:${pageH}px;background:${bg}">${out.join('')}</div>`);
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff;overflow:hidden}
@page{size:${SLIDE_WIDTH_PX}px ${pageH}px;margin:0}
.slide{position:relative;overflow:hidden;display:block;break-after:page;page-break-after:always;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.slide:last-of-type{break-after:auto;page-break-after:auto}
.slide *{box-sizing:border-box}
.el{position:absolute}
.tx{position:absolute;display:flex;flex-direction:column;overflow:visible}
.txi{width:100%}
</style></head><body>${slides.join('')}<script>
function loadImages(){var urls={};document.querySelectorAll('[style*="url("]').forEach(function(e){(e.getAttribute('style').match(/url[(]'[^']+'[)]/g)||[]).forEach(function(x){urls[x.slice(5,-2)]=1})});document.querySelectorAll('image').forEach(function(e){var h=e.getAttribute('href');if(h)urls[h]=1});return Promise.all(Object.keys(urls).map(function(u){return new Promise(function(r){var i=new Image();i.onload=i.onerror=function(){r()};i.src=u})}))}
function fitAll(){document.querySelectorAll('.slide').forEach(fitText);return true;}
function fitText(root){root.querySelectorAll('[data-fit]').forEach(function(box){var inner=box.firstElementChild;if(!inner)return;var avail=box.clientHeight-parseFloat(box.dataset.pad||0);var k=parseFloat(box.dataset.k||1);box.style.setProperty('--k',k);if(box.dataset.fit==='fixed')return;for(var n=0;n<24&&inner.offsetHeight>avail+1&&k>0.3;n++){k*=0.94;box.style.setProperty('--k',k);}});}
</script></body></html>`;
  return { html, slideWidth: SLIDE_WIDTH_PX, slideHeight: pageH, count: slides.length };
  }

  // ------------------------------------------------------------ shapes

  async function renderTree(tree, env, ctx) {
    if (!tree) return '';
    const frame = { offX: 0, offY: 0, sx: env.k, sy: env.k };
    return renderChildren(tree, env, ctx, frame);
  }

  async function renderChildren(parent, env, ctx, frame) {
    let html = '';
    for (const child of expandAlternates(parent.kids)) {
      if (child.name === 'sp' || child.name === 'cxnSp') html += await renderSp(child, env, ctx, frame);
      else if (child.name === 'pic') html += await renderPic(child, env, ctx, frame);
      else if (child.name === 'grpSp') html += await renderGroup(child, env, ctx, frame);
      else if (child.name === 'graphicFrame') html += await renderFrame(child, env, ctx, frame);
    }
    return html;
  }

  /** `mc:AlternateContent` holds a rich choice and a plain fallback. The fallback is drawn when there is one. */
  function expandAlternates(list) {
    const out = [];
    for (const n of list) {
      if (n.name === 'AlternateContent') {
        const pick = kid(n, 'Fallback') ?? kid(n, 'Choice');
        if (pick) out.push(...expandAlternates(pick.kids));
      } else out.push(n);
    }
    return out;
  }

  const xfrmOf = (n) => {
    const x = n ? kid(n, 'xfrm') : null;
    if (!x) return null;
    const off = kid(x, 'off'), ext = kid(x, 'ext');
    return {
      x: num(at(off, 'x')), y: num(at(off, 'y')), w: num(at(ext, 'cx')), h: num(at(ext, 'cy')),
      rot: num(at(x, 'rot')) / 60000, flipH: at(x, 'flipH') === '1' || at(x, 'flipH') === 'true', flipV: at(x, 'flipV') === '1' || at(x, 'flipV') === 'true',
      chOff: kid(x, 'chOff') ? { x: num(at(kid(x, 'chOff'), 'x')), y: num(at(kid(x, 'chOff'), 'y')) } : null,
      chExt: kid(x, 'chExt') ? { w: num(at(kid(x, 'chExt'), 'cx')), h: num(at(kid(x, 'chExt'), 'cy')) } : null,
    };
  };

  const boxStyle = (xf, frame) => {
    const left = (xf.x - frame.offX) * frame.sx, top = (xf.y - frame.offY) * frame.sy, w = xf.w * frame.sx, h = xf.h * frame.sy;
    return { left, top, w, h, css: `left:${r2(left)}px;top:${r2(top)}px;width:${r2(w)}px;height:${r2(h)}px;${xf.rot ? `transform:rotate(${r2(xf.rot)}deg);` : ''}` };
  };

  const phOf = (sp) => kid(path_(sp, 'nvSpPr', 'nvPr') ?? path_(sp, 'nvPicPr', 'nvPr') ?? path_(sp, 'nvGraphicFramePr', 'nvPr'), 'ph');

  const PH_ALIAS = { ctrTitle: 'title', subTitle: 'body', obj: 'body', tbl: 'body', chart: 'body', dgm: 'body', media: 'body', pic: 'body', clipArt: 'body' };
  const phKey = (ph) => PH_ALIAS[at(ph, 'type')] ?? at(ph, 'type') ?? 'body';

  /** The matching placeholder shape on a layout (by index, then by kind) or a master (by kind). */
  function findPlaceholder(root, ph, byIdx) {
    const tree = path_(root, 'cSld', 'spTree');
    if (!tree || !ph) return null;
    const shapes = expandAlternates(tree.kids).filter((n) => n.name === 'sp' || n.name === 'pic');
    const cands = shapes.filter((s) => phOf(s));
    const idx = at(ph, 'idx');
    if (byIdx && idx !== undefined) {
      const hit = cands.find((s) => at(phOf(s), 'idx') === idx);
      if (hit) return hit;
    }
    return cands.find((s) => phKey(phOf(s)) === phKey(ph)) ?? null;
  }

  const styleRefs = (sp, env) => {
    const style = kid(sp, 'style');
    if (!style) return {};
    const ln = kid(style, 'lnRef'), fillRef = kid(style, 'fillRef'), font = kid(style, 'fontRef');
    const out = {};
    if (ln && num(at(ln, 'idx')) > 0) {
      const phClr = resolveColor(ln, env);
      const lenv = { ...env, phClr };
      out.ln = parseLn(env.theme.lines[num(at(ln, 'idx')) - 1], lenv);
      if (!out.ln.fill) out.ln.fill = { type: 'solid', c: phClr };
    }
    if (fillRef && num(at(fillRef, 'idx')) > 0) {
      const phClr = resolveColor(fillRef, env);
      const fenv = { ...env, phClr };
      const f = env.theme.fills[num(at(fillRef, 'idx')) - 1];
      out.fill = f ? parseFill({ kids: [f] }, fenv) : { type: 'solid', c: phClr };
    }
    if (font) out.fontColor = resolveColor(font, env);
    return out;
  };

  async function renderSp(sp, env, ctx, frame) {
    const nv = path_(sp, 'nvSpPr');
    if (at(kid(nv, 'cNvPr'), 'hidden') === '1') return '';
    const ph = phOf(sp);
    if (ph && ctx.skipPlaceholders) return '';
    const chainSp = [sp];
    if (ph) {
      const l = findPlaceholder(ctx.layout, ph, true);
      if (l) chainSp.push(l);
      const m = findPlaceholder(ctx.master, ph, false);
      if (m) chainSp.push(m);
    }
    const spPrs = chainSp.map((s) => kid(s, 'spPr'));
    const xf = spPrs.map(xfrmOf).find(Boolean);
    if (!xf) return '';
    const box = boxStyle(xf, frame);
    const refs = styleRefs(sp, env);

    // Outline and fill: the shape's own, then the layout's, then the master's, then the theme style it refers to.
    const fill = spPrs.map((p) => parseFill(p, env)).find(Boolean) ?? refs.fill;
    let ln = refs.ln;
    for (const p of [...spPrs].reverse()) {
      const l = kid(p, 'ln');
      if (l) ln = parseLn(l, env, ln);
    }
    const geom = spPrs.map((p) => kid(p, 'prstGeom') ?? kid(p, 'custGeom')).find(Boolean);
    const prst = geom?.name === 'prstGeom' ? at(geom, 'prst') : geom ? 'custom' : 'rect';

    const w = box.w, h = box.h;
    let svg = '';
    const hasGeom = ph ? Boolean(spPrs.map((p) => kid(p, 'prstGeom') ?? kid(p, 'custGeom')).find(Boolean)) : true;
    const visibleFill = fill && fill.type !== 'none';
    const visibleLn = ln && ln.fill && ln.fill.type !== 'none' && ln.w > 0;
    if ((visibleFill || visibleLn) && hasGeom) {
      const defs = [];
      const paint = await fillSvg(LINE_ONLY.has(prst) ? { type: 'none' } : fill, env, defs);
      const stroke = visibleLn ? await fillSvg(ln.fill, env, defs) : { paint: 'none', opacity: 1 };
      let strokeAttrs = visibleLn ? `stroke="${stroke.paint}" stroke-opacity="${r2(stroke.opacity)}" stroke-width="${r2(ln.w)}" stroke-linejoin="round"` : '';
      if (visibleLn && ln.dash && DASHES[ln.dash]) strokeAttrs += ` stroke-dasharray="${DASHES[ln.dash].split(' ').map((d) => r2(Number(d) * ln.w)).join(' ')}"`;
      if (visibleLn && ln.head) { const id = `m${uid()}`; defs.push(`<marker id="${id}" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0 L6 3 L0 6 Z" fill="${stroke.paint}"/></marker>`); strokeAttrs += ` marker-start="url(#${id})"`; }
      if (visibleLn && ln.tail) { const id = `m${uid()}`; defs.push(`<marker id="${id}" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L6 3 L0 6 Z" fill="${stroke.paint}"/></marker>`); strokeAttrs += ` marker-end="url(#${id})"`; }
      const av = {};
      for (const gd of kids(kid(geom, 'avLst'), 'gd')) av[at(gd, 'name')] = num(/val\s+(-?\d+)/.exec(at(gd, 'fmla') ?? '')?.[1]);
      const paths = prst === 'custom' ? customPath(geom, w, h) : [{ d: presetPath(prst, w, h, av), fill: !LINE_ONLY.has(prst), stroke: true }];
      const flip = `${xf.flipH ? 'scaleX(-1) ' : ''}${xf.flipV ? 'scaleY(-1)' : ''}`.trim();
      const shadow = kid(kid(spPrs[0], 'effectLst'), 'outerShdw');
      let filter = '';
      if (shadow) {
        const sc = resolveColor(shadow, env) ?? { r: 0, g: 0, b: 0, a: 0.4 };
        const dist = num(at(shadow, 'dist')) * env.k, dir = (num(at(shadow, 'dir')) / 60000) * (Math.PI / 180);
        filter = `filter:drop-shadow(${r2(dist * Math.cos(dir))}px ${r2(dist * Math.sin(dir))}px ${r2(num(at(shadow, 'blurRad')) * env.k / 2)}px ${css(sc)});`;
      }
      const body = paths.map((p) => `<path d="${p.d}" fill="${p.fill ? paint.paint : 'none'}" fill-opacity="${r2(paint.opacity)}" fill-rule="evenodd" ${p.stroke ? strokeAttrs : ''}/>`).join('');
      const sw = Math.max(1, r2(w)), sh = Math.max(1, r2(h));
      svg = `<svg width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}" style="position:absolute;left:0;top:0;overflow:visible;${flip ? `transform:${flip};` : ''}${filter}"><defs>${defs.join('')}</defs>${body}</svg>`;
    }

    // Text.
    const txBody = kid(sp, 'txBody');
    let text = '';
    const hasText = txBody && kids(txBody, 'p').some((p) => p.kids.some((n) => n.name === 'r' || n.name === 'fld' || n.name === 'br'));
    if (hasText) {
      const bodyPrs = chainSp.map((s) => kid(kid(s, 'txBody'), 'bodyPr')).filter(Boolean);
      const bp = (name) => bodyPrs.map((b) => at(b, name)).find((v) => v !== undefined);
      const lIns = num(bp('lIns'), 91440) * env.k, rIns = num(bp('rIns'), 91440) * env.k, tIns = num(bp('tIns'), 45720) * env.k, bIns = num(bp('bIns'), 45720) * env.k;
      const anchor = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[bp('anchor') ?? 't'] ?? 'flex-start';
      const auto = bodyPrs.map((b) => kid(b, 'normAutofit')).find(Boolean);
      const vert = bp('vert');
      const kind = ph ? ({ title: 'titleStyle', body: 'bodyStyle' }[phKey(ph)] ?? 'otherStyle') : null;
      const txStyles = ctx.master ? kid(ctx.master, 'txStyles') : null;
      const chain = [kid(txBody, 'lstStyle'), ...(ph ? [kid(kid(chainSp[1] ?? {}, 'txBody'), 'lstStyle'), kid(kid(chainSp[2] ?? {}, 'txBody'), 'lstStyle'), kind ? kid(txStyles, kind) : null] : []), defaultTextStyle].filter(Boolean);
      const defaultColor = refs.fontColor ?? resolveColor({ kids: [{ name: 'schemeClr', attrs: { val: 'tx1' }, kids: [] }] }, env);
      const fontScale = auto ? num(at(auto, 'fontScale'), 100000) / 100000 : 1;
      const lnReduce = auto ? num(at(auto, 'lnSpcReduction')) / 100000 : 0;
      const paras = renderParagraphs(txBody, env, { chain, defaultColor, fontScale, lnReduce, noWrap: bp('wrap') === 'none' });
      const rotateText = vert === 'vert270' ? 'transform:rotate(180deg);' : '';
      const mode = vert && vert !== 'horz' ? 'writing-mode:vertical-rl;' : '';
      const fitAttr = auto ? ` data-fit="${at(auto, 'fontScale') ? 'fixed' : 'auto'}" data-pad="${r2(tIns + bIns)}"` : '';
      text = `<div class="tx"${fitAttr} style="left:0;top:0;width:${r2(w)}px;height:${r2(h)}px;padding:${r2(tIns)}px ${r2(rIns)}px ${r2(bIns)}px ${r2(lIns)}px;justify-content:${anchor};${mode}${rotateText}--k:1"><div class="txi">${paras}</div></div>`;
    }
    if (!svg && !text) return '';
    return `<div class="el" style="${box.css}">${svg}${text}</div>`;
  }

  async function renderGroup(grp, env, ctx, frame) {
    const xf = xfrmOf(kid(grp, 'grpSpPr'));
    if (!xf) return '';
    const box = boxStyle(xf, frame);
    const chOff = xf.chOff ?? { x: xf.x, y: xf.y }, chExt = xf.chExt ?? { w: xf.w, h: xf.h };
    const inner = { offX: chOff.x, offY: chOff.y, sx: chExt.w ? box.w / chExt.w : frame.sx, sy: chExt.h ? box.h / chExt.h : frame.sy };
    const flip = `${xf.flipH ? 'scaleX(-1) ' : ''}${xf.flipV ? 'scaleY(-1)' : ''}`.trim();
    const content = await renderChildren(grp, env, ctx, inner);
    return `<div class="el" style="${box.css.replace(/transform:[^;]*;/, '')}${xf.rot || flip ? `transform:${xf.rot ? `rotate(${r2(xf.rot)}deg) ` : ''}${flip};` : ''}">${content}</div>`;
  }

  async function renderPic(pic, env, ctx, frame) {
    const ph = phOf(pic);
    if (ph && ctx.skipPlaceholders) return '';
    const spPr = kid(pic, 'spPr');
    const xf = xfrmOf(spPr) ?? xfrmOf(kid(findPlaceholder(ctx.layout, ph, true) ?? {}, 'spPr'));
    if (!xf) return '';
    const box = boxStyle(xf, frame);
    const bf = kid(pic, 'blipFill');
    const blip = kid(bf, 'blip');
    const rid = at(blip, 'r:embed') ?? at(blip, 'r:link');
    const url = rid ? await env.media(rid, env.part) : null;
    if (!url) return '';
    const src = kid(bf, 'srcRect');
    const l = num(at(src, 'l')) / 100000, t = num(at(src, 't')) / 100000, r = num(at(src, 'r')) / 100000, b = num(at(src, 'b')) / 100000;
    const iw = 1 - l - r || 1, ih = 1 - t - b || 1;
    const filters = [];
    if (kid(blip, 'grayscl')) filters.push('grayscale(1)');
    const lum = kid(blip, 'lum');
    if (lum) {
      if (at(lum, 'bright')) filters.push(`brightness(${r2(1 + num(at(lum, 'bright')) / 100000)})`);
      if (at(lum, 'contrast')) filters.push(`contrast(${r2(1 + num(at(lum, 'contrast')) / 100000)})`);
    }
    const alpha = num(at(kid(blip, 'alphaModFix'), 'amt'), 100000) / 100000;
    const prst = at(kid(spPr, 'prstGeom'), 'prst');
    const radius = prst === 'ellipse' ? 'border-radius:50%;' : prst === 'roundRect' ? `border-radius:${r2(Math.min(box.w, box.h) * 0.1667)}px;` : '';
    const ln = parseLn(kid(spPr, 'ln'), env);
    const border = ln.fill && ln.fill.type === 'solid' && ln.w > 0 ? `border:${r2(ln.w)}px solid ${solidCss(ln.fill.c)};` : '';
    const flip = `${xf.flipH ? 'scaleX(-1) ' : ''}${xf.flipV ? 'scaleY(-1)' : ''}`.trim();
    const imgStyle = `position:absolute;left:${r2((-l / iw) * 100)}%;top:${r2((-t / ih) * 100)}%;width:${r2(100 / iw)}%;height:${r2(100 / ih)}%;background:url('${url}') 0 0/100% 100% no-repeat;${flip ? `transform:${flip};` : ''}${filters.length ? `filter:${filters.join(' ')};` : ''}`;
    return `<div class="el" style="${box.css}overflow:hidden;${radius}${border}${alpha < 1 ? `opacity:${r2(alpha)};` : ''}"><div style="${imgStyle}"></div></div>`;
  }

  async function renderFrame(gf, env, ctx, frame) {
    const xf = xfrmOf(gf);
    if (!xf) return '';
    const box = boxStyle(xf, frame);
    const data = path_(gf, 'graphic', 'graphicData');
    const tbl = kid(data, 'tbl');
    if (tbl) return `<div class="el" style="${box.css}">${await renderTable(tbl, env, box)}</div>`;
    // SmartArt: PowerPoint saves a drawing of the finished diagram next to the diagram data. That drawing is what is shown.
    const relId = at(kid(data, 'relIds'), 'r:dm');
    if (relId) {
      const rels = await readRels(zip, env.part);
      const dataPart = rels[relId]?.target;
      const dataRels = dataPart ? await readRels(zip, dataPart) : {};
      const drawingRel = Object.values(rels).find((r) => r.type === 'diagramDrawing');
      const drawingPart = drawingRel?.target ?? Object.values(dataRels).find((r) => r.type === 'diagramDrawing')?.target;
      const drawing = drawingPart ? await loadPart(drawingPart) : null;
      if (drawing) {
        const inner = { offX: 0, offY: 0, sx: env.k, sy: env.k };
        const tree = kid(drawing, 'spTree');
        const shapes = [];
        for (const sp of kids(tree, 'sp')) {
          // A diagram shape keeps its text frame in `txXfrm`, which is already in the diagram's own space.
          shapes.push(await renderSp(sp, { ...env, part: drawingPart }, { ...ctx, skipPlaceholders: false }, inner));
        }
        return `<div class="el" style="${box.css}">${shapes.join('')}</div>`;
      }
    }
    return '';
  }

  const TABLE_DEFAULT = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';

  function tableStyleOf(id) {
    const list = kids(tableStyles, 'tblStyle');
    return list.find((s) => at(s, 'styleId') === id) ?? null;
  }

  async function renderTable(tbl, env, box) {
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => num(at(c, 'w')) * env.k);
    const props = kid(tbl, 'tblPr');
    const styleId = kid(props, 'tableStyleId')?.text?.trim() || TABLE_DEFAULT;
    const style = tableStyleOf(styleId);
    const flag = (n) => at(props, n) === '1' || at(props, n) === 'true';
    const rows = kids(tbl, 'tr');
    const accent = resolveColor({ kids: [{ name: 'schemeClr', attrs: { val: 'accent1' }, kids: [] }] }, env);
    const lt = resolveColor({ kids: [{ name: 'schemeClr', attrs: { val: 'lt1' }, kids: [] }] }, env);
    const dk = resolveColor({ kids: [{ name: 'schemeClr', attrs: { val: 'dk1' }, kids: [] }] }, env);
    const mix = (c, t) => ({ r: c.r + (255 - c.r) * (1 - t), g: c.g + (255 - c.g) * (1 - t), b: c.b + (255 - c.b) * (1 - t), a: 1 });

    /** The style's part for this cell: fill, bold and text colour. Falls back to Medium Style 2 - Accent 1 when the style is not in the file. */
    const partFor = (ri, ci) => {
      const first = flag('firstRow') && ri === 0, last = flag('lastRow') && ri === rows.length - 1;
      const firstCol = flag('firstCol') && ci === 0, lastCol = flag('lastCol') && ci === grid.length - 1;
      const band = flag('bandRow') && (ri - (flag('firstRow') ? 1 : 0)) % 2 === 0;
      const names = [first && 'firstRow', last && 'lastRow', firstCol && 'firstCol', lastCol && 'lastCol', band && 'band1H', 'wholeTbl'].filter(Boolean);
      for (const name of names) {
        const p = style ? kid(style, name) : null;
        if (!p) continue;
        const tcStyle = kid(p, 'tcStyle'), txStyle = kid(p, 'tcTxStyle');
        const fillNode = kid(tcStyle, 'fill');
        let fill = null, color = null;
        if (fillNode) {
          const fenv = { ...env };
          const ref = kid(fillNode, 'fillRef');
          fill = fillChild(fillNode) ? parseFill(fillNode, fenv) : ref ? { type: 'solid', c: resolveColor(ref, fenv) } : null;
        }
        if (txStyle) color = resolveColor(txStyle, env);
        const bold = at(txStyle, 'b') === 'on';
        if (fill || color || bold) return { fill, color, bold, found: name };
      }
      if (style) return {};
      if (first) return { fill: { type: 'solid', c: accent }, color: lt, bold: true };
      if (last) return { fill: { type: 'solid', c: accent }, color: lt, bold: true };
      return { fill: { type: 'solid', c: mix(accent, band ? 0.4 : 0.2) }, color: dk };
    };

    const rowSpans = {};
    let html = `<table style="border-collapse:collapse;table-layout:fixed;width:${r2(box.w)}px;position:absolute;left:0;top:0"><colgroup>${grid.map((w) => `<col style="width:${r2(w)}px">`).join('')}</colgroup>`;
    for (let ri = 0; ri < rows.length; ri++) {
      html += `<tr style="height:${r2(num(at(rows[ri], 'h')) * env.k)}px">`;
      const cells = kids(rows[ri], 'tc');
      for (let ci = 0; ci < cells.length; ci++) {
        const tc = cells[ci];
        if (at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1') continue;
        const tcPr = kid(tc, 'tcPr');
        const part = partFor(ri, ci);
        const own = parseFill(tcPr, env);
        const fill = own ?? part.fill;
        const anchor = { t: 'top', ctr: 'middle', b: 'bottom' }[at(tcPr, 'anchor') ?? 't'];
        const pad = `${r2(num(at(tcPr, 'marT'), 45720) * env.k)}px ${r2(num(at(tcPr, 'marR'), 91440) * env.k)}px ${r2(num(at(tcPr, 'marB'), 45720) * env.k)}px ${r2(num(at(tcPr, 'marL'), 91440) * env.k)}px`;
        const borders = ['L', 'R', 'T', 'B'].map((side) => {
          const l = kid(tcPr, `ln${side}`);
          if (!l) return '';
          const pl = parseLn(l, env);
          if (!pl.fill || pl.fill.type !== 'solid' || pl.w <= 0) return `border-${{ L: 'left', R: 'right', T: 'top', B: 'bottom' }[side]}:none;`;
          return `border-${{ L: 'left', R: 'right', T: 'top', B: 'bottom' }[side]}:${r2(Math.max(1, pl.w))}px solid ${solidCss(pl.fill.c)};`;
        }).join('');
        const defaultColor = part.color ?? dk;
        const paras = renderParagraphs(kid(tc, 'txBody'), env, { chain: [kid(kid(tc, 'txBody'), 'lstStyle'), defaultTextStyle].filter(Boolean), baseRpr: part.bold ? [{ b: '1' }] : [], defaultColor });
        const span = `${at(tc, 'gridSpan') ? ` colspan="${at(tc, 'gridSpan')}"` : ''}${at(tc, 'rowSpan') ? ` rowspan="${at(tc, 'rowSpan')}"` : ''}`;
        html += `<td${span} style="padding:${pad};vertical-align:${anchor};background:${await fillCss(fill, env)};${borders || 'border:1px solid rgba(255,255,255,0.8);'}overflow:hidden">${paras}</td>`;
        void rowSpans;
      }
      html += '</tr>';
    }
    return `${html}</table>`;
  }

  return build();
}
