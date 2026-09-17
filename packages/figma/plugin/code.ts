/**
 * The plugin sandbox half.
 *
 * Figma runs this in a worker with no DOM. Its only jobs are to read the
 * selection, hand it to the analysis, and place annotations back on the canvas —
 * every measurement comes from the same instruments the pipeline uses, bundled
 * in, so a ratio reported here and a ratio reported in a run are the same number
 * produced by the same code.
 */

import { analyzeFrame, snapshotFrame, type Annotation } from '../src/index.js';

declare const figma: {
  currentPage: { selection: readonly unknown[]; appendChild(node: unknown): void };
  ui: {
    postMessage(message: unknown): void;
    onmessage: ((message: { type: string; [k: string]: unknown }) => void) | null;
  };
  showUI(html: string, options?: { width?: number; height?: number; themeColors?: boolean }): void;
  notify(message: string, options?: { error?: boolean }): void;
  createFrame(): Record<string, unknown>;
  createText(): Record<string, unknown>;
  loadFontAsync(font: { family: string; style: string }): Promise<void>;
  getNodeByIdAsync(id: string): Promise<Record<string, unknown> | null>;
  viewport: { scrollAndZoomIntoView(nodes: readonly unknown[]): void };
  closePlugin(message?: string): void;
};
declare const __html__: string;

const SEVERITY_COLOR: Record<string, { r: number; g: number; b: number }> = {
  blocker: { r: 0.70, g: 0.16, b: 0.13 },
  major:   { r: 0.66, g: 0.34, b: 0.12 },
  minor:   { r: 0.36, g: 0.40, b: 0.47 },
  nitpick: { r: 0.55, g: 0.58, b: 0.63 },
  info:    { r: 0.36, g: 0.40, b: 0.47 },
};

function selectedFrame(): Record<string, unknown> | undefined {
  const selection = figma.currentPage.selection;
  const framelike = selection.find((node) => {
    const type = (node as { type?: string }).type;
    return type === 'FRAME' || type === 'COMPONENT' || type === 'SECTION' || type === 'INSTANCE';
  });
  return (framelike ?? selection[0]) as Record<string, unknown> | undefined;
}

function run(): void {
  const frame = selectedFrame();
  if (!frame) {
    figma.ui.postMessage({ type: 'empty' });
    return;
  }

  try {
    const snapshot = snapshotFrame(frame as never);
    const report = analyzeFrame(snapshot);
    figma.ui.postMessage({ type: 'report', report });
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Place one pin per annotation, next to the layer it belongs to. */
async function annotate(annotations: Annotation[]): Promise<void> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  let placed = 0;

  for (const annotation of annotations) {
    if (!annotation.nodeId) continue;
    const target = await figma.getNodeByIdAsync(annotation.nodeId);
    if (!target) continue;

    const pin = figma.createText() as Record<string, unknown> & {
      characters: string; fontSize: number; x: number; y: number;
      fills: unknown; name: string;
      fontName: { family: string; style: string };
    };
    pin.fontName = { family: 'Inter', style: 'Medium' };
    pin.characters = `${annotation.headline}\n${annotation.layer}`;
    pin.fontSize = 11;
    pin.name = `EDSAI · ${annotation.severity} · ${annotation.layer}`;
    pin.fills = [{
      type: 'SOLID',
      color: SEVERITY_COLOR[annotation.severity] ?? SEVERITY_COLOR['minor'],
    }];

    const box = target as { x?: number; y?: number; width?: number };
    pin.x = (box.x ?? 0) + (box.width ?? 0) + 16;
    pin.y = box.y ?? 0;

    figma.currentPage.appendChild(pin);
    placed++;
  }

  figma.notify(
    placed > 0
      ? `Placed ${placed} annotation${placed === 1 ? '' : 's'}.`
      : 'Nothing to pin — the findings are frame-level rather than layer-level.',
  );
}

figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

figma.ui.onmessage = (message): void => {
  if (message.type === 'run') run();
  else if (message.type === 'annotate') void annotate(message['annotations'] as Annotation[]);
  else if (message.type === 'focus') {
    void figma.getNodeByIdAsync(String(message['nodeId'])).then((node) => {
      if (node) figma.viewport.scrollAndZoomIntoView([node]);
    });
  } else if (message.type === 'close') figma.closePlugin();
};

run();
