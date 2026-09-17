import type { Rubric } from '@edsai/rubric';
import { evaluateGate, gateSummary, type Conflict, type DepartmentOutput, type Issue, type Run } from '@edsai/engine';

/**
 * The full internal document.
 *
 * Everything the run produced, in pipeline order, with the scorecard intact and
 * every number carrying where it came from. It is long because a full run is
 * long; the client summary is the short one, and it is a different document
 * with a different job.
 */

export interface RunBundle {
  run: Run;
  rubric: Rubric;
  outputs: readonly DepartmentOutput[];
  issues: readonly Issue[];
  conflicts: readonly Conflict[];
  violations?: readonly { departmentId: number; kind: string; metric: string; detail: string }[];
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

function departmentName(bundle: RunBundle, id: number): string {
  return bundle.rubric.departments.find((d) => d.id === id)?.name ?? `Department ${id}`;
}

export function internalDocument(bundle: RunBundle): string {
  const { run, outputs, issues, conflicts } = bundle;
  const gate = evaluateGate({
    proposed: run.determination ?? run.version, issues, conflicts,
  });

  const ordered = [...outputs].sort(
    (a, b) => run.activatedDepartments.indexOf(a.departmentId)
            - run.activatedDepartments.indexOf(b.departmentId),
  );

  const allScores = ordered.flatMap((o) => o.scores);
  const allTargets = ordered.flatMap((o) => o.targets);
  const measured = allTargets.filter((t) => t.source === 'instrument');
  const open = issues.filter((i) => i.status === 'open');

  const lines: string[] = [
    `# ${run.projectId} — internal run document`,
    '',
    `Run \`${run.id}\` · determination **${gate.determination}** · level ${run.level} · ` +
    `scope \`${run.scopeId}\` · ${ordered.length} of ${run.activatedDepartments.length} departments`,
    '',
    `> ${gateSummary(gate)}`,
    '',
    '## Brief',
    '',
    run.brief.trim(),
    '',
    '## Aggregate',
    '',
    '| Measure | Value |',
    '|---|---|',
    `| Departments run | ${ordered.length} of ${run.activatedDepartments.length} |`,
    `| Scores recorded | ${allScores.length} |`,
    `| Mean score | ${allScores.length ? (allScores.reduce((n, s) => n + s.value, 0) / allScores.length).toFixed(2) : '—'} |`,
    `| Targets stated | ${allTargets.length} |`,
    `| Instrument-measured | ${measured.length} (${pct(measured.length, allTargets.length)}) |`,
    `| Open issues | ${open.length} of ${issues.length} |`,
    `| Conflicts | ${conflicts.length} |`,
    '',
  ];

  // The corpus requires the weak point named rather than buried.
  if (allScores.length > 0) {
    const lowest = allScores.reduce((worst, s) => (s.value < worst.value ? s : worst));
    const owner = ordered.find((o) => o.scores.includes(lowest));
    lines.push(
      `**Lowest score: ${lowest.dimension} at ${lowest.value}**` +
      (owner ? ` (${departmentName(bundle, owner.departmentId)})` : '') + '.',
      '',
      `> ${lowest.justification}`,
      '',
    );
  }

  lines.push('## Departments', '');

  for (const output of ordered) {
    lines.push(`### ${output.departmentId} — ${departmentName(bundle, output.departmentId)}`, '');
    lines.push(output.body.trim(), '');

    if (output.scores.length > 0) {
      lines.push('| Dimension | Score | Justification |', '|---|---|---|');
      for (const score of output.scores) {
        lines.push(
          `| ${score.dimension}${score.inverse ? ' *(inverse)*' : ''} | ` +
          `${score.value} | ${score.justification} |`,
        );
      }
      lines.push('');
    }

    if (output.targets.length > 0) {
      lines.push('| Metric | Target | Actual | Source |', '|---|---|---|---|');
      for (const target of output.targets) {
        lines.push(
          `| ${target.metric} | ${target.target} | ${target.actual ?? '—'} | ` +
          (target.source === 'instrument'
            ? `\`${target.instrument ?? 'instrument'}\``
            : 'stated') + ' |',
        );
      }
      lines.push('');
      const stated = output.targets.filter((t) => t.source === 'stated-target' && t.mechanism);
      for (const target of stated) {
        lines.push(`- **${target.metric}** — ${target.mechanism}`);
      }
      if (stated.length) lines.push('');
    }

    for (const composition of output.compositions) {
      lines.push(`**Composition: ${composition.structure}** — ${composition.eyePath}`, '');
    }

    for (const decision of output.decisions) {
      lines.push(
        `#### ${decision.technology}`, '',
        `- **Appropriate when** — ${decision.appropriateWhen}`,
        `- **Not appropriate when** — ${decision.notAppropriateWhen}`,
        `- **Complexity introduced** — ${decision.complexity}`,
        `- **Failure modes** — ${decision.failureModes}`,
        `- **Simpler alternative** — ${decision.simplerAlternative}`,
        '',
      );
    }

    if (output.instrumentCalls.length > 0) {
      lines.push(`*Instruments called: ${[...new Set(output.instrumentCalls)].join(', ')}.*`, '');
    }
  }

  if (issues.length > 0) {
    lines.push('## Issues', '', '| Severity | Status | Traced to | Issue | Fix |', '|---|---|---|---|---|');
    for (const issue of issues) {
      lines.push(
        `| ${issue.severity} | ${issue.status} | ${issue.tracedTo.join(', ')} | ` +
        `${issue.description} | ${issue.fix} |`,
      );
    }
    lines.push('');
  }

  if (conflicts.length > 0) {
    lines.push('## Conflicts', '');
    for (const conflict of conflicts) {
      lines.push(
        `**${conflict.departments.join(' ↔ ')}** — ${conflict.description}`, '',
        conflict.resolution ? `*Resolved:* ${conflict.resolution}` : '*Unresolved.*',
        conflict.whatWasLost ? `*What was lost:* ${conflict.whatWasLost}` : '',
        '',
      );
    }
  }

  const violations = bundle.violations ?? [];
  if (violations.length > 0) {
    lines.push(
      '## Instrument violations', '',
      'Numbers reported as measured that no instrument produced. Each was stripped',
      'back to a stated target before the output was persisted.', '',
      '| Department | Kind | Metric | Detail |', '|---|---|---|---|',
      ...violations.map((v) => `| ${v.departmentId} | ${v.kind} | ${v.metric} | ${v.detail} |`),
      '',
    );
  }

  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n');
}
