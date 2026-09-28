import { useState, type ReactElement } from 'react';
import { api } from '../api.js';

/**
 * How EDSAI says who a client is.
 *
 * One component, because a logo is not a decoration to be sprinkled where a
 * name happens to appear — it is the client's identity, and the same client has
 * to look the same everywhere they are recognised. Every surface that draws a
 * client draws them through this: the client list, a client's own header, the
 * sidebar rail, the discovery index, a project card. A screen that grew its own
 * `<img src={client.logo}>` is how a list ends up on the old logo while the
 * header is on the new one.
 *
 * **The fallback is the point.** Most clients arrive without a mark, so initials
 * are the normal case and the logo is the exception, not the reverse. A missing
 * or broken logo is never a broken-image glyph in a client list — it is two
 * letters in the same box, which is also what makes the row scannable when half
 * the studio has no logo yet.
 *
 * Resolution is always the canonical client record, never a logo URL copied into
 * the row being drawn. That is what makes a logo change propagate: one write to
 * one record, and every surface follows on the next render.
 */

/**
 * The client's initials.
 *
 * First and last, because that is what a person reads: "Campus Turkey" is `CT`,
 * "Sweet Haven Bakery" is `SB`. A single word takes its own second letter rather
 * than doubling its first, so "Aurelia" is `AU` and not `AA` — the doubled form
 * looks like a typo rather than an initial.
 *
 * Last rather than second, so a three-word name is `ABA` and not `ABC`: "The
 * Daily Grind" is `TG`. It also matches what the sidebar, the client list and
 * the account avatar each did on their own, which is why removing those copies
 * changed nothing anyone could see.
 *
 * This was written out four times in this codebase, in files that could not see
 * each other — and twice with a different rule, so the same client read `TG` in
 * the sidebar and `TD` on its own project card. One copy is the fix; the tests
 * hold it.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

export type IdentitySize = 'xs' | 'sm' | 'md' | 'lg';

export interface ClientIdentityProps {
  /** A client record, or the two fields of one — whichever the caller has. */
  client: { name: string; logoAssetId?: string };
  /**
   * `xs` a calendar event card, `sm` a table row or the sidebar rail, `md` a
   * card, `lg` a workspace header. `xs` exists because the calendar has to name
   * whose meeting it is on a chip two lines tall, and shrinking `sm` with CSS
   * from outside would be a second set of rules for the same mark.
   */
  size?: IdentitySize;
  /** Whether the name is rendered beside the mark. Off for a mark on its own. */
  showName?: boolean;
  /** The element the name renders as, so a table cell can stay a cell. */
  as?: 'span' | 'div';
  className?: string;
}

export function ClientIdentity({
  client, size = 'md', showName = true, as = 'span', className,
}: ClientIdentityProps): ReactElement {
  // A logo that fails to load is a 410 from storage, a revoked portal key, or
  // bytes that were never there. All three land in the same place, which is the
  // same place as never having had one: initials. Reset on the id so replacing
  // a logo re-attempts it rather than leaving the fallback stuck.
  const [failedId, setFailedId] = useState<string | undefined>();
  const logoId = client.logoAssetId;
  const showLogo = logoId !== undefined && logoId !== '' && failedId !== logoId;
  const Name = as === 'div' ? 'div' : 'span';

  return (
    <span className={['client-identity', `is-${size}`, className].filter(Boolean).join(' ')}
          data-has-logo={showLogo ? 'yes' : 'no'}>
      <span className="client-mark">
        {showLogo && (
          <img
            className="client-mark-image"
            src={api.logoPath(logoId)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailedId(logoId)}
          />
        )}
        {!showLogo && <span className="client-mark-initials" aria-hidden="true">
          {initialsOf(client.name)}
        </span>}
      </span>
      {showName && <Name className="client-identity-name">{client.name}</Name>}
    </span>
  );
}
