import { useEffect, useState } from 'react';

/**
 * Returns `value` debounced by `delay` ms. Useful for similarity / search
 * input that should not fire on every keystroke (spec §6: 800ms debounce on
 * the PublishModal similarity calls).
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
