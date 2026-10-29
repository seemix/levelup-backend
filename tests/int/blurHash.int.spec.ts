import { APIError, type PayloadRequest } from 'payload'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { generateBlurHash } from '@/hooks/generateBlurHash'

const run = (file: unknown) =>
  generateBlurHash({
    data: { alt: 'x' },
    req: { file, payload: { logger: { error: () => {} } } } as unknown as PayloadRequest,
  } as unknown as Parameters<typeof generateBlurHash>[0])

describe('generateBlurHash', () => {
  it('adds a blurHash for images', async () => {
    const data = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#c00' },
    })
      .png()
      .toBuffer()
    const result = await run({ data, mimetype: 'image/png' })
    expect(result).toMatchObject({ alt: 'x', blurHash: expect.stringMatching(/^data:image/) })
  })

  it('returns data untouched without a file or for non-images', async () => {
    expect(await run(undefined)).toEqual({ alt: 'x' })
    expect(await run({ data: Buffer.from('a'), mimetype: 'application/pdf' })).toEqual({ alt: 'x' })
  })

  it('throws APIError for broken images', async () => {
    await expect(run({ data: Buffer.from('nope'), mimetype: 'image/png' })).rejects.toBeInstanceOf(APIError)
  })
})
