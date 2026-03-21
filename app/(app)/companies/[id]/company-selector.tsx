'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

interface Company {
  id: string
  name: string
}

interface Props {
  currentId: string
  currentName: string
}

export function CompanySelector({ currentId, currentName }: Props) {
  const [open, setOpen] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [search, setSearch] = useState('')
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/companies')
      .then(r => r.json())
      .then(data => {
        const list = data.companies ?? data ?? []
        setCompanies(list.sort((a: Company, b: Company) => a.name.localeCompare(b.name)))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight hover:text-muted-foreground transition-colors"
      >
        {currentName}
        <ChevronDown className="h-5 w-5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 bg-background border rounded-md shadow-lg z-50 w-64">
          <div className="p-2 border-b">
            <input
              autoFocus
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-sm px-2 py-1 rounded border bg-transparent focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground px-3 py-2">No companies found</p>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    setOpen(false)
                    setSearch('')
                    router.push(`/companies/${c.id}`)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors ${
                    c.id === currentId ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {c.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
