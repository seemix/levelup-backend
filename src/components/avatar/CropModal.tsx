'use client'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import {
  clampOffset,
  cropRect,
  imageBox,
  MAX_ZOOM,
  MIN_ZOOM,
  outputSize,
  zoomTo,
  type CropView,
  type Size,
} from '@/crm/avatar-crop'

import { Modal } from '../calendar/Modal'
import { useCrmT } from '../calendar/useCrmT'

const VIEWPORT = 280
const START: CropView = { zoom: 1, offset: { x: 0, y: 0 } }

type Props = {
  /** Image URL: an object URL of a chosen file or the site photo. */
  src: string
  busy: boolean
  /** The upload of the crop failed. */
  uploadFailed?: boolean
  onCancel: () => void
  onCrop: (blob: Blob) => void
}

/** Square crop with a round preview mask: drag to move, slider or wheel to zoom (A48). */
export const CropModal = ({ src, busy, uploadFailed, onCancel, onCrop }: Props) => {
  const t = useCrmT()
  const image = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<CropView>(START)
  const drag = useRef<{ x: number; y: number; start: CropView['offset'] } | null>(null)
  const viewport = useRef<HTMLDivElement>(null)

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const node = viewport.current
    if (!node || !size) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setView((current) =>
        zoomTo(size, VIEWPORT, current, current.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)),
      )
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [size])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!size) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, start: view.offset }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || !size) return
    setView((current) => ({
      ...current,
      offset: clampOffset(size, VIEWPORT, current.zoom, {
        x: start.start.x + event.clientX - start.x,
        y: start.start.y + event.clientY - start.y,
      }),
    }))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const save = () => {
    const node = image.current
    if (!node || !size) return
    const rect = cropRect(size, VIEWPORT, view)
    const side = outputSize(rect)
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const context = canvas.getContext('2d')
    if (!context) return setFailed(true)
    context.imageSmoothingQuality = 'high'
    context.drawImage(node, rect.x, rect.y, rect.size, rect.size, 0, 0, side, side)
    try {
      canvas.toBlob((blob) => (blob ? onCrop(blob) : setFailed(true)), 'image/jpeg', 0.92)
    } catch {
      // A cross-origin image without CORS taints the canvas.
      setFailed(true)
    }
  }

  const box = size ? imageBox(size, VIEWPORT, view) : null

  return (
    <Modal
      title={t('barbers.avatarCropTitle')}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="calendar__button" onClick={onCancel} disabled={busy}>
            {t('barbers.avatarCancel')}
          </button>
          <button
            type="button"
            className="calendar__button calendar__button--primary"
            onClick={save}
            disabled={busy || !size}
          >
            {t('barbers.avatarSave')}
          </button>
        </>
      }
    >
      <div className="avatar-crop">
        <div
          ref={viewport}
          className="avatar-crop__viewport"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={image}
            src={src}
            alt=""
            crossOrigin={src.startsWith('blob:') ? undefined : 'anonymous'}
            draggable={false}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setFailed(true)}
            style={
              box
                ? { left: box.left, top: box.top, width: box.width, height: box.height }
                : { visibility: 'hidden' }
            }
          />
          <div className="avatar-crop__mask" />
        </div>
        <label className="avatar-crop__zoom">
          <span>{t('barbers.avatarZoom')}</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            disabled={!size}
            onChange={(event) =>
              size &&
              setView((current) => zoomTo(size, VIEWPORT, current, Number(event.target.value)))
            }
          />
        </label>
        <p className="avatar-crop__hint">{t('barbers.avatarCropHint')}</p>
        {(failed || uploadFailed) && (
          <p className="avatar-field__error">{t('barbers.avatarError')}</p>
        )}
      </div>
    </Modal>
  )
}
