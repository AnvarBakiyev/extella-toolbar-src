import { createHashRouter, Navigate } from 'react-router-dom';
import { Layout } from './Layout';
import { RulesPage } from '@/features/rules/pages/RulesPage';
import { ConceptsPage } from '@/features/concepts/pages/ConceptsPage';
import { ExpertsListPage } from '@/features/experts/pages/ExpertsListPage';
import { AgentsListPage } from '@/features/agents/pages/AgentsListPage';
import { AgentDetailPage } from '@/features/agents/pages/AgentDetailPage';
import { TeamsListPage } from '@/features/teams/pages/TeamsListPage';
import { TeamDetailPage } from '@/features/teams/pages/TeamDetailPage';
import { KvStorePage } from '@/features/kvstore/pages/KvStorePage';
import { DevicesListPage } from '@/features/devices/pages/DevicesListPage';
import { TokensPage } from '@/features/tokens/pages/TokensPage';
import { NotFoundPage } from '@/components/layout/NotFoundPage';

/**
 * Hash router — works from `file://` URLs inside Electron without server-side
 * routing rewrites.
 */
export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/rules" replace /> },

      { path: 'rules', element: <RulesPage /> },
      { path: 'rules/:id', element: <RulesPage /> },

      { path: 'concepts', element: <ConceptsPage /> },
      { path: 'concepts/:id', element: <ConceptsPage /> },

      { path: 'experts', element: <ExpertsListPage /> },
      { path: 'experts/:id', element: <ExpertsListPage /> },

      { path: 'agents', element: <AgentsListPage /> },
      { path: 'agents/:id', element: <AgentsListPage /> },
      { path: 'agents/:id/page', element: <AgentDetailPage /> },

      { path: 'teams', element: <TeamsListPage /> },
      { path: 'teams/:id', element: <TeamDetailPage /> },

      { path: 'kvstore', element: <KvStorePage /> },
      { path: 'kvstore/:key', element: <KvStorePage /> },

      { path: 'devices', element: <DevicesListPage /> },
      { path: 'devices/:id', element: <DevicesListPage /> },

      { path: 'tokens', element: <TokensPage /> },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
