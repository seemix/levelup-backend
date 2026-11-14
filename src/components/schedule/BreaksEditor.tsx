'use client'
import { useCrmT } from '../calendar/useCrmT'
import type { BreakRow } from './shared'

type Props = {
  breaks: BreakRow[]
  onChange: (breaks: BreakRow[]) => void
  /** Default hours of a new break. */
  suggest: BreakRow
}

/** List of breaks (start–end) with add/remove; validation is done by the parent form. */
export const BreaksEditor = ({ breaks, onChange, suggest }: Props) => {
  const t = useCrmT()
  const set = (index: number, patch: Partial<BreakRow>) =>
    onChange(breaks.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  return (
    <div className="schedule-breaks">
      {breaks.map((item, index) => (
        <div className="schedule-breaks__row" key={index}>
          <input
            type="time"
            aria-label={`${t('roster.day.breaks')} · ${t('roster.day.start')}`}
            value={item.start}
            onChange={(event) => set(index, { start: event.target.value })}
          />
          <span>–</span>
          <input
            type="time"
            aria-label={`${t('roster.day.breaks')} · ${t('roster.day.end')}`}
            value={item.end}
            onChange={(event) => set(index, { end: event.target.value })}
          />
          <button
            type="button"
            className="calendar__icon-button schedule-breaks__remove"
            aria-label={t('roster.day.removeBreak')}
            title={t('roster.day.removeBreak')}
            onClick={() => onChange(breaks.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="schedule-link"
        onClick={() => onChange([...breaks, { ...suggest }])}
      >
        + {t('roster.day.addBreak')}
      </button>
    </div>
  )
}
