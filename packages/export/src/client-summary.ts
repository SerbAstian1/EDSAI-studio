import { evaluateGate } from '@edsai/engine';
import type { RunBundle } from './internal.js';

/**
 * The client-ready summary.
 *
 * `09-client-summary-and-score-audit.md` sets three hard constraints — under 600
 * words, zero scores, zero department jargon — and one gate: it may only be
 * generated from a run whose determination is FINAL.
 *
 * All four are enforced here rather than trusted. A summary is the one artifact
 * a client reads without us in the room, and a scorecard leaking into it, or a
 * summary of a run that was never final, is the kind of mistake that is only
 * discovered after it has been sent.
 */

export const WORD_LIMIT = 600;

export class ClientSummaryRefused extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Client summary refused: ${reasons.join(' ')}`);
    this.name = 'ClientSummaryRefused';
  }
}

/** Vocabulary that belongs to the internal document and must never reach a client. */
const JARGON = [
  /\bdepartment\s*\d+/i,
  /\bscorecard\b/i,
  /\bbenchmark gap\b/i,
  /\barbitration\b/i,
  /\bcross-system coherence\b/i,
  /\bblocker\b/i,
  /\bnitpick\b/i,
  /\bEDSAI\b/,
  /\bV1\b|\bV2\b/,
  /\brubric\b/i,
];

export const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

/** Anything shaped like a 1–10 score, which the summary must not contain. */
export function findScoreLeaks(text: string): string[] {
  const leaks: string[] = [];
  for (const match of text.matchAll(/\b(?:scored?|rating|rated)\b[^.]{0,40}\b(\d|10)\b/gi)) {
    leaks.push(match[0].trim());
  }
  for (const match of text.matchAll(/\b(\d|10)\s*\/\s*10\b/g)) leaks.push(match[0]);
  return leaks;
}

export function findJargon(text: string): string[] {
  return JARGON.flatMap((pattern) => {
    const found = pattern.exec(text);
    return found ? [found[0]] : [];
  });
}

export interface ClientSummaryInput {
  bundle: RunBundle;
  /** The prose. Written by a person or a model; this function only polices it. */
  body: string;
  /** What the client asked for, in their words, for the opening line. */
  headline?: string;
}

export interface ClientSummary {
  title: string;
  body: string;
  wordCount: number;
  generatedAt: string;
}

/**
 * Check a drafted summary against every constraint, without generating one.
 * Useful in a UI that wants to warn while someone types rather than at submit.
 */
export function checkClientSummary(input: ClientSummaryInput): string[] {
  const { bundle, body } = input;
  const reasons: string[] = [];

  const gate = evaluateGate({
    proposed: bundle.run.determination ?? bundle.run.version,
    issues: bundle.issues,
    conflicts: bundle.conflicts,
  });

  if (gate.determination !== 'FINAL') {
    reasons.push(
      `the run is ${gate.determination}, not FINAL` +
      (gate.blockers.length ? ` — ${gate.blockers.join(' ')}` : '.'),
    );
  }

  const words = countWords(body);
  if (words > WORD_LIMIT) {
    reasons.push(`the summary is ${words} words, over the ${WORD_LIMIT}-word limit.`);
  }

  const leaks = findScoreLeaks(body);
  if (leaks.length > 0) {
    reasons.push(`it contains scores, which a client summary never carries: ${leaks.join('; ')}.`);
  }

  const jargon = findJargon(body);
  if (jargon.length > 0) {
    reasons.push(`it contains internal vocabulary: ${jargon.join(', ')}.`);
  }

  return reasons;
}

/** Generate the summary, or refuse and say exactly why. */
export function clientSummary(input: ClientSummaryInput): ClientSummary {
  const reasons = checkClientSummary(input);
  if (reasons.length > 0) throw new ClientSummaryRefused(reasons);

  return {
    title: input.headline ?? `${input.bundle.run.projectId} — what we did and why`,
    body: input.body.trim(),
    wordCount: countWords(input.body),
    generatedAt: new Date().toISOString(),
  };
}

export function renderClientSummary(summary: ClientSummary): string {
  return [`# ${summary.title}`, '', summary.body, ''].join('\n');
}
