import type { PreparedTurn } from '@edsai/engine';
import type { ModelEffort } from './protocol.js';

export const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

/**
 * Departments whose decisions become the brand system the Brand Hub uses.
 * The hub itself is deterministic; this route only upgrades the thinking that
 * produces its strategy, visual direction, tokens and physical applications.
 */
export const BRAND_MODEL_DEPARTMENT_IDS = [1, 2, 5, 12, 13, 14] as const;

export type ModelSelector = (turn: PreparedTurn) => string;
export type EffortSelector = (turn: PreparedTurn, model: string) => ModelEffort | undefined;

export function departmentModelSelector(
  defaultModel: string,
  routedModel: string,
  departmentIds: readonly number[] = BRAND_MODEL_DEPARTMENT_IDS,
): ModelSelector {
  const selected = routedModel.trim();
  if (!selected) throw new Error('A routed model id cannot be empty.');
  const routed = new Set(departmentIds);
  return (turn) => routed.has(turn.department.id) ? selected : defaultModel;
}

export function parseDepartmentIds(
  value: string | undefined,
  fallback: readonly number[] = BRAND_MODEL_DEPARTMENT_IDS,
): number[] {
  if (value === undefined) return [...fallback];
  if (!value.trim()) return [];

  const ids = value.split(',').map((part) => Number(part.trim()));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('EDSAI_BRAND_MODEL_DEPARTMENTS must be comma-separated positive integers.');
  }
  return [...new Set(ids)];
}

export function parseModelEffort(value: string | undefined): ModelEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'default') return undefined;
  const efforts: ModelEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (efforts.includes(normalized as ModelEffort)) return normalized as ModelEffort;
  throw new Error(`Unknown reasoning effort "${value}".`);
}

export function parseMaxOutputTokens(
  value: string | undefined,
  fallback = DEFAULT_MAX_OUTPUT_TOKENS,
): number {
  if (value === undefined || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_024) {
    throw new Error('EDSAI_MAX_OUTPUT_TOKENS must be an integer of at least 1024.');
  }
  return parsed;
}

/** GPT-6 accepts low effort across Astra, Sol and Luna. */
export const lowEffortForGpt6: EffortSelector = (_turn, model) =>
  /^gpt-6(?:[-.]|$)/.test(model) ? 'low' : undefined;
