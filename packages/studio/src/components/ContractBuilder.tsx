import { useState, type ReactElement } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { api, type Contract, type ContractFee, type ContractFeeInput } from '../api.js';
import { requestConfirmation } from './ConfirmDialog.js';
import Markdown from './Markdown.js';
import { formatCents, toCents } from '../money.js';
import { StudioOnly } from '../viewMode.js';

/**
 * A contract, written by a person, and never by a model.
 *
 * This is the one document in the system that binds anybody, so the builder is
 * shaped around what it is *not* allowed to do:
 *
 * - There is no "draft for me" button, and there is no path to one. A clause a
 *   machine invented and sent to a client as terms is the failure this system
 *   exists to avoid, so the body is a Markdown box a person fills in and the
 *   server only ever renders and stores what arrives.
 * - A revision is a revision, not an overwrite. The studio has to say what
 *   changed, because somebody may already have agreed to the text being
 *   replaced and "which version did they sign" has to stay answerable.
 * - The lifecycle is a lifecycle, and the studio cannot skip through it. Sending
 *   an empty contract is refused with a sentence rather than a red button,
 *   rewriting the terms of a signed one is refused outright, and a voided
 *   contract stays void — because voiding is what a studio does instead of
 *   deleting a document somebody signed.
 * - The signature line is blank. The server records three facts when a signature
 *   comes back — sent, returned, and the name typed on the line — and it does
 *   not sign for anybody.
 *
 * `templates` are starting points, not content: each one is an empty document
 * with headings a person has to fill in, because a template that arrives with
 * clauses in it is a template nobody read.
 */

const FEE_KINDS: readonly ContractFee['kind'][] = ['retainer', 'deposit', 'milestone', 'final', 'other'];

const STATUS_TONE: Record<Contract['status'], string> = {
  draft: 'minor', sent: 'minor', signed: 'pass', declined: 'err', void: 'err',
};

interface Template {
  id: string;
  name: string;
  /** One line saying what this is for, shown before anything is chosen. */
  blurb: string;
  markdown: string;
}

const templates: readonly Template[] = [
  {
    id: 'services',
    name: 'Services agreement',
    blurb: 'What the studio will do, when, and what it costs.',
    markdown: [
      '## What we will do',
      '',
      '<!-- What is being delivered, in the client’s own words where possible. -->',
      '',
      '## When',
      '',
      '## What it costs',
      '',
      '## What is not included',
      '',
      '## How either of us ends this',
    ].join('\n'),
  },
  {
    id: 'nda',
    name: 'Confidentiality',
    blurb: 'Both ways, for material that should not travel.',
    markdown: [
      '## What is confidential',
      '',
      '## Who may see it',
      '',
      '## How long this lasts',
      '',
      '## What happens on the last day',
    ].join('\n'),
  },
  {
    id: 'blank',
    name: 'Blank',
    blurb: 'A titled document with nothing in it yet.',
    markdown: '',
  },
];

const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];

let nextFee = 0;
interface DraftFee {
  key: number;
  description: string;
  /** As typed, in major units, because that is what a person writes. */
  amount: string;
  kind: ContractFee['kind'];
  dueDate: string;
}

const blankFee = (): DraftFee => ({ key: nextFee++, description: '', amount: '', kind: 'milestone', dueDate: '' });

function toDraftFee(fee: ContractFee): DraftFee {
  return {
    key: nextFee++,
    description: fee.description,
    amount: (fee.amountCents / 100).toFixed(2),
    kind: fee.kind,
    dueDate: fee.dueDate?.slice(0, 10) ?? '',
  };
}

/** The fee as the record will hold it, or the reason it is not one yet. */
function toFeeInput(fee: DraftFee): { input?: ContractFeeInput; problem?: string } {
  if (!fee.description.trim()) return { problem: 'a fee needs a description' };
  const amountCents = toCents(fee.amount);
  if (amountCents === undefined) return { problem: 'a fee needs an amount' };
  return {
    input: {
      description: fee.description.trim(),
      amountCents,
      kind: fee.kind,
      ...(fee.dueDate ? { dueDate: fee.dueDate } : {}),
    },
  };
}

const draftFeesTo = (fees: readonly DraftFee[]): {
  inputs: ContractFeeInput[]; problems: string[]; totalCents: number;
} => {
  const read = fees.map(toFeeInput);
  const inputs = read.flatMap((r) => (r.input ? [r.input] : []));
  return {
    inputs,
    problems: read.flatMap((r) => (r.problem ? [r.problem] : [])),
    totalCents: inputs.reduce((sum, fee) => sum + fee.amountCents, 0),
  };
};

function ContractCard({ contract, onChanged }: {
  contract: Contract; onChanged: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(contract.title);
  const [markdown, setMarkdown] = useState(contract.markdown);
  const [note, setNote] = useState('');
  const [fees, setFees] = useState<DraftFee[]>(contract.fees.map(toDraftFee));
  const [error, setError] = useState<string | undefined>();
  const [signer, setSigner] = useState('');

  const signed = contract.status === 'signed';
  const voided = contract.status === 'void';
  // The stated figure is a sum of what is already stored, so it is read from the
  // record rather than from the editor: the editor is mid-edit half the time and
  // a heading that flickers between two numbers is a worse heading.
  const stated = contract.fees.reduce((sum, fee) => sum + fee.amountCents, 0);

  const run = useMutation({
    mutationFn: (input: Parameters<typeof api.updateContract>[1]) => api.updateContract(contract.id, input),
    onSuccess: () => { setEditing(false); setError(undefined); onChanged(); },
    onError: (caught) => setError((caught as Error).message),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteContract(contract.id),
    onSuccess: onChanged,
  });

  const onDelete = (): void => {
    void requestConfirmation({
      title: `Delete ${contract.number}?`,
      message: 'This removes the contract and its revisions. A contract carrying a signature is '
        + 'refused — void that one instead, so it stays on the record.',
      confirmLabel: 'Delete contract',
    }).then((confirmed) => { if (confirmed) remove.mutate(); });
  };

  const saveRevision = (): void => {
    const read = draftFeesTo(fees);
    if (read.problems[0]) { setError(`Cannot save: ${read.problems[0]}.`); return; }
    setError(undefined);
    run.mutate({
      title: title.trim() || contract.title,
      markdown,
      fees: read.inputs,
      note: note.trim() || 'Terms revised.',
    });
  };

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="row">
        <h4 style={{ margin: 0 }}>{contract.title}</h4>
        <span className={`pill ${STATUS_TONE[contract.status]}`} style={{ marginLeft: 'auto' }}>
          {contract.status}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
        <span className="mono">{contract.number}</span>
        {' · '}{contract.fees.length === 0
          ? 'no fees stated'
          : `${formatCents(stated, contract.currency)} stated in ${contract.currency}`}
        {contract.sentAt && <> {' · '}sent {contract.sentAt.slice(0, 10)}</>}
      </p>

      {contract.signedAt ? (
        <p className="contract-signed" style={{ fontSize: 13 }}>
          Recorded as signed by <strong>{contract.signedBy}</strong> on {contract.signedAt.slice(0, 10)},
          on the server&rsquo;s date. The terms under it cannot be rewritten here — void it and send
          a new contract, so it stays answerable which version was signed.
        </p>
      ) : contract.sendable.reason && (
        <p className="muted" style={{ fontSize: 13 }}>{contract.sendable.reason}</p>
      )}

      {editing ? (
        <div className="stack">
          <input value={title} aria-label="Contract title"
                 onChange={(e) => setTitle(e.target.value)} />
          <span className="label">What changed, and why</span>
          <input value={note} placeholder="Added the revision rounds" aria-label="Revision note"
                 onChange={(e) => setNote(e.target.value)} />
          <span className="label">The terms</span>
          <textarea rows={16} value={markdown} onChange={(e) => setMarkdown(e.target.value)} />

          <span className="label">Fees</span>
          {fees.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>No fees.</p>}
          <FeeRows fees={fees} onChange={setFees} />
          <div>
            <button type="button" onClick={() => setFees((c) => [...c, blankFee()])}>
              <Plus size={14} aria-hidden="true" /> Add a fee
            </button>
          </div>

          {error && <p className="err">{error}</p>}
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" onClick={saveRevision} disabled={run.isPending}>
              {run.isPending ? 'Saving…' : 'Save the revision'}
            </button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="contract-terms"><Markdown text={contract.markdown} /></div>

          {contract.fees.length > 0 && (
            <table className="stacky" style={{ marginTop: 12 }}>
              <thead><tr><th>Fee</th><th>Kind</th><th>Due</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {contract.fees.map((fee) => (
                  <tr key={fee.id}>
                    <td>{fee.description}</td>
                    <td className="muted">{fee.kind}</td>
                    <td className="muted">{fee.dueDate?.slice(0, 10) ?? '—'}</td>
                    <td className="mono num">{formatCents(fee.amountCents, contract.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {contract.revisions.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
                {contract.revisions.length} revision{contract.revisions.length === 1 ? '' : 's'} on record
              </summary>
              <ol className="stack" style={{ fontSize: 13 }}>
                {contract.revisions.map((revision, i) => (
                  <li key={`${revision.at}-${i}`}>
                    <span className="muted">{revision.at.slice(0, 10)} — {revision.by}:</span>{' '}
                    {revision.note}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}

      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <StudioOnly>
          {!editing && !signed && !voided && (
            <button onClick={() => setEditing(true)}>Revise</button>
          )}
          {!editing && contract.status === 'draft' && contract.sendable.ready && (
            <button onClick={() => run.mutate({ status: 'sent' })} disabled={run.isPending}>
              Mark as sent
            </button>
          )}
          {!editing && !signed && !voided && contract.status !== 'draft' && (
            <button onClick={() => run.mutate({ status: 'declined' })} disabled={run.isPending}>
              Record a decline
            </button>
          )}
          {!editing && !voided && (
            <button onClick={() => run.mutate({ status: 'void' })} disabled={run.isPending}>
              Void
            </button>
          )}
        </StudioOnly>

        {!editing && !signed && contract.status === 'sent' && (
          <div className="row contract-sign" style={{ gap: 6 }}>
            <input value={signer} placeholder="Name on the signature line"
                   aria-label="Name on the signature line"
                   onChange={(e) => setSigner(e.target.value)} />
            <button className="primary" disabled={!signer.trim() || run.isPending}
                    onClick={() => run.mutate({ status: 'signed', signedBy: signer.trim() })}>
              Record the signature
            </button>
          </div>
        )}

        <a className="link row" style={{ gap: 5, marginLeft: 'auto' }}
           href={api.contractDocumentUrl(contract.id)} target="_blank" rel="noreferrer">
          <FileText size={14} aria-hidden="true" /> Open for print
        </a>
        <StudioOnly>
          {!editing && !signed && (
            <button onClick={onDelete} disabled={remove.isPending}
                    aria-label={`Delete ${contract.number}`}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </StudioOnly>
      </div>

      {(error || run.error || remove.error) && (
        <p className="err">{((error ?? run.error ?? remove.error) as Error).message}</p>
      )}
    </div>
  );
}

/** Fee rows, shared by the create form and the revision editor. */
function FeeRows({ fees, onChange }: {
  fees: readonly DraftFee[];
  onChange: (next: DraftFee[]) => void;
}): ReactElement {
  const patch = (key: number, changes: Partial<DraftFee>): void => {
    onChange(fees.map((fee) => (fee.key === key ? { ...fee, ...changes } : fee)));
  };
  return (
    <>
      {fees.map((fee, index) => (
        <div className="row invoice-line" key={fee.key}>
          <input className="invoice-line-desc" value={fee.description}
                 aria-label={`Fee ${index + 1} description`} placeholder="Deposit, on signature"
                 onChange={(e) => patch(fee.key, { description: e.target.value })} />
          <input className="invoice-line-price" value={fee.amount} inputMode="decimal"
                 aria-label={`Fee ${index + 1} amount`} placeholder="4800.00"
                 onChange={(e) => patch(fee.key, { amount: e.target.value })} />
          <select className="invoice-line-kind" value={fee.kind} aria-label={`Fee ${index + 1} kind`}
                  onChange={(e) => patch(fee.key, { kind: e.target.value as ContractFee['kind'] })}>
            {FEE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <input type="date" value={fee.dueDate} aria-label={`Fee ${index + 1} due date`}
                 onChange={(e) => patch(fee.key, { dueDate: e.target.value })} />
          <button type="button" className="icon" aria-label={`Remove fee ${index + 1}`}
                  onClick={() => onChange(fees.filter((f) => f.key !== fee.key))}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      ))}
    </>
  );
}

export function ContractBuilder({ clientId, onChanged }: {
  clientId: string; onChanged: () => void;
}): ReactElement {
  const { data, isPending, error: readError, refetch } = useQuery({
    queryKey: ['contracts', clientId], queryFn: () => api.contracts(clientId),
  });

  const [adding, setAdding] = useState(false);
  const [template, setTemplate] = useState<string>(templates[0]?.id ?? 'blank');
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [markdown, setMarkdown] = useState(templates[0]?.markdown ?? '');
  const [feeDrafts, setFeeDrafts] = useState<DraftFee[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const chosen = templates.find((t) => t.id === template) ?? templates[templates.length - 1];
  const draft = draftFeesTo(feeDrafts);

  const create = async (): Promise<void> => {
    setError(undefined);
    if (draft.problems[0]) { setError(`Cannot save: ${draft.problems[0]}.`); return; }
    setBusy(true);
    try {
      await api.createContract(clientId, {
        // Left off entirely rather than sent as undefined: an empty title is the
        // server's cue to name the contract after the client, and a key that is
        // present but blank is a different instruction.
        ...(title.trim() ? { title: title.trim() } : {}),
        currency,
        markdown,
        fees: draft.inputs,
      });
      setAdding(false);
      setTitle('');
      setMarkdown(templates[0]?.markdown ?? '');
      setFeeDrafts([]);
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = (): void => { onChanged(); void refetch(); };
  const contracts = data ?? [];

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Contracts</h3>
        <span className="muted" style={{ fontSize: 13 }}>
          Studio-written, and the only document here that binds anybody
        </span>
        <StudioOnly>
          <button type="button" style={{ marginLeft: 'auto' }}
                  onClick={() => { setAdding((o) => !o); setError(undefined); }}>
            {adding ? 'Cancel' : 'New contract'}
          </button>
        </StudioOnly>
      </div>

      {adding && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            The terms are yours to write. There is no drafting here on purpose: a clause a machine
            wrote and sent as terms is the thing this screen exists to prevent. A template only
            supplies headings — every word under them is a person&rsquo;s.
          </p>

          <span className="label">Start from</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {templates.map((t) => (
              <button key={t.id} type="button" className={template === t.id ? 'primary' : ''}
                      aria-pressed={template === t.id} title={t.blurb}
                      onClick={() => { setTemplate(t.id); setMarkdown(t.markdown); }}>
                {t.name}
              </button>
            ))}
          </div>
          {chosen && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{chosen.blurb}</p>}

          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 2 }}>
              <span className="label">Title</span>
              <input value={title} placeholder="Left blank, and the client’s name is used"
                     onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            <label className="field" style={{ width: 110 }}>
              <span className="label">Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
          </div>

          <label className="field">
            <span className="label">The terms</span>
            <textarea rows={18} value={markdown} onChange={(e) => setMarkdown(e.target.value)} />
          </label>

          <span className="label">Fees</span>
          {feeDrafts.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              None stated. A contract can be written without a fee schedule — but a money page with
              nothing in it is the mistake this field is here to prevent.
            </p>
          ) : (
            <>
              <FeeRows fees={feeDrafts} onChange={setFeeDrafts} />
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {formatCents(draft.totalCents, currency)} stated across {feeDrafts.length}{' '}
                fee{feeDrafts.length === 1 ? '' : 's'}.
              </p>
            </>
          )}
          <div>
            <button type="button" onClick={() => setFeeDrafts((c) => [...c, blankFee()])}>
              <Plus size={14} aria-hidden="true" /> Add a fee
            </button>
          </div>

          {error && <p className="err">{error}</p>}
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'File the draft'}
            </button>
            <button type="button" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}

      {isPending && <p className="muted">Loading contracts…</p>}
      {readError && (
        <p className="muted">
          Contracts could not be read: {(readError as Error).message}{' '}
          <button type="button" onClick={() => { void refetch(); }}>Try again</button>
        </p>
      )}

      {!isPending && !readError && contracts.length === 0 && (
        <p className="muted">
          No contracts yet. A contract is not a document slot with a different label — it is the
          one thing here that gets signed, which is why it has its own screen, its own revisions,
          and no drafting at all.
        </p>
      )}

      {contracts.map((contract) => (
        <ContractCard key={contract.id} contract={contract} onChanged={refresh} />
      ))}
    </section>
  );
}
