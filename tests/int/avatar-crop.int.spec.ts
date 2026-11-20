import { describe, expect, it } from 'vitest'

import {
  AVATAR_SIZE,
  clampOffset,
  clampZoom,
  cropRect,
  imageBox,
  outputSize,
  zoomTo,
} from '@/crm/avatar-crop'

const portrait = { width: 1000, height: 1500 }
const V = 300

describe('avatar crop (A48)', () => {
  it('zoom 1, centered: the largest centered square', () => {
    expect(cropRect(portrait, V, { zoom: 1, offset: { x: 0, y: 0 } })).toEqual({
      x: 0,
      y: 250,
      size: 1000,
    })
  })

  it('offset is clamped so the image covers the viewport', () => {
    // Zoom 1: no horizontal play; vertical play = (1500 * 0.3 - 300) / 2 = 75.
    expect(clampOffset(portrait, V, 1, { x: 50, y: 500 })).toEqual({ x: 0, y: 75 })
    expect(clampOffset(portrait, V, 1, { x: -50, y: -500 })).toEqual({ x: 0, y: -75 })
    // Moving the image down shows its top edge.
    expect(cropRect(portrait, V, { zoom: 1, offset: { x: 0, y: 500 } })).toEqual({
      x: 0,
      y: 0,
      size: 1000,
    })
    expect(cropRect(portrait, V, { zoom: 1, offset: { x: 0, y: -75 } }).y).toBe(500)
  })

  it('zoom 2 picks a square half the size, shifted by the offset', () => {
    // scale = 0.6; dx = -60 viewport px = 100 image px to the right.
    expect(cropRect(portrait, V, { zoom: 2, offset: { x: -60, y: 0 } })).toEqual({
      x: 350,
      y: 500,
      size: 500,
    })
  })

  it('zoom is limited to 1..4 and keeps the center point', () => {
    expect(clampZoom(0.2)).toBe(1)
    expect(clampZoom(10)).toBe(4)
    expect(clampZoom(Number.NaN)).toBe(1)
    const view = zoomTo(portrait, V, { zoom: 2, offset: { x: -60, y: 30 } }, 4)
    expect(view).toEqual({ zoom: 4, offset: { x: -120, y: 60 } })
    // Zooming out re-clamps the offset.
    expect(zoomTo(portrait, V, view, 1)).toEqual({ zoom: 1, offset: { x: 0, y: 15 } })
  })

  it('image box matches the crop rect', () => {
    const view = { zoom: 1.5, offset: { x: 20, y: -40 } }
    const box = imageBox(portrait, V, view)
    const rect = cropRect(portrait, V, view)
    const scale = box.width / portrait.width
    expect(-box.left / scale).toBeCloseTo(rect.x)
    expect(-box.top / scale).toBeCloseTo(rect.y)
    expect(V / scale).toBeCloseTo(rect.size)
  })

  it('output is at most AVATAR_SIZE and never upscaled', () => {
    expect(outputSize({ x: 0, y: 0, size: 1000 })).toBe(AVATAR_SIZE)
    expect(outputSize({ x: 0, y: 0, size: 200.4 })).toBe(200)
  })
})
