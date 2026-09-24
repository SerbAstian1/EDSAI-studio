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
    help: 'Use plain language that anyone can understand.',
  },
  {
    id: 'f-who', act: 'facts', kind: 'text', required: true,
    prompt: 'Who is your main customer, and what are they trying to do when they find you?',
    help: 'Describe one real type of customer and their immediate need.',
  },
  {
    id: 'f-deliverables', act: 'facts', kind: 'pick-many', required: true, take: 0,
    prompt: 'What do you want us to deliver?',
    options: [
      { id: 'logo', label: 'A logo and the rules for using it' },
      { id: 'identity', label: 'A full visual identity' },
      { id: 'website', label: 'A website' },
      { id: 'packaging', label: 'Packaging' },
      { id: 'print', label: 'Print and collateral' },
      { id: 'social', label: 'Social templates' },
      { id: 'unsure', label: 'I am not sure yet' },
    ],
  },
  {
    id: 'f-deadline', act: 'facts', kind: 'text', required: false,
    prompt: 'When does this need to be ready?',
    help: 'Add a launch date or deadline. Leave it blank if there is none.',
  },

  /* — warm-up ————————————————————————————————————————————————————— */
  {
    id: 'w-headline', act: 'warm-up', kind: 'text', required: true, axis: 'T1',
    prompt: 'In three years, what do you want people to say you are known for?',
    help: 'Write one short sentence.',
  },

  /* — the eight enumerated axes ——————————————————————————————————— */
  {
    id: 'e1', act: 'axes', kind: 'binary', required: true, axis: 'E1',
    prompt: 'When someone asks your price, what should you do first?',
    options: [
      { id: 'directness', label: 'Give them the price directly.' },
      { id: 'restraint', label: 'Ask what they need before giving a price.' },
    ],
  },
  {
    id: 'e2', act: 'axes', kind: 'scale', required: true, axis: 'E2',
    prompt: 'How should you explain what your business does?',
    anchors: {
      low: 'Say it plainly: “We make shoes.”',
      high: 'Tell a short story about why the product matters.',
    },
  },
  {
    id: 'e3', act: 'axes', kind: 'scale', required: true, axis: 'E3',
    prompt: 'How bold should the brand look at first glance?',
    anchors: {
      low: 'Quiet: one product and plenty of empty space.',
      high: 'Bold: many products, strong colour and movement.',
    },
  },
  {
    id: 'e4', act: 'axes', kind: 'ratio', required: true, axis: 'E4',
    prompt: 'Should the visual style feel ordered or full of detail?',
    sides: {
      a: 'Ordered: a few items, carefully placed.',
      b: 'Layered: many useful details and signs of work.',
    },
  },
  {
    id: 'e5', act: 'axes', kind: 'ratio', required: true, axis: 'E5',
    prompt: 'Should the design feel current to today or hard to date?',
    sides: {
      a: 'Current: let it reflect this moment and update it later.',
      b: 'Timeless: make it difficult to place in a specific year.',
    },
  },
  {
    id: 'e6', act: 'axes', kind: 'ratio', required: true, axis: 'E6',
    prompt: 'Would you change the brand to win a large retailer?',
    help: 'Choose your first reaction.',
    sides: { a: 'Yes, we can adapt.', b: 'No, protect the brand’s character.' },
  },
  {
    id: 'e7', act: 'axes', kind: 'ratio', required: true, axis: 'E7',
    prompt: 'Should the brand system be tightly organised or flexible?',
    sides: { a: 'Organised: clear rules and a place for everything.', b: 'Flexible: room to change and experiment.' },
  },
  {
    id: 'e8', act: 'axes', kind: 'binary', required: true, axis: 'E8',
    prompt: 'Which layout style feels most like your brand?',
    help: 'Choose the closest fit.',
    options: [
      { id: 'negative-space', label: 'One focus point with lots of empty space' },
      { id: 'fill-the-frame', label: 'Content fills the whole space' },
      { id: 'radiating-radial', label: 'Everything arranged around one centre' },
      { id: 'diagonal-double-diagonal', label: 'Strong diagonal movement' },
      { id: 'horizontal-lines', label: 'Calm horizontal sections' },
      { id: 'l-arrangement', label: 'Content held along two edges' },
    ],
  },

  /* — the disagreement round ——————————————————————————————————————— */
  {
    id: 'd-traits', act: 'disagreement', kind: 'pick-many', required: true, take: 3,
    prompt: 'Choose the three words that should describe your brand.',
    help: 'Choose your own answer before comparing it with your team.',
    options: TRAITS.map((trait) => ({ id: trait, label: trait })),
  },
  {
    id: 'd-worst', act: 'disagreement', kind: 'text', required: true,
    prompt: 'Which competitor should people never confuse you with, and why?',
    help: 'A short answer is enough.',
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

/**
 * Discovery, as the facts a designer reads off it and as a brief a run reads.
 *
 * The questions were written so a client never has to speak design; the
 * answers come back as option ids, 1–5 scales and side/strength pairs. This
 * translates each one back into the sentence the client actually chose, so
 * the run's brief carries their words and the Direction view can show
 * "scope of work" and "tone" without anyone re-typing them.
 *
 * It does not draft positioning, emotional tone or motion law. Those are the
 * three axes the flow leaves to the studio on purpose, and a brief that
 * guessed at them would have the run confirm a guess.
 */
export interface DiscoveryFacts {
  what?: string;
  who?: string;
  /** What they asked for at the end — the scope of work, in their labels. */
  deliverables: { id: string; label: string }[];
  deadline?: string;
  headline?: string;
  /** The three words they said belong to them. */
  traits: string[];
  /** Who they would hate to be mistaken for, and why. */
  worst?: string;
  /** Each enumerated axis they settled, as the sentence they chose. */
  decisions: { axis: string; question: string; answer: string }[];
}

export interface DiscoveryBrief {
  facts: DiscoveryFacts;
  /** The same facts as the Markdown a run's brief carries. */
  markdown: string;
}

/**
 * The sentence a client chose, for one question.
 *
 * Answers are stored as option ids, 1–5 integers and side/strength pairs;
 * this turns one back into the words that were on the screen — the only
 * form in which it is evidence a reader can check against the chart.
 */
export function decisionFor(answers: readonly Answer[], questionId: string): string | undefined {
  const q = question(questionId);
  const answer = answers.find((a) => a.questionId === questionId);
  if (!q || !answer || !answerIsValid(questionId, answer.value)) return undefined;
  const value = answer.value;
  if (q.kind === 'binary') return q.options?.find((o) => o.id === value)?.label;
  if (q.kind === 'scale' && q.anchors) {
    const n = value as number;
    return n === 1 ? q.anchors.low
      : n === 2 ? `Closer to ${q.anchors.low}`
        : n === 3 ? `Halfway between ${q.anchors.low} and ${q.anchors.high}`
          : n === 4 ? `Closer to ${q.anchors.high}`
            : q.anchors.high;
  }
  if (q.kind === 'ratio' && q.sides) {
    const v = value as { side: 'a' | 'b'; strength: string };
    const strength = RATIO_STRENGTHS.find((s) => s.id === v.strength);
    return `${q.sides[v.side]} (${strength?.label.toLowerCase() ?? v.strength}, ${strength?.ratio ?? ''})`.trim();
  }
  return undefined;
}

export function discoveryBrief(answers: readonly Answer[]): DiscoveryBrief {
  const byId = new Map(answers.map((a) => [a.questionId, a.value]));
  const text = (id: string): string | undefined => {
    const value = byId.get(id);
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || undefined;
  };
  const labelOf = (q: Question, id: unknown): string | undefined =>
    q.options?.find((o) => o.id === id)?.label;

  const deliverablesQ = question('f-deliverables');
  const picked = byId.get('f-deliverables');
  const deliverables = (Array.isArray(picked) ? picked as string[] : [])
    .map((id) => ({ id, label: deliverablesQ ? labelOf(deliverablesQ, id) ?? id : id }));

  const traits = byId.get('d-traits');

  const decisions: DiscoveryFacts['decisions'] = [];
  for (const q of QUESTIONS) {
    if (!q.axis?.startsWith('E')) continue;
    const answer = decisionFor(answers, q.id);
    if (answer) decisions.push({ axis: q.axis, question: q.prompt, answer });
  }

  const what = text('f-what');
  const who = text('f-who');
  const deadline = text('f-deadline');
  const headline = text('w-headline');
  const worst = text('d-worst');
  const facts: DiscoveryFacts = {
    ...(what ? { what } : {}),
    ...(who ? { who } : {}),
    deliverables,
    ...(deadline ? { deadline } : {}),
    ...(headline ? { headline } : {}),
    traits: Array.isArray(traits) ? traits.filter((t): t is string => typeof t === 'string') : [],
    ...(worst ? { worst } : {}),
    decisions,
  };

  const lines: string[] = ['## From discovery', ''];
  if (facts.what) lines.push(`**What they do.** ${facts.what}`);
  if (facts.who) lines.push(`**Who buys it.** ${facts.who}`);
  if (facts.deliverables.length > 0) {
    lines.push(`**Scope of work.** ${facts.deliverables.map((d) => d.label).join('; ')}.`);
  }
  if (facts.deadline) lines.push(`**Deadline.** ${facts.deadline}`);
  if (facts.headline) lines.push(`**Their headline, three years out.** ${facts.headline}`);
  if (facts.traits.length > 0) lines.push(`**Three words that are theirs.** ${facts.traits.join(', ')}.`);
  if (facts.worst) lines.push(`**Would hate to be mistaken for.** ${facts.worst}`);
  if (facts.decisions.length > 0) {
    lines.push('', '### Decisions they made', '');
    for (const d of facts.decisions) lines.push(`- **${d.axis}:** ${d.answer}`);
  }
  lines.push(
    '',
    'The studio will decide positioning, emotional tone and motion, then ask the client to confirm them.',
  );

  return { facts, markdown: lines.join('\n') };
}
