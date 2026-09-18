import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type BrandValue } from '../api.js';

/**
 * The brand workspace.
 *
 * Editing is meant to feel like typing a hex code, not like filing a change
 * request: a value that still holds up saves on the spot, with nothing asked
 * for. The only time this interrupts is when an edit takes a value below what
 * it needs — and then it asks once, because whoever meets that value next will
 * want to know it was a decision rather than an accident.
 *
 * The ratio beside each swatch is not decoration. It is recomputed by the same
 * instrument the pipeline uses, on every save, which is what lets an edited
 * value still be published to a client as a measured one.
 */

function Swatch({ value, clientId }: { value: BrandValue; clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(value.value);
  const [reason, setReason] = useState('');
  const [needsReason, setNeedsReason] = useState(false);

  const save = useMutation({
    mutationFn: () => api.editBrandValue(clientId, value.name, {
      value: draft, ...(reason.trim() ? { reason: reason.trim() } : {}),
    }),
    onSuccess: () => {
      setNeedsReason(false); setReason('');
      void queryClient.invalidateQueries({ queryKey: ['brand', clientId] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 422) setNeedsReason(true);
    },
  });

  const measured = value.measured;
  const dirty = draft.trim() !== value.value;

  return (
    <div className="swatch">
      {value.kind === 'color' && (
        <div className="swatch-chip" style={{ background: safeColor(draft) }} />
      )}
      <div className="swatch-body">
        <div className="row">
          <strong>{value.name}</strong>
          {/* "Edited" means changed from what the run produced. A value typed
              in by hand has no earlier version to differ from, so calling it
              edited says nothing — it was just added. */}
          {value.origin === 'studio' && value.sourceRunId
            && <span className="pill minor">edited</span>}
        </div>
        {value.role && <p className="role muted">{value.role}</p>}

        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <input
            className="mono"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setNeedsReason(false); }}
            aria-label={`${value.name} value`}
            spellCheck={false}
          />

          {measured?.note && (
            <p className={`measured ${measured.passes === false ? 'err' : 'ok'}`}>
              {measured.note}
            </p>
          )}

          {needsReason && (
            <div className="stack" style={{ marginTop: 8 }}>
              {/* `needsReason` is our state and `save.error` is the mutation's;
                  they are not updated in the same tick. On the retry render this
                  block is still open while the error has already been cleared,
                  and reading `.message` off null took the whole page down. */}
              {save.error && (
                <p className="err" style={{ margin: 0 }}>{(save.error as Error).message}</p>
              )}
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this worth it?"
                aria-label="Reason for this change"
                autoFocus
              />
            </div>
          )}

          {save.error && !needsReason && (
            <p className="err">{(save.error as Error).message}</p>
          )}

          {(dirty || needsReason) && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" type="submit"
                      disabled={save.isPending || (needsReason && !reason.trim())}>
                {save.isPending ? 'Saving…' : needsReason ? 'Save anyway' : 'Save'}
              </button>
              <button type="button" onClick={() => {
                setDraft(value.value); setNeedsReason(false); setReason('');
              }}>Reset</button>
            </div>
          )}
        </form>

        {value.reason && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Changed by hand: {value.reason}
          </p>
        )}
      </div>
    </div>
  );
}

const SAFE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\))$/i;
const safeColor = (value: string): string =>
  (SAFE.test(value.trim()) ? value.trim() : 'transparent');

export default function Brand({ clientId }: { clientId: string }): ReactElement {
  const { data: values, isPending, error } = useQuery({
    queryKey: ['brand', clientId], queryFn: () => api.brand(clientId),
  });

  if (isPending) return <p className="muted">Loading the brand…</p>;
  if (error) return <p className="err">{(error as Error).message}</p>;

  const colours = values.filter((value) => value.kind === 'color');
  const type = values.filter((value) => value.kind === 'font' || value.kind === 'size');
  const rest = values.filter((value) => !['color', 'font', 'size'].includes(value.kind));
  const failing = values.filter((value) => value.measured?.passes === false);

  if (values.length === 0) {
    return (
      <div className="empty">
        <p className="editorial">This brand has no values yet.</p>
        <p>
          Seed it from a run that cleared the gate, and every colour arrives with the ratio the
          instruments measured. After that it is yours to edit — each change is re-measured on
          save, so the numbers a client sees stay true.
        </p>
      </div>
    );
  }

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Brand system</h3>
        <span className="muted mono">{values.length} values</span>
        {failing.length > 0 && (
          <span className="pill blocker" style={{ marginLeft: 'auto' }}>
            {failing.length} below target
          </span>
        )}
      </div>

      {colours.length > 0 && (
        <>
          <p className="label">Colour</p>
          <div className="swatches">
            {colours.map((value) => (
              <Swatch key={value.name} value={value} clientId={clientId} />
            ))}
          </div>
        </>
      )}

      {type.length > 0 && (
        <>
          <p className="label">Typography</p>
          <div className="swatches">
            {type.map((value) => (
              <Swatch key={value.name} value={value} clientId={clientId} />
            ))}
          </div>
        </>
      )}

      {rest.length > 0 && (
        <>
          <p className="label">Other</p>
          <div className="swatches">
            {rest.map((value) => (
              <Swatch key={value.name} value={value} clientId={clientId} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
