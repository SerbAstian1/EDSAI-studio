import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import type { BrandModule, BrandProject } from '../api.js';
import { saveToLibrary } from '../components/brandLibrary.js';
import { renderJpg, renderPng, renderSvg, saveBlob } from '../components/toolkit.js';
import { designSvg, exportName } from './render.js';
import { judge } from './brandCheck.js';
import {
  DESIGN_SIZES, DESIGN_TEMPLATES, documentFromTemplate,
  type DesignSize, type DesignTemplate, type TemplateBrand,
} from './templates.js';
import { summarise, type Editor } from './useEditor.js';
import { ActionButton, ChoiceField, NumberField, Row, Sheet } from './fields.js';

/**
 * The two moments the editor cannot do work: before there is a sheet, and after
 * the design is finished.
 *
 * **Both are sheets rather than panels.** A designer picking a size is not
 * editing, and a designer choosing a format has already made the design —
 * neither has anything to look at behind the dialog, so neither needs a panel
 * taking a third of the screen to say four things.
 *
 * **The create sheet previews the real template, not a picture of one.** The
 * preview is `designSvg` over the actual nodes at the actual size, so what a
 * designer picks is what they will edit. A template that looked different once
 * it was live would be a lie told before they started.
 */

/** The exports a design can be written as, and the reason each one exists. */
const FORMATS = [
  { id: 'png', label: 'PNG', detail: 'Lossless, with transparency. The safe default.' },
  { id: 'jpg', label: 'JPEG', detail: 'Smaller, for photograph-heavy artwork. The sheet is baked in.' },
  { id: 'svg', label: 'SVG', detail: 'Vector. Type and shapes stay sharp at any size; layers are not kept.' },
] as const;

type Format = (typeof FORMATS)[number]['id'];

/** The pixel multiples a raster export can be drawn at. */
const SCALES = [0.5, 1, 2, 3] as const;

/* ------------------------------------------------------------------ creating */

export function CreateSheet(props: {
  brand: TemplateBrand;
  onClose: () => void;
  onStart: (size: DesignSize, template: DesignTemplate) => void;
}): ReactElement {
  const { brand, onClose, onStart } = props;
  const [size, setSize] = useState<DesignSize>(DESIGN_SIZES[0]!);
  const [template, setTemplate] = useState<DesignTemplate>(DESIGN_TEMPLATES[0]!);
  const groups = [...new Set(DESIGN_SIZES.map((entry) => entry.group))];

  // A template names no files — see `templates.ts` — so the href function is
  // never called and the empty one is honest rather than a stub.
  const preview = designSvg(documentFromTemplate(size, template, brand), () => '');

  return (
    <Sheet
      title="New design"
      note="Pick a size, then a starting layout. Everything on it stays editable."
      onClose={onClose}
      wide
    >
      <div className="cv-create">
        <div className="cv-create__sizes">
          <h4>Size</h4>
          {groups.map((group) => (
            <div key={group} className="cv-create__group">
              <p className="cv-create__group-name">{group}</p>
              <div className="cv-create__size-grid">
                {DESIGN_SIZES.filter((entry) => entry.group === group).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`cv-create__size${entry.id === size.id ? ' is-on' : ''}`}
                    aria-pressed={entry.id === size.id}
                    onClick={() => setSize(entry)}
                  >
                    {/* The chip is the size drawn to scale, which is the fastest
                        way to tell a story format from a print one. */}
                    <span
                      className="cv-create__chip"
                      style={{ aspectRatio: `${entry.width} / ${entry.height}` }}
                      aria-hidden="true"
                    />
                    <span className="cv-create__size-label">{entry.label}</span>
                    <span className="mono muted">{entry.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="cv-create__right">
          <h4>Start from</h4>
          <div className="cv-create__templates">
            {DESIGN_TEMPLATES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`cv-create__template${entry.id === template.id ? ' is-on' : ''}`}
                aria-pressed={entry.id === template.id}
                onClick={() => setTemplate(entry)}
              >
                <strong>{entry.label}</strong>
                <span>{entry.detail}</span>
              </button>
            ))}
          </div>

          <div className="cv-create__preview">
            <p className="cv-create__preview-label">{size.label} · {size.detail}</p>
            <div className="cv-create__canvas" dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        </div>
      </div>

      <footer className="cv-sheet__foot">
        <ActionButton label="Cancel" onClick={onClose} />
        <ActionButton
          label={`Start — ${template.label.toLowerCase()}`}
          tone="primary"
          onClick={() => onStart(size, template)}
        />
      </footer>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ exporting */

export function ExportSheet(props: {
  editor: Editor;
  clientId: string;
  module: BrandModule;
  project: BrandProject | undefined;
  name: string;
  /** The brand's export allowlist, already narrowed by the server. */
  allowed: readonly string[];
  href: (assetId: string) => string;
  onClose: () => void;
}): ReactElement {
  const { editor, clientId, module, project, name, allowed, href, onClose } = props;

  /**
   * **An empty allowlist means "no restriction", not "nothing".**
   *
   * The server narrows `module.exports` from the hub's rules, and a hub written
   * before this feature has no rules at all — so an empty list here is a client
   * who has not been told otherwise, and offering them no formats would be the
   * tool deciding to be useless. The fallback is the safe format rather than a
   * blank panel, because a sheet with nothing in it has no way to recover.
   */
  const offered = FORMATS.filter((entry) => allowed.length === 0 || allowed.includes(entry.id));
  const usable = offered.length > 0 ? offered : [FORMATS[0]!];
  const [format, setFormat] = useState<Format>(usable[0]!.id);
  const [scale, setScale] = useState<string>('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [filed, setFiled] = useState(false);

  const chosen = usable.find((entry) => entry.id === format) ?? usable[0]!;
  const art = editor.doc.artboard;
  const width = Math.round(art.width * Number(scale));
  const height = Math.round(art.height * Number(scale));
  const basename = exportName(clientId, name, chosen.id, width, height);
  const verdict = judge(editor.doc, undefined);

  /**
   * The bytes, once.
   *
   * A download and a library entry are two different acts with the same source,
   * so the render is one function rather than duplicated per button — and the
   * string they are made from is the string the artboard is showing.
   */
  const bytes = async (): Promise<Blob> => {
    const svg = designSvg(editor.doc, href);
    if (chosen.id === 'svg') return renderSvg(svg);
    if (chosen.id === 'jpg') return renderJpg(svg, width, height);
    return renderPng(svg, width, height);
  };

  const download = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      saveBlob(await bytes(), `${basename}.${chosen.id}`);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const file = useLibrarySave({
    clientId,
    module,
    project,
    bytes,
    filename: `${basename}.${chosen.id}`,
    format: chosen.id,
    width,
    height,
    onFiled: () => setFiled(true),
    onError: setError,
  });

  return (
    <Sheet title="Export" note={`${width} × ${height}px — ${basename}.${chosen.id}`} onClose={onClose}>
      <div className="cv-export">
        <ChoiceField
          label="Format"
          value={format}
          options={usable.map((entry) => ({ id: entry.id, label: entry.label, hint: entry.detail }))}
          onChange={setFormat}
        />
        <p className="cv-export__detail">{chosen.detail}</p>

        {chosen.id === 'svg' ? (
          <p className="cv-export__detail">
            SVG has no size setting: it is the artboard’s own dimensions, and it stays sharp at all of them.
          </p>
        ) : (
          <ChoiceField
            label="Size"
            value={scale}
            options={SCALES.map((s) => ({ id: String(s), label: `${s}×` }))}
            onChange={setScale}
          />
        )}

        <Row>
          <NumberField label="Artboard width" value={art.width} onChange={() => undefined} disabled />
          <NumberField label="Artboard height" value={art.height} onChange={() => undefined} disabled />
        </Row>

        {verdict.errors > 0 ? (
          <p className="cv-issue cv-issue--error">
            <TriangleAlert size={13} />
            <span>
              {verdict.errors} thing{verdict.errors === 1 ? '' : 's'} on this design
              {verdict.errors === 1 ? ' is' : ' are'} off-brand. It will still export — the client
              asked for the file, not for permission.
            </span>
          </p>
        ) : null}

        {summarise(editor.doc).files === 0 ? (
          <p className="cv-export__detail">
            This design has no client files in it, so the export has nothing to inline.
          </p>
        ) : null}

        {error ? <p className="cv-issue cv-issue--error"><TriangleAlert size={13} /><span>{error}</span></p> : null}
        {filed ? <p className="cv-issue cv-issue--ok">Filed in the brand library.</p> : null}
      </div>

      <footer className="cv-sheet__foot">
        <ActionButton label={filed ? 'Filed' : 'File to library'} disabled={busy || filed} onClick={file} />
        <ActionButton label={busy ? 'Working…' : 'Download'} tone="primary" disabled={busy} onClick={download} />
      </footer>
    </Sheet>
  );
}

/** The library write, as a mutation, because it is a request like any other. */
function useLibrarySave(input: {
  clientId: string;
  module: BrandModule;
  project: BrandProject | undefined;
  bytes: () => Promise<Blob>;
  filename: string;
  format: string;
  width: number;
  height: number;
  onFiled: () => void;
  onError: (message: string) => void;
}): () => void {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      // Rendered here rather than inside `saveToLibrary` because the library wants
      // the finished bytes, and the bytes are the only thing that cannot be made
      // twice from the same document without the two files differing.
      const blob = await input.bytes();
      return saveToLibrary({
        clientId: input.clientId,
        toolId: input.module.id,
        kind: 'design',
        format: input.format,
        blob,
        filename: input.filename,
        width: input.width,
        height: input.height,
        ...(input.project ? { projectId: input.project.id } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brand-assets', input.clientId] });
      void queryClient.invalidateQueries({ queryKey: ['assets', input.clientId] });
      input.onFiled();
    },
    onError: (failure: Error) => input.onError(failure.message),
  });
  return () => { save.mutate(); };
}
