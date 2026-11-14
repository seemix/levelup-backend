'use client'
import { emptyRow, type CashRow } from '@/crm/payment-form'

import { useCrmT } from '../calendar/useCrmT'

import type { Register } from './types'

type Props = {
  /** Section title (the legend). */
  label: string
  rows: readonly CashRow[]
  registers: readonly Register[]
  onChange: (rows: CashRow[]) => void
  disabled?: boolean
}

/** "Register + amount" rows (payment split between registers, certificate sale). */
export const CashRows = ({ label, rows, registers, onChange, disabled }: Props) => {
  const t = useCrmT()
  const update = (index: number, patch: Partial<CashRow>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  const free = registers.find((register) => !rows.some((row) => row.cashRegister === register.id))

  return (
    <fieldset className="calendar-modal__field finance__rows">
      <legend>{label}</legend>
      {rows.map((row, index) => (
        <div className="finance__row" key={index}>
          <select
            aria-label={t('finance.form.register')}
            value={row.cashRegister}
            disabled={disabled}
            onChange={(event) => update(index, { cashRegister: event.target.value })}
          >
            <option value="">{t('finance.form.pickRegister')}</option>
            {registers.map((register) => (
              <option key={register.id} value={register.id}>
                {register.name} · {t(`finance.registerTypes.${register.type}`)}
              </option>
            ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={t('finance.form.amount')}
            placeholder="0.00"
            value={row.amount}
            disabled={disabled}
            onChange={(event) => update(index, { amount: event.target.value })}
          />
          {rows.length > 1 && (
            <button
              type="button"
              className="calendar__icon-button"
              aria-label={t('finance.form.removeRow')}
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, at) => at !== index))}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {free && (
        <button
          type="button"
          className="calendar__button finance__add"
          disabled={disabled}
          onClick={() => onChange([...rows, emptyRow(free.id)])}
        >
          + {t('finance.form.addRow')}
        </button>
      )}
    </fieldset>
  )
}
