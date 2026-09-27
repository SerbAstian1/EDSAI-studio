import { useMemo, useState, type ReactElement } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, type Invoice, type InvoiceLineInput } from '../api.js';
import { formatBasisPoints, formatCents, subtotalCents, taxCents, toBasisPoints, toCents, toHundredths } from '../money.js';

/**
 * An invoice, written the way an invoice is actually written.
 *
 * The old form asked for a description and an amount, because that is all an
 * invoice was for years and the studio still has records shaped like it. That
 * shape stays available — the first tab of this builder is exactly that form —
 * but it is now the smaller half of the story, because the arithmetic behind it
 * lived in somebody's head or in a spreadsheet nobody else could read.
 *
 * What the line-item half changes is not the layout, it is who is trusted with
 * the total:
 *
 * - The studio types quantities and unit prices, never a line amount and never a
 *   total. A line that disagrees with itself is an arithmetic error nobody
 *   notices until a client does.
 * - Quantities are hundredths and money is minor units, in the form, because
 *   `7.5 * 12000` in floating point is not 90000.
 * - Tax is a *rate* the studio proposes, not an amount. Who owes what tax is a
 *   question for a jurisdiction and an accountant; what the studio decided to
 *   propose is a fact it can be held to.
 * - The totals shown here are a preview. The server derives them again on the
 *   way in and stores that, so a preview that drifted could mislead for a second
 *   but could never corrupt the record. See `src/money.ts` for why the arithmetic
 *   is stated twice rather than imported.
 *
 * The builder is also how an existing invoice is revised, because a total that
 * was wrong is fixed by changing the line that was wrong, not by typing over the
 * answer.
 */

interface DraftLine {
  /** Stable across edits, so a row being typed into does not jump. */
  key: number;
  description: string;
  /** As typed, because "7." is a moment every quantity passes through. */
  quantity: string;
  unitAmount: string;
}

let nextKey = 0;

const blankLine = (): DraftLine => ({ key: nextKey++, description: '', quantity: '1', unitAmount: '' });

/** The line as the record will hold it, or the reason it is not one yet. */
function toInput(line: DraftLine): { input?: InvoiceLineInput; problem?: string } {
  const quantityHundredths = toHundredths(line.quantity);
  if (line.quantity.trim() === '' || quantityHundredths === undefined) {
    return { problem: 'a quantity is a number' };
  }
  if (quantityHundredths <= 0) return { problem: 'a quantity has to be more than nothing' };
  const unitAmountCents = toCents(line.unitAmount);
  if (unitAmountCents === undefined) return { problem: 'a unit price is a number' };
  if (!line.description.trim()) return { problem: 'a line needs a description' };
  return {
    input: {
      description: line.description.trim(),
      quantityHundredths,
      unitAmountCents,
    },
  };
}

/** A stored line back into a row somebody can edit. */
function toDraftLine(line: Invoice['lines'][number]): DraftLine {
  return {
    key: nextKey++,
    description: line.description,
    // 750 becomes "7.5", not "750", because this is a field a person reads.
    quantity: String(line.quantityHundredths / 100),
    unitAmount: (line.unitAmountCents / 100).toFixed(2),
  };
}

const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];

export function InvoiceBuilder({
  clientId,
  invoice,
  onSaved,
  onCancel,
}: {
  clientId: string;
  /** Present when revising an existing invoice rather than writing a new one. */
  invoice?: Invoice;
  onSaved: () => void;
  onCancel: () => void;
}): ReactElement {
  const revising = invoice !== undefined;
  const [mode, setMode] = useState<'lines' | 'single'>(
    revising ? (invoice.lines.length > 0 ? 'lines' : 'single') : 'lines');
  const [description, setDescription] = useState(invoice?.description ?? '');
  const [currency, setCurrency] = useState(invoice?.currency ?? 'USD');
  const [issueDate, setIssueDate] = useState(invoice?.issueDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(invoice?.dueDate.slice(0, 10) ?? '');
  const [terms, setTerms] = useState(invoice?.terms ?? '');
  const [tax, setTax] = useState(String((invoice?.taxBasisPoints ?? 0) / 100));
  const [singleAmount, setSingleAmount] = useState(
    revising ? (invoice.amountCents / 100).toFixed(2) : '');
  const [lines, setLines] = useState<DraftLine[]>(() => (invoice?.lines ?? []).map(toDraftLine));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /*
   * The preview, derived on every keystroke from the same integer rules the
   * server will use. It is a `useMemo` rather than state so it cannot fall out
   * of step with the fields it is showing.
   */
  const preview = useMemo(() => {
    const read = lines.map(toInput);
    const problems = read.flatMap((r, i) => (r.problem ? [`Line ${i + 1} needs ${r.problem}.`] : []));
    const complete = read.flatMap((r) => (r.input ? [r.input] : []));
    const subtotal = mode === 'lines'
      ? subtotalCents(complete)
      : (toCents(singleAmount) ?? 0);
    const basisPoints = toBasisPoints(tax) ?? 0;
    return {
      problems: mode === 'lines' ? problems : [],
      subtotal,
      basisPoints,
      tax: taxCents(subtotal, basisPoints),
      total: subtotal + taxCents(subtotal, basisPoints),
      complete,
    };
  }, [lines, mode, singleAmount, tax]);

  const patch = (key: number, changes: Partial<DraftLine>): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  };

  const save = async (): Promise<void> => {
    setError(undefined);
    if (!description.trim()) { setError('An invoice needs a description.'); return; }
    if (!dueDate) { setError('An invoice needs a due date.'); return; }
    if (mode === 'lines' && lines.length === 0) {
      setError('Add a line, or switch to the one-number form.');
      return;
    }
    if (preview.problems.length > 0) { setError(preview.problems[0]); return; }
    const basisPoints = toBasisPoints(tax) ?? 0;
    setBusy(true);
    try {
      if (revising) {
        /*
         * A revision sends the whole line set, because the server replaces it
         * rather than diffing it. Sending a partial set here would delete the
         * lines nobody mentioned.
         */
        await api.updateInvoice(invoice.id, {
          description: description.trim(),
          dueDate,
          ...(mode === 'lines'
            ? { lines: preview.complete, taxBasisPoints: basisPoints }
            : { lines: [], taxBasisPoints: basisPoints, amountCents: toCents(singleAmount) ?? 0 }),
          ...(terms.trim() ? { terms: terms.trim() } : { terms: null }),
        });
      } else {
        await api.createInvoice(clientId, {
          description: description.trim(), issueDate, dueDate, currency,
          ...(mode === 'lines'
            ? { lines: preview.complete, taxBasisPoints: basisPoints }
            : { amountCents: toCents(singleAmount) ?? 0, taxBasisPoints: basisPoints }),
          ...(terms.trim() ? { terms: terms.trim() } : {}),
        });
      }
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="row">
        <span className="label" style={{ margin: 0 }}>{revising ? `Revising ${invoice.number}` : 'New invoice'}</span>
        <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
          <button type="button" className={mode === 'lines' ? 'primary' : ''}
                  aria-pressed={mode === 'lines'}
                  onClick={() => setMode('lines')}>Line items</button>
          <button type="button" className={mode === 'single' ? 'primary' : ''}
                  aria-pressed={mode === 'single'}
                  onClick={() => setMode('single')}>One number</button>
        </div>
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 2 }}>
          <span className="label">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
                 placeholder="Phase 1 — planning &amp; research" required autoFocus />
        </label>
        <label className="field" style={{ width: 110 }}>
          <span className="label">Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={revising}>
            {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="field">
          <span className="label">Issue date</span>
          <input type="date" value={issueDate} disabled={revising}
                 onChange={(e) => setIssueDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Due date</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </label>
        <label className="field" style={{ width: 130 }}>
          <span className="label">Tax rate %</span>
          <input value={tax} inputMode="decimal" placeholder="0"
                 onChange={(e) => setTax(e.target.value)} />
        </label>
      </div>

      {mode === 'single' ? (
        <label className="field">
          <span className="label">Amount ({currency})</span>
          <input value={singleAmount} inputMode="decimal" placeholder="1500.00"
                 onChange={(e) => setSingleAmount(e.target.value)} required />
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            The older shape, kept because years of records are exactly this: one number and a
            description. There is nothing to add up, so there is nothing to disagree about.
          </p>
        </label>
      ) : (
        <div className="stack">
          <span className="label">What was billed</span>
          {lines.length === 0 && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              No lines yet. One line is a rate; several are a schedule.
            </p>
          )}
          {lines.map((line, index) => {
            const read = toInput(line);
            const amount = read.input
              ? Math.round((read.input.quantityHundredths * read.input.unitAmountCents) / 100)
              : undefined;
            return (
              <div className="row invoice-line" key={line.key}>
                <input
                  className="invoice-line-desc"
                  value={line.description}
                  aria-label={`Line ${index + 1} description`}
                  placeholder="Discovery workshop"
                  onChange={(e) => patch(line.key, { description: e.target.value })}
                />
                <input
                  className="invoice-line-qty"
                  value={line.quantity}
                  inputMode="decimal"
                  aria-label={`Line ${index + 1} quantity`}
                  placeholder="7.5"
                  onChange={(e) => patch(line.key, { quantity: e.target.value })}
                />
                <span className="muted" aria-hidden="true">×</span>
                <input
                  className="invoice-line-price"
                  value={line.unitAmount}
                  inputMode="decimal"
                  aria-label={`Line ${index + 1} unit price`}
                  placeholder="120.00"
                  onChange={(e) => patch(line.key, { unitAmount: e.target.value })}
                />
                <span className="mono invoice-line-amount" style={{ textAlign: 'right' }}>
                  {amount === undefined ? '—' : formatCents(amount, currency)}
                </span>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
                {read.problem && index === lines.length - 1 && (
                  <span className="err" style={{ fontSize: 12 }}>{read.problem}</span>
                )}
              </div>
            );
          })}
          <div>
            <button type="button" onClick={() => setLines((c) => [...c, blankLine()])}>
              <Plus size={14} aria-hidden="true" /> Add a line
            </button>
          </div>
        </div>
      )}

      <div className="invoice-totals">
        <div className="row"><span className="muted">Subtotal</span>
          <span className="mono">{formatCents(preview.subtotal, currency)}</span></div>
        <div className="row">
          <span className="muted">
            Tax at {formatBasisPoints(preview.basisPoints)} <span className="pill minor">proposed</span>
          </span>
          <span className="mono">{formatCents(preview.tax, currency)}</span>
        </div>
        <div className="row invoice-total"><span>Total</span>
          <span className="mono">{formatCents(preview.total, currency)}</span></div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          A preview. The server adds these up again on the way in and stores that, so a total can
          never drift from the lines under it.
        </p>
      </div>

      <label className="field">
        <span className="label">Terms</span>
        <textarea rows={2} value={terms} placeholder="Net 14. Bank transfer to the studio account."
                  onChange={(e) => setTerms(e.target.value)} />
      </label>

      {error && <p className="err">{error}</p>}

      <div className="row" style={{ gap: 8 }}>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : revising ? 'Save the revision' : 'Add the invoice'}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
