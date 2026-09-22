import type { ReactElement } from 'react';
import type { Asset, BrandProject, BrandValue } from '../api.js';
import PatternStudio, { tileable } from './PatternStudio.js';
import IllustrationBuilder, { partsFor } from './IllustrationBuilder.js';
import TemplateMaker from './TemplateMaker.js';

/**
 * One place that knows which component a tool id opens, so the portal and
 * the studio's own preview cannot disagree about it.
 */

export interface ToolProps {
  clientId: string;
  assets: readonly Asset[];
  values: readonly BrandValue[];
  project: BrandProject | undefined;
  onSaved: (project: BrandProject) => void;
  onClose: () => void;
}

/** Whether a tool has what it needs among the approved files. */
export function toolReady(toolId: string, assets: readonly Asset[]): boolean {
  const approved = assets.filter((a) => a.approved);
  if (toolId === 'pattern-studio') return approved.some(tileable);
  if (toolId === 'illustration-builder') return partsFor(approved).length > 0;
  // A template tool works from the palette alone; artwork and photos make it better.
  return true;
}

export default function ToolHost({ toolId, ...props }: ToolProps & { toolId: string }): ReactElement | null {
  if (toolId === 'pattern-studio') return <PatternStudio {...props} />;
  if (toolId === 'illustration-builder') return <IllustrationBuilder {...props} />;
  if (toolId === 'social-post' || toolId === 'poster') return <TemplateMaker format={toolId} {...props} />;
  return null;
}
