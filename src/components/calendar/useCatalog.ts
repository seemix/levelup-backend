'use client'
import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import type { CatalogExtra, CatalogService } from './api'

type Catalog = { services: CatalogService[]; extras: CatalogExtra[] }

type Doc = {
  id: string | number
  name?: string | null
  price?: number | null
  durationMinutes?: number | null
  appliesTo?: (string | number | { id: string | number })[] | null
}

const relationIds = (values: Doc['appliesTo']) =>
  (values ?? []).map((value) => String(typeof value === 'object' ? value.id : value))

/**
 * Active services and extras (standard REST of the catalog collections: every staff role may read
 * them, §3.1) in the admin language. Loaded once per modal session.
 */
export const useCatalog = (language: string) => {
  const { config } = useConfig()
  const [state, setState] = useState<{ key: string; catalog: Catalog | null; failed: boolean }>({
    key: '',
    catalog: null,
    failed: false,
  })
  const api = config.routes.api

  useEffect(() => {
    const controller = new AbortController()
    const query = (select: string[]) => {
      const params = new URLSearchParams({
        locale: language,
        depth: '0',
        limit: '0',
        sort: 'order',
        'where[active][equals]': 'true',
      })
      for (const field of select) params.set(`select[${field}]`, 'true')
      return params.toString()
    }
    const load = async (collection: 'services' | 'extras', select: string[]) => {
      const response = await fetch(`${api}/${collection}?${query(select)}`, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(String(response.status))
      return ((await response.json()) as { docs: Doc[] }).docs
    }
    Promise.all([
      load('services', ['name', 'price', 'durationMinutes']),
      load('extras', ['name', 'price', 'durationMinutes', 'appliesTo']),
    ])
      .then(([services, extras]) =>
        setState({
          key: language,
          failed: false,
          catalog: {
            services: services.map((doc) => ({
              id: String(doc.id),
              name: doc.name ?? '',
              price: doc.price ?? 0,
              durationMinutes: doc.durationMinutes ?? 0,
            })),
            extras: extras.map((doc) => ({
              id: String(doc.id),
              name: doc.name ?? '',
              price: doc.price ?? 0,
              durationMinutes: doc.durationMinutes ?? 0,
              appliesTo: relationIds(doc.appliesTo),
            })),
          },
        }),
      )
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError')
          setState({ key: language, catalog: null, failed: true })
      })
    return () => controller.abort()
  }, [api, language])

  return { catalog: state.key === language ? state.catalog : null, failed: state.failed }
}
