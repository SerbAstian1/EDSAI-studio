import { Suspense, type ReactElement } from 'react';
import type { Asset, BrandModule, BrandProject, BrandValue } from '../api.js';
import { moduleComponent, moduleReady, type ToolProps } from './brandModules.js';

/**
 * One place that knows which component a module opens, so the portal and the
 * studio's own preview cannot disagree about it.
 *
 * **Registry-driven rather than a switch.** The old version asked "which id is
 * this?" in a chain of `if`s, which meant every future tool was an edit here,
 * in the portal's icon map, and in the studio's. The module registry answers
 * the same question from data, and a module the server sends that this build
 * has no component for is not rendered at all rather than rendered blank.
 *
 * The component is loaded on open, so a client whose hub holds four tools
 * downloads one of them.
 */

/** Whether a tool has what it needs among the approved files. */
export function toolReady(toolId: string, assets: readonly Asset[]): boolean {
  return moduleReady(toolId, assets);
}

export default function ToolHost({ toolId, module, ...props }: Omit<ToolProps, 'module'> & {
  toolId: string;
  /** The resolved module, so the tool renders only the controls the brand allows. */
  module: BrandModule;
}): ReactElement | null {
  const Component = moduleComponent(toolId);
  // A module the server resolved but this build cannot draw. Returning null is
  // the honest answer; the caller renders the module list, not the tool.
  if (!Component) return null;
  return (
    <Suspense fallback={<div className="empty"><p className="muted">Opening the tool…</p></div>}>
      <Component {...props} module={module} />
    </Suspense>
  );
}

export type { Asset, BrandModule, BrandProject, BrandValue, ToolProps };
