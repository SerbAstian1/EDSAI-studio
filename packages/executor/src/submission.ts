import type Anthropic from '@anthropic-ai/sdk';
import type { Submission } from '@edsai/engine';

/**
 * How a department finishes its turn.
 *
 * The model ends by calling one tool. That is deliberate rather than
 * incidental: the alternative is asking for prose and parsing it, and a
 * department's output is a typed record with scores, targets and provenance on
 * it — not something to recover with a regular expression afterwards.
 *
 * `strict: true` makes the API itself guarantee the arguments validate against
 * this schema, so the shape is settled before the engine ever sees it. The
 * engine still validates on the way in, because the API's guarantee is about
 * the JSON and the engine's rules are about meaning — a target claiming an
 * instrument produced it is refused there, not here.
 */
export const SUBMIT_TOOL_NAME = 'submit_department_output';

export const SUBMIT_TOOL: Anthropic.Tool = {
  name: SUBMIT_TOOL_NAME,
  description:
    'Record this department\'s finished output. Call this exactly once, last, '
    + 'after any measurements you need. Everything you want kept must be in '
    + 'this call — text outside it is not stored.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['body', 'scores', 'targets', 'compositions', 'decisions', 'comparators'],
    properties: {
      body: {
        type: 'string',
        description: 'The department\'s written output, in Markdown.',
      },
      scores: {
        type: 'array',
        description: 'One entry per dimension this department scores.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['dimension', 'value', 'justification', 'inverse'],
          properties: {
            dimension: { type: 'string' },
            value: { type: 'integer', minimum: 1, maximum: 10 },
            justification: {
              type: 'string',
              description: 'One sentence. A score with no reason is refused.',
            },
            inverse: {
              type: 'boolean',
              description: 'True where a lower number is the better result.',
            },
          },
        },
      },
      targets: {
        type: 'array',
        description:
          'Measurable targets. Set source to "instrument" ONLY for a value a '
          + 'tool call in this turn produced, and name that tool in "instrument". '
          + 'Anything you reasoned to is "stated-target" and needs a mechanism.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['discipline', 'metric', 'target', 'source'],
          properties: {
            discipline: { type: 'string' },
            metric: { type: 'string' },
            target: { type: 'string', description: 'e.g. "< 2.5s" or "4.5:1".' },
            actual: { type: 'string', description: 'Only when an instrument measured it.' },
            source: { type: 'string', enum: ['instrument', 'stated-target'] },
            mechanism: { type: 'string', description: 'Required when there is no actual.' },
            pass: { type: 'boolean' },
            instrument: { type: 'string', description: 'The tool that produced "actual".' },
          },
        },
      },
      compositions: {
        type: 'array',
        description: 'Named structures from the catalog, each with its eye path.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['structure', 'eyePath'],
          properties: {
            structure: { type: 'string', description: 'A slug from the catalog, not free text.' },
            family: { type: 'string' },
            eyePath: { type: 'string' },
          },
        },
      },
      decisions: {
        type: 'array',
        description: 'The five-part frame, required for any gated technology.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'technology', 'appropriateWhen', 'notAppropriateWhen',
            'complexity', 'failureModes', 'simplerAlternative',
          ],
          properties: {
            technology: { type: 'string' },
            appropriateWhen: { type: 'string' },
            notAppropriateWhen: { type: 'string' },
            complexity: { type: 'string' },
            failureModes: { type: 'string' },
            simplerAlternative: { type: 'string' },
          },
        },
      },
      comparators: {
        type: 'array',
        description:
          'Brands the client will be compared with, placed on the positioning axes '
          + '(E2 plain–story-led, E3 quiet–loud, E4 minimal–expressive, E5 of-its-time–timeless, '
          + 'E6 corporate–artistic, E7 structured–organic; 0 is the first pole, 100 the second). '
          + 'Empty for a department that does not position brands.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'note', 'positions'],
          properties: {
            name: { type: 'string', description: 'The brand, as the client would recognise it.' },
            note: { type: 'string', description: 'One sentence: why it sits there.' },
            positions: {
              type: 'array',
              description: 'At least two axes, or the brand appears on no chart.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['axis', 'value'],
                properties: {
                  axis: { type: 'string', enum: ['E2', 'E3', 'E4', 'E5', 'E6', 'E7'] },
                  value: { type: 'integer', minimum: 0, maximum: 100 },
                },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * Read a submission out of the tool call, dropping empty collections.
 *
 * The schema requires every array so the model cannot quietly omit one it found
 * nothing for — "no targets" and "forgot about targets" look identical in an
 * optional field. Empty arrays are dropped here rather than stored, because
 * downstream an absent list and an empty one mean the same thing and one of
 * them is noise.
 */
export function submissionFrom(input: unknown): Submission {
  const raw = input as {
    body?: unknown;
    scores?: unknown[];
    targets?: unknown[];
    compositions?: unknown[];
    decisions?: unknown[];
    comparators?: unknown[];
  };

  const filled = (list: unknown): boolean => Array.isArray(list) && list.length > 0;

  const submission: Submission = {
    body: typeof raw?.body === 'string' ? raw.body : '',
  };
  if (filled(raw?.scores)) submission.scores = raw.scores as NonNullable<Submission['scores']>;
  if (filled(raw?.targets)) submission.targets = raw.targets as NonNullable<Submission['targets']>;
  if (filled(raw?.compositions)) {
    submission.compositions = raw.compositions as NonNullable<Submission['compositions']>;
  }
  if (filled(raw?.decisions)) submission.decisions = raw.decisions as NonNullable<Submission['decisions']>;
  if (filled(raw?.comparators)) submission.comparators = raw.comparators as unknown[];
  return submission;
}
