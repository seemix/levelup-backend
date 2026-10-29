import { APIError, CollectionBeforeChangeHook } from 'payload'
import { getPlaiceholder } from 'plaiceholder'

export const generateBlurHash: CollectionBeforeChangeHook = async ({ data, req }) => {
    const file = req.file
    if (!file?.data || !file.mimetype?.startsWith('image/')) return data

    try {
        const { base64 } = await getPlaiceholder(file.data, { size: 16 })
        return { ...data, blurHash: base64 }
    } catch (error) {
        req.payload.logger.error({ err: error, msg: 'Failed to generate blurHash' })
        throw new APIError('Error while creating blur hash', 400, undefined, true)
    }
}
