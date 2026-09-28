import { useState, type ReactElement } from 'react';
import {
  ChevronDown, ChevronRight, Eye, EyeOff, Folder, Grid3x3, Image as ImageIcon, Lock, PenTool,
  Shapes, Sparkles, Trash2, Type as TypeIcon, Unlock,
} from 'lucide-react';
import type { CanvasDocument, CanvasNode } from '../api.js';
import { layerRows } from './useEditor.js';
import { nudgeOrder, reorderNodes } from './commands.js';

/**
 * The layer tree.
 *
 * **The panel reads top-down like the artboard does.** The layer sitting on top of
 * everything is the first row, because that is the layer a designer is working
 * on; getting this backwards is the single most disorienting thing a layers panel
 * can do, and it is why `layerRows` reverses the sibling order rather than
 * leaving that to the component.
 *
 * **Groups are shown as a folder with their contents indented under it**, and
 * clicking one selects the group — which selects everything inside it. That is
 * what a group *is* in this document: not a frame, but a selection.
 */

const ICONS: Record<CanvasNode['type'], typeof TypeIcon> = {
  text: TypeIcon,
  image: ImageIcon,
  shape: Shapes,
  logo: Sparkles,
  illustration: PenTool,
  pattern: Grid3x3,
  texture: Grid3x3,
  group: Folder,
};

const LABELS: Record<CanvasNode['type'], string> = {
  text: 'Text', image: 'Image', shape: 'Shape', logo: 'Logo',
  illustration: 'Illustration', pattern: 'Pattern', texture: 'Texture', group: 'Group',
};

export interface LayersPanelProps {
  doc: CanvasDocument;
  selection: string[];
  href: (assetId: string) => string;
  onSelect: (ids: string[]) => void;
  onToggle: (id: string) => void;
  onPatch: (ids: string[], label: string, change: (node: CanvasNode) => CanvasNode) => void;
  onOrder: (direction: 'front' | 'back' | 'forward' | 'backward') => void;
  onDelete: () => void;
  onDrop: (draggedId: string, targetId: string) => void;
}

/** Groups the designer has folded shut, so a deep design opens readable. */
export function useFolded(): { folded: Set<string>; toggle: (id: string) => void } {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  return {
    folded,
    toggle: (id: string) => setFolded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }),
  };
}

export function LayersPanel(props: LayersPanelProps): ReactElement {
  const { doc, selection, href, onSelect, onToggle, onPatch, onOrder, onDelete, onDrop } = props;
  const { folded, toggle } = useFolded();
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = layerRows(doc);
  const visible = rows.filter((row) => {
    let parent = row.node.parentId;
    while (parent) {
      if (folded.has(parent)) return false;
      parent = doc.nodes.find((n) => n.id === parent)?.parentId ?? null;
    }
    return true;
  });
  const has = (id: string): boolean => selection.includes(id);

  return (
    <div className="cv-layers" role="tree" aria-label="Layers">
      {visible.length === 0 ? (
        <p className="cv-empty">
          Nothing on the sheet yet. Add a logo, a picture or some type from the library on the left.
        </p>
      ) : null}

      {visible.map(({ node, depth, index }) => {
        const Icon = ICONS[node.type];
        const isGroup = node.type === 'group';
        const selected = has(node.id);
        return (
          <div
            key={node.id}
            className={`cv-layer${selected ? ' is-selected' : ''}${node.hidden ? ' is-hidden' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            role="treeitem"
            aria-selected={selected}
            aria-expanded={isGroup ? !folded.has(node.id) : undefined}
            draggable
            onDragStart={() => setDragging(node.id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => { if (dragging && dragging !== node.id) e.preventDefault(); }}
            onDrop={() => { if (dragging && dragging !== node.id) onDrop(dragging, node.id); setDragging(null); }}
          >
            {isGroup ? (
              <button type="button" className="cv-layer__caret" aria-label={folded.has(node.id) ? 'Open group' : 'Fold group'}
                onClick={() => toggle(node.id)}>
                {folded.has(node.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            ) : <span className="cv-layer__caret" />}

            <button type="button" className="cv-layer__name" onClick={(e) => (e.shiftKey ? onToggle(node.id) : onSelect([node.id]))}
              onDoubleClick={() => onPatch([node.id], 'Rename', (n) => ({ ...n, name: window.prompt('Layer name', n.name) ?? n.name }))}
              title={`${LABELS[node.type]} — ${node.name}`}>
              <Icon size={13} className="cv-layer__icon" />
              <span className="cv-layer__text">{node.name}</span>
            </button>

            <span className="cv-layer__tools">
              <button type="button" className="cv-icon cv-icon--tiny" title={node.locked ? 'Unlock' : 'Lock'}
                onClick={() => onPatch([node.id], node.locked ? 'Unlock' : 'Lock', (n) => ({ ...n, locked: !n.locked }))}>
                {node.locked ? <Lock size={12} /> : <Unlock size={12} className="cv-icon--faint" />}
              </button>
              <button type="button" className="cv-icon cv-icon--tiny" title={node.hidden ? 'Show' : 'Hide'}
                onClick={() => onPatch([node.id], node.hidden ? 'Show' : 'Hide', (n) => ({ ...n, hidden: !n.hidden }))}>
                {node.hidden ? <EyeOff size={12} /> : <Eye size={12} className="cv-icon--faint" />}
              </button>
              <button type="button" className="cv-icon cv-icon--tiny" title="Delete"
                onClick={() => { onSelect([node.id]); onDelete(); }}>
                <Trash2 size={12} className="cv-icon--faint" />
              </button>
            </span>

            {/*
              A thumbnail, for the four kinds where the picture is the layer. Not
              for text or shapes: a row of identical grey boxes tells a designer
              nothing, and the cost is one more thing to lay out.
            */}
            {'assetId' in node.properties ? (
              <span className="cv-layer__thumb" aria-hidden="true">
                <img src={href(node.properties.assetId)} alt="" loading="lazy" />
              </span>
            ) : null}
          </div>
        );
      })}

      {/*
        Order controls, on the rows rather than in a menu.

        A designer reorders by *seeing* what moved, so the four moves are always
        there, always in the same order, and named for what they do. A context menu
        would hide the one operation that has no keyboard equivalent here.
      */}
      <footer className="cv-layers__foot">
        <div className="cv-order" role="group" aria-label="Stacking order">
          <button type="button" onClick={() => onOrder('front')} disabled={selection.length === 0} title="Bring to front">Front</button>
          <button type="button" onClick={() => onOrder('forward')} disabled={selection.length === 0} title="Bring forward">Up</button>
          <button type="button" onClick={() => onOrder('backward')} disabled={selection.length === 0} title="Send backward">Down</button>
          <button type="button" onClick={() => onOrder('back')} disabled={selection.length === 0} title="Send to back">Back</button>
        </div>
        <span className="cv-layers__count mono">
          {doc.nodes.length} layer{doc.nodes.length === 1 ? '' : 's'}
        </span>
      </footer>
    </div>
  );
}

/**
 * What a drag from one row onto another does.
 *
 * **Reorder, and only reorder.** Dropping a layer onto a group would be a way to
 * put things inside groups by accident, and a canvas that rearranges the tree from
 * a drag the designer meant as a move is a canvas that loses work. Reordering is
 * what a layers list has always done.
 */
export function reorderBy(doc: CanvasDocument, draggedId: string, targetId: string): ReturnType<typeof reorderNodes> {
  const target = doc.nodes.find((n) => n.id === targetId);
  if (!target) return reorderNodes(doc, [draggedId], 0);
  const siblings = doc.nodes.filter((n) => n.parentId === target.parentId);
  const at = siblings.findIndex((n) => n.id === targetId);
  return reorderNodes(doc, [draggedId], at + 1, 'Reorder');
}

/** The name of a layer kind, for a readout. */
export const layerKindLabel = (node: CanvasNode): string => LABELS[node.type];
