import type { ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Download, EyeOff, LayoutTemplate, Trash2, Users } from 'lucide-react';
import { api, type Asset } from '../api.js';
import OverflowMenu from './OverflowMenu.js';
import { downloadFile, go } from './actions.js';

/**
 * A file's actions in the studio-wide views — Files and Templates — where
 * the row has no edit form of its own. Editing stays on the client's Files
 * panel; this is what can be done from a distance: approve or withdraw,
 * download, mark as a template or back, delete.
 */
export default function AssetMenu({ asset }: { asset: Asset }): ReactElement {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
  };
  const update = useMutation({
    mutationFn: (input: { approved?: boolean; kind?: Asset['kind'] }) => api.updateAsset(asset.id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => api.deleteAsset(asset.id), onSuccess: refresh });

  return (
    <OverflowMenu label={`Actions for ${asset.filename}`} items={[
      asset.approved
        ? { label: 'Withdraw from portal', icon: EyeOff, disabled: update.isPending,
            onSelect: () => update.mutate({ approved: false }) }
        : { label: 'Approve for portal', icon: Check, disabled: update.isPending,
            onSelect: () => update.mutate({ approved: true }) },
      { label: 'Download', icon: Download, onSelect: () => downloadFile(api.downloadPath(asset.id), asset.filename) },
      asset.kind === 'template'
        ? { label: 'Unmark as template', icon: LayoutTemplate, disabled: update.isPending,
            onSelect: () => update.mutate({ kind: 'other' }) }
        : { label: 'Mark as template', icon: LayoutTemplate, disabled: update.isPending,
            onSelect: () => update.mutate({ kind: 'template' }) },
      { label: 'Open client', icon: Users, onSelect: () => go(`#/clients/${asset.clientId}/delivery`) },
      { label: 'Delete', icon: Trash2, danger: true, disabled: remove.isPending,
        onSelect: () => {
          if (confirm(`Delete "${asset.filename}"? This removes it from the studio and the client's portal.`)) {
            remove.mutate();
          }
        } },
    ]} />
  );
}
