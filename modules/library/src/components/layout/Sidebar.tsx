import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { ChevronDown, FileText, Sparkles, Bot, Cpu, Users, Database, MonitorSmartphone, KeyRound } from 'lucide-react';
import { cn } from '@/lib/cn';

type IconCmp = ComponentType<{ className?: string }>;

// Подписи меню — КЛЮЧИ, а не готовые строки. Раньше здесь лежал английский текст, и
// русский словарь до экрана не доезжал: язык переключён, а меню осталось «Rules ·
// Concepts · Experts». Проверка «слова есть в сборке» такое пропускает — слова-то есть,
// просто их никто не спрашивает (поймала Элла 30.07).
interface NavItem {
  id: string;
  labelKey: string;
  icon: IconCmp;
  to: string;
}

interface NavGroup {
  id: string;
  labelKey: string;
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
    labelKey: 'nav.myLibrary',
    items: [
      { id: 'rules', labelKey: 'nav.rules', icon: FileText, to: '/rules' },
      { id: 'concepts', labelKey: 'nav.concepts', icon: Sparkles, to: '/concepts' },
      { id: 'experts', labelKey: 'nav.experts', icon: Bot, to: '/experts' },
      { id: 'agents', labelKey: 'nav.agents', icon: Cpu, to: '/agents' },
      { id: 'teams', labelKey: 'nav.teams', icon: Users, to: '/teams' },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.system',
    items: [
      { id: 'devices', labelKey: 'nav.devices', icon: MonitorSmartphone, to: '/devices' },
      { id: 'kvstore', labelKey: 'nav.kvstore', icon: Database, to: '/kvstore' },
      { id: 'tokens', labelKey: 'nav.tokens', icon: KeyRound, to: '/tokens' },
    ],
  },
];

export function Sidebar() {
  const { t } = useTranslation('common');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <aside
      className="flex w-[260px] shrink-0 flex-col border-r border-divider bg-bg2"
      aria-label={t('nav.myLibrary')}
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
                <span>{t(g.labelKey)}</span>
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
  const { t } = useTranslation('common');
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
          <span className="flex-1 truncate">{t(item.labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}
