import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { requestConfirmation } from '../components/ConfirmDialog.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import QuadrantChart from '../components/QuadrantChart.js';

/**
 * Where this brand sits, and who says so.
 *
 * The studio's side of the positioning matrix: choose the two axes, place the
 * brands worth comparing against, and see the client's own point arrive from
 * their discovery answers without anybody moving it.
 *
 * Placing a competitor is a click on the chart rather than six sliders. That is
 * not only faster — it is more honest about what is being recorded. A click
 * sets the two axes you are looking at and says nothing about the other four,
 * so the comparator shows up on the comparisons somebody actually thought about
 * and is absent from the ones they did not.
 */

export default function Positioning({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [xAxis, setXAxis] = useState('E4');
  const [yAxis, setYAxis] = useState('E6');
  const [placing, setPlacing] = useState<{ x: number; y: number } | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['positioning', clientId, xAxis, yAxis],
    queryFn: () => api.positioning(clientId, xAxis, yAxis),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['positioning', clientId] });
  };

  const add = useMutation({
    mutationFn: () => api.addComparator(clientId, {
      name: name.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
      positions: { [xAxis]: placing?.x ?? 50, [yAxis]: placing?.y ?? 50 },
    }),
    onSuccess: () => { setPlacing(null); setName(''); setNote(''); invalidate(); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeComparator(id),
    onSuccess: invalidate,
  });

  if (isPending) return <p className="muted">Loading the chart…</p>;
  if (error) {
    return <ErrorPanel title="Could not load the chart" error={error} onRetry={() => { void refetch(); }} />;
  }

  const { matrix, axes, answersFrom } = data;
  // Both kinds of judgement can be taken off the chart; the computed point cannot.
  const placed = matrix.points.filter((p) => p.source !== 'computed');

  /** A click anywhere in the plot is a position on the two axes on screen. */
  const takeClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const svg = (event.target as Element).closest('figure')?.querySelector('svg');
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    // The plot is inset by 40 of the 360-unit viewBox on every side.
    const inset = (40 / 360) * box.width;
    const span = box.width - inset * 2;
    const x = ((event.clientX - box.left - inset) / span) * 100;
    const y = (1 - (event.clientY - box.top - inset) / span) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    setPlacing({ x: Math.round(x), y: Math.round(y) });
  };

  return (
    <section className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Where they sit</h3>
        {answersFrom === 'in-progress' && (
          <span className="pill minor">Discovery still open</span>
        )}
      </div>

      <p className="muted" style={{ maxWidth: '60ch' }}>
        {answersFrom === 'none'
          ? 'Nobody has been through discovery yet, so this client has no measured position. '
            + 'Anything you place here is your own reading until they answer.'
          : 'Their own point comes from the answers they gave in discovery — it is computed, '
            + 'and nothing here can move it. Every other brand on the chart is your judgement, '
            + 'and the chart says so.'}
      </p>

      <div className="row">
        <label className="field">
          <span className="label">Across</span>
          <select value={xAxis} onChange={(e) => { setXAxis(e.target.value); setPlacing(null); }}>
            {axes.map((a) => (
              <option key={a.id} value={a.id} disabled={a.id === yAxis}>
                {a.low} → {a.high}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Up</span>
          <select value={yAxis} onChange={(e) => { setYAxis(e.target.value); setPlacing(null); }}>
            {axes.map((a) => (
              <option key={a.id} value={a.id} disabled={a.id === xAxis}>
                {a.low} → {a.high}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div onClick={takeClick}>
        <QuadrantChart x={matrix.x} y={matrix.y} points={matrix.points} />
      </div>

      {matrix.unanswered.length > 0 && (
        <p className="muted">
          {matrix.unanswered.length === 2
            ? 'They have not answered either of these questions, so they are not on this chart.'
            : 'They have not answered one of these questions, so they are not on this chart yet.'}
        </p>
      )}

      {placing && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <span className="label">
            Put a brand here — {matrix.x.label} {placing.x}, {matrix.y.label} {placing.y}
          </span>
          <label className="field">
            <span className="label">Which brand?</span>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="A competitor, or someone they admire" required autoFocus
            />
          </label>
          <label className="field">
            <span className="label">Why here?</span>
            <input
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Optional, and worth writing down."
            />
          </label>
          {add.error && <p className="err">{(add.error as Error).message}</p>}
          <div className="row">
            <button className="primary" type="submit" disabled={!name.trim() || add.isPending}>
              {add.isPending ? 'Placing…' : 'Place it'}
            </button>
            <button type="button" onClick={() => setPlacing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {!placing && (
        <p className="muted">Click anywhere on the chart to put another brand on it.</p>
      )}

      {placed.length > 0 && (
        <div className="row">
          {placed.map((point) => (
            <button
              key={point.id} type="button" disabled={remove.isPending}
              onClick={() => {
                void requestConfirmation({
                  title: `Remove ${point.label}?`,
                  message: 'This removes the brand from the current positioning chart. It cannot be undone.',
                  confirmLabel: 'Remove brand',
                }).then((confirmed) => { if (confirmed) remove.mutate(point.id); });
              }}
            >
              Remove {point.label}
            </button>
          ))}
        </div>
      )}
      {remove.error && <p className="err">{(remove.error as Error).message}</p>}
    </section>
  );
}
