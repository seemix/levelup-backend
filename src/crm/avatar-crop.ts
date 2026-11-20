/**
 * Square avatar crop (A48): the image is moved and zoomed under a fixed square viewport.
 *
 * Zoom 1 = the image just covers the viewport (shorter side = viewport side). The offset is the shift
 * of the image center from the viewport center, in viewport pixels; it is clamped so the image always
 * covers the whole viewport. Pure math, no DOM.
 */

export const AVATAR_SIZE = 512
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export type Size = { width: number; height: number }
export type Offset = { x: number; y: number }
export type CropView = { zoom: number; offset: Offset }
export type CropRect = { x: number; y: number; size: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const clampZoom = (zoom: number) =>
  Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : MIN_ZOOM

/** Viewport pixels per image pixel. */
export const displayScale = (image: Size, viewport: number, zoom: number) =>
  (viewport / Math.min(image.width, image.height)) * clampZoom(zoom)

/** Offset limited so the image still covers the viewport. */
export const clampOffset = (
  image: Size,
  viewport: number,
  zoom: number,
  offset: Offset,
): Offset => {
  const scale = displayScale(image, viewport, zoom)
  const maxX = Math.max(0, (image.width * scale - viewport) / 2)
  const maxY = Math.max(0, (image.height * scale - viewport) / 2)
  // `+ 0` turns -0 into 0.
  return { x: clamp(offset.x, -maxX, maxX) + 0, y: clamp(offset.y, -maxY, maxY) + 0 }
}

/** Zoom keeping the image point under the viewport center fixed, then re-clamp the offset. */
export const zoomTo = (image: Size, viewport: number, view: CropView, zoom: number): CropView => {
  const next = clampZoom(zoom)
  const ratio = next / clampZoom(view.zoom)
  return {
    zoom: next,
    offset: clampOffset(image, viewport, next, {
      x: view.offset.x * ratio,
      y: view.offset.y * ratio,
    }),
  }
}

/** Square region of the source image (image pixels) visible in the viewport. */
export const cropRect = (image: Size, viewport: number, view: CropView): CropRect => {
  const scale = displayScale(image, viewport, view.zoom)
  const offset = clampOffset(image, viewport, view.zoom, view.offset)
  const size = Math.min(viewport / scale, image.width, image.height)
  const left = (viewport - image.width * scale) / 2 + offset.x
  const top = (viewport - image.height * scale) / 2 + offset.y
  return {
    x: clamp(-left / scale, 0, image.width - size),
    y: clamp(-top / scale, 0, image.height - size),
    size,
  }
}

/** CSS placement of the image inside the viewport (top-left corner and displayed size). */
export const imageBox = (image: Size, viewport: number, view: CropView) => {
  const scale = displayScale(image, viewport, view.zoom)
  const offset = clampOffset(image, viewport, view.zoom, view.offset)
  const width = image.width * scale
  const height = image.height * scale
  return {
    left: (viewport - width) / 2 + offset.x,
    top: (viewport - height) / 2 + offset.y,
    width,
    height,
  }
}

/** Output side: the crop is never upscaled beyond the source pixels. */
export const outputSize = (rect: CropRect) =>
  Math.max(1, Math.min(AVATAR_SIZE, Math.round(rect.size)))
