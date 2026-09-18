import { z } from 'zod';

/**
 * Client onboarding.
 *
 * This builds the flow already designed in `docs/discovery/flow.md` rather than
 * inventing a second questionnaire, and its principle governs every question
 * below:
 *
 * > A good discovery question produces a **decision**, not a description.
 *
 * Three consequences that show up in the data model:
 *
 * - **No design vocabulary.** "Minimal", "premium" and "clean" mean something
 *   different to everyone. The questions are about rooms, shop windows,
 *   workbenches and what happens when someone asks the price. Clients are
 *   fluent in their own business, not in ours; the translation is our job.
 * - **The midpoint is unreachable, not rejected.** The four ratio axes are
 *   asked as "pick a side" then "how strongly", so 50/50 cannot be expressed.
 *   A slider with a centre would collect an unmade decision and fail the gate
 *   afterwards, which is a worse experience than not offering it.
 * - **Three axes are never asked.** Positioning, emotional tone and motion law
 *   are drafted by the studio and confirmed by the client. Asking someone to
 *   write a positioning statement produces category description, which the gate
 *   then rejects — bad for everyone.
 *
 * So a completed client flow resolves **8 of 11** axes by design. That is the
 * Direction Lock's own threshold, and reaching it is the point at which the
 * studio's work starts rather than a shortfall.
 */

export const QuestionKind = z.enum(['binary', 'scale', 'ratio', 'pick-many', 'text']);
export type QuestionKind = z.infer<typeof QuestionKind>;

export const ACTS = ['warm-up', 'axes', 'disagreement', 'facts'] as const;
export const Act = z.enum(ACTS);
export type Act = z.infer<typeof Act>;

export interface Question {
  id: string;
  act: Act;
  kind: QuestionKind;
  /** The question as the client reads it. A situation, not a category. */
  prompt: string;
  /** One line under it, where the prompt needs a frame rather than a definition. */
  help?: string;
  /** For binary and pick-many: the choices, in the client's language. */
  options?: { id: string; label: string }[];
  /** For scale: the sentence at each end. Never a number against a number. */
  anchors?: { low: string; high: string };
  /** For ratio: what each side is called once picked. */
  sides?: { a: string; b: string };
  /** For pick-many: exactly how many to take. */
  take?: number;
  /** Which Direction Lock axis this resolves, where it resolves one. */
  axis?: string;
  /** Whether progress counts it. Facts are required; the reveal is not. */
  required: boolean;
}

/** "slightly / clearly / overwhelmingly" → a ratio nobody had to reason about. */
export const RATIO_STRENGTHS = [
  { id: 'slightly', label: 'Slightly', ratio: '60/40' },
  { id: 'clearly', label: 'Clearly', ratio: '70/30' },
  { id: 'overwhelmingly', label: 'Overwhelmingly', ratio: '85/15' },
] as const;

export const TRAITS = [
  'precise', 'warm', 'bold', 'quiet', 'playful', 'serious',
  'crafted', 'fast', 'generous', 'exacting', 'open', 'unbothered',
] as const;

export const QUESTIONS: readonly Question[] = [
  /* — the facts, kept short because nobody enjoys them ——————————————— */
  {
    id: 'f-what', act: 'facts', kind: 'text', required: true,
    prompt: 'In one sentence, what do you make or do?',
    help: 'Plain language. The way you would say it to someone outside your industry.',
  },
  {
    id: 'f-who', act: 'facts', kind: 'text', required: true,
    prompt: 'Who buys it, and what were they doing ten minutes before they found you?',
    help: 'The second half matters more than the first.',
  },
  {
    id: 'f-deliverables', act: 'facts', kind: 'pick-many', required: true, take: 0,
    prompt: 'What do you need at the end of this?',
    options: [
      { id: 'logo', label: 'A logo and the rules for using it' },
      { id: 'identity', label: 'A full visual identity' },
      { id: 'website', label: 'A website' },
      { id: 'packaging', label: 'Packaging' },
      { id: 'print', label: 'Print and collateral' },
      { id: 'social', label: 'Social templates' },
      { id: 'unsure', label: 'Not sure yet — that is a fine answer' },
    ],
  },
  {
    id: 'f-deadline', act: 'facts', kind: 'text', required: false,
    prompt: 'Is there a date this has to be ready for?',
    help: 'A launch, a season, a meeting. If there is not one, say so.',
  },

  /* — warm-up ————————————————————————————————————————————————————— */
  {
    id: 'w-headline', act: 'warm-up', kind: 'text', required: true, axis: 'T1',
    prompt: 'It is three years from now and a magazine has written about you. What is the headline?',
    help: 'People answer this one well, because it is a story rather than a definition.',
  },

  /* — the eight enumerated axes ——————————————————————————————————— */
  {
    id: 'e1', act: 'axes', kind: 'binary', required: true, axis: 'E1',
    prompt: 'A customer messages asking your price. What happens next?',
    options: [
      { id: 'directness', label: 'They get the number.' },
      { id: 'restraint', label: 'They get a question back about what they are looking for.' },
    ],
  },
  {
    id: 'e2', act: 'axes', kind: 'scale', required: true, axis: 'E2',
    prompt: 'Someone asks what you do, at a party. Which is closer to what you would say?',
    anchors: {
      low: '“I make shoes.”',
      high: '“Ever owned a pair you couldn’t bring yourself to throw out?”',
    },
  },
  {
    id: 'e3', act: 'axes', kind: 'scale', required: true, axis: 'E3',
    prompt: 'Your shop window, done right.',
    anchors: {
      low: 'One shoe. One light. Nothing else.',
      high: 'Twelve shoes, colour everywhere, something moving.',
    },
  },
  {
    id: 'e4', act: 'axes', kind: 'ratio', required: true, axis: 'E4',
    prompt: 'Two rooms to meet a client in. Pick one.',
    sides: {
      a: 'A long table, one chair each side, one object on the wall.',
      b: 'Shelves to the ceiling, samples everywhere, three things half-finished.',
    },
  },
  {
    id: 'e5', act: 'axes', kind: 'ratio', required: true, axis: 'E5',
    prompt: 'In ten years, should someone be able to tell this was made in 2026?',
    sides: {
      a: 'Yes — it should date honestly, and we will redo it.',
      b: 'No — it should be hard to place.',
    },
  },
  {
    id: 'e6', act: 'axes', kind: 'ratio', required: true, axis: 'E6',
    prompt: 'A national retailer wants to stock you, but wants you to tone it down first.',
    help: 'Gut reaction.',
    sides: { a: 'We can work with that.', b: 'Then they don’t want us.' },
  },
  {
    id: 'e7', act: 'axes', kind: 'ratio', required: true, axis: 'E7',
    prompt: 'Your workbench at the end of the day.',
    sides: { a: 'Everything back where it lives.', b: 'Everything where the work left it.' },
  },
  {
    id: 'e8', act: 'axes', kind: 'binary', required: true, axis: 'E8',
    prompt: 'Which of these holds your eye, and which would you never choose?',
    help: 'Described rather than shown here. The intended form is six abstract thumbnails; '
      + 'the reject matters more than the pick.',
    options: [
      { id: 'negative-space', label: 'One small thing, a lot of empty space around it' },
      { id: 'fill-the-frame', label: 'Filled edge to edge, no breathing room' },
      { id: 'radiating-radial', label: 'Everything arranged around one centre point' },
      { id: 'diagonal-double-diagonal', label: 'Cut across at an angle, leaning' },
      { id: 'horizontal-lines', label: 'Calm horizontal bands, stacked' },
      { id: 'l-arrangement', label: 'Weight along two edges, one corner left open' },
    ],
  },

  /* — the disagreement round ——————————————————————————————————————— */
  {
    id: 'd-traits', act: 'disagreement', kind: 'pick-many', required: true, take: 3,
    prompt: 'Pick the three words that belong to you.',
    help: 'Answer before you talk to anyone else about it. Where your team disagrees is '
      + 'the most useful thing this whole form will tell us.',
    options: TRAITS.map((trait) => ({ id: trait, label: trait })),
  },
  {
    id: 'd-worst', act: 'disagreement', kind: 'text', required: true,
    prompt: 'Name a competitor you would hate to be mistaken for, and say why in a few words.',
    help: 'People identify what they are not far faster, and far more accurately, '
      + 'than what they are.',
  },
];

export const Onboarding = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  status: z.enum(['draft', 'sent', 'in-progress', 'submitted', 'accepted']).default('draft'),
  createdAt: z.string(),
  sentAt: z.string().optional(),
  submittedAt: z.string().optional(),
  /** The project this became, once accepted. */
  projectId: z.string().optional(),
});
export type Onboarding = z.infer<typeof Onboarding>;

export const Answer = z.object({
  onboardingId: z.string().min(1),
  questionId: z.string().min(1),
  /** Shape depends on the question kind; validated against the catalog. */
  value: z.unknown(),
  answeredAt: z.string(),
});
export type Answer = z.infer<typeof Answer>;

export function question(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}

/**
 * Whether an answer fits the question it claims to answer.
 *
 * The client-facing endpoint is the one place in this system an unauthenticated
 * stranger writes to the database, so what they write is checked against the
 * catalog rather than stored as whatever arrived.
 */
export function answerIsValid(questionId: string, value: unknown): boolean {
  const q = question(questionId);
  if (!q) return false;

  switch (q.kind) {
    case 'text':
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
    case 'binary':
      return typeof value === 'string' && (q.options ?? []).some((o) => o.id === value);
    case 'scale':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
    case 'ratio': {
      const v = value as { side?: unknown; strength?: unknown };
      return typeof v === 'object' && v !== null
        && (v.side === 'a' || v.side === 'b')
        && RATIO_STRENGTHS.some((s) => s.id === v.strength);
    }
    case 'pick-many': {
      if (!Array.isArray(value)) return false;
      const ids = new Set((q.options ?? []).map((o) => o.id));
      if (!value.every((v) => typeof v === 'string' && ids.has(v))) return false;
      if (new Set(value).size !== value.length) return false;
      // `take: 0` means "as many as apply"; anything else is exact.
      return q.take === undefined || q.take === 0 || value.length === q.take;
    }
    default:
      return false;
  }
}

export interface Progress {
  answered: number;
  required: number;
  percent: number;
  /** Ids of required questions still unanswered, in catalog order. */
  outstanding: string[];
  /** Enumerated axes this flow has settled, out of the Direction Lock's eleven. */
  axesDecided: number;
  /** The three the studio drafts rather than asks. Always outstanding here. */
  axesDrafted: string[];
}

export function progressOf(answers: readonly Answer[]): Progress {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const required = QUESTIONS.filter((q) => q.required);

  const outstanding = required
    .filter((q) => {
      const answer = byId.get(q.id);
      return !answer || !answerIsValid(q.id, answer.value);
    })
    .map((q) => q.id);

  const answered = required.length - outstanding.length;

  const axesDecided = QUESTIONS.filter((q) =>
    q.axis?.startsWith('E') && byId.has(q.id) && answerIsValid(q.id, byId.get(q.id)?.value),
  ).length;

  return {
    answered,
    required: required.length,
    percent: required.length === 0 ? 0 : Math.round((answered / required.length) * 100),
    outstanding,
    axesDecided,
    axesDrafted: ['T1 Positioning', 'T2 Emotional tone', 'T3 Motion law'],
  };
}

/**
 * Turn a submitted onboarding into the project it describes.
 *
 * §14: the studio should not have to copy answers into a project by hand. What
 * this can derive honestly is the name, the kind and a brief assembled from the
 * client's own words — it does not invent a positioning statement, because that
 * is one of the three axes the flow deliberately leaves to the studio.
 */
export interface DerivedProject {
  name: string;
  kind: 'brand-identity' | 'rebrand' | 'campaign' | 'website' | 'collateral' | 'other';
  notes: string;
}

export function deriveProject(
  clientName: string, answers: readonly Answer[],
): DerivedProject {
  const byId = new Map(answers.map((a) => [a.questionId, a.value]));
  const text = (id: string): string => {
    const value = byId.get(id);
    return typeof value === 'string' ? value.trim() : '';
  };

  const deliverables = byId.get('f-deliverables');
  const picked = Array.isArray(deliverables) ? deliverables as string[] : [];

  const kind: DerivedProject['kind'] =
    picked.includes('identity') ? 'brand-identity'
      : picked.includes('website') ? 'website'
        : picked.includes('packaging') || picked.includes('print') ? 'collateral'
          : picked.includes('logo') ? 'brand-identity'
            : 'other';

  const lines = [
    `From ${clientName}'s onboarding.`,
    '',
    `**What they do.** ${text('f-what') || '(not answered)'}`,
    `**Who buys it.** ${text('f-who') || '(not answered)'}`,
    `**Their headline, three years out.** ${text('w-headline') || '(not answered)'}`,
    `**Would hate to be mistaken for.** ${text('d-worst') || '(not answered)'}`,
    '',
    picked.length > 0
      ? `**Asked for:** ${picked.join(', ')}.`
      : '**Asked for:** nothing specified.',
    text('f-deadline') ? `**Date:** ${text('f-deadline')}` : '',
    '',
    'Positioning, emotional tone and motion law are not here on purpose — the flow',
    'leaves those three for the studio to draft and the client to confirm.',
  ].filter((line) => line !== '' || true);

  return {
    name: picked.includes('identity') || picked.includes('logo')
      ? 'Brand identity' : picked.includes('website') ? 'Website' : 'Discovery',
    kind,
    notes: lines.join('\n'),
  };
}
