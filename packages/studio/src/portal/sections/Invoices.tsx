import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Client, type Invoice } from '../../api.js';
import { ErrorPanel } from '../../components/ErrorPanel.js';
import { formatCents } from '../../screens/Invoices.js';

// `Blocker` is the run rubric's severity vocabulary and has no business in a
// client's invoice table; `major` carries the same weight in the stylesheet
// without borrowing a word from a system they cannot see.
const STATUS_TONE: Record<Invoice['status'], string> = { paid: 'pass', pending: 'minor', overdue: 'major' };

/** What a client reads, rather than the enum the database stores. */
const STATUS_LABEL: Record<Invoice['status'], string> = {
  paid: 'Paid', pending: 'Due', overdue: 'Overdue',
};

export default function InvoicesSection({ client }: { client: Client }): ReactElement {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['invoices', client.id], queryFn: () => api.invoices(client.id),
  });

  const totals = data?.totals;

  return (
    <section className="stack">
      <div>
        <p className="label mono">07</p>
        <h1 className="display" style={{ fontSize: 32, margin: 0 }}>Invoices</h1>
        <p className="muted" style={{ maxWidth: '56ch' }}>
          View and download every project invoice and payment history in one place.
        </p>
      </div>

      {isPending && <p className="muted">Loading…</p>}
      {error && (
        <ErrorPanel
          title="Could not load invoices"
          error={error}
          onRetry={() => { void refetch(); }}
        />
      )}

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

      {data && data.invoices.length === 0 && (
        <div className="empty">
          <p className="editorial">No invoices yet.</p>
          <p>Your studio's billing for this project will appear here.</p>
        </div>
      )}

      {data && data.invoices.length > 0 && (
        <table>
          <thead><tr><th>Invoice</th><th>Description</th><th>Due</th><th>Amount</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="mono">{invoice.number}</td>
                <td>{invoice.description}</td>
                <td className="muted">{invoice.dueDate}</td>
                <td className="mono">{formatCents(invoice.amountCents, invoice.currency)}</td>
                <td>
                  <span className={`pill ${STATUS_TONE[invoice.status]}`}>
                    {STATUS_LABEL[invoice.status]}
                  </span>
                </td>
                <td>
                  <a href={api.invoiceDocumentUrl(invoice.id)} target="_blank" rel="noreferrer">
                    <button type="button">Download</button>
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ fontSize: 13 }}>
        Have a question about an invoice or payment? Contact your project manager.
      </p>
    </section>
  );
}
