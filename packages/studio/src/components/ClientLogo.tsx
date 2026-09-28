import { useRef, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { api, type Client } from '../api.js';
import { ClientIdentity } from './ClientIdentity.js';
import { requestConfirmation } from './ConfirmDialog.js';
import { StudioOnly } from '../viewMode.js';
import { reportNotice } from '../notices.js';

/**
 * A client's own mark: upload it, replace it, take it away.
 *
 * On the client's settings tab rather than in the header's edit form, for the
 * same reason the file library is its own tab — a logo is a *file*, goes
 * through the asset pipeline, and is a thing you come back to rather than a
 * field you fill in. Editing the record is a form; this is an operation.
 *
 * Three affordances, and which one is offered depends only on whether a logo
 * exists — not on whether the studio can already tell it is the wrong file:
 *
 *   - none    → Upload logo
 *   - one     → Replace logo, and Remove logo
 *
 * Removing asks first. It is the only one of the three that loses something a
 * person cannot get back by doing it again, and "remove" next to a preview of
 * the thing being removed is exactly the click that happens by accident.
 *
 * The server enforces the same rules this UI assumes — an image type, a 2 MB
 * ceiling, and `write` on the client's assets — so a client whose session
 * cannot manage this sees a 400 or a 403 rather than a silent success. The file
 * input is validated here too, but only to say *why*, earlier: the API is the
 * boundary, not this.
 */
export function ClientLogo({ client }: { client: Client }): ReactElement {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | undefined>();

  /**
   * Every client surface reads the logo from the client record, so invalidating
   * `['client', id]` and `['clients']` is the whole propagation. Nothing else
   * holds a copy: the discovery index resolves it per read, and no table stores
   * a logo of its own.
   */
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['client', client.id] });
    void queryClient.invalidateQueries({ queryKey: ['clients'] });
    // The studio-wide onboarding index resolves the mark per request, so its
    // cache entry is stale the moment this write lands.
    void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
  };

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadLogo(client.id, file),
    onSuccess: (result) => {
      setRejected(undefined);
      invalidate();
      reportNotice(
        result.removedPrevious
          ? `Logo replaced. ${client.name} now shows their new mark.`
          : `Logo uploaded. ${client.name} now shows their mark.`,
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => api.removeLogo(client.id),
    onSuccess: () => {
      invalidate();
      reportNotice(`Logo removed. ${client.name} is back to their initials.`);
    },
  });

  const onRemove = (): void => {
    void requestConfirmation({
      title: `Remove ${client.name}’s logo?`,
      message: 'The file is deleted and they go back to their initials. You can upload it '
        + 'again later, but this one cannot be recovered.',
      confirmLabel: 'Remove logo',
    }).then((confirmed) => { if (confirmed) remove.mutate(); });
  };

  /**
   * The client-side type and size check.
   *
   * Deliberately duplicating the server's list rather than importing it: this
   * runs before there is a request to make, and its only job is to explain
   * itself in the same sentence the API would have. The server is still the one
   * that decides — a browser check is a courtesy, never a control.
   */
  const onPick = (file: File | undefined): void => {
    if (!file) return;
    const type = file.type || 'application/octet-stream';
    if (!/^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(type)) {
      setRejected('A logo has to be an image — PNG, JPEG, WebP, AVIF, GIF or SVG.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setRejected('A logo can be up to 2 MB. A larger file is probably the artwork rather '
        + 'than the mark — export it as PNG, WebP or SVG.');
      return;
    }
    setRejected(undefined);
    upload.mutate(file);
  };

  const hasLogo = client.logoAssetId !== undefined && client.logoAssetId !== '';
  const busy = upload.isPending || remove.isPending;
  const error = (upload.error ?? remove.error) as Error | undefined;

  return (
    <div className="stack">
      <div className="row">
        <span className="label">Logo</span>
        <StudioOnly>
          <span style={{ marginLeft: 'auto' }} className="row">
            <button type="button" disabled={busy} onClick={() => input.current?.click()}>
              <Upload className="glyph" size={14} strokeWidth={1.75} aria-hidden="true" />
              {hasLogo ? 'Replace logo' : 'Upload logo'}
            </button>
            {hasLogo && (
              <button type="button" disabled={busy} onClick={onRemove}>Remove logo</button>
            )}
          </span>
        </StudioOnly>
      </div>

      {/* One preview, drawn by the same component every other surface uses, so
          what is approved here is literally what the sidebar will show. */}
      <div className="row">
        <ClientIdentity size="md" client={client} />
        <span className="muted" style={{ fontSize: 13 }}>
          {hasLogo
            ? 'Shown beside their name in the studio and the portal.'
            : 'No logo yet, so their initials stand in for it. A square mark with breathing '
              + 'room reads best; PNG, WebP or SVG.'}
        </span>
      </div>

      {/* Clipped, and out of the tab order, so the button above is the one
          control a keyboard reaches — a second focus stop on an element nobody
          can see is worse than no second stop at all. The picker it opens is the
          browser's own and fully keyboard-operable, so nothing is lost by
          taking the input itself out of the sequence. `accept` is still set,
          because it filters the OS file dialog even when the input is never
          focused. */}
      <input
        ref={input}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml"
        className="sr-only"
        onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
      />

      {busy && <p className="muted" style={{ fontSize: 13 }}>{upload.isPending ? 'Uploading…' : 'Removing…'}</p>}
      {(rejected || error) && (
        <p className="err" style={{ fontSize: 13 }}>{rejected ?? error?.message}</p>
      )}
    </div>
  );
}
