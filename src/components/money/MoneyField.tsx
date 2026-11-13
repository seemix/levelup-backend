'use client'
import { FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { NumberFieldClientComponent } from 'payload'
import { useEffect, useRef, useState } from 'react'
import { baniToLeiText, CURRENCY, isBani, parseLeiInput } from '@/crm/money'

const toText = (value: unknown): string => (isBani(value) ? baniToLeiText(value) : '')

/**
 * Edit field for money: the user types lei (MDL), the form value (and the database) holds bani.
 * Invalid text leaves the stored value untouched and is reset to it on blur.
 */
export const MoneyField: NumberFieldClientComponent = ({ field, path, readOnly }) => {
  const { label, required, admin } = field
  const { value, setValue, showError } = useField<number | null>({ path })
  const [text, setText] = useState(() => toText(value))
  const [invalid, setInvalid] = useState(false)
  const lastEmitted = useRef<number | null | undefined>(value)

  // Sync with external changes (form reset, loaded document, locale switch).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      setText(toText(value))
      setInvalid(false)
    }
  }, [value])

  const onChange = (next: string) => {
    setText(next)
    if (next.trim() === '') {
      setInvalid(false)
      lastEmitted.current = null
      setValue(null)
      return
    }
    const bani = parseLeiInput(next)
    setInvalid(bani === null)
    if (bani !== null) {
      lastEmitted.current = bani
      setValue(bani)
    }
  }

  const onBlur = () => {
    setText(toText(lastEmitted.current ?? value))
    setInvalid(false)
  }

  const className = ['field-type', 'number', (showError || invalid) && 'error']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} style={{ marginBottom: 'var(--base)' }}>
      <FieldLabel label={label} path={path} required={required} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="text"
          inputMode="decimal"
          id={`field-${path.replace(/\./g, '__')}`}
          value={text}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          style={{ maxWidth: '12rem' }}
        />
        <span>{CURRENCY}</span>
      </div>
      <FieldError path={path} showError={showError} />
      <FieldDescription description={admin?.description} path={path} />
    </div>
  )
}
