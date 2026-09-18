import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

/**
 * Settings.
 *
 * Only what the application actually has is shown. The spec's fuller settings —
 * studio profile, AI providers, storage, portal domains, team, sessions — need
 * systems that do not exist, and rendering disabled fields for them would be
 * decoration.
 *
 * The security note is not filler. It is the largest gap between what this
 * codebase is and what a multi-client studio tool has to be, and settings is
 * where someone would go looking for it.
 */
export default function Settings(): ReactElement {
  const { data: rubric } = useQuery({ queryKey: ['rubric'], queryFn: api.rubric });

  return (
    <section className="stack">
      <h2>Settings</h2>

      <div className="card">
        <span className="label">Corpus</span>
        <p style={{ marginTop: 8 }}>
          {rubric
            ? `${rubric.departments.length} departments, ${rubric.universalDimensions.length} universal dimensions.`
            : 'Loading the rubric…'}
        </p>
        <p className="muted">
          The markdown corpus is canonical. The typed rubric is derived from it and validated
          in CI, so a scorecard edited in markdown that the parser does not follow fails the
          build rather than shipping a rubric that disagrees with the document.
        </p>
      </div>

      <div className="card">
        <span className="label">Access</span>
        <p style={{ marginTop: 8 }}>
          <strong>This application has no authentication.</strong>
        </p>
        <p className="muted">
          It was built as a single-user local tool and the API is open to anything that can
          reach the port. That is defensible for a workstation on one machine. It is not
          defensible for multiple clients, published portals, or any client-facing access —
          those need authentication and per-client authorization enforced at the data layer,
          not in the interface. Nothing here should be exposed to a network until that exists.
        </p>
      </div>
    </section>
  );
}
