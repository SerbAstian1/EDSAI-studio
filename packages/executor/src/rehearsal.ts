import { dimensionsFor, type Rubric } from '@edsai/rubric';
import type { ModelClient, ModelRequest, ModelResponse } from './protocol.js';
import { SUBMIT_TOOL_NAME } from './submission.js';

/**
 * A model that is not one.
 *
 * A run is twenty-four departments and, on a real key, a real bill. Before
 * anyone spends that, they want to watch the thing move: a run start, each
 * department land in turn, the scorecard fill, a halt and a resume, the
 * portal reflect it. None of that needs a model to have reasoned about the
 * brief — it needs the *shape* of a department's output to arrive in the
 * right order at a believable pace.
 *
 * So this stands where a model client stands and answers every turn with a
 * submission that passes the engine's checks: every dimension the rubric
 * expects is scored, every target is a stated one with a mechanism, and the
 * body says on its first line that nobody reasoned about anything. The
 * engine, the pipeline loop, the events, the store and the Studio all run
 * unmodified — they cannot tell, which is the point.
 *
 * **It never pretends to be findings.** Scores are placeholders spread across
 * the range so a scorecard looks like a scorecard rather than a column of
 * sevens, and each justification says so. Nothing here proposes FINAL, so a
 * rehearsed run stays V1 and never becomes a brand. The model name reported
 * on the run is `rehearsal`, which has no published rate, so the cost column
 * stays empty rather than inventing a number.
 */

export const REHEARSAL_MODEL = 'rehearsal';

export interface RehearsalOptions {
  rubric: Rubric;
  /**
   * How long a department takes. A real turn is a minute or more; zero would
   * finish a run before the first event reached a tab, which shows nothing.
   */
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 1500;

/** The instruction names the department; that is how a turn is told apart. */
const TURN = /^# Your turn: Department (\d+) — /m;
const BRIEF = /^# Project brief\n\n([\s\S]*?)(?:\n\nFrontend System Level|\n\n---)/m;

export class RehearsalClient implements ModelClient {
  private readonly rubric: Rubric;
  private readonly delayMs: number;

  constructor(options: RehearsalOptions) {
    this.rubric = options.rubric;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  }

  async complete(params: ModelRequest): Promise<ModelResponse> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const user = lastUserText(params.messages);
    const departmentId = Number.parseInt(user.match(TURN)?.[1] ?? '', 10);
    const department = this.rubric.departments.find((d) => d.id === departmentId);
    if (!department) {
      throw new Error(`Rehearsal could not tell which department this turn is for.`);
    }
    const brief = user.match(BRIEF)?.[1]?.trim() ?? '';
    const input = this.submission(department.id, brief);
    return {
      stopReason: 'tool-call',
      usage: { inputTokens: 0, outputTokens: 0 },
      content: [{
        type: 'tool-call',
        id: `t-${department.id}`,
        name: SUBMIT_TOOL_NAME,
        input,
      }],
    };
  }

  private submission(departmentId: number, brief: string): Record<string, unknown> {
    const department = this.rubric.departments.find((d) => d.id === departmentId);
    if (!department) throw new Error(`unknown department ${departmentId}`);
    const dimensions = dimensionsFor(this.rubric, departmentId);

    const scores = dimensions.map((dimension, index) => ({
      dimension: dimension.name,
      value: placeholderScore(departmentId, index),
      justification:
        'Rehearsal placeholder — no reasoning was done; the shape of the scorecard is real, '
        + 'this number is not.',
      inverse: dimension.inverse,
    }));

    const targets = department.measurableTargets.slice(0, 3).map((metric) => ({
      discipline: department.name,
      metric,
      target: 'set in a real turn',
      source: 'stated-target',
      mechanism: 'Rehearsal — a real turn states here how the target will be hit.',
    }));

    const firstLine = brief.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));

    const body = [
      '> **Rehearsal.** No model was called for this turn. This shows where '
      + `Department ${department.id} sits in the run and what it is asked to produce, so the `
      + 'pipeline can be walked end to end before a key is spent. Nothing below is a finding '
      + 'about the client.',
      '',
      '## Summary',
      '',
      `- In a real run, ${department.name} states its decisions here in three to six lines.`,
      ...(firstLine ? [`- It would reason from the brief — "${firstLine}" — and every upstream output.`] : []),
      ...(department.measurableTargets.length > 0
        ? [`- It reports against: ${department.measurableTargets.slice(0, 3).join('; ')}.`]
        : []),
      '- Rehearsal: no decision was made.',
      '',
      `## What ${department.name} produces here`,
      '',
      department.mode === 'scored'
        ? `A written output against \`${department.reference}\`, scored on ${dimensions.length} `
          + `dimensions — the four universal ones plus ${department.dimensions.length} of its own.`
        : department.mode === 'measured'
          ? `A written output against \`${department.reference}\`, reported as measurable targets `
            + 'rather than scores.'
          : `A severity-ranked issue list against \`${department.reference}\`, each issue traced `
            + 'to the departments it came from.',
      '',
      ...(department.measurableTargets.length > 0
        ? [
          '## Targets it reports against',
          '',
          ...department.measurableTargets.map((t) => `- ${t}`),
          '',
        ]
        : []),
      ...(firstLine
        ? ['## From the brief', '', `> ${firstLine}`, '']
        : []),
      '## In a real run',
      '',
      'The department reads the full reference file, the brief and every upstream output, '
      + 'reasons through its framework, calls instruments for any number it wants to claim, '
      + 'and submits — usually a minute or two, and a cost shown on this row.',
    ].join('\n');

    // Department 1 places brands on the chart. The rehearsal proposes the one
    // the client named as "not us", at a placeholder position, so the chart
    // shows what a proposed point looks like — and says it is a placeholder.
    const anti = brief.match(/\*\*Would hate to be mistaken for\.\*\*\s*(.+)/)?.[1]?.trim();
    const comparators = departmentId === 1 && anti
      ? [{
        // "Heineken — too corporate" → "Heineken": the name is what comes before
        // the first dash, comma or full stop.
        name: anti.split(/\s[—–-]\s|[,.;]|\s�\s/)[0]?.trim().slice(0, 80) || anti.slice(0, 80),
        note: 'Rehearsal placeholder — a real turn states why it sits here.',
        positions: [{ axis: 'E4', value: 75 }, { axis: 'E6', value: 25 }, { axis: 'E3', value: 70 }],
      }]
      : [];

    return { body, scores, targets, compositions: [], decisions: [], comparators };
  }
}

function lastUserText(messages: ModelRequest['messages']): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    return message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
  }
  return '';
}

/**
 * Spread across 6–9 and different per row, so a rehearsed scorecard reads
 * as a scorecard. Deterministic, so two rehearsals of the same run agree.
 */
function placeholderScore(departmentId: number, index: number): number {
  return 6 + ((departmentId * 7 + index * 3) % 4);
}
