import type { CSSProperties, ReactElement } from 'react';

interface LoadingOverlayProps {
  label?: string;
}

type LoadingBlockStyle = CSSProperties & {
  '--loader-angle': string;
  '--loader-delay': string;
};

const BLOCK_COUNT = 12;

export function LoadingOverlay({
  label = 'Loading the studio…',
}: LoadingOverlayProps): ReactElement {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-label={label}>
      <div className="loading-overlay-field" aria-hidden="true" />
      <div className="loading-overlay-content">
        <div className="loading-orbit" aria-hidden="true">
          {Array.from({ length: BLOCK_COUNT }, (_, index) => (
            <span
              className="loading-block"
              key={index}
              style={{
                '--loader-angle': `${index * (360 / BLOCK_COUNT)}deg`,
                '--loader-delay': `${index * -90}ms`,
              } as LoadingBlockStyle}
            />
          ))}
          <span className="loading-core" />
        </div>
        <p className="loading-kicker">EDS AI Studio</p>
        <p className="loading-label">{label}</p>
      </div>
    </div>
  );
}
