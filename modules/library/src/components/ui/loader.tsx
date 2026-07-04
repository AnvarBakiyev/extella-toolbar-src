import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface LoaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Ring diameter in px. Default 30. */
  size?: number;
  /** Optional caption rendered beneath the ring (already localized). */
  label?: string;
}

/**
 * Centered ring spinner — the standard "waiting on the backend" indicator for
 * full sections (replaces the faint skeleton placeholders on the main list
 * pages). A thin accent-tinted track carries a solid accent arc that spins,
 * with an optional muted caption underneath.
 *
 * Colors resolve from the `--ap-*` design tokens (`accentSoftStrong` track,
 * `accent` arc), so it tracks light/dark themes with no extra wiring. The
 * container grows to fill its parent and centers the spinner, so a page only
 * has to drop `<Loader label={…} />` into its content area.
 */
export function Loader({ size = 30, label, className, ...props }: LoaderProps) {
  const borderWidth = Math.max(2, Math.round(size / 11));
  return (
    <div
      className={cn(
        'flex min-h-[280px] flex-1 flex-col items-center justify-center gap-3 animate-fade-in',
        className,
      )}
      role="status"
      aria-live="polite"
      {...props}
    >
      <span
        className="inline-block animate-spin rounded-full border-solid border-accentSoftStrong border-t-accent"
        style={{ width: size, height: size, borderWidth }}
        aria-hidden="true"
      />
      {label ? <span className="text-sm text-textMuted">{label}</span> : null}
    </div>
  );
}
