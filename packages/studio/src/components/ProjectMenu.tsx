import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Compass, ExternalLink, Play, Trash2, Users } from 'lucide-react';
import { api, type ApiError } from '../api.js';
import { requestConfirmation } from './ConfirmDialog.js';
import OverflowMenu from './OverflowMenu.js';
import { go, openExternal } from './actions.js';

/**
 * The actions a project has, wherever a project appears — the Projects and
 * Campaigns lists, and the cards on Home. One list of them so the three
 * places cannot drift.
 */
export interface ProjectLike {
  id: string;
  name: string;
  clientId: string;
  figmaUrl?: string;
  /** The run this project is currently on, when it has one. */
  runId?: string;
}

export default function ProjectMenu({ project, size }: {
  project: ProjectLike; size?: 'row' | 'bar';
}): ReactElement {
  const queryClient = useQueryClient();
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (e) => setRefused((e as ApiError).message),
  });

  return (
    <>
      <OverflowMenu label={`Actions for ${project.name}`} size={size ?? 'row'} items={[
        { label: 'Start a run', icon: Play, onSelect: () => go(`#/new/${project.id}`) },
        ...(project.runId
          ? [{ label: 'Read the direction', icon: Compass, onSelect: () => go(`#/run/${project.runId}/direction`) }]
          : []),
        { label: 'Open client', icon: Users, onSelect: () => go(`#/clients/${project.clientId}`) },
        ...(project.figmaUrl
          ? [{ label: 'Open in Figma', icon: ExternalLink, onSelect: () => openExternal(project.figmaUrl ?? '') }]
          : []),
        { label: 'Delete', icon: Trash2, danger: true, disabled: remove.isPending,
          onSelect: () => {
            void requestConfirmation({
              title: `Delete ${project.name}?`,
              message: 'This removes the project. Delete its runs first if the studio still has any.',
              confirmLabel: 'Delete project',
            }).then((confirmed) => {
              if (!confirmed) return;
              setRefused(undefined);
              remove.mutate();
            });
          } },
      ]} />
      {refused && <span className="err" style={{ fontSize: 12 }}>{refused}</span>}
    </>
  );
}
