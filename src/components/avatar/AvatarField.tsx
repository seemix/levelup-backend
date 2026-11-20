'use client'
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  useConfig,
  useField,
  useFormFields,
} from '@payloadcms/ui'
import type { UploadFieldClientComponent } from 'payload'
import { useEffect, useRef, useState } from 'react'

import { relationId, type RelationValue } from '@/crm/schedule'

import { BarberAvatar } from '../calendar/BarberAvatar'
import { useCrmT } from '../calendar/useCrmT'
import { CropModal } from './CropModal'

import '../calendar/calendar.scss'
import './avatar.scss'

type MediaDoc = { url?: string | null; sizes?: { thumbnail?: { url?: string | null } } }

/**
 * Barber avatar for the CRM (A48): a square crop of a new upload or of the site photo (`image`),
 * stored as a separate media document. The calendar and the roster fall back to `image` without it.
 */
export const AvatarField: UploadFieldClientComponent = ({ field, path, readOnly }) => {
  const t = useCrmT()
  const { config } = useConfig()
  const api = `${config.serverURL}${config.routes.api}`
  const { label, required, admin } = field
  const { value, setValue, showError } = useField<RelationValue>({ path })
  const photo = useFormFields(([fields]) => fields.image?.value as RelationValue)
  const name = useFormFields(([fields]) => fields.name?.value as string | undefined)

  const avatarId = relationId(value)
  const photoId = relationId(photo)
  const [preview, setPreview] = useState<{ id: string; url: string | null } | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const loadMedia = async (id: string): Promise<MediaDoc> => {
    const res = await fetch(`${api}/media/${id}?depth=0`, { credentials: 'include' })
    if (!res.ok) throw new Error(String(res.status))
    return (await res.json()) as MediaDoc
  }

  // Thumbnail URL of the current avatar; a stale entry (another id) is ignored.
  const shown = avatarId && preview?.id === avatarId ? preview.url : null
  useEffect(() => {
    if (!avatarId) return
    let cancelled = false
    loadMedia(avatarId)
      .then((doc) => {
        if (!cancelled)
          setPreview({ id: avatarId, url: doc.sizes?.thumbnail?.url ?? doc.url ?? null })
      })
      .catch(() => {
        if (!cancelled) setPreview({ id: avatarId, url: null })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId, api])

  const closeCrop = () => {
    if (source?.startsWith('blob:')) URL.revokeObjectURL(source)
    setSource(null)
  }

  const fromPhoto = async () => {
    if (!photoId) return
    setError(false)
    try {
      const doc = await loadMedia(photoId)
      // The original, not a resized copy: the crop keeps full resolution.
      if (!doc.url) throw new Error('NO_URL')
      setSource(doc.url)
    } catch {
      setError(true)
    }
  }

  const fromFile = (file: File | undefined) => {
    if (!file) return
    setError(false)
    setSource(URL.createObjectURL(file))
  }

  const upload = async (blob: Blob) => {
    setBusy(true)
    setError(false)
    try {
      const body = new FormData()
      const base = (name ?? '').trim() || 'barber'
      const slug =
        base
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'barber'
      body.append('file', new File([blob], `avatar-${slug}.jpg`, { type: blob.type }))
      body.append('_payload', JSON.stringify({ alt: base }))
      const res = await fetch(`${api}/media`, { method: 'POST', body, credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const { doc } = (await res.json()) as { doc: { id: string } }
      setValue(doc.id)
      closeCrop()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={['avatar-field', 'field-type', showError && 'error'].filter(Boolean).join(' ')}>
      <FieldLabel label={label} path={path} required={required} />
      <div className="avatar-field__row">
        <BarberAvatar name={name ?? ''} image={shown} className="avatar-field__preview" />
        {!readOnly && (
          <div className="avatar-field__actions">
            <button
              type="button"
              className="calendar__button"
              onClick={() => fileInput.current?.click()}
            >
              {t('barbers.avatarUpload')}
            </button>
            <button
              type="button"
              className="calendar__button"
              disabled={!photoId}
              title={photoId ? undefined : t('barbers.avatarNoPhoto')}
              onClick={fromPhoto}
            >
              {t('barbers.avatarFromPhoto')}
            </button>
            {avatarId && (
              <button
                type="button"
                className="calendar__button calendar__button--danger"
                onClick={() => setValue(null)}
              >
                {t('barbers.avatarRemove')}
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                fromFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        )}
      </div>
      {error && !source && <p className="avatar-field__error">{t('barbers.avatarError')}</p>}
      <FieldError path={path} showError={showError} />
      <FieldDescription description={admin?.description} path={path} />
      {source && (
        <CropModal
          key={source}
          src={source}
          busy={busy}
          uploadFailed={error}
          onCancel={closeCrop}
          onCrop={(blob) => void upload(blob)}
        />
      )}
    </div>
  )
}
