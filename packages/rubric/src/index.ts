import { corpusRoot, readReference, readSkill } from './corpus.js';
import { parseActivationMatrix } from './parse/classification.js';
import { parseCompositionCatalog, slug } from './parse/composition.js';
import { parseDepartmentDimensions, parseDepartmentTargets, reconcile } from './parse/departments.js';
import {
  parseCanonicalDimensions,
  parseMeasurableTargets,
  parseRollUps,
  parseSeverities,
  parseUniversalDimensions,
} from './parse/scorecard.js';
import { parseTracks } from './parse/tracks.js';
import { Rubric, type Activation, type Department, type SystemLevel } from './types.js';
import { FULL_SCOPE, isExcluded, type DeliveryScope } from './scope.js';

export * from './types.js';
export { corpusRoot } from './corpus.js';
export { slug } from './parse/composition.js';
export * from './scope.js';

/**
 * Builds the typed rubric from the vendored corpus.
 *
 * This is the drift contract: the markdown stays canonical and is what the model
 * reads, while everything structured is derived from it here and validated. A
 * department is added by writing a markdown file, not by editing this package.
 */
export function buildRubric(root = corpusRoot()): Rubric {
  const skill = readSkill(root);
  const scorecard = readReference('00-scorecard.md', root);

  const { tracks, stubs } = parseTracks(skill);
  const { byDepartment } = parseCanonicalDimensions(scorecard);

  const departments: Department[] = [];
  const drift = [];

  for (const [id, stub] of [...stubs].sort((a, b) => a[0] - b[0])) {
    const canonical = byDepartment.get(id) ?? [];
    const markdown = readReference(stub.reference, root);
    const fromFile = parseDepartmentDimensions(markdown, id, stub.reference);
    const reconciled = reconcile(id, canonical, fromFile);
    drift.push(...reconciled.drift);

    departments.push({
      id,
      name: stub.name,
      mode: id === 8 ? 'measured' : id === 9 ? 'issue-counted' : 'scored',
      dimensions: reconciled.dimensions,
      measurableTargets: parseDepartmentTargets(markdown, id),
      reference: stub.reference,
    });
  }

  return Rubric.parse({
    universalDimensions: parseUniversalDimensions(scorecard),
    departments,
    activationMatrix: parseActivationMatrix(readReference('00-frontend-classification.md', root)),
    compositionFamilies: parseCompositionCatalog(readReference('composition-frameworks.md', root)),
    rollUps: parseRollUps(scorecard),
    severities: parseSeverities(scorecard),
    measurableTargets: parseMeasurableTargets(scorecard),
    tracks,
    drift,
  });
}

/* ------------------------------------------------------------------ queries */

/** Whether a department runs at a level, and how strongly. */
export function activationAt(rubric: Rubric, departmentId: number, level: SystemLevel): Activation {
  const row = rubric.activationMatrix.find((r) => r.departmentId === departmentId);
  // Departments outside the gated block (1–15) are not in the matrix; they run
  // whenever their track runs, which is the track's business, not the level's.
  return row ? row.byLevel[level] : 'full';
}

/**
 * The departments a run executes, in pipeline order, for a given level and
 * tracks. This is what `00-scorecard.md §3` means by "skipped departments
 * produce no row" — they never enter the run at all.
 */
export function activatedDepartments(
  rubric: Rubric,
  level: SystemLevel,
  trackIds: readonly string[] = ['digital-product', 'frontend-block', 'closing'],
  scope: DeliveryScope = FULL_SCOPE,
): Department[] {
  const seen = new Set<number>();
  const out: Department[] = [];

  for (const trackId of trackIds) {
    const track = rubric.tracks.find((t) => t.id === trackId);
    if (!track) throw new Error(`unknown track: ${trackId}`);

    for (const id of track.order) {
      if (seen.has(id)) continue;
      // A department outside the studio's delivery scope never enters the run,
      // for the same reason an unactivated one does not: there is no row to skip.
      if (isExcluded(scope, id)) continue;
      if (activationAt(rubric, id, level) === 'off') continue;
      const department = rubric.departments.find((d) => d.id === id);
      if (!department) throw new Error(`track ${trackId} names unknown department ${id}`);
      seen.add(id);
      out.push(department);
    }
  }
  return out;
}

/** Every composition structure, flattened — the enum a department must cite. */
export function compositionStructures(rubric: Rubric) {
  return rubric.compositionFamilies.flatMap((f) => f.structures);
}

/** Look up a structure by name or slug, so a cited structure can be validated. */
export function findStructure(rubric: Rubric, nameOrId: string) {
  const key = slug(nameOrId);
  return compositionStructures(rubric).find((s) => s.id === key || slug(s.name) === key);
}

/** Every dimension a department scores: the four universal ones plus its own. */
export function dimensionsFor(rubric: Rubric, departmentId: number) {
  const department = rubric.departments.find((d) => d.id === departmentId);
  if (!department) throw new Error(`unknown department: ${departmentId}`);
  if (department.mode !== 'scored') return [];
  return [...rubric.universalDimensions, ...department.dimensions];
}
