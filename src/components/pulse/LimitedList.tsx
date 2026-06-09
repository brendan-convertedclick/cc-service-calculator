import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface LimitedListProps<T> {
  items: T[]
  /** Number of items shown when collapsed. */
  limit?: number
  /** Classes for the wrapper around the visible items (e.g. flex flex-col gap-2). */
  className?: string
  /** Overrides the toggle's text color, e.g. on non-neutral surfaces like error-container. */
  toggleClassName?: string
  renderItem: (item: T, index: number) => ReactNode
}

/** Renders at most `limit` items with a "+N more" toggle that expands the full list. */
export function LimitedList<T>({ items, limit = 5, className, toggleClassName, renderItem }: LimitedListProps<T>) {
  const [expanded, setExpanded] = useState(false)
  // Re-collapse when the underlying data changes so the cap applies to each new data set.
  useEffect(() => setExpanded(false), [items])
  const visible = expanded ? items : items.slice(0, limit)
  const hiddenCount = items.length - limit

  return (
    <>
      <div className={className}>{visible.map(renderItem)}</div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className={cn('mt-2 text-label-small font-semibold text-m-primary hover:underline', toggleClassName)}
        >
          {expanded ? 'Show less' : `+${hiddenCount} more`}
        </button>
      )}
    </>
  )
}
