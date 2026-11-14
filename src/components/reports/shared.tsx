'use client'
import { useEffect, useState, type ReactNode } from 'react'

import { todayLocal } from '@/crm/time'

import { useCrmApi, useErrorText } from '../calendar/api'

/** Default period of the finance reports: from the first day of the current month to today. */
export const currentMonth = (): { from: string; to: string } => {
  const today = todayLocal()
  return { from: `${today.slice(0, 8)}01`, to: today }
}

type Loaded<T> = { key: string; data: T | null; error: string | null } | null

/** GET of a report; keeps the previous data while the next query loads. */
export const useReport = <T,>(path: string | null) => {
  const api = useCrmApi()
  const errorText = useErrorText()
  const [loaded, setLoaded] = useState<Loaded<T>>(null)
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    api<T>(path, { signal: controller.signal })
      .then((data) => setLoaded({ key: path, data, error: null }))
      .catch((caught: unknown) => {
        if ((caught as { name?: string }).name !== 'AbortError')
          setLoaded({ key: path, data: null, error: errorText(caught) })
      })
    return () => controller.abort()
    // `errorText` is recreated on every render; the request depends on the path only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path])
  const current = loaded?.key === path ? loaded : null
  return { current, data: (current ?? loaded)?.data ?? null, busy: !current }
}

export type TableColumn = { label: string; numeric?: boolean }

/** A plain report table; `footer` is the totals row. */
export const ReportTable = ({
  columns,
  rows,
  footer,
}: {
  columns: TableColumn[]
  rows: ReactNode[][]
  footer?: ReactNode[]
}) => (
  <div className="reports__scroll">
    <table className="reports__table">
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th
              key={index}
              scope="col"
              className={column.numeric ? 'reports__table-num' : undefined}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                className={columns[cellIndex]?.numeric ? 'reports__table-num' : undefined}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && (
        <tfoot>
          <tr className="reports__total">
            {footer.map((cell, index) => (
              <td
                key={index}
                className={columns[index]?.numeric ? 'reports__table-num' : undefined}
              >
                {cell}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  </div>
)

export const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="reports__stat">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
)

export const Section = ({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) => (
  <section className="reports__section">
    <h2 className="reports__subtitle">{title}</h2>
    {hint && <p className="reports__hint">{hint}</p>}
    {children}
  </section>
)
