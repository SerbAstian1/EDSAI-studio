import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Assets: the files a client actually downloads.
 *
 * **Where they live, and why it is not the designer's laptop.** The portal is
 * the place a client gets everything, so the files have to sit somewhere a
 * client's browser can reach — which means beside the API that serves the
 * portal, not on a machine behind someone's router. Today that is the server's
 * own disk; `AssetStore` is the seam, so moving to rented object storage later
 * is one adapter and no change a client would notice.
 *
 * **Content-addressed.** A file is stored under the SHA-256 of its bytes, never
 * under its name. Three consequences, and the first is the one that matters:
 *
 * - **A filename never touches the filesystem**, so `../../etc/passwd` is a
 *   label in a database row and not a path. Path traversal is not defended
 *   against here; it is unreachable.
 * - The same logo uploaded to four clients is stored once.
 * - Re-uploading an identical file is idempotent rather than a duplicate.
 *
 * The client-visible name lives in the record, and is only ever used in a
 * `Content-Disposition` header on the way out.
 */

export const AssetKind = z.enum([
  'logo', 'photography', 'video', 'font', 'icon', 'illustration',
  'document', 'presentation', 'template', 'other',
]);
export type AssetKind = z.infer<typeof AssetKind>;

export const Asset = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  /** SHA-256 of the bytes. The only thing that locates the file. */
  digest: z.string().length(64),
  /** What the client sees and downloads it as. Never used as a path. */
  filename: z.string().min(1),
  kind: AssetKind.default('other'),
  contentType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  /** Free-text grouping — "logos", "summer campaign". Drives limited access. */
  collection: z.string().optional(),
  description: z.string().optional(),
  /** Whether the studio has cleared this for the client to see. */
  approved: z.boolean().default(false),
  uploadedAt: z.string(),
});
export type Asset = z.infer<typeof Asset>;

/** The seam. Disk today; object storage later, with no caller changing. */
export interface AssetStore {
  put(bytes: Buffer): string;
  get(digest: string): Buffer | undefined;
  has(digest: string): boolean;
  size(digest: string): number | undefined;
  remove(digest: string): void;
}

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const DIGEST = /^[0-9a-f]{64}$/;

/**
 * Files on disk, addressed by digest.
 *
 * Sharded two levels deep: a single directory with tens of thousands of entries
 * is slow to list on most filesystems, and this is the standard cheap fix.
 */
export class DiskAssetStore implements AssetStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private pathFor(digest: string): string {
    // The digest comes from `createHash` and cannot contain a separator — but
    // it is validated anyway, because this is the one place where assuming it
    // would matter.
    if (!DIGEST.test(digest)) throw new Error('not a digest');
    return join(this.root, digest.slice(0, 2), digest.slice(2, 4), digest);
  }

  put(bytes: Buffer): string {
    const digest = createHash('sha256').update(bytes).digest('hex');
    const path = this.pathFor(digest);
    if (existsSync(path)) return digest;
    mkdirSync(join(this.root, digest.slice(0, 2), digest.slice(2, 4)), { recursive: true });
    writeFileSync(path, bytes);
    return digest;
  }

  get(digest: string): Buffer | undefined {
    try {
      const path = this.pathFor(digest);
      return existsSync(path) ? readFileSync(path) : undefined;
    } catch {
      return undefined;
    }
  }

  has(digest: string): boolean {
    try {
      return existsSync(this.pathFor(digest));
    } catch {
      return false;
    }
  }

  size(digest: string): number | undefined {
    try {
      const path = this.pathFor(digest);
      return existsSync(path) ? statSync(path).size : undefined;
    } catch {
      return undefined;
    }
  }

  remove(digest: string): void {
    try {
      const path = this.pathFor(digest);
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // Already gone is the outcome that was asked for.
    }
  }
}

/** For tests, and for anything that should not touch a disk. */
export class MemoryAssetStore implements AssetStore {
  private readonly files = new Map<string, Buffer>();

  put(bytes: Buffer): string {
    const digest = createHash('sha256').update(bytes).digest('hex');
    this.files.set(digest, bytes);
    return digest;
  }

  get(digest: string): Buffer | undefined { return this.files.get(digest); }
  has(digest: string): boolean { return this.files.has(digest); }
  size(digest: string): number | undefined { return this.files.get(digest)?.byteLength; }
  remove(digest: string): void { this.files.delete(digest); }
}

/**
 * What a file may be served as.
 *
 * The attack this closes: someone uploads `payload.html`, it is opened from the
 * portal, and it runs as script on the portal's own origin with that person's
 * session. So an upload is only ever served back with a type from this list —
 * anything else becomes `application/octet-stream`, which browsers download
 * rather than render.
 *
 * SVG is deliberately absent despite being an image: it can carry script, and a
 * logo is exactly the kind of file someone uploads. It is stored and downloaded,
 * never rendered inline.
 */
const INLINE_SAFE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf', 'video/mp4', 'font/woff2', 'font/woff',
]);

export function safeContentType(claimed: string): string {
  const type = claimed.split(';')[0]?.trim().toLowerCase() ?? '';
  return INLINE_SAFE.has(type) ? type : 'application/octet-stream';
}

/** Whether a browser may render it in place, or must be made to download it. */
export function mustDownload(claimed: string): boolean {
  return safeContentType(claimed) === 'application/octet-stream';
}

/**
 * Characters a filename may not carry into a header.
 *
 * Built from code points rather than escape literals: a quote or a newline in a
 * filename would let it inject header fields, and control characters are
 * invisible in a diff, which is exactly when a reviewer stops seeing them.
 */
const UNSAFE_IN_HEADER = new Set<number>([
  0x22, // "
  0x5c, // backslash
  0x2f, // /
  0x7f, // delete
]);

function isUnsafeForHeader(code: number): boolean {
  return code < 0x20 || UNSAFE_IN_HEADER.has(code);
}

/**
 * A filename safe to put in a `Content-Disposition` header.
 *
 * The result is a label. The file is located by digest regardless of what this
 * returns, so a hostile name is cosmetic rather than dangerous.
 */
export function safeFilename(name: string): string {
  let cleaned = '';
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (!isUnsafeForHeader(code)) cleaned += character;
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned === '' ? 'download' : cleaned;
}

/** Guess a kind from the type, so the studio does not have to pick one. */
export function kindFor(contentType: string, filename: string): AssetKind {
  const type = contentType.toLowerCase();
  const name = filename.toLowerCase();
  if (name.endsWith('.svg') || /logo|mark|wordmark/.test(name)) return 'logo';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('font/') || /\.(woff2?|otf|ttf)$/.test(name)) return 'font';
  if (type === 'application/pdf') return 'document';
  if (type.startsWith('image/')) return 'photography';
  return 'other';
}
