import { z } from 'zod';

/**
 * What a probe brings back, before anything judges it.
 *
 * The split that makes this package work: a probe fetches and normalises into
 * one of these records, the record is stored, and an instrument evaluates it.
 * Re-checking the same page against a different budget never touches the
 * network again, and every instrument stays a pure function of a record.
 */

export const WebVitalsRecord = z.object({
  url: z.string().min(1),
  fetchedAt: z.string(),
  /** Real-user data from CrUX, where the page has enough traffic to have it. */
  field: z.object({
    lcp: z.number().optional(),
    inp: z.number().optional(),
    cls: z.number().optional(),
    /** Whether CrUX returned page-level data or fell back to origin-level. */
    scope: z.enum(['page', 'origin']).optional(),
  }).optional(),
  /** Lighthouse's synthetic run. Always present; never outranks field data. */
  lab: z.object({
    performanceScore: z.number().optional(),
    lcp: z.number().optional(),
    inp: z.number().optional(),
    cls: z.number().optional(),
    fcp: z.number().optional(),
    ttfb: z.number().optional(),
    totalBlockingTime: z.number().optional(),
  }),
  strategy: z.enum(['mobile', 'desktop']).default('mobile'),
});
export type WebVitalsRecord = z.infer<typeof WebVitalsRecord>;

export const HeaderRecord = z.object({
  url: z.string().min(1),
  fetchedAt: z.string(),
  status: z.number().int(),
  /** Lower-cased header names to values. */
  headers: z.record(z.string(), z.string()),
  cookies: z.array(z.object({
    name: z.string(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.string().optional(),
  })).default([]),
});
export type HeaderRecord = z.infer<typeof HeaderRecord>;

export const BundleRecord = z.object({
  /** Chunks as a bundler's stats.json reports them. */
  chunks: z.array(z.object({
    name: z.string(),
    bytes: z.number().nonnegative(),
    gzipBytes: z.number().nonnegative().optional(),
    /** True when the chunk is on the initial route rather than lazy. */
    initial: z.boolean().default(true),
    renderBlocking: z.boolean().default(false),
  })).min(1),
  source: z.string().default('stats.json'),
});
export type BundleRecord = z.infer<typeof BundleRecord>;

/**
 * axe results, imported rather than probed.
 *
 * axe has to run inside a browser with the page open, so it cannot be fetched
 * from a server. The Studio ships the snippet that produces this file; pretending
 * otherwise would be the kind of convenient fiction this system exists to refuse.
 */
export const AxeRecord = z.object({
  url: z.string().min(1),
  testedAt: z.string(),
  violations: z.array(z.object({
    id: z.string(),
    impact: z.enum(['critical', 'serious', 'moderate', 'minor']).optional(),
    help: z.string(),
    nodes: z.number().int().nonnegative().default(1),
  })).default([]),
  /** How many checks passed. A zero with no passes behind it is a failed run. */
  passes: z.number().int().nonnegative().optional(),
  incomplete: z.number().int().nonnegative().default(0),
});
export type AxeRecord = z.infer<typeof AxeRecord>;
