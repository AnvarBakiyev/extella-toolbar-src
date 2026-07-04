/**
 * MemberStack — overlapping avatars of a team's member agents, with the master
 * outlined in the accent color and a "+N" overflow chip.
 */

import { agentInitials } from '../lib/teamColor';

export interface MemberStackMember {
  id: string;
  name: string;
  isMaster: boolean;
}

export interface MemberStackProps {
  members: MemberStackMember[];
  max?: number;
}

export function MemberStack({ members, max = 5 }: MemberStackProps) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;

  return (
    <div className="flex items-center" style={{ gap: 0 }}>
      {shown.map((m, i) => (
        <div
          key={m.id}
          title={m.isMaster ? `${m.name} (Master)` : m.name}
          style={{
            marginLeft: i === 0 ? 0 : -7,
            width: 24,
            height: 24,
            borderRadius: 7,
            background: 'oklch(0.58 0.12 240)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 700,
            boxShadow: '0 0 0 2px var(--ap-bg-card)',
            zIndex: shown.length - i,
            position: 'relative',
            outline: m.isMaster ? '2px solid var(--ap-accent)' : 'none',
            outlineOffset: 0,
          }}
        >
          {agentInitials(m.name)}
        </div>
      ))}
      {extra > 0 ? (
        <div
          style={{
            marginLeft: -7,
            width: 24,
            height: 24,
            borderRadius: 7,
            background: 'var(--ap-bg-3)',
            color: 'var(--ap-text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 600,
            boxShadow: '0 0 0 2px var(--ap-bg-card)',
            position: 'relative',
            zIndex: 0,
          }}
        >
          +{extra}
        </div>
      ) : null}
    </div>
  );
}
