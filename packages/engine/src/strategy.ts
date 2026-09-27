import { z } from 'zod';

/**
 * A strategy: what a client said, and what it adds up to.
 *
 * This is the document between the two halves of the system. A transcript is
 * unstructured and a run is twenty-four departments scoring eleven axes; the
 * strategy is the page a studio member reads before deciding what to do, and the
 * page a client reads before confirming it. It is prose, because the thing it
 * has to carry — a tension — does not survive being split into columns.
 *
 * **It is not a run, and it is not a contract.** It does not score axes, name a
 * deliverable, quote a fee or commit to a date. The run does the scoring; the
 * invoice and the contract do the money. A strategy that starts doing those
 * jobs will be quoted back at the studio as a promise, so the prompt in this
 * file is written to refuse all three.
 *
 * The transcript is kept alongside the draft rather than discarded. A draft is
 * not reproducible — the same transcript read twice will not give the same
 * page — so the material the page came from has to survive it, or the studio
 * cannot check the draft against the words and has to take it on trust.
 *
 * `model` records what wrote the draft, and is absent when a person did. A
 * reader can therefore always tell a machine's page from a studio's, which
 * matters more here than in most of this system: `rehearsal` is a real
 * recorded value, not an absence, so a rehearsed draft never passes as real.
 */

export const Strategy = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  /** The words the draft came from, kept so the draft can be checked. */
  transcript: z.string().min(1),
  /** The draft itself, and the studio's edits to it. */
  markdown: z.string().min(1),
  /** What wrote the draft. Absent means a person wrote it. */
  model: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Strategy = z.infer<typeof Strategy>;

/**
 * How much transcript a draft will read.
 *
 * Sixty thousand characters is roughly fifteen thousand tokens, which is a long
 * interview and a short strategy. Past that the marginal page of context costs
 * more than it changes, and a founder who has sent the whole of their inbox
 * wants a page out of it, not an apology about tokens. Cutting is never
 * silent: the tail is dropped at a line, and both the prompt and the studio say
 * so, because a draft that quietly read three quarters of a transcript will
 * confidently reason about the part it never saw.
 */
export const TRANSCRIPT_LIMIT = 60_000;

export interface TranscriptCut {
  text: string;
  truncated: boolean;
  /** Words dropped, for the studio to show. Zero when nothing was dropped. */
  dropped: number;
}

export function cutTranscript(raw: string): TranscriptCut {
  const text = raw.trim();
  if (text.length <= TRANSCRIPT_LIMIT) return { text, truncated: false, dropped: 0 };

  const kept = text.slice(0, TRANSCRIPT_LIMIT);
  const lastBreak = kept.lastIndexOf('\n');
  const end = lastBreak > TRANSCRIPT_LIMIT / 2 ? lastBreak : TRANSCRIPT_LIMIT;
  const head = kept.slice(0, end).trimEnd();
  const tail = text.slice(end);
  return {
    text: head,
    truncated: true,
    dropped: tail.split(/\s+/).filter(Boolean).length,
  };
}

const HEADINGS = [
  'What they said they wanted',
  'Where the work actually points',
  'What the studio would do about it',
  'What would have to be true',
  'Open questions',
] as const;

/**
 * The standing instruction, kept as one string so it caches across every
 * transcript the studio drafts.
 *
 * Three rules carry the weight. Quote rather than summarise, because a
 * paraphrase of a founder is already an interpretation and this document is
 * supposed to be checkable word by word against the transcript. No design
 * vocabulary, for the same reason the discovery flow refuses it: "elevated",
 * "premium" and "modern" are words about the answer, and this page is about
 * the question. And name no number that was not said — a fee, a date or a
 * headcount invented here becomes a figure the client believes they gave.
 */
export const STRATEGY_SYSTEM = `You write the strategy page for a design studio.

A founder, owner or marketing lead has talked for an hour. You will be given
that transcript. Your job is to write the one page a studio member reads
before deciding what to do, and the page a client reads before agreeing to it.

Write these five sections, in this order, with these headings:

## ${HEADINGS[0]}
What they asked for, in their own words, as quotations. If they said it three
ways, quote all three. Do not summarise and do not improve it.

## ${HEADINGS[1]}
Where that actually points: the tension between what was said and the money,
the deadline, the audience or the audience's size. Say which quotation each
part of the tension comes from. If there is no tension, say there is not one —
a page that manufactures disagreement is worse than a page that reports calm.

## ${HEADINGS[2]}
The smallest set of moves that closes that gap, and what each one costs in
time. This is advice, not a proposal: no deliverables, no scope, no fees, no
dates. A proposal is a different document and it is written by a person.

## ${HEADINGS[3]}
What has to be true for the work to land: the assumptions the plan rests on,
the things that would make it wrong, and what would show it early.

## ${HEADINGS[4]}
What the studio has to go back and ask, and what it is guessing at.

Rules:

- Every claim traces to a line in the transcript. If it is your inference, say
  which line it came from.
- No design vocabulary. No "elevated", "premium", "modern", "minimal",
  "dynamic", "sleek", "luxury", "bold", "clean", "young", "approachable".
  You are writing about their business, not proposing a look.
- No number that was not said. No fee, no budget figure, no headcount, no date,
  no percentage. If they were vague, write that they were vague and quote them.
- No scores, no axis positions, no scorecard. This is not an audit.
- Do not name competitors as if you researched them. If they named one, quote
  it; if they did not, do not supply examples.
- Be specific. "Their positioning needs work" is not a sentence. What work,
  on what, visible to whom.
- Length: as long as the transcript earns and no longer. Six hundred words is
  usually right for an hour of talking. A short transcript earns a short page.
- Plain markdown. No front matter, no code fences, no horizontal rules.`;

export interface StrategyPrompt {
  /** The transcript, already cut to the limit. */
  transcript: string;
  clientName?: string;
  /** The discovery brief, when the client filled the flow in. */
  discovery?: string;
  /** Words cut by `cutTranscript`, so the draft knows it read a part. */
  dropped?: number;
}

export function strategyUser(input: StrategyPrompt): string {
  const head: string[] = [];
  if (input.clientName) head.push(`The client is ${input.clientName}.`);
  if (input.discovery) {
    head.push('They also filled in the discovery flow. This is what it recorded:', '');
    head.push(input.discovery, '');
  }
  head.push('--- TRANSCRIPT ---', input.transcript);

  if (input.dropped && input.dropped > 0) {
    head.push(
      '',
      `--- END OF TRANSCRIPT. ${input.dropped} words of the end were not included for `
        + 'length. Do not reason about anything after this line, and if the cut looks '
        + 'like it removed a decision, say so under Open questions. ---',
    );
  }

  return head.join('\n');
}

