import type { BrandValue } from '../../api.js';
import { measurementState } from './model.js';

/** Uses server measurements; no browser approximation or inferred approval. */
export function MeasurementStatus({ value }: { value: BrandValue }) {
  const state = measurementState(value);
  const measured = value.measured;
  return <div className="bh-measurement">
    <span className={`bh-badge ${state}`}>{state === 'pass' ? 'Measured · Pass' : state === 'fail' ? 'Measured · Fail' : 'No pass/fail measurement'}</span>
    {measured?.ratio !== undefined && <span className="mono">{measured.ratio.toFixed(2)}:1{measured.required !== undefined ? ` / ${measured.required}:1 required` : ''}</span>}
    {measured?.note && <span className="bh-meta">{measured.note}</span>}
  </div>;
}
