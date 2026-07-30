import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Icon } from '@/lib/icon';
import { cn } from '@/lib/cn';

/**
 * Tiny in-progress indicator for search inputs.
 *
 * Renders a spinning loader (matching the Search-icon size/colour) only while
 * `busy` is true, so the user gets immediate feedback that a query is in
 * flight — covering both the debounce window and the network round-trip.
 * Returns nothing when idle so it adds no layout when not searching.
 *
 * Place it inside the search container:
 *   - flex toolbars (Concepts/Rules/Tokens/KV): drop it after the <input>;
 *     the flex-1 input pushes it to the right edge.
 *   - relative containers (Devices/Agents/Experts): pass
 *     `className="absolute right-2.5"` to pin it over the input's right side.
 */
export function SearchSpinner({
  busy,
  className,
}: {
  busy: boolean;
  className?: string;
}) {
  const { t: tCommon } = useTranslation('common');
  if (!busy) return null;
  return (
    <Icon
      as={Loader2}
      size={14}
      className={cn('animate-spin', className)}
      style={{ color: 'var(--ap-text-faint)' }}
      role="status"
      aria-label={tCommon('states.searching')}
    />
  );
}
