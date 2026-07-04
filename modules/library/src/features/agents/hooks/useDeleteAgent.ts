import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { deleteAgent } from '../api';
import { AGENTS_LIST_KEY } from './useAgentsList';
import { AGENT_DETAIL_KEY } from './useAgent';

/**
 * Mutation hook for hard-deleting an agent. There is no trash for agents
 * upstream (v0.8.0), so this is irreversible. Callers should guard with a
 * danger-confirm dialog.
 *
 * On success the list cache is invalidated so the row drops out of view
 * immediately, and the detail cache for the deleted id is purged.
 */
export function useDeleteAgent() {
  const qc = useQueryClient();
  const { t } = useTranslation('agents');

  return useMutation({
    mutationFn: ({
      agentId,
      profileId,
      agentScopeId,
    }: {
      agentId: string;
      profileId?: string;
      agentScopeId?: string;
    }) => deleteAgent(agentId, { profileId, agentId: agentScopeId }),
    onSuccess: (_, { agentId }) => {
      toast.success(t('toasts.deleted', 'Agent deleted'));
      qc.invalidateQueries({ queryKey: [AGENTS_LIST_KEY] });
      qc.removeQueries({ queryKey: [AGENT_DETAIL_KEY, agentId] });
    },
    onError: () => {
      toast.error(t('toasts.deleteFailed', 'Failed to delete agent'));
    },
  });
}
