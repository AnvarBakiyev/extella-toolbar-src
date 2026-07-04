import { Check, Loader2, Play, Rocket, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import type { RunPhase } from '../schemas';

/**
 * Shared run-control widgets used by the expert card, the list table, and the
 * "Running now" section so the Run button + status badge look identical
 * everywhere and stay in sync with the run manager.
 */

function isActivePhase(p: RunPhase): boolean {
  return p === 'pending' || p === 'running';
}

interface RunButtonProps {
  phase: RunPhase;
  onRun: () => void;
  onStop: () => void;
}

/**
 * Compact icon button. Idle/terminal → ▶ (run). Pending/running → spinner that
 * stops the run on click. Clicks are stopped from bubbling so the surrounding
 * card/row doesn't also open the drawer.
 */
export function RunButton({ phase, onRun, onStop }: RunButtonProps) {
  const { t } = useTranslation('experts');
  const active = isActivePhase(phase);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (active) onStop();
        else onRun();
      }}
      title={active ? t('drawer.stop', 'Stop') : t('actions.use', 'Use')}
      aria-label={active ? t('drawer.stop', 'Stop') : t('actions.use', 'Use')}
      className={[
        'flex h-[22px] w-[22px] items-center justify-center rounded-[6px] transition-colors',
        active
          ? 'bg-accentSoft text-accent hover:bg-accentSoftStrong'
          : 'text-textMuted hover:bg-bg3 hover:text-text',
      ].join(' ')}
    >
      {phase === 'pending' || phase === 'running' ? (
        <Icon as={active && phase === 'running' ? Square : Loader2} size={11} className={phase === 'pending' ? 'animate-spin' : undefined} />
      ) : (
        <Icon as={Play} size={11} />
      )}
    </button>
  );
}

interface RunButtonWideProps {
  phase: RunPhase;
  status?: string | null;
  onRun: () => void;
  onStop: () => void;
}

/**
 * Wide, labelled run button sized to sit in the type-badge slot of a card.
 * Idle/terminal → click runs (re-runs); pending/running → click stops. The
 * label/colour double as the status indicator so it replaces the type tag.
 */
export function RunButtonWide({ phase, status, onRun, onStop }: RunButtonWideProps) {
  const { t } = useTranslation('experts');
  const active = isActivePhase(phase);

  const cfg = {
    idle: { icon: Play, label: t('actions.run', 'Run'), tone: 'bg-accentSoft text-accent hover:bg-accentSoftStrong', spin: false },
    pending: { icon: Loader2, label: t('run.statusBadge.pending', 'Pending'), tone: 'bg-bg3 text-textMuted', spin: true },
    running: { icon: Loader2, label: t('run.statusBadge.running', 'Running'), tone: 'bg-accentSoft text-accent', spin: true },
    launched: { icon: Rocket, label: t('run.statusBadge.launched', 'Launched'), tone: 'bg-bg3 text-textMuted', spin: false },
    success: { icon: Check, label: t('run.statusBadge.success', 'Done'), tone: 'bg-successSoft text-success', spin: false },
    error: { icon: X, label: t('run.statusBadge.error', 'Error'), tone: 'bg-dangerSoft text-danger', spin: false },
  }[phase];

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (active) onStop();
        else onRun();
      }}
      title={active ? t('drawer.stop', 'Stop') : status ?? t('actions.run', 'Run')}
      aria-label={active ? t('drawer.stop', 'Stop') : t('actions.run', 'Run')}
      className={[
        'flex h-6 w-full items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
        cfg.tone,
      ].join(' ')}
    >
      <Icon as={cfg.icon} size={12} className={cfg.spin ? 'animate-spin' : undefined} />
      {cfg.label}
    </button>
  );
}

interface RunStatusBadgeProps {
  phase: RunPhase;
  /** Raw upstream status, used as a tooltip for extra detail. */
  status?: string | null;
}

/** A small pill describing the run phase. Renders nothing when idle. */
export function RunStatusBadge({ phase, status }: RunStatusBadgeProps) {
  const { t } = useTranslation('experts');
  if (phase === 'idle') return null;

  const label = {
    pending: t('run.statusBadge.pending', 'Pending'),
    running: t('run.statusBadge.running', 'Running'),
    launched: t('run.statusBadge.launched', 'Launched'),
    success: t('run.statusBadge.success', 'Done'),
    error: t('run.statusBadge.error', 'Error'),
  }[phase];

  const tone = {
    pending: 'bg-bg3 text-textMuted',
    running: 'bg-accentSoft text-accent',
    launched: 'bg-bg3 text-textMuted',
    success: 'bg-successSoft text-success',
    error: 'bg-dangerSoft text-danger',
  }[phase];

  return (
    <span
      className={['inline-flex h-5 items-center gap-1 rounded-pill px-1.5 text-xs font-medium', tone].join(' ')}
      title={status ?? undefined}
    >
      {phase === 'pending' || phase === 'running' ? (
        <Icon as={Loader2} size={10} className="animate-spin" />
      ) : null}
      {label}
    </span>
  );
}
