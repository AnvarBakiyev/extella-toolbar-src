/**
 * Pagination — shared rows-per-page + prev/next control.
 *
 * Extracted from the inline pagination used on the list pages so it can be
 * reused anywhere a paginated list is shown (list pages, the scoped entity
 * panels on the Agent / Team detail pages, …). English-only build, so labels
 * default to English but stay overridable via props.
 */

import { Button } from '@/components/ui/button';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** True when the backend/normalizer reports more rows beyond this page. */
  hasMore?: boolean;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  labels?: {
    rows?: string;
    prev?: string;
    next?: string;
    of?: string;
  };
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function Pagination({
  page,
  pageSize,
  total,
  hasMore = false,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
  labels,
}: PaginationProps) {
  const rowsLabel = labels?.rows ?? 'Rows:';
  const prevLabel = labels?.prev ?? 'Previous';
  const nextLabel = labels?.next ?? 'Next';
  const ofLabel = labels?.of ?? 'of';

  const from = total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between border-t border-divider px-7 py-4">
      <div className="flex items-center gap-2 text-sm text-textMuted">
        <span>{rowsLabel}</span>
        {pageSizeOptions.map((size) => (
          <button
            key={size}
            className="rounded-sm px-2 py-0.5 text-sm transition-colors"
            style={{
              background: pageSize === size ? 'var(--ap-bg-3)' : 'transparent',
              fontWeight: pageSize === size ? 600 : 400,
              color: pageSize === size ? 'var(--ap-text)' : 'var(--ap-text-muted)',
            }}
            onClick={() => onPageSizeChange(size)}
          >
            {size}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-textMuted tabular-nums">
          {from}–{to} {ofLabel} {total}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {prevLabel}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasMore && page * pageSize >= total}
          onClick={() => onPageChange(page + 1)}
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
