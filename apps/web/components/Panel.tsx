import type { ReactNode } from 'react'

/** A rack module. Every control group on the page is one of these, which is
 *  what makes the layout read as a stack of hardware rather than a form. */
export function Panel({
  legend,
  right,
  children,
  className = '',
}: {
  legend: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rack p-4 ${className}`}>
      <header className="flex items-center justify-between gap-3 mb-3">
        <h2 className="legend">{legend}</h2>
        {right}
      </header>
      {children}
    </section>
  )
}
