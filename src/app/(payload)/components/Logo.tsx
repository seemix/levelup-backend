import React from 'react'
import Image from 'next/image'

import logo from './favicon.webp'

export default function CustomLogo() {
  return (
    <div className="logo">
      <Image src={logo.src} alt="LevelUp" width={200} height={200} />
    </div>
  )
}
