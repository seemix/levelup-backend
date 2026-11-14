'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Props = {
  /** Full href (admin route already applied). */
  href: string
  /** Extra paths that also mark the link as active (e.g. `/calendar` for the home calendar). */
  alsoActive?: string[]
  /** Element id: `nav-crm-<name>`, used by `nav-icons.scss` to pick the icon. */
  id: string
  label: string
}

/** CRM sidebar link styled like Payload's own `.nav__link` (icon, active indicator). */
export const CrmNavLink = ({ href, alsoActive = [], id, label }: Props) => {
  const pathname = usePathname()
  const active = pathname === href || alsoActive.includes(pathname)
  const content = (
    <>
      {active && <div className="nav__link-indicator" />}
      <span className="nav__link-label">{label}</span>
    </>
  )
  if (pathname === href)
    return (
      <div className="nav__link crm-nav-link" id={id}>
        {content}
      </div>
    )
  return (
    <Link className="nav__link crm-nav-link" href={href} id={id} prefetch={false}>
      {content}
    </Link>
  )
}

/** Admin route prefix without the trailing slash (`''` when the admin lives at `/`). */
export const adminPrefix = (adminRoute: string): string => (adminRoute === '/' ? '' : adminRoute)
