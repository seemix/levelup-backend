import type { PayloadRequest } from 'payload'

import { relationId, type RelationValue } from '@/crm/schedule'

import { SYSTEM_READ } from '../booking/context'

type MediaRow = { id: string; url?: string | null; sizes?: { thumbnail?: { url?: string | null } } }

type AvatarSource = { avatar?: RelationValue; image?: RelationValue }

/** Media id shown as the barber avatar in the CRM: the cropped avatar, else the site photo (A48). */
export const avatarMediaId = (barber: AvatarSource): string | null =>
  relationId(barber.avatar) ?? relationId(barber.image) ?? null

/** Thumbnail URL of each barber avatar by media id, in one query. */
export const loadAvatarUrls = async (
  req: PayloadRequest,
  barbers: AvatarSource[],
): Promise<(barber: AvatarSource) => string | null> => {
  const ids = [...new Set(barbers.map(avatarMediaId).filter((id): id is string => !!id))]
  const media =
    ids.length === 0
      ? []
      : ((
          await req.payload.find({
            collection: 'media',
            ...SYSTEM_READ,
            req,
            where: { id: { in: ids } },
            // Payload builds `url` from `filename`: without it both URLs come back as null.
            select: {
              filename: true,
              url: true,
              sizes: { thumbnail: { filename: true, url: true } },
            },
          })
        ).docs as unknown as MediaRow[])
  return (barber) => {
    const id = avatarMediaId(barber)
    const doc = id ? media.find((item) => String(item.id) === id) : undefined
    return doc ? (doc.sizes?.thumbnail?.url ?? doc.url ?? null) : null
  }
}
