import { describe, expect, it } from 'vitest';
import {
  QUESTIONS, RATIO_STRENGTHS, answerIsValid, progressOf, deriveProject, question,
  type Answer,
} from '../src/onboarding.js';

/**
 * The flow's own principles, asserted as properties of the catalog.
 *
 * `docs/discovery/flow.md` states them as rules a designer follows; here they
 * are checks that fail if someone stops following them.
 */

const answer = (questionId: string, value: unknown): Answer =>
  ({ onboardingId: 'o1', questionId, value, answeredAt: '2026-09-18T00:00:00.000Z' });

describe('the catalog follows its own rules', () => {
  it('never uses design vocabulary in a question a client reads', () => {
    // "A good discovery question produces a decision, not a description", and
    // the words below mean something different to everyone in the room.
    const banned = /\b(minimal|modern|clean|premium|elegant|sleek|dynamic|bold and)\b/i;
    for (const q of QUESTIONS) {
      expect(banned.test(q.prompt), `${q.id}: ${q.prompt}`).toBe(false);
      for (const option of q.options ?? []) {
        expect(banned.test(option.label), `${q.id}/${option.id}`).toBe(false);
      }
    }
  });

  it('offers no midpoint on a ratio axis, so 50/50 cannot be expressed', () => {
    for (const strength of RATIO_STRENGTHS) {
      const [a, b] = strength.ratio.split('/').map(Number);
      expect(a).not.toBe(b);
    }
    expect(RATIO_STRENGTHS.map((s) => s.ratio)).toEqual(['60/40', '70/30', '85/15']);
  });

  it('anchors every scale with a sentence rather than a number', () => {
    for (const q of QUESTIONS.filter((x) => x.kind === 'scale')) {
      expect(q.anchors?.low.length, q.id).toBeGreaterThan(8);
      expect(q.anchors?.high.length, q.id).toBeGreaterThan(8);
    }
  });

  it('never asks for the three axes the studio drafts', () => {
    // Asking a client to write a positioning statement produces category
    // description, which the gate then rejects — a bad experience for everyone.
    for (const q of QUESTIONS) {
      expect(q.axis === 'T2' || q.axis === 'T3', q.id).toBe(false);
    }
  });

  it('covers all eight enumerated axes exactly once', () => {
    const axes = QUESTIONS.map((q) => q.axis).filter((a) => a?.startsWith('E'));
    expect(new Set(axes).size).toBe(8);
    expect(axes).toHaveLength(8);
  });

  it('gives every question a stable id and no duplicates', () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('answer validation', () => {
  it('refuses an answer to a question that does not exist', () => {
    expect(answerIsValid('nope', 'anything')).toBe(false);
    expect(question('nope')).toBeUndefined();
  });

  it('accepts and refuses text by content rather than presence', () => {
    expect(answerIsValid('f-what', 'We make boots.')).toBe(true);
    expect(answerIsValid('f-what', '   ')).toBe(false);
    expect(answerIsValid('f-what', 'x'.repeat(2001))).toBe(false);
    expect(answerIsValid('f-what', 42)).toBe(false);
  });

  it('accepts only an option the question actually offers', () => {
    expect(answerIsValid('e1', 'directness')).toBe(true);
    expect(answerIsValid('e1', 'something-else')).toBe(false);
  });

  it('holds a scale to 1 through 5, integers only', () => {
    expect(answerIsValid('e2', 3)).toBe(true);
    expect(answerIsValid('e2', 0)).toBe(false);
    expect(answerIsValid('e2', 6)).toBe(false);
    expect(answerIsValid('e2', 2.5)).toBe(false);
  });

  it('needs both a side and a strength for a ratio', () => {
    expect(answerIsValid('e4', { side: 'a', strength: 'clearly' })).toBe(true);
    expect(answerIsValid('e4', { side: 'a' })).toBe(false);
    expect(answerIsValid('e4', { side: 'middle', strength: 'clearly' })).toBe(false);
    expect(answerIsValid('e4', 'a')).toBe(false);
  });

  it('takes exactly three traits, not two and not four', () => {
    expect(answerIsValid('d-traits', ['precise', 'warm', 'bold'])).toBe(true);
    expect(answerIsValid('d-traits', ['precise', 'warm'])).toBe(false);
    expect(answerIsValid('d-traits', ['precise', 'warm', 'bold', 'quiet'])).toBe(false);
  });

  it('refuses the same trait picked three times to reach the count', () => {
    expect(answerIsValid('d-traits', ['precise', 'precise', 'precise'])).toBe(false);
  });

  it('lets an as-many-as-apply question take any number of real options', () => {
    expect(answerIsValid('f-deliverables', ['logo'])).toBe(true);
    expect(answerIsValid('f-deliverables', ['logo', 'website', 'print'])).toBe(true);
    expect(answerIsValid('f-deliverables', ['not-an-option'])).toBe(false);
  });
});

describe('progress', () => {
  it('reports nothing answered on an empty onboarding', () => {
    const progress = progressOf([]);
    expect(progress.answered).toBe(0);
    expect(progress.percent).toBe(0);
    expect(progress.outstanding.length).toBe(progress.required);
  });

  it('does not count an answer that fails validation', () => {
    // Otherwise a client could reach 100% by sending junk.
    expect(progressOf([answer('e2', 99)]).answered).toBe(0);
  });

  it('counts a valid answer and drops it from outstanding', () => {
    const progress = progressOf([answer('f-what', 'We make boots.')]);
    expect(progress.answered).toBe(1);
    expect(progress.outstanding).not.toContain('f-what');
  });

  it('resolves exactly eight axes from a complete client flow, never eleven', () => {
    const answers = [
      answer('e1', 'directness'), answer('e2', 4), answer('e3', 2),
      answer('e4', { side: 'a', strength: 'clearly' }),
      answer('e5', { side: 'b', strength: 'slightly' }),
      answer('e6', { side: 'b', strength: 'overwhelmingly' }),
      answer('e7', { side: 'a', strength: 'clearly' }),
      answer('e8', 'negative-space'),
    ];
    const progress = progressOf(answers);
    expect(progress.axesDecided).toBe(8);
    expect(progress.axesDrafted).toHaveLength(3);
  });

  it('reaches 100% when every required question is answered', () => {
    const answers = QUESTIONS.filter((q) => q.required).map((q) => {
      switch (q.kind) {
        case 'text': return answer(q.id, 'An answer.');
        case 'scale': return answer(q.id, 3);
        case 'ratio': return answer(q.id, { side: 'a', strength: 'clearly' });
        case 'binary': return answer(q.id, q.options?.[0]?.id);
        default: return answer(q.id, q.take
          ? (q.options ?? []).slice(0, q.take).map((o) => o.id)
          : [q.options?.[0]?.id]);
      }
    });
    const progress = progressOf(answers);
    expect(progress.percent).toBe(100);
    expect(progress.outstanding).toEqual([]);
  });
});

describe('deriving a project', () => {
  const base = [
    answer('f-what', 'We make hand-finished boots.'),
    answer('f-who', 'People who were reading a repair guide.'),
    answer('w-headline', 'The boots that outlived the shop.'),
    answer('d-worst', 'A fast-fashion label — we would rather close.'),
  ];

  it('names a brand identity project when identity is asked for', () => {
    const project = deriveProject('Disan', [...base, answer('f-deliverables', ['identity'])]);
    expect(project.kind).toBe('brand-identity');
    expect(project.name).toBe('Brand identity');
  });

  it('names a website project when that is what they asked for', () => {
    const project = deriveProject('Disan', [...base, answer('f-deliverables', ['website'])]);
    expect(project.kind).toBe('website');
  });

  it('falls back to discovery when nothing was chosen', () => {
    const project = deriveProject('Disan', [...base, answer('f-deliverables', ['unsure'])]);
    expect(project.name).toBe('Discovery');
    expect(project.kind).toBe('other');
  });

  it('carries the client’s own words into the brief', () => {
    const project = deriveProject('Disan', [...base, answer('f-deliverables', ['logo'])]);
    expect(project.notes).toContain('hand-finished boots');
    expect(project.notes).toContain('outlived the shop');
    expect(project.notes).toContain('Disan');
  });

  it('marks what was not answered rather than inventing it', () => {
    const project = deriveProject('Disan', [answer('f-deliverables', ['logo'])]);
    expect(project.notes).toContain('(not answered)');
  });

  it('never fabricates the three axes the studio owes', () => {
    const project = deriveProject('Disan', [...base, answer('f-deliverables', ['identity'])]);
    expect(project.notes).toContain('leaves those three for the studio');
    expect(project.notes.toLowerCase()).not.toContain('positioning statement:');
  });
});
