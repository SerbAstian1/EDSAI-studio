import { api, type Asset, type BrandAsset, type BrandModule } from '../api.js';

/**
 * Putting a finished design into the brand's library.
 *
 * **This is the loop the Brand Hub is built around.** A client makes a pattern in
 * Pattern Studio, and that pattern has to become something the rest of the hub
 * can work from — otherwise every module is a dead end and the "Asset Lab" is
 * just a room with a download button in it. So a generated design is not only
 * downloaded; it can also be filed as a `BrandAsset`, which is a pointer to a
 * stored file plus the record of what made it.
 *
 * **Two steps, deliberately in that order.** The bytes go up as an ordinary
 * `Asset` first, using the same upload every other file in this product uses,
 * and only a file that exists is pointed at. Registering first would leave a
 * design row referring to a file that never arrived, which is a broken library
 * entry rather than a missing one — and a missing file the user retried, where a
 * broken entry they would have to be told about.
 *
 * **The upload is not approved, because a design the client just made is already
 * approved by the act of making it.** Approving is the studio's call for files
 * *they* supplied; a generation has no studio in the loop, and a pattern that
 * has to wait for a studio to notice it is useless in a self-serve hub.
 */

export interface LibrarySave {
  clientId: string;
  /** Which module produced it — the server refuses a tool this hub does not offer. */
  toolId: string;
  /** The design's own word, e.g. `pattern`, `poster`, `illustration`. */
  kind: string;
  format: string;
  blob: Blob;
  filename: string;
  width?: number;
  height?: number;
  /** The saved design this was made from, so the two can be traced apart later. */
  projectId?: string;
  /** Which preset it was on, so the library can be grouped by it. */
  presetId?: string;
  /** The brand file it was tiled from or built out of. */
  sourceAssetId?: string;
}

export interface LibrarySaveResult {
  /** The stored file, for a thumbnail or a link. */
  asset: Asset;
  /** The library row pointing at it. */
  design: BrandAsset;
}

/**
 * Upload a design and register it, in that order.
 *
 * Throws on either half failing, and the caller reports it where the button
 * was. A registered-but-unuploaded design cannot happen; an uploaded-but-
 * unregistered file is an orphan in Files, which the studio can clear and which
 * nobody has to be told about.
 */
export async function saveToLibrary(input: LibrarySave): Promise<LibrarySaveResult> {
  const asset = await api.uploadAsset(input.clientId, new File([input.blob], input.filename, { type: input.blob.type }), {
    // A collection of its own, so the studio's Files screen can separate a
    // generation from a brand asset without a database join.
    collection: 'brand-generations',
  });
  const design = await api.createBrandAsset(input.clientId, {
    assetId: asset.id,
    toolId: input.toolId,
    kind: input.kind,
    format: input.format,
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.presetId ? { presetId: input.presetId } : {}),
    ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
  });
  return { asset, design };
}

/**
 * Whether a module's output is worth filing.
 *
 * A module that only draws on the canvas — the social post, the poster — has
 * nothing to feed the Asset Lab, because another module cannot tile a finished
 * social post into a pattern without producing exactly the wrong thing. Those
 * are left to the download button, which is the honest outcome rather than a
 * library slowly filling with things nothing can use.
 */
export function filesIntoLibrary(module: BrandModule): boolean {
  return module.layer === 'asset-lab';
}
