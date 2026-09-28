import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent, type ReactElement,
} from 'react';
import type { CanvasDocument, CanvasNode } from '../api.js';
import { designSvg } from './render.js';
import { boxOf } from './document.js';
import { guideLine, HANDLE_CURSOR, HANDLES, pickAt, type Guide, type Handle } from './snapping.js';

/**
 * The artboard, the design on it, and everything that is not part of the design.
 *
 * **Two layers, and the split is the whole trick.** The design is one SVG string
 * from `designSvg` — exactly the string the export writes — and it is injected
 * once, wholesale, with `dangerouslySetInnerHTML`. Everything a designer needs
 * that the client must not get (the selection frame, the handles, the guides,
 * the marquee, the hover outline) is a *sibling* overlay above it, measured in
 * screen pixels.
 *
 * That is why dragging a handle does not leave a blue outline in the exported
 * file, and why the preview cannot drift from the export: there is only ever one
 * renderer, and nothing is ever added to its output. It is also why the overlay
 * is a separate DOM tree rather than more SVG nodes — an overlay node in the same
 * tree would have to be removed again before every export, and "remove it again"
 * is a step that gets forgotten exactly once.
 */

export type Tool =
  | 'select' | 'text' | 'shape' | 'logo' | 'image' | 'illustration' | 'pattern' | 'texture';

export interface StageProps {
  doc: CanvasDocument;
  href: (assetId: string) => string;
  selection: string[];
  guides: Guide[];
  zoom: number;
  tool: Tool;
  onSelect: (ids: string[]) => void;
  onToggle: (id: string) => void;
  onDrag: (from: { x: number; y: number }, to: { x: number; y: number }, ratio: boolean, handle?: Handle) => void;
  onCanvasClick: (x: number, y: number) => void;
  onZoom: (zoom: number) => void;
  onStatus: (status: string) => void;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'marquee'; from: Canvas; to: Canvas }
  | { kind: 'move'; from: Canvas; moved: boolean }
  | { kind: 'resize'; from: Canvas; handle: Handle; moved: boolean };

interface Canvas { x: number; y: number }
interface Box { x: number; y: number; width: number; height: number }

/** The zoom stops, and the two commands that are not steps: fit and 100%. */
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

/** How close a pointer must be, in screen pixels, to catch a handle. */
const GRAB = 10;

export default function CanvasStage(props: StageProps): ReactElement {
  const { doc, href, selection, guides, zoom, tool, onSelect, onToggle, onDrag, onCanvasClick, onZoom, onStatus } = props;
  const surface = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: 'none' });
  const [hover, setHover] = useState<string | null>(null);

  const art = doc.artboard;
  const svg = designSvg(doc, href);

  /**
   * Fit the sheet to the space available, and again when that space changes.
   *
   * **Measured rather than guessed.** A canvas that opens at a zoom which crops
   * its own artboard looks broken before anything has been done to it. So the
   * first measurement always fits, and a resize re-fits only while the designer
   * has not zoomed by hand — after that their zoom is theirs, and re-fitting
   * would throw away a decision they made.
   */
  const [autoFit, setAutoFit] = useState(true);
  const fit = useCallback(() => {
    const element = surface.current;
    if (!element || !autoFit) return;
    const box = element.getBoundingClientRect();
    if (box.width < 40 || box.height < 40) return;
    const next = Math.min((box.width - 120) / art.width, (box.height - 120) / art.height);
    onZoom(Math.max(0.05, Math.min(2, Math.round(next * 100) / 100)));
  }, [art.height, art.width, autoFit, onZoom]);

  useLayoutEffect(() => {
    fit();
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  /** Where a pointer landed, in the document's own pixels. */
  const toCanvas = useCallback((event: { clientX: number; clientY: number }): Canvas => {
    const stage = surface.current;
    const scroll = scroller.current;
    if (!stage || !scroll) return { x: 0, y: 0 };
    const box = stage.getBoundingClientRect();
    return {
      x: (event.clientX - box.left + scroll.scrollLeft - PAD) / zoom,
      y: (event.clientY - box.top + scroll.scrollTop - PAD) / zoom,
    };
  }, [zoom]);

  /**
   * The handle under the pointer, if any.
   *
   * **Rotated into screen space before it is compared**, so a handle on a turned
   * layer is where it looks rather than where the unrotated box says it is —
   * the same reason the frame is drawn rotated.
   */
  const handleUnder = useCallback((event: { clientX: number; clientY: number }): Handle | undefined => {
    const stage = surface.current;
    if (!stage || selection.length !== 1) return undefined;
    const node = doc.nodes.find((n) => n.id === selection[0]);
    if (!node || node.locked) return undefined;
    const box = stage.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    for (const handle of HANDLES) {
      const at = corner(node, handle);
      if (Math.hypot(at.x * zoom - px, at.y * zoom - py) <= GRAB) return handle;
    }
    return undefined;
  }, [doc.nodes, selection, zoom]);

  const capture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* not capturable */ }
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const point = toCanvas(event);

    const handle = handleUnder(event);
    if (handle) {
      capture(event);
      setGesture({ kind: 'resize', from: point, handle, moved: false });
      return;
    }

    const hit = pickAt(doc, point.x, point.y);
    if (event.shiftKey && hit) { onToggle(hit.id); return; }

    if (hit) {
      onSelect(selection.includes(hit.id) ? selection : [hit.id]);
      if (hit.locked) { onStatus(`${hit.name} is locked by the studio.`); return; }
      capture(event);
      setGesture({ kind: 'move', from: point, moved: false });
      return;
    }

    // A drawing tool drops its layer where it was clicked, not in the middle.
    if (tool !== 'select') { onCanvasClick(point.x, point.y); return; }
    onSelect([]);
    capture(event);
    setGesture({ kind: 'marquee', from: point, to: point });
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = toCanvas(event);
    if (gesture.kind === 'none') {
      setHover(pickAt(doc, point.x, point.y)?.id ?? null);
      return;
    }
    if (gesture.kind === 'marquee') { setGesture({ ...gesture, to: point }); return; }
    // Under two screen pixels is a click, not a drag, and turning it into one
    // would move a layer a designer was only trying to click on.
    if (!gesture.moved && Math.hypot(point.x - gesture.from.x, point.y - gesture.from.y) * zoom < 2) return;
    onDrag(gesture.from, point, event.altKey, gesture.kind === 'resize' ? gesture.handle : undefined);
    setGesture({ ...gesture, moved: true });
  };

  const up = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (gesture.kind === 'marquee') {
      const box = boxFrom(gesture.from, gesture.to);
      onSelect(box.width * zoom > 3 && box.height * zoom > 3
        ? doc.nodes.filter((n) => n.type !== 'group' && !n.hidden && intersects(n, box)).map((n) => n.id)
        : []);
    }
    if (gesture.kind === 'move' && gesture.moved) onStatus('Moved');
    if (gesture.kind === 'resize' && gesture.moved) onStatus('Resized');
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* already released */ }
    setGesture({ kind: 'none' });
  };

  /**
   * ⌘-wheel zooms, and only then.
   *
   * **On the stage, not on the document**, so a wheel over the layers panel still
   * scrolls the panel. A canvas that swallows every wheel event on the page is a
   * canvas that fights the rest of the studio.
   */
  useEffect(() => {
    const stage = surface.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setAutoFit(false);
      const step = event.deltaY > 0 ? 1 / 1.15 : 1.15;
      onZoom(Math.max(0.05, Math.min(4, Math.round(zoom * step * 100) / 100)));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [onZoom, zoom]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Delete' || event.key === 'Backspace') return;
    if (event.key === '+' || event.key === '=') { setAutoFit(false); onZoom(zoomUp(zoom)); return; }
    if (event.key === '-') { setAutoFit(false); onZoom(zoomDown(zoom)); return; }
    if (event.key === '0') { setAutoFit(false); onZoom(1); return; }
    if (event.key === '1') { setAutoFit(true); }
  };

  const frame = selection.length === 1 ? doc.nodes.find((n) => n.id === selection[0]) : undefined;
  const marquee = gesture.kind === 'marquee' ? boxFrom(gesture.from, gesture.to) : undefined;
  const cursor = gesture.kind === 'resize' ? HANDLE_CURSOR[gesture.handle]
    : gesture.kind === 'move' ? (gesture.moved ? 'grabbing' : 'grab')
    : tool === 'select' ? 'default' : 'crosshair';

  return (
    <div
      ref={surface}
      className="cv-stage"
      tabIndex={0}
      role="application"
      aria-label="Design canvas. Arrow keys move the selection, shift and click adds to it, and 1 fits the sheet."
      style={{ cursor }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
    >
      <div className="cv-stage__scroll" ref={scroller}>
        <div className="cv-stage__pad" style={{ padding: PAD }}>
          <div
            className="cv-artboard"
            style={{ width: art.width * zoom, height: art.height * zoom, background: art.background }}
          >
            {/*
              The design. One string, injected whole, and never touched again —
              the frame, the handles and the guides are all in the sibling
              overlay below, precisely so that nothing here has to be taken out
              before an export.
            */}
            <div className="cv-artboard__art" dangerouslySetInnerHTML={{ __html: svg }} />

            <div className="cv-overlay" style={{ width: art.width * zoom, height: art.height * zoom }}>
              {hover && !selection.includes(hover) && gesture.kind === 'none'
                ? outline(doc.nodes.find((n) => n.id === hover), zoom, 'cv-hit cv-hit--hover')
                : null}

              {guides.map((guide, i) => (
                <line key={`${guide.axis}-${guide.at}-${i}`} className="cv-guide"
                  {...guideLine(guide, { width: art.width * zoom, height: art.height * zoom }, zoom)} />
              ))}

              {marquee && marquee.width * zoom > 0 ? (
                <div className="cv-marquee" style={{
                  left: marquee.x * zoom, top: marquee.y * zoom,
                  width: marquee.width * zoom, height: marquee.height * zoom,
                }} />
              ) : null}

              {frame ? outline(frame, zoom, `cv-frame${frame.locked ? ' is-locked' : ''}`) : null}
              {frame && !frame.locked ? HANDLES.map((handle) => {
                const at = corner(frame, handle);
                return (
                  <span key={handle} className={`cv-handle cv-handle--${handle}`}
                    style={{ left: at.x * zoom - 5, top: at.y * zoom - 5, cursor: HANDLE_CURSOR[handle] }} />
                );
              }) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The breathing room around the sheet, so a designer can see its edge. */
const PAD = 72;

/**
 * The frame or the hover outline, rotated with the layer.
 *
 * **Rotated, not drawn around.** A plain rectangle around a headline turned 30°
 * tells the designer the layer is a different shape from the one they can see,
 * and the frame is the only thing telling them what they are about to move.
 */
function outline(node: CanvasNode | undefined, zoom: number, className: string): ReactElement | null {
  if (!node) return null;
  return (
    <div className={className} style={{
      left: node.x * zoom, top: node.y * zoom,
      width: node.width * zoom, height: node.height * zoom,
      transform: node.rotation % 360 === 0 ? undefined : `rotate(${node.rotation}deg)`,
      transformOrigin: 'center',
    }} />
  );
}

/** A handle's position in canvas units, on a node's own box. */
function corner(node: CanvasNode, handle: Handle): Canvas {
  const { x, y, width: w, height: h } = node;
  switch (handle) {
    case 'nw': return { x, y };
    case 'n': return { x: x + w / 2, y };
    case 'ne': return { x: x + w, y };
    case 'e': return { x: x + w, y: y + h / 2 };
    case 'se': return { x: x + w, y: y + h };
    case 's': return { x: x + w / 2, y: y + h };
    case 'sw': return { x, y: y + h };
    case 'w': return { x, y: y + h / 2 };
  }
}

const boxFrom = (a: Canvas, b: Canvas): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** Whether two boxes overlap at all. The marquee's whole test. */
function intersects(node: CanvasNode, box: Box): boolean {
  return node.x < box.x + box.width && node.x + node.width > box.x
    && node.y < box.y + box.height && node.y + node.height > box.y;
}

const zoomUp = (zoom: number): number => ZOOMS.find((z) => z > zoom + 0.001) ?? 4;
const zoomDown = (zoom: number): number => [...ZOOMS].reverse().find((z) => z < zoom - 0.001) ?? 0.1;

/** The box around a multi-selection, for the inspector's geometry row. */
export function frameBox(nodes: readonly CanvasNode[]): Box | undefined {
  return boxOf(nodes);
}
