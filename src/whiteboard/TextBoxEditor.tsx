import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  FoldVertical,
  Plus,
  Trash2,
  Type,
} from 'lucide-react';
import {
  MAX_TEXT_BOXES,
  sanitizeTextBox,
  TEXT_BOX_DEFAULTS,
  TEXT_BOX_SIZE_MAX,
  TEXT_BOX_SIZE_MIN,
  type WhiteboardDesign,
  type WhiteboardTextBox,
} from '../../shared/whiteboard.js';
import { TEXT_COLORS } from '../../shared/text-style.js';
import { ColorField } from '../announcements/StyleControls';
import { CHIP_OFF, FIELD, LABEL } from './SlideForm';
import { SlideCanvas, textBoxFrame, textBoxStyle } from './SlideCanvas';

const CHIP_ON = 'border-accent/50 bg-accent/20 text-accent';

/** Fonts offered for a text box, besides the one it already uses. All are on a standard Windows computer. */
const FONTS = [
  'Segoe UI',
  'Calibri',
  'Calibri Light',
  'Arial',
  'Arial Black',
  'Cambria',
  'Candara',
  'Century Gothic',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Franklin Gothic Medium',
  'Gabriola',
  'Georgia',
  'Impact',
  'Lucida Sans Unicode',
  'Palatino Linotype',
  'Segoe Script',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

/** The handles that resize a box: which edges each one moves. */
const HANDLES: { id: string; left: boolean; right: boolean; top: boolean; bottom: boolean; cursor: string; style: CSSProperties }[] = [
  { id: 'nw', left: true, right: false, top: true, bottom: false, cursor: 'nwse-resize', style: { left: 0, top: 0 } },
  { id: 'n', left: false, right: false, top: true, bottom: false, cursor: 'ns-resize', style: { left: '50%', top: 0 } },
  { id: 'ne', left: false, right: true, top: true, bottom: false, cursor: 'nesw-resize', style: { left: '100%', top: 0 } },
  { id: 'e', left: false, right: true, top: false, bottom: false, cursor: 'ew-resize', style: { left: '100%', top: '50%' } },
  { id: 'se', left: false, right: true, top: false, bottom: true, cursor: 'nwse-resize', style: { left: '100%', top: '100%' } },
  { id: 's', left: false, right: false, top: false, bottom: true, cursor: 'ns-resize', style: { left: '50%', top: '100%' } },
  { id: 'sw', left: true, right: false, top: false, bottom: true, cursor: 'nesw-resize', style: { left: 0, top: '100%' } },
  { id: 'w', left: true, right: false, top: false, bottom: false, cursor: 'ew-resize', style: { left: 0, top: '50%' } },
];

const round = (n: number) => Math.round(n * 100) / 100;

/** A number field with a label, for a box's place, size and turn. */
function NumberField({ label, value, min, max, step = 1, unit, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-bold tracking-wider text-fg/55 uppercase">
        {label} <span className="font-normal normal-case">({unit})</span>
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className={`${FIELD} px-2 py-1.5 tabular-nums`}
      />
    </label>
  );
}

/** A small square button for the box toolbar. */
function ToolButton({ label, onClick, on = false, disabled = false, danger = false, children }: {
  label: string;
  onClick: () => void;
  on?: boolean;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={`grid size-9 place-items-center rounded-md border text-sm transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40 ${
        on ? CHIP_ON : danger ? 'border-fg/20 bg-panel text-fg/80 hover:border-danger/60 hover:text-danger' : CHIP_OFF
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The slide as it will look, with every text box on it ready to edit, as in PowerPoint: click a box to select it, drag it to move it,
 * drag its handles to resize it, and double-click it to type in it right on the slide. Arrow keys nudge the selected box (with Shift, further),
 * Delete removes it and Ctrl+D copies it. Below the slide, the selected box's words, font, size, colour, alignment, place and turn can all
 * be set exactly.
 */
export function TextBoxEditor({
  slide,
  onBoxes,
  heading = 'Slide',
  badge = null,
  onEditPart,
  inspectorHost,
}: {
  slide: { title: string; content: string; design: WhiteboardDesign };
  /** The heading over the slide, and anything shown beside it (such as an on-air badge). */
  heading?: string;
  badge?: React.ReactNode;
  /** Called with the whole new list of boxes after every change. */
  onBoxes: (boxes: WhiteboardTextBox[]) => void;
  /** Called when the slide's title or content (not a text box) is double-clicked, so the editor can take the operator to that field. */
  onEditPart?: (part: 'title' | 'content') => void;
  /** Where the selected box's controls are shown: under the slide when not given, and nowhere while the given place is not on the page yet. */
  inspectorHost?: HTMLElement | null;
}) {
  const boxes = slide.design.boxes;
  const [selected, setSelected] = useState<number | null>(null);
  const [typing, setTyping] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const typingField = useRef<HTMLTextAreaElement>(null);
  // The latest boxes, for a drag that outlives the render it started in.
  const latest = useRef(boxes);
  latest.current = boxes;

  // A box that is gone (deleted, or the list replaced) is no longer selected.
  useEffect(() => {
    if (selected != null && selected >= boxes.length) setSelected(null);
    if (typing != null && typing >= boxes.length) setTyping(null);
  }, [boxes.length]);

  useEffect(() => {
    if (typing == null) return;
    const field = typingField.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [typing]);

  const box = selected != null ? boxes[selected] : null;

  const change = (index: number, patch: Partial<WhiteboardTextBox>) => {
    const next = latest.current.map((b, i) => (i === index ? sanitizeTextBox({ ...b, ...patch }) : b));
    latest.current = next;
    onBoxes(next);
  };
  const replace = (next: WhiteboardTextBox[]) => {
    latest.current = next;
    onBoxes(next);
  };

  const addBox = () => {
    if (boxes.length >= MAX_TEXT_BOXES) return;
    replace([...boxes, { ...TEXT_BOX_DEFAULTS }]);
    setSelected(boxes.length);
    setTyping(boxes.length);
  };
  const removeBox = (index: number) => {
    replace(boxes.filter((_, i) => i !== index));
    setSelected(null);
    setTyping(null);
  };

  /** Follows the pointer from a press on a box (to move it) or on one of its handles (to resize it), until it is let go. */
  const startDrag = (e: ReactPointerEvent, index: number, handle: (typeof HANDLES)[number] | null) => {
    if (e.button !== 0 || typing === index) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(index);
    if (typing != null) setTyping(null);
    stage.current?.focus({ preventScroll: true });
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return;
    const start = { ...latest.current[index] };
    const from = { x: e.clientX, y: e.clientY };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - from.x) / rect.width) * 100;
      const dy = ((ev.clientY - from.y) / rect.height) * 100;
      if (!moved && Math.abs(ev.clientX - from.x) + Math.abs(ev.clientY - from.y) < 3) return;
      moved = true;
      if (!handle) {
        change(index, { x: round(start.x + dx), y: round(start.y + dy) });
        return;
      }
      let { x, y, w, h } = start;
      if (handle.left) {
        const nx = Math.min(start.x + dx, start.x + start.w - 2);
        w = start.w + (start.x - nx);
        x = nx;
      }
      if (handle.right) w = Math.max(2, start.w + dx);
      if (handle.top) {
        const ny = Math.min(start.y + dy, start.y + start.h - 2);
        h = start.h + (start.y - ny);
        y = ny;
      }
      if (handle.bottom) h = Math.max(2, start.h + dy);
      change(index, { x: round(x), y: round(y), w: round(Math.min(100, w)), h: round(Math.min(100, h)) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onStageKey = (e: ReactKeyboardEvent) => {
    if (selected == null || typing != null) return;
    const step = e.shiftKey ? 5 : 0.5;
    const b = boxes[selected];
    const nudge: Record<string, Partial<WhiteboardTextBox>> = {
      ArrowLeft: { x: round(b.x - step) },
      ArrowRight: { x: round(b.x + step) },
      ArrowUp: { y: round(b.y - step) },
      ArrowDown: { y: round(b.y + step) },
    };
    if (nudge[e.key]) {
      e.preventDefault();
      change(selected, nudge[e.key]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeBox(selected);
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      setTyping(selected);
    } else if (e.key === 'Escape') {
      // Escape lets go of the box first; the editor closes only when nothing is selected.
      e.preventDefault();
      setSelected(null);
    }
  };

  const fonts = box && !FONTS.includes(box.font) ? [box.font, ...FONTS] : FONTS;

  // The selected box's controls: its words, font, size, style, alignment, colour, place and size.
  const inspector =
    box && selected != null ? (
        <section aria-label="Selected text box" className="flex flex-col gap-4 rounded-lg border border-accent/40 bg-panel-2/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-accent uppercase">
              <Type size={13} aria-hidden /> Text box {selected + 1} of {boxes.length}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <ToolButton label="Delete text box" onClick={() => removeBox(selected)} danger>
                <Trash2 size={15} aria-hidden />
              </ToolButton>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Text</span>
            <textarea rows={4} maxLength={2000} value={box.text} onChange={(e) => change(selected, { text: e.target.value })} className={`${FIELD} resize-y leading-relaxed`} />
          </label>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>Font</span>
              <select value={box.font} onChange={(e) => change(selected, { font: e.target.value })} className={FIELD} style={{ fontFamily: `'${box.font}', sans-serif` }}>
                {fonts.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: `'${f}', sans-serif` }}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label="Size" unit="px" value={box.size} min={TEXT_BOX_SIZE_MIN} max={TEXT_BOX_SIZE_MAX} onChange={(size) => change(selected, { size })} />
          </div>
          <input
            type="range"
            aria-label="Font size"
            min={TEXT_BOX_SIZE_MIN}
            max={TEXT_BOX_SIZE_MAX}
            value={box.size}
            onChange={(e) => change(selected, { size: Number(e.target.value) })}
            className="-mt-2 h-1.5 w-full cursor-pointer accent-accent"
          />

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Style</span>
              <div className="flex gap-1.5">
                <ToolButton label="Bold" on={box.bold} onClick={() => change(selected, { bold: !box.bold })}>
                  <span className="font-black">B</span>
                </ToolButton>
                <ToolButton label="Italic" on={box.italic} onClick={() => change(selected, { italic: !box.italic })}>
                  <span className="font-serif italic">I</span>
                </ToolButton>
                <ToolButton label="Underline" on={box.underline} onClick={() => change(selected, { underline: !box.underline })}>
                  <span className="underline">U</span>
                </ToolButton>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Align</span>
              <div className="flex gap-1.5">
                {(
                  [
                    ['left', 'Align left', AlignLeft],
                    ['center', 'Centre', AlignCenter],
                    ['right', 'Align right', AlignRight],
                    ['justify', 'Justify', AlignJustify],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <ToolButton key={id} label={label} on={box.align === id} onClick={() => change(selected, { align: id })}>
                    <Icon size={15} aria-hidden />
                  </ToolButton>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Up and down</span>
              <div className="flex gap-1.5">
                {(
                  [
                    ['top', 'Top', ArrowUpToLine],
                    ['middle', 'Middle', FoldVertical],
                    ['bottom', 'Bottom', ArrowDownToLine],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <ToolButton key={id} label={`Text at the ${label.toLowerCase()}`} on={box.valign === id} onClick={() => change(selected, { valign: id })}>
                    <Icon size={15} aria-hidden />
                  </ToolButton>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Text colour</span>
            <ColorField label="Text colour" value={box.color} presets={TEXT_COLORS} onChange={(hex) => hex && change(selected, { color: hex })} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Place and size</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <NumberField label="Left" unit="%" value={box.x} min={1 - box.w} max={99} step={0.5} onChange={(x) => change(selected, { x })} />
              <NumberField label="Top" unit="%" value={box.y} min={1 - box.h} max={99} step={0.5} onChange={(y) => change(selected, { y })} />
              <NumberField label="Width" unit="%" value={box.w} min={1} max={100} step={0.5} onChange={(w) => change(selected, { w })} />
              <NumberField label="Height" unit="%" value={box.h} min={1} max={100} step={0.5} onChange={(h) => change(selected, { h })} />
              <NumberField label="Turn" unit="°" value={box.rot} min={-360} max={360} onChange={(rot) => change(selected, { rot })} />
            </div>
          </div>
        </section>
    ) : (
        <p className="rounded-md border border-dashed border-fg/20 px-3 py-3 text-xs text-fg/60">
          {boxes.length > 0
            ? `This slide has ${boxes.length} text box${boxes.length === 1 ? '' : 'es'}. Click one on the slide to change its words, font, size, colour or place.`
            : 'This slide has no text boxes. Add one to put words anywhere on the slide.'}
        </p>
      );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-3">
          <span className={LABEL}>{heading}</span>
          {badge}
        </span>
        <button
          type="button"
          onClick={addBox}
          disabled={boxes.length >= MAX_TEXT_BOXES}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent shadow-sm transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40"
        >
          <Plus size={13} aria-hidden /> Add text box
        </button>
      </div>

      <div
        ref={stage}
        tabIndex={0}
        role="application"
        aria-label="Slide layout. Select a text box to move, resize or edit it."
        onKeyDown={onStageKey}
        onDoubleClick={(e) => {
          if (!onEditPart || (e.target as HTMLElement).dataset.stage !== 'bg') return;
          // The title and content are drawn under this layer: find which one is under the pointer.
          const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.part) as HTMLElement | undefined;
          const part = hit?.dataset.part;
          if (part === 'title' || part === 'content') onEditPart(part);
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.stage === 'bg') {
            setSelected(null);
            setTyping(null);
          }
        }}
        className="relative aspect-video w-full touch-none overflow-hidden rounded-xl border-[3px] border-accent bg-black shadow-xl select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <SlideCanvas slide={slide} hiddenBox={typing} className="pointer-events-none absolute inset-0 h-full w-full" />
        {/* The layer the boxes are handled on. It is a container too, so text typed in place has the slide's own sizes. */}
        <div data-stage="bg" className="absolute inset-0" style={{ containerType: 'inline-size' }}>
          {boxes.map((b, i) => {
            const isSelected = selected === i;
            const isTyping = typing === i;
            return (
              <div
                key={i}
                role="button"
                tabIndex={-1}
                aria-label={`Text box ${i + 1}: ${b.text.slice(0, 40) || 'empty'}`}
                aria-pressed={isSelected}
                onPointerDown={(e) => startDrag(e, i, null)}
                onDoubleClick={() => {
                  setSelected(i);
                  setTyping(i);
                }}
                className={`group flex flex-col ${isTyping ? 'cursor-text' : 'cursor-move'}`}
                style={{
                  ...textBoxFrame(b),
                  justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[b.valign],
                  outline: isSelected ? '2px solid rgb(245 158 11)' : undefined,
                  outlineOffset: 2,
                }}
              >
                {!isSelected && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-sm border border-dashed border-white/0 transition group-hover:border-white/70" />}
                {isTyping && (
                  <textarea
                    ref={typingField}
                    value={b.text}
                    maxLength={2000}
                    onChange={(e) => change(i, { text: e.target.value })}
                    onBlur={() => setTyping(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setTyping(null);
                        stage.current?.focus({ preventScroll: true });
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label="Text"
                    className="h-full w-full resize-none border-0 bg-black/20 p-0 outline-none"
                    style={{ ...textBoxStyle(b), caretColor: 'rgb(245 158 11)' }}
                  />
                )}
                {isSelected &&
                  !isTyping &&
                  HANDLES.map((h) => (
                    <span
                      key={h.id}
                      aria-hidden
                      onPointerDown={(e) => startDrag(e, i, h)}
                      className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-accent bg-white shadow"
                      style={{ ...h.style, cursor: h.cursor }}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-fg/55">
        Drag a text to move it · drag its handles to resize it · double-click to type · arrows nudge it (Shift for more) · Delete removes it.
      </p>

      {inspectorHost === undefined ? inspector : inspectorHost ? createPortal(inspector, inspectorHost) : null}
    </div>
  );
}
