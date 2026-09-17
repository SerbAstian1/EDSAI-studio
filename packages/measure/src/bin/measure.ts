#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { probeHeaders, probeWebVitals, ProbeFailed } from '../probes.js';
import { FetchRefused } from '../guard.js';
import { bundleFromViteDist } from '../vite.js';
import { axeFromResults } from '../import.js';
import { measurementTargets, type MeasurementInput } from '../targets.js';
import { webVitalsAudit } from '../web-vitals.js';
import { headerAudit } from '../headers.js';
import { bundleAudit } from '../bundle.js';
import { axeAudit } from '../axe.js';
import { WebVitalsRecord, HeaderRecord, BundleRecord, AxeRecord } from '../records.js';
import type { Finding } from '@edsai/instruments';

/**
 * `edsai-measure` — collect records, then judge them.
 *
 * The two halves are separate commands on purpose. `collect` reaches the
 * network and writes a records file; `report` reads that file and produces the
 * `Target` rows, touching nothing. Re-judging a stored measurement against a
 * changed budget is therefore free and deterministic, and a measurement taken
 * once can be re-read months later without pretending to re-take it.
 */

const USAGE = `edsai-measure — measurement bridges for Departments 8, 40 and 43

  collect <url> [options]        probe a URL and write a records file
    --out <file>                 where to write (default: measurements.json)
    --strategy mobile|desktop    PageSpeed strategy (default: mobile)
    --key <key>                  PageSpeed Insights API key; without one the
                                 shared quota is routinely exhausted
    --skip-vitals                headers only
    --dist <dir>                 also read a Vite build's initial route
    --axe <file>                 also import an axe-core results file

  report <file> [--budget <KB>] [--json]
                                 judge a records file; no network

A records file is plain JSON and is meant to be committed alongside a run.`;

interface Records extends MeasurementInput {
  collectedAt?: string;
}

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function severityMark(severity: Finding['severity']): string {
  return { blocker: '✗', major: '✗', minor: '·', nitpick: '·', info: 'i' }[severity];
}

async function collect(argv: string[]): Promise<number> {
  const target = argv[0];
  if (!target) {
    process.stderr.write('collect needs a url\n');
    return 2;
  }

  const out = arg(argv, '--out') ?? 'measurements.json';
  const records: Records = { collectedAt: new Date().toISOString() };

  records.headers = await probeHeaders(target);
  process.stdout.write(`headers  ${records.headers.status} ${target}\n`);

  if (!argv.includes('--skip-vitals')) {
    const strategy = arg(argv, '--strategy') === 'desktop' ? 'desktop' : 'mobile';
    const key = arg(argv, '--key') ?? process.env['PSI_API_KEY'];
    try {
      records.vitals = await probeWebVitals(target, {
        strategy, ...(key ? { apiKey: key } : {}), timeoutMs: 90_000,
      });
      process.stdout.write(
        `vitals   ${records.vitals.field ? 'field + lab' : 'lab only'} (${strategy})\n`,
      );
    } catch (error) {
      // A failed vitals probe does not lose the headers already collected.
      process.stderr.write(`vitals   unavailable: ${(error as Error).message}\n`);
    }
  }

  const dist = arg(argv, '--dist');
  if (dist) {
    records.bundle = bundleFromViteDist(dist);
    process.stdout.write(`bundle   ${records.bundle.chunks.length} chunks from ${dist}\n`);
  }

  const axePath = arg(argv, '--axe');
  if (axePath) {
    records.axe = axeFromResults(JSON.parse(readFileSync(axePath, 'utf8')), target);
    process.stdout.write(`axe      ${records.axe.violations.length} rules from ${axePath}\n`);
  }

  writeFileSync(out, `${JSON.stringify(records, null, 2)}\n`);
  process.stdout.write(`\nwrote ${out}\n`);
  return 0;
}

function report(argv: string[]): number {
  const path = argv[0];
  if (!path) {
    process.stderr.write('report needs a records file\n');
    return 2;
  }

  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const input: MeasurementInput = {};
  if (raw['vitals']) input.vitals = WebVitalsRecord.parse(raw['vitals']);
  if (raw['headers']) input.headers = HeaderRecord.parse(raw['headers']);
  if (raw['bundle']) input.bundle = BundleRecord.parse(raw['bundle']);
  if (raw['axe']) input.axe = AxeRecord.parse(raw['axe']);

  const budgetKb = arg(argv, '--budget');
  if (budgetKb) input.bundleBudgetBytes = Number(budgetKb) * 1024;

  const targets = measurementTargets(input);

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(targets, null, 2)}\n`);
    return targets.every((t) => t.pass) ? 0 : 1;
  }

  const findings: Finding[] = [
    ...(input.vitals ? webVitalsAudit(input.vitals).findings : []),
    ...(input.headers ? headerAudit(input.headers).findings : []),
    ...(input.bundle ? bundleAudit(input.bundle, input.bundleBudgetBytes).findings : []),
    ...(input.axe ? axeAudit(input.axe).findings : []),
  ];

  let discipline = '';
  for (const target of targets) {
    if (target.discipline !== discipline) {
      discipline = target.discipline;
      process.stdout.write(`\n${discipline}\n`);
    }
    process.stdout.write(
      `  ${target.pass ? '✓' : '✗'} ${target.metric.padEnd(38)} ${target.actual ?? ''}` +
      `  (target ${target.target})\n`,
    );
  }

  const blocking = findings.filter((f) => f.severity === 'blocker' || f.severity === 'major');
  if (findings.length > 0) process.stdout.write('\nFindings\n');
  for (const finding of findings) {
    process.stdout.write(`  ${severityMark(finding.severity)} ${finding.message}\n`);
    if (finding.remediation) process.stdout.write(`      → ${finding.remediation}\n`);
  }

  const failed = targets.filter((t) => !t.pass).length;
  process.stdout.write(
    `\n${targets.length - failed} of ${targets.length} targets met; ` +
    `${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'}\n`,
  );
  return failed === 0 && blocking.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const [command = '', ...rest] = process.argv.slice(2);
  switch (command) {
    case 'collect': return collect(rest);
    case 'report': return report(rest);
    default:
      process.stdout.write(`${USAGE}\n`);
      return command === '' || command === '--help' || command === 'help' ? 0 : 2;
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    // A refusal is a correct outcome, not a crash, so it is reported as one.
    const message = error instanceof FetchRefused || error instanceof ProbeFailed
      ? (error as Error).message
      : `edsai-measure failed: ${String(error)}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  },
);
