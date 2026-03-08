'use client'

import React from 'react'
import { useLocale, useConfig } from '@payloadcms/ui'
import { useRouter, usePathname, useSearchParams } from 'next/navigation' // Використовуємо стандарт Next.js

export const LocaleSwitcher: React.FC = () => {
    const locale = useLocale()
    const { config } = useConfig()

    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    const locales = config.localization ? config.localization.locales : []

    const handleChange = (newLocaleCode: string) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('locale', newLocaleCode) // Payload адмінка реагує на параметр ?locale=

        router.push(`${pathname}?${params.toString()}`)
    }

    return (
        <div style={{ display: 'flex', gap: '15px', padding: '0 15px', justifyContent: 'center', width: '100%', position: 'relative' }}>
            {locales.map((loc) => {
                const code = typeof loc === 'string' ? loc : loc.code
                const label = typeof loc === 'string' ? String(loc).toUpperCase() : loc.label
                // Додаємо перевірку на undefined, щоб уникнути помилки "reading code"
                const isSelected = locale?.code === code

                return (
                    <label key={code} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                        <input
                            type="radio"
                            checked={!!isSelected}
                            onChange={() => handleChange(code)}
                        />
                        <span style={{ fontWeight: isSelected ? 'bold' : 'normal' }}>{label}</span>
                    </label>
                )
            })}
        </div>
    )
}

export default LocaleSwitcher