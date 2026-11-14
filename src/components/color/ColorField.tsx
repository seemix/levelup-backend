'use client'
import { FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'

import { BARBER_COLORS, isHexColor } from '@/crm/colors'

const FALLBACK = '#3B82F6'

/**
 * Color field: native color picker, quick swatches from the barber palette and the hex code input.
 * The stored value is the same `#RRGGBB` text as before.
 */
export const ColorField: TextFieldClientComponent = ({ field, path, readOnly }) => {
  const { label, required, admin } = field
  const { value, setValue, showError } = useField<string>({ path })
  const current = isHexColor(value) ? value : null

  return (
    <div
      className={['field-type', 'text', showError && 'error'].filter(Boolean).join(' ')}
      style={{ marginBottom: 'var(--base)' }}
    >
      <FieldLabel label={label} path={path} required={required} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          type="color"
          value={(current ?? FALLBACK).toLowerCase()}
          disabled={readOnly}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          style={{
            width: 44,
            height: 44,
            padding: 2,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        />
        <input
          type="text"
          id={`field-${path.replace(/\./g, '__')}`}
          value={value ?? ''}
          disabled={readOnly}
          placeholder={admin?.placeholder as string | undefined}
          onChange={(e) => setValue(e.target.value)}
          style={{ maxWidth: '9rem' }}
        />
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {BARBER_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              title={color}
              onClick={() => setValue(color)}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                borderRadius: '50%',
                background: color,
                cursor: 'pointer',
                border:
                  current?.toUpperCase() === color
                    ? '2px solid var(--theme-text)'
                    : '2px solid transparent',
                outline: '1px solid var(--theme-elevation-150)',
              }}
            />
          ))}
        </div>
      )}
      <FieldError path={path} showError={showError} />
      <FieldDescription description={admin?.description} path={path} />
    </div>
  )
}
