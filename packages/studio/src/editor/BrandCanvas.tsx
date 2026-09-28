import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check, Download, Frame, FolderPlus, Hand, Redo2, Save, Shapes, Trash2,
  TriangleAlert, Type as TypeIcon, Undo2, Ungroup, X,
} from 'lucide-react';
import type { Asset, BrandProject, CanvasDocument, CanvasNode } from '../api.js';
import { api } from '../api.js';
import type { ToolProps } from '../components/brandModules.js';
import { allowedColors, allowedExports, colorPolicyOf } from '../components/brandModules.js';
import { brandColours, brandFonts } from '../components/toolkit.js';
import { addNodes, patchNodes } from './commands.js';
import { blankDocument, makeNode, normalise } from './document.js';
import { documentFromTemplate, FALLBACK_BRAND, type DesignSize, type DesignTemplate, type TemplateBrand } from './templates.js';
import { hrefFor, summarise, useEditor, type Editor } from './useEditor.js';
import { useAutosave, type AutosaveState } from './save.js';
import { useShortcuts } from './shortcuts.js';
import AssetPanel from './AssetPanel.js';
import CanvasStage, { type Tool } from './CanvasStage.js';
import Inspector from './Inspector.js';
import { LayersPanel, reorderBy } from './LayersPanel.js';
import { CreateSheet, ExportSheet } from './CanvasSheets.js';

/**
 * The Design Canvas: a real editor, in the one place a client already is.
 *
 * **Its own shell, not the shared `Workspace`.** The other four brand tools are a
 * stage and a settings panel. This is a tool rail, a library, a layer tree, an
 * artboard and a property inspector, and forcing that into a two-column grid
 * would have meant a `Workspace` with seven slots and every other tool's layout
 * changed to accommodate it. The registry still decides whether the hub offers
 * the tool; the studio decided what the tool *is*.
 *
 * **One renderer, everywhere.** The artboard, the PNG, the JPEG and the SVG are
 * all `designSvg` over the same document — see `render.ts` — so §37's "the export
 * matches the editor" is not a promise to keep up. It is a thing that cannot fail,
 * because there is no second rendering path to disagree with the first.
 *
 * **A design is saved, not an image.** What crosses the wire is the
 * `CanvasDocument` in `configuration`, and the engine re-reads it on every save —
 * refusing any file this client does not own, which is the check that keeps one
 * client's logo out of another client's poster.
 */

export default function BrandCanvas(props: ToolProps): ReactElement {
  const { clientId, assets, values, project, module, rules, onSaved, onClose } = props;
  const queryClient = useQueryClient();

  /**
   * What this brand permits, resolved once.
   *
   * The three questions the editor asks constantly — which colours may go on the
   * sheet, which typefaces may be set, which formats may be written — all reduce
   * to a rule and the brand's own values, and all three fall back to "whatever
   * the brand itself says" when the hub has written nothing down. A canvas that
   * refused work because a hub predated a rule would be least useful exactly
   * where it is most needed: on an existing client's brand.
   */
  const brand = useMemo((): TemplateBrand & {
    swatches: string[];
    fonts: string[];
    customColor: boolean;
    typeLocked: boolean;
  } => {
    const measured = brandColours(values);
    const allowed = allowedColors(rules, values);
    const hexes = (allowed.hexes.length > 0 ? allowed.hexes : measured.map((entry) => entry.hex))
      .map((hex) => hex.toUpperCase());
    const { heading, body } = brandFonts(values);
    const named = rules.fonts.filter((family) => family.trim() !== '');
    return {
      displayFont: named[0] ?? heading ?? FALLBACK_BRAND.displayFont,
      bodyFont: named[1] ?? named[0] ?? body ?? FALLBACK_BRAND.bodyFont,
      ink: hexes[0] ?? FALLBACK_BRAND.ink,
      accent: hexes[1] ?? hexes[0] ?? FALLBACK_BRAND.accent,
      ground: FALLBACK_BRAND.ground,
      swatches: hexes,
      fonts: named.length > 0 ? named : [heading, body].filter((family): family is string => Boolean(family)),
      /**
       * A colour policy only closes the picker when the brand has actually named
       * a palette. With nothing named there is nothing for a colour to be
       * off-brand against, and refusing one would be inventing a rule.
       */
      customColor: colorPolicyOf(rules) !== 'strict' || allowed.hexes.length === 0,
      typeLocked: named.length > 0 && !rules.allowCustomFont,
    };
  }, [rules, values]);

  const [started, setStarted] = useState<CanvasDocument | undefined>(() => openedFrom(project));
  const [name, setName] = useState(project?.name ?? '');
  /**
   * Whether the name differs from the one on the server.
   *
   * The name is part of the design but it is not in the document, so `dirty` —
   * which compares documents — cannot see a rename. Left untracked, a designer who
   * renames a clean saved design has no lit Save button and no autosave: the edit
   * would exist only in the input until they closed the tab.
   */
  const [renamed, setRenamed] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Once a design has been saved it has an id, and from then on it keeps itself up
  // to date. Until then the Save button owns the first and only write.
  const savedId = project?.id;
  const write = useCallback(async (doc: CanvasDocument) => {
    if (!savedId) throw new Error('This design has not been saved yet.');
    await api.updateBrandProject(savedId, {
      name: name.trim() || 'Untitled design',
      configuration: doc,
    });
  }, [name, savedId]);

  const autosave = useAutosave({ enabled: savedId !== undefined, write });
  const editor = useEditor(started ?? blankDocument(1080, 1080), rules, assets, autosave.note);
  const href = useMemo(() => hrefFor(assets), [assets]);

  /**
   * Renaming, and what it has to set in motion.
   *
   * The document is unchanged by a rename, so autosave is not triggered by the
   * editor the way an edit is — it is told, with `force`, because the write is the
   * only place the name lives. The document being written is the current one, so a
   * rename never saves a stale design.
   */
  const setDesignName = useCallback((value: string) => {
    setName(value);
    setRenamed(true);
    setError(undefined);
    autosave.note(editor.doc, { force: true });
  }, [autosave, editor.doc]);

  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      const title = name.trim();
      if (title === '') throw new Error('Give the design a name before saving it.');
      const configuration = editor.saveable();
      if (project && !asNew) return api.updateBrandProject(project.id, { name: title, configuration });
      return api.createBrandProject(clientId, { toolId: 'brand-canvas', name: title, configuration });
    },
      onSuccess: (saved: BrandProject) => {
      void queryClient.invalidateQueries({ queryKey: ['brand-projects', clientId] });
      autosave.markSaved();
      editor.markClean();
      setRenamed(false);
      setError(undefined);
      // The hub hands the saved project straight back as `project`, which is what
      // turns autosave on for the rest of the session.
      onSaved(saved);
    },
    onError: (failure: Error) => setError(failure.message),
  });

  // A sheet is the whole interface while it is open; the artboard must not react.
  useShortcuts(editor, { blocked: exporting || !started });

  /**
   * Put a new layer down where the pointer was.
   *
   * **Centred on the click, not from the top left of it.** A designer clicking
   * where they want a headline expects the headline to be *there*, and a text
   * layer that appears one corner up and to the left of the click reads as the
   * canvas having moved something on its own.
   */
  const drop = useCallback((kind: 'text' | 'shape', at: { x: number; y: number }) => {
    const art = editor.doc.artboard;
    const width = kind === 'text' ? Math.round(Math.min(art.width * 0.8, 760)) : Math.round(art.width * 0.4);
    const height = kind === 'text' ? Math.round(width * 0.25) : Math.round(art.height * 0.3);
    const seed = {
      name: kind === 'text' ? 'Headline' : 'Shape',
      x: Math.round(at.x - width / 2),
      y: Math.round(at.y - height / 2),
      width,
      height,
    };
    const node: CanvasNode = kind === 'text'
      ? makeNode('text', seed, {
        text: 'Your headline',
        fontFamily: brand.displayFont,
        fontWeight: 700,
        fontSize: Math.max(14, Math.round(height * 0.7)),
        lineHeight: 1.1,
        letterSpacing: -0.01,
        align: 'left',
        transform: 'none',
        color: brand.ink,
      })
      : makeNode('shape', seed, {
        shape: 'rectangle',
        fill: brand.accent,
        stroke: brand.ink,
        strokeWidth: 0,
        cornerRadius: 0,
        points: [],
      });
    editor.run(addNodes([node], `Add ${seed.name.toLowerCase()}`));
    editor.select([node.id]);
    setTool('select');
  }, [brand, editor]);

  /**
   * The library's own two buttons, which add at the middle of the sheet.
   *
   * **Placed in the middle rather than waiting for a click.** A designer reaching
   * for "add a headline" in the library is not aiming at a coordinate; they want
   * one, and the middle is where it can be found and moved afterwards.
   */
  const addAtCentre = useCallback((kind: 'text' | 'shape') => {
    const art = editor.doc.artboard;
    drop(kind, { x: art.width / 2, y: art.height / 2 });
  }, [drop, editor.doc.artboard]);

  /**
   * Put one of the client's own files on the sheet.
   *
   * The measurement lives in the editor because that is where the node is made —
   * see `place` in `useEditor.ts` — so this is only the part that needs the shell:
   * the file, and the tool to go back to afterwards.
   */
  const place = useCallback(async (kind: CanvasNode['type'], asset: Asset) => {
    try {
      await editor.place(kind, asset);
      setTool('select');
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [editor]);

  const begin = (size: DesignSize, template: DesignTemplate): void => {
    setName(template.blank ? size.label : `${template.label} — ${size.label}`);
    setStarted(normalise(documentFromTemplate(size, template, brand)).doc);
  };

  const onCanvasClick = (x: number, y: number): void => {
    if (tool === 'select') return;
    if (tool === 'text' || tool === 'shape') drop(tool, { x, y });
  };

  // No sheet yet, or a saved design whose configuration is not a canvas: the
  // create sheet, rather than an empty artboard nobody can make anything of.
  if (!started) {
    return <CreateSheet brand={brand} onClose={onClose} onStart={begin} />;
  }

  const canGroup = editor.selection.length > 1;
  const canUngroup = editor.selectedOne?.type === 'group';

  return (
    <div className="cv">
      <TopBar
        editor={editor}
        name={name}
        setName={setDesignName}
        saved={project !== undefined}
        renamed={renamed}
        saving={save.isPending}
        autosave={autosave.state}
        error={error}
        onSave={() => { save.mutate(false); }}
        onSaveAs={() => { save.mutate(true); }}
        onExport={() => setExporting(true)}
        onClose={onClose}
      />

      <div className="cv-body">
        <ToolRail
          tool={tool}
          setTool={setTool}
          typeLocked={brand.typeLocked}
          canGroup={canGroup}
          canUngroup={canUngroup}
          canDelete={editor.selected.length > 0}
          onGroup={editor.groupSelected}
          onUngroup={editor.ungroupSelected}
          onDelete={editor.deleteSelected}
        />

        <div className="cv-left">
          <div className="cv-left__library">
            <AssetPanel
              assets={assets}
              values={values}
              tool={tool}
              onPlace={place}
              onAddText={() => addAtCentre('text')}
              onAddShape={() => addAtCentre('shape')}
              lockedFor={(kind) => kind === 'text' && brand.typeLocked}
            />
          </div>
          <div className="cv-left__layers">
            <LayersPanel
              doc={editor.doc}
              selection={editor.selection}
              href={href}
              onSelect={editor.select}
              onToggle={editor.toggle}
              onPatch={(ids, label, change) => editor.run(patchNodes(editor.doc, ids, label, change))}
              onOrder={editor.order}
              onDelete={editor.deleteSelected}
              onDrop={(dragged, target) => editor.run(reorderBy(editor.doc, dragged, target))}
            />
          </div>
        </div>

        <CanvasStage
          doc={editor.doc}
          href={href}
          selection={editor.selection}
          guides={editor.state.guides}
          zoom={editor.state.zoom}
          tool={tool}
          onSelect={editor.select}
          onToggle={editor.toggle}
          onDrag={(from, to, ratio, handle) => editor.dispatch({ type: 'drag', from, to, ratio, ...(handle ? { handle } : {}) })}
          onCanvasClick={onCanvasClick}
          onZoom={(zoom) => editor.dispatch({ type: 'zoom', zoom })}
          onStatus={(status) => editor.dispatch({ type: 'status', status })}
        />

        <Inspector
          doc={editor.doc}
          nodes={editor.selected}
          assets={assets}
          rules={rules}
          verdict={editor.verdict}
          swatches={brand.swatches}
          allowCustomColor={brand.customColor}
          fonts={brand.fonts}
          allowCustomFont={!brand.typeLocked}
          onPatch={(ids, label, change) => editor.run(patchNodes(editor.doc, ids, label, change))}
          onArtboard={editor.setArtboard}
        />
      </div>

      <StatusBar
        editor={editor}
        snapping={editor.state.snapping}
        autosave={autosave.state}
        onSnapping={(on) => editor.dispatch({ type: 'snapping', on })}
      />

      {exporting ? (
        <ExportSheet
          editor={editor}
          clientId={clientId}
          module={module}
          project={project}
          name={name}
          allowed={allowedExports(module)}
          href={href}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- the rail */

function ToolRail(props: {
  tool: Tool;
  setTool: (tool: Tool) => void;
  typeLocked: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  /** Delete is an act on the selection, so it is dark with nothing selected. */
  canDelete: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}): ReactElement {
  const { tool, setTool, typeLocked, canGroup, canUngroup, canDelete, onGroup, onUngroup, onDelete } = props;
  return (
    <nav className="cv-rail" aria-label="Tools">
      {/*
        Three tools, then the four acts that apply to whatever is selected.

        The rail holds no file kinds, and that is a decision rather than an
        omission: a file is placed from the library, where its thumbnail is, and a
        rail button that says "logo" tells a designer nothing about *which* logo
        it will put on their poster.
      */}
      <RailButton icon={Hand} label="Select and move" hint="V" on={tool === 'select'} disabled={false} onClick={() => setTool('select')} />
      <RailButton icon={TypeIcon} label="Add text" hint="T" on={tool === 'text'} disabled={typeLocked} onClick={() => setTool('text')} />
      <RailButton icon={Shapes} label="Add a shape" hint="R" on={tool === 'shape'} disabled={typeLocked} onClick={() => setTool('shape')} />
      <span className="cv-rail__gap" />
      <RailButton icon={FolderPlus} label="Group" hint="⌘G" on={false} disabled={!canGroup} onClick={onGroup} />
      <RailButton icon={Ungroup} label="Ungroup" hint="⇧⌘G" on={false} disabled={!canUngroup} onClick={onUngroup} />
      <span className="cv-rail__gap" />
      <RailButton icon={Trash2} label="Delete" hint="⌫" on={false} disabled={!canDelete} onClick={onDelete} />
    </nav>
  );
}

function RailButton(props: {
  icon: typeof Hand;
  label: string;
  hint: string;
  on: boolean;
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  const { icon: Icon, label, hint, on, disabled, onClick } = props;
  return (
    <button
      type="button"
      className={`cv-rail__item${on ? ' is-on' : ''}`}
      aria-pressed={on}
      disabled={disabled}
      title={`${label} — ${hint}`}
      aria-label={label}
      onClick={onClick}
    >
      <Icon size={17} />
    </button>
  );
}

/* -------------------------------------------------------------- the top bar */

function TopBar(props: {
  editor: Editor;
  name: string;
  setName: (name: string) => void;
  /** Whether this design is already a saved project, or not yet one. */
  saved: boolean;
  /** Whether the name on screen differs from the one the server holds. */
  renamed: boolean;
  saving: boolean;
  autosave: AutosaveState;
  error: string | undefined;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onClose: () => void;
}): ReactElement {
  const { editor, name, setName, saved, renamed, saving, autosave, error, onSave, onSaveAs, onExport, onClose } = props;
  const { verdict } = editor;
  const stats = summarise(editor.doc);
  const untitled = name.trim() === '';
  /**
   * Save is lit while there is something to write and goes out when there is not.
   *
   * A brand-new design is the exception that makes the rule: it has nothing
   * *changed*, and it still has never been filed, so "nothing to save" is the
   * wrong answer for it. Hence `saved` rather than `dirty` deciding the second
   * half of this.
   *
   * `renamed` is in there because a name is saved but is not in the document, so
   * it is the one edit `dirty` is blind to by construction.
   */
  const savable = !saving && !untitled && (!saved || editor.dirty || renamed);

  return (
    <header className="cv-top">
      <div className="cv-top__left">
        <button type="button" className="cv-icon" onClick={onClose} aria-label="Close the canvas" title="Close">
          <X size={15} />
        </button>
        <span className="cv-top__mark" aria-hidden="true"><Frame size={14} /></span>
        <div className="cv-top__title">
          <input
            className="cv-top__name"
            value={name}
            placeholder="Name this design"
            aria-label="Design name"
            onChange={(event) => setName(event.target.value)}
          />
          <span className="cv-top__sub mono">
            {editor.doc.artboard.width} × {editor.doc.artboard.height}
            {' · '}
            {stats.total} layer{stats.total === 1 ? '' : 's'}
            {stats.files > 0 ? ` · ${stats.files} file${stats.files === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </div>

      <div className="cv-top__centre">
        <button type="button" className="cv-icon" disabled={!editor.canUndo}
          onClick={editor.undo} title={editor.canUndo ? `Undo — ${editor.undoLabel}` : 'Nothing to undo'} aria-label="Undo">
          <Undo2 size={15} />
        </button>
        <button type="button" className="cv-icon" disabled={!editor.canRedo}
          onClick={editor.redo} title={editor.canRedo ? `Redo — ${editor.redoLabel}` : 'Nothing to redo'} aria-label="Redo">
          <Redo2 size={15} />
        </button>
      </div>

      <div className="cv-top__right">
        {verdict.status === 'clean' ? (
          <span className="cv-badge cv-badge--clean" title="Every layer on this design is inside the brand">
            <Check size={12} /> On brand
          </span>
        ) : (
          <span
            className={`cv-badge cv-badge--${verdict.status}`}
            title={verdict.errors > 0
              ? `${verdict.errors} thing${verdict.errors === 1 ? '' : 's'} to fix, ${verdict.warnings} to look at`
              : `${verdict.warnings} thing${verdict.warnings === 1 ? '' : 's'} worth a look`}
          >
            <TriangleAlert size={12} />
            {verdict.errors > 0
              ? `${verdict.errors} to fix`
              : `${verdict.warnings} to look at`}
          </span>
        )}

        <button type="button" className="cv-button" onClick={onExport} title="Export this design">
          <Download size={14} /> Export
        </button>
        <button
          type="button"
          className="cv-button cv-button--primary"
          disabled={!savable}
          onClick={onSave}
          title={untitled ? 'Give the design a name first' : 'Save this design'}
        >
          <Save size={14} /> {saving ? 'Saving…' : saved ? 'Save' : 'Save design'}
        </button>
        {/* A second copy, only once there is a first. */}
        {saved ? (
          <button type="button" className="cv-button" onClick={onSaveAs} title="Save this design again, under a new name">
            Save a copy
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="cv-top__error" role="alert">
          <TriangleAlert size={13} /> {error}
        </p>
      ) : null}
      {stats.total === 0 ? (
        <p className="cv-top__hint">
          This sheet is empty. Put a logo, a picture or some type on it from the library on the left.
        </p>
      ) : null}
    </header>
  );
}

/* --------------------------------------------------------- the status bar */

function StatusBar(props: {
  editor: Editor;
  snapping: boolean;
  autosave: AutosaveState;
  onSnapping: (on: boolean) => void;
}): ReactElement {
  const { editor, snapping, autosave, onSnapping } = props;
  return (
    <footer className="cv-status">
      <span className="cv-status__left">{editor.status}</span>
      <span className="cv-status__right">
        <button
          type="button"
          className={`cv-status__chip${snapping ? ' is-on' : ''}`}
          aria-pressed={snapping}
          onClick={() => onSnapping(!snapping)}
          title="Snap to guides, thirds and the canvas edges"
        >
          Snap
        </button>
        <span className="cv-status__zoom mono" title="Zoom. 1 fits the sheet, 0 is 100%.">
          {Math.round(editor.state.zoom * 100)}%
        </span>
        <span className="cv-status__save mono" role="status">
          {describeSave(autosave)}
        </span>
      </span>
    </footer>
  );
}

/** What the status bar says about the last write, in the fewest words that fit. */
function describeSave(state: AutosaveState): string {
  switch (state.kind) {
    case 'waiting': return 'Unsaved';
    case 'saving': return 'Saving…';
    case 'saved': return `Saved ${state.at}`;
    case 'failed': return `Not saved — ${state.message}`;
    case 'idle': return '';
  }
}

/* ----------------------------------------------------------------- opening */

/**
 * The document to open, from a saved design.
 *
 * **`undefined` for something that is not a canvas document**, and the create
 * sheet opens instead. A configuration that has been written by something other
 * than this editor — or corrupted — should not put half a document on the
 * artboard and then refuse every save because of it. Opening the create sheet is
 * a recoverable answer; a canvas that cannot save is not.
 */
export function openedFrom(project: BrandProject | undefined): CanvasDocument | undefined {
  const raw: unknown = project?.configuration;
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as Partial<CanvasDocument>;
  if (!Array.isArray(candidate.nodes) || typeof candidate.artboard !== 'object') return undefined;
  return normalise(candidate as CanvasDocument).doc;
}
