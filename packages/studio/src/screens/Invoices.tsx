import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil, Trash2 } from 'lucide-react';
import { api, type Invoice } from '../api.js';
import { requestConfirmation } from '../components/ConfirmDialog.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { InvoiceBuilder } from '../components/InvoiceBuilder.js';
import OverflowMenu from '../components/OverflowMenu.js';
import { formatBasisPoints, formatCents, toCents } from '../money.js';
import { StudioOnly } from '../viewMode.js';

/**
 * What has been billed, and whether it was paid.
 *
 * This studio does not move money. `paid` is a flag the studio sets once its
 * own bookkeeping — wherever that actually happens — says it is true; nothing
 * here calls a payment processor. `overdue` is never set by hand: it is
 * computed from `dueDate` fresh on every read, on both this panel and the
 * client's own portal, so the two can never disagree about what today is.
 */

const STATUS_TONE: Record<Invoice['status'], string> = { paid: 'pass', pending: 'minor', overdue: 'Blocker' };

function InvoiceRow({ invoice, onChanged, onRevised }: {
  invoice: Invoice; onChanged: () => void; onRevised: (invoice: Invoice) => void;
}): ReactElement {
  const setPaid = useMutation({
    mutationFn: (paid: boolean) => api.updateInvoice(invoice.id, { paid }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteInvoice(invoice.id),
    onSuccess: onChanged,
  });

  const onDelete = (): void => {
    void requestConfirmation({
      title: `Remove invoice ${invoice.number}?`,
      message: 'This removes the invoice record and its lines. It cannot be undone.',
      confirmLabel: 'Remove invoice',
    }).then((confirmed) => { if (confirmed) remove.mutate(); });
  };

  return (
    <tr>
      <td className="mono" data-label="Invoice">{invoice.number}</td>
      <td data-label="Description">
        {invoice.description}
        {/*
          The lines, when there are any, said once and quietly. A studio member
          looking at a total needs to know whether it was derived or typed, and a
          click-through to the builder for that is one step too many.
        */}
        {invoice.lines.length > 0 && (
          <span className="muted" style={{ fontSize: 12, display: 'block' }}>
            {invoice.lines.length} line{invoice.lines.length === 1 ? '' : 's'}
            {invoice.taxBasisPoints > 0 && ` · ${formatBasisPoints(invoice.taxBasisPoints)} tax`}
            {invoice.terms && ' · terms stated'}
          </span>
        )}
      </td>
      <td className="muted" data-label="Due">{invoice.dueDate}</td>
      <td className="mono" data-label="Amount">{formatCents(invoice.amountCents, invoice.currency)}</td>
      <td data-label="Status"><span className={`pill ${STATUS_TONE[invoice.status]}`}>{invoice.status}</span></td>
      <td className="actions"><div className="row">
        {/* "Mark paid" records that money arrived, which is the studio's own
            bookkeeping to declare — a client marking their own invoice paid
            would be a client asserting a fact about the studio's account. */}
        <StudioOnly>
          <button type="button" onClick={() => setPaid.mutate(!invoice.paid)} disabled={setPaid.isPending}>
            {invoice.paid ? 'Mark unpaid' : 'Mark paid'}
          </button>
        </StudioOnly>
        <OverflowMenu label={`Actions for invoice ${invoice.number}`} items={[
          { label: 'View invoice', icon: FileText,
            onSelect: () => { window.open(api.invoiceDocumentUrl(invoice.id), '_blank', 'noopener'); } },
          { label: 'Revise the invoice', icon: Pencil, studioOnly: true, onSelect: () => onRevised(invoice) },
          { label: 'Remove', icon: Trash2, danger: true, disabled: remove.isPending, studioOnly: true, onSelect: onDelete },
        ]} />
      </div></td>
    </tr>
  );
}

/** Dollars a person types in, as the integer cents the record actually stores. */
export const dollarsToCents = toCents;

export { formatCents } from '../money.js';

export default function Invoices({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [revising, setRevising] = useState<Invoice | undefined>();

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['invoices', clientId], queryFn: () => api.invoices(clientId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['invoices', clientId] });
  };

  const close = (): void => { setAdding(false); setRevising(undefined); };
  const saved = (): void => { close(); invalidate(); };

  const totals = data?.totals;

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Invoices</h3>
        <span className="muted mono">{data?.invoices.length ?? 0}</span>
        {/* What a client is owed is theirs to read; raising a new one is the
            studio's. The two sit on the same tab because the client should not
            have to go looking for what they owe. */}
        <StudioOnly>
          <button type="button" style={{ marginLeft: 'auto' }}
                  onClick={() => { close(); setAdding((o) => !o); }}>
            {adding ? 'Cancel' : 'New invoice'}
          </button>
        </StudioOnly>
      </div>

      {totals && totals.count > 0 && (
        <div className="stat-row">
          <div className="stat"><span className="label">Total invoiced</span>
            <span className="metric" style={{ fontSize: 20 }}>{formatCents(totals.totalCents)}</span></div>
          <div className="stat"><span className="label">Paid</span>
            <span className="metric" style={{ fontSize: 20 }}>{formatCents(totals.paidCents)}</span></div>
          <div className="stat"><span className="label">Pending</span>
            <span className="metric" style={{ fontSize: 20 }}>{formatCents(totals.pendingCents)}</span></div>
          <div className="stat"><span className="label">Overdue</span>
            <span className="metric" style={{ fontSize: 20 }}>{formatCents(totals.overdueCents)}</span></div>
        </div>
      )}

      <StudioOnly>
        {adding && (
          <InvoiceBuilder clientId={clientId} onSaved={saved} onCancel={close} />
        )}
        {revising && (
          <InvoiceBuilder clientId={clientId} invoice={revising} onSaved={saved} onCancel={close} />
        )}
      </StudioOnly>

      {isPending && <p className="muted">Loading invoices…</p>}
      {error && (
        <ErrorPanel
          title="Could not load invoices"
          error={error}
          onRetry={() => { void refetch(); }}
        />
      )}

      {data && data.invoices.length === 0 && !adding && (
        <p className="muted">No invoices yet.</p>
      )}

      {data && data.invoices.length > 0 && (
        <table className="stacky">
          <thead>
            <tr><th>Invoice</th><th>Description</th><th>Due</th><th>Amount</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {data.invoices.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} onChanged={invalidate}
                          onRevised={(target) => { close(); setRevising(target); }} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
