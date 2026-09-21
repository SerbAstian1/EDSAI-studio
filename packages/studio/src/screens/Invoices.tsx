import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Invoice } from '../api.js';

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

/** Dollars a person types in, as the integer cents the record actually stores. */
export function dollarsToCents(input: string): number | undefined {
  const trimmed = input.trim().replace(/^\$/, '');
  if (trimmed === '') return undefined;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

export function formatCents(cents: number, currency = 'USD'): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency });
}

export default function Invoices({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');

  const { data, isPending, error } = useQuery({
    queryKey: ['invoices', clientId], queryFn: () => api.invoices(clientId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['invoices', clientId] });
  };

  const cents = dollarsToCents(amount);

  const create = useMutation({
    mutationFn: () => api.createInvoice(clientId, {
      description: description.trim(), issueDate, dueDate, amountCents: cents ?? 0,
    }),
    onSuccess: () => {
      setDescription(''); setAmount(''); setDueDate(''); setAdding(false); invalidate();
    },
  });

  const setPaid = useMutation({
    mutationFn: (input: { id: string; paid: boolean }) =>
      api.updateInvoice(input.id, { paid: input.paid }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteInvoice(id),
    onSuccess: invalidate,
  });

  const totals = data?.totals;

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Invoices</h3>
        <span className="muted mono">{data?.invoices.length ?? 0}</span>
        <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setAdding((o) => !o)}>
          {adding ? 'Cancel' : 'New invoice'}
        </button>
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

      {adding && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label className="field">
            <span className="label">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
                   placeholder="Phase 1 payment — planning & research" required autoFocus />
          </label>
          <label className="field">
            <span className="label">Amount (USD)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)}
                   placeholder="1500.00" inputMode="decimal" required />
          </label>
          <label className="field">
            <span className="label">Issue date</span>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </label>
          {create.error && <p className="err">{(create.error as Error).message}</p>}
          <button
            className="primary" type="submit"
            disabled={!description.trim() || cents === undefined || !dueDate || create.isPending}
          >
            {create.isPending ? 'Adding…' : 'Add invoice'}
          </button>
        </form>
      )}

      {isPending && <p className="muted">Loading invoices…</p>}
      {error && <p className="err">Could not load invoices. {(error as Error).message}</p>}

      {data && data.invoices.length === 0 && !adding && (
        <p className="muted">No invoices yet.</p>
      )}

      {data && data.invoices.length > 0 && (
        <table>
          <thead>
            <tr><th>Invoice</th><th>Description</th><th>Due</th><th>Amount</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {data.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="mono">{invoice.number}</td>
                <td>{invoice.description}</td>
                <td className="muted">{invoice.dueDate}</td>
                <td className="mono">{formatCents(invoice.amountCents, invoice.currency)}</td>
                <td><span className={`pill ${STATUS_TONE[invoice.status]}`}>{invoice.status}</span></td>
                <td className="row" style={{ gap: 6 }}>
                  <button type="button" onClick={() => setPaid.mutate({
                    id: invoice.id, paid: !invoice.paid,
                  })}>
                    {invoice.paid ? 'Mark unpaid' : 'Mark paid'}
                  </button>
                  <a href={api.invoiceDocumentUrl(invoice.id)} target="_blank" rel="noreferrer">
                    <button type="button">View</button>
                  </a>
                  <button type="button" onClick={() => remove.mutate(invoice.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
