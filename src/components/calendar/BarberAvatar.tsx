'use client'
import { useState } from 'react'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

type Props = {
  name: string
  /** Thumbnail URL of the barber photo; `null` → initials. */
  image: string | null
  className?: string
}

/** Round barber avatar: the photo, or the initials when there is none or it fails to load. */
export const BarberAvatar = ({ name, image, className = 'calendar-head__avatar' }: Props) => {
  const [failed, setFailed] = useState<string | null>(null)
  if (image && failed !== image)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={className} src={image} alt="" onError={() => setFailed(image)} />
    )
  return (
    <span className={`${className} ${className}--empty`} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
