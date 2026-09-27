import { describe, expect, it } from 'vitest';
import type { Principal } from '@edsai/auth';
import { RunStore } from '../src/store.js';
import { ScopedStore } from '../src/scoped.js';
import {
  STRATEGY_SYSTEM, Strategy, TRANSCRIPT_LIMIT, cutTranscript, strategyUser,
} from '../src/strategy.js';

/**
 * The strategy is the one document in this system a client reads and a machine
 * wrote. So the tests here are mostly about the three ways that goes wrong: a
 * transcript too long to read and quietly truncated, a draft that starts
 * committing the studio to things nobody said, and a page that cannot be traced
 * back to the words it came from.
 */

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  id: 's1',
  clientId: 'client-a',
  title: 'Where Disan actually points',
  transcript: 'I want people to take us seriously.',
  markdown: '## What they said they wanted\n\n> I want people to take us seriously.',
  model: 'gpt-6-sol',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('reading a transcript', () => {
  it('leaves a transcript that fits exactly as it is, bar the paste padding', () => {
    const text = 'a founder talking. '.repeat(100);
    expect(cutTranscript(`  ${text}  `)).toEqual({ text: text.trim(), truncated: false, dropped: 0 });
  });

  it('cuts at a line, and never at one that empties the page', () => {
    const line = 'x'.repeat(500);
    const text = Array.from({ length: 200 }, () => line).join('\n');
    const cut = cutTranscript(text);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(TRANSCRIPT_LIMIT);
    expect(cut.text.endsWith(line)).toBe(true);
    expect(cut.dropped).toBeGreaterThan(0);
  });

  it('counts the words it dropped, so the studio can say so', () => {
    // One clean line break past the halfway mark, so the cut lands on it.
    const head = 'word '.repeat(10_000);
    const cut = cutTranscript(`${head}\n${'word '.repeat(20_000)}`);
    expect(cut.dropped).toBe(20_000);
    expect(cut.text.split(/\s+/).filter(Boolean)).toHaveLength(10_000);
  });

  it('tells the model it read a part, because a half-read transcript invents the rest', () => {
    const cut = cutTranscript(Array.from({ length: 200 }, () => 'y'.repeat(500)).join('\n'));
    const user = strategyUser({ transcript: cut.text, dropped: cut.dropped });
    expect(user).toContain('words of the end were not included for length');
    expect(user).toContain('Do not reason about anything after this line');
  });

  it('says nothing about a cut when there was none', () => {
    expect(strategyUser({ transcript: 'short' })).toBe('--- TRANSCRIPT ---\nshort');
  });
});

describe('the instruction the draft is written under', () => {
  it('asks for the five sections, in order', () => {
    const headings = [...STRATEGY_SYSTEM.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'What they said they wanted',
      'Where the work actually points',
      'What the studio would do about it',
      'What would have to be true',
      'Open questions',
    ]);
  });

  it('refuses to become a proposal, a price or an audit', () => {
    expect(STRATEGY_SYSTEM).toMatch(/no fees/i);
    expect(STRATEGY_SYSTEM).toMatch(/no deliverables/i);
    expect(STRATEGY_SYSTEM).toMatch(/no axis positions/i);
  });

  it('bans the same design words the discovery flow bans', () => {
    for (const word of ['elevated', 'premium', 'modern', 'minimal', 'sleek', 'approachable']) {
      expect(STRATEGY_SYSTEM.toLowerCase()).toContain(word);
    }
  });

  it('puts the discovery brief in before the transcript when there is one', () => {
    const user = strategyUser({
      clientName: 'Disan',
      discovery: '**Budget band.** 25,000 to 60,000.',
      transcript: 'the words',
    });
    expect(user.indexOf('The client is Disan.')).toBeLessThan(user.indexOf('--- TRANSCRIPT ---'));
    expect(user.indexOf('25,000 to 60,000')).toBeLessThan(user.indexOf('--- TRANSCRIPT ---'));
  });
});

describe('a strategy in the store', () => {
  it('round-trips with the transcript intact, because a draft is not reproducible', () => {
    const db = new RunStore();
    db.saveStrategy(strategy());
    const read = db.getStrategy('s1');
    expect(read?.markdown).toContain('take us seriously');
    expect(read?.transcript).toBe('I want people to take us seriously.');
    expect(read?.model).toBe('gpt-6-sol');
    db.close();
  });

  it('records a written-by-hand page as having no model rather than a fake one', () => {
    const db = new RunStore();
    db.saveStrategy(strategy({ model: undefined }));
    expect(db.getStrategy('s1')).not.toHaveProperty('model');
    db.close();
  });

  it('lists the one being worked on first', () => {
    const db = new RunStore();
    db.saveStrategy(strategy({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }));
    db.saveStrategy(strategy({ id: 'new', updatedAt: '2026-09-09T00:00:00.000Z' }));
    expect(db.listStrategiesForClient('client-a').map((s) => s.id)).toEqual(['new', 'old']);
    db.close();
  });

  it('keeps a client out of another client’s page', () => {
    const db = new RunStore();
    db.saveStrategy(strategy());
    expect(db.listStrategiesForClient('client-b')).toEqual([]);
    db.close();
  });
});

const studio: Principal = { kind: 'studio', userId: 'u1', role: 'owner' };
const clientPortal: Principal = { kind: 'portal', userId: 'p1', clientId: 'client-a', role: 'editor' };
const otherPortal: Principal = { kind: 'portal', userId: 'p2', clientId: 'client-b', role: 'editor' };

describe('who may read a strategy and who may write one', () => {
  it('lets the studio read and revise its own reading', () => {
    const db = new ScopedStore(new RunStore(), studio);
    db.saveStrategy(strategy());
    expect(db.listStrategies('client-a')).toHaveLength(1);
    db.saveStrategy(strategy({ markdown: '## Open questions\n\n- Revised by a person.' }));
    expect(db.getStrategy('s1')?.markdown).toContain('Revised by a person');
  });

  it('lets the client read the page written about them', () => {
    const db = new RunStore();
    db.saveStrategy(strategy());
    const portal = new ScopedStore(db, clientPortal);
    expect(portal.getStrategy('s1')?.title).toBe('Where Disan actually points');
  });

  it('refuses the client an edit, and says why in terms', () => {
    const db = new RunStore();
    db.saveStrategy(strategy());
    const portal = new ScopedStore(db, clientPortal);
    expect(() => portal.saveStrategy(strategy({ markdown: 'edited by the client' })))
      .toThrow(/strategy status is set by the studio/);
    expect(db.getStrategy('s1')?.markdown).not.toContain('edited by the client');
  });

  it('refuses a client another client’s page, before the role is even considered', () => {
    const db = new RunStore();
    db.saveStrategy(strategy());
    const portal = new ScopedStore(db, otherPortal);
    expect(portal.getStrategy('s1')).toBeUndefined();
    expect(portal.listStrategies('client-a')).toEqual([]);
  });
});
