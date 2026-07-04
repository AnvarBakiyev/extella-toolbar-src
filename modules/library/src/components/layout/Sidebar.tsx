import { useState, type ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, FileText, Sparkles, Bot, Cpu, Users, Database, MonitorSmartphone, KeyRound } from 'lucide-react';
import { cn } from '@/lib/cn';

type IconCmp = ComponentType<{ className?: string }>;

interface NavItem {
  id: string;
  label: string;
  icon: IconCmp;
  to: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Trimmed sidebar for the standalone build. Two nav groups:
 *   - "My Library" — Rules, Concepts, Experts, Agents.
 *   - "System" — Devices, KV Store.
 * Mirrors the main app's grouping (English-only here).
 */
const GROUPS: NavGroup[] = [
  {
    id: 'my-library',
    label: 'My Library',
    items: [
      { id: 'rules', label: 'Rules', icon: FileText, to: '/rules' },
      { id: 'concepts', label: 'Concepts', icon: Sparkles, to: '/concepts' },
      { id: 'experts', label: 'Experts', icon: Bot, to: '/experts' },
      { id: 'agents', label: 'Agents', icon: Cpu, to: '/agents' },
      { id: 'teams', label: 'Agent Teams', icon: Users, to: '/teams' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'devices', label: 'Devices', icon: MonitorSmartphone, to: '/devices' },
      { id: 'kvstore', label: 'KV Store', icon: Database, to: '/kvstore' },
      { id: 'tokens', label: 'Tokens', icon: KeyRound, to: '/tokens' },
    ],
  },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <aside
      className="flex w-[260px] shrink-0 flex-col border-r border-divider bg-bg2"
      aria-label="My Library"
    >
      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto p-2">
        {GROUPS.map((g) => {
          const isCollapsed = collapsed[g.id];
          return (
            <div key={g.id} className="mb-1">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium uppercase tracking-wider text-textFaint hover:bg-bg3"
              >
                <ChevronDown
                  className={cn(
                    'h-3 w-3 transition-transform',
                    isCollapsed && '-rotate-90',
                  )}
                />
                <span>{g.label}</span>
              </button>
              {!isCollapsed && (
                <ul className="flex flex-col gap-px pl-0.5">
                  {g.items.map((item) => (
                    <li key={item.id}>
                      <NavItemRow item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function NavItemRow({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex h-8 w-full items-center gap-3 rounded-md px-3 text-base font-semibold text-text',
          'transition-colors hover:bg-bg3',
          isActive && 'bg-accentSoft text-accent',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              'h-[15px] w-[15px]',
              isActive ? 'text-accent' : 'text-icon',
            )}
          />
          <span className="flex-1 truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}
