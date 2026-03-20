import { APIError, CollectionBeforeValidateHook } from 'payload'
import { getPlaiceholder } from 'plaiceholder'

export const generateBlurHash: CollectionBeforeValidateHook = async ({ data, operation, req }) => {
    if (operation === 'create' || operation === 'update') {
        try {
            const buffer = req?.file?.data
            if (buffer) {
                const { base64 } = await getPlaiceholder(buffer, { size: 16 })
                return {
                    ...data,
                    blurHash: base64,
                }
            }
        } catch (e) {
            throw new APIError('Error while creating blur hash')
        }
    }
}