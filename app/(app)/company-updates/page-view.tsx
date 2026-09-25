'use client'

import { UpdatesSearch } from './updates-search'
import type { CompanyUpdatesPageData } from './load'

export function CompanyUpdatesPageView({ companies }: CompanyUpdatesPageData) {
  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 max-w-page">
        <h1 className="text-2xl font-semibold tracking-tight">Company updates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search what portfolio companies have reported — the message, its attachments, and where each passage came from.
        </p>
      </div>
      <UpdatesSearch companies={companies} />
    </div>
  )
}
