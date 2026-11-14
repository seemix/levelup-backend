'use client'

type Props = {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  disabled?: boolean
  autoFocus?: boolean
}

/** Lei input (text → `parseLeiInput` → bani): a decimal keypad on a phone, comma or dot accepted. */
export const AmountInput = ({
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
  autoFocus,
}: Props) => (
  <label className="calendar-modal__field">
    <span>{label}</span>
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder ?? '0.00'}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
    {hint && <span className="finance__hint">{hint}</span>}
  </label>
)
