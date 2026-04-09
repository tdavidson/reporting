'use client'

import { X, CheckCircle2, XCircle, MinusCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import type { ScrapeReport } from '@/lib/vc-market/scrapers'

interface Props {
  report: ScrapeReport
  pending: number
  skipped: number
  onClose: () => void
}

/** Safe stringify — never returns [object Object] */
function str(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.message
  try { return JSON.stringify(v) } catch { return String(v) }
}

export function ScrapeReportModal({ report, pending, skipped, onClose }: Props) {
  const hasErrors = report.sources.some(s => s.status === 'error')
  const aiError   = str(report.aiError)
  const [showSources, setShowSources] = useState(false)
  const dealRows = report.dealRows ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-base font-semibold">Scrape Report</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {report.uniqueArticles} articles analysed
              {' · '}{report.dealsExtracted} extracted by AI
              {' · '}{report.dealsAfterFilter} passed filter
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-muted/20 shrink-0 flex-wrap">
          <Stat label="New deals"        value={pending} color="emerald" />
          <Stat label="Duplicates skipped" value={skipped} color="amber" />
          <Stat label="Sources OK"       value={report.sources.filter(s => s.status === 'ok').length}    color="blue" />
          <Stat label="Sources failed"   value={report.sources.filter(s => s.status === 'error').length} color="rose" />
        </div>

        {/* AI error banner */}
        {aiError && (
          <div className="flex items-start gap-2 mx-6 mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs shrink-0">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">AI extraction error: </span>
              {aiError}
            </div>
          </div>
        )}

        {/* No deals found explanation */}
        {pending === 0 && !aiError && (
          <div className="flex items-start gap-2 mx-6 mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs shrink-0">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {report.dealsExtracted === 0
                ? 'AI encontrou 0 deals LATAM nos artigos de hoje. Ou não houve publicações hoje, ou todos os artigos foram filtrados (data antiga, empresa não-LATAM, ou baixa confiança).'
                : `${report.dealsExtracted} deal(s) extraídos pela AI, mas todos filtrados — veja a tabela abaixo.`
              }
            </span>
          </div>
        )}

        <div className="overflow-auto flex-1 px-6 py-4 space-y-5">

          {/* ── Deals reviewed table ── */}
          {dealRows.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Deals analisados ({dealRows.length})
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="pb-2 text-left font-medium w-5" />
                    <th className="pb-2 text-left font-medium">Company</th>
                    <th className="pb-2 text-left font-medium pl-2">Stage</th>
                    <th className="pb-2 text-left font-medium pl-2">Country</th>
                    <th className="pb-2 text-left font-medium pl-2">Confidence</th>
                    <th className="pb-2 text-left font-medium pl-2">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {dealRows.map((row, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-1.5 pr-1">
                        {row.outcome === 'approved'
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          : <XCircle className="h-3.5 w-3.5 text-rose-400" />}
                      </td>
                      <td className="py-1.5 font-medium text-foreground">{row.company}</td>
                      <td className="py-1.5 pl-2 text-muted-foreground">{row.stage ?? '—'}</td>
                      <td className="py-1.5 pl-2 text-muted-foreground">{row.country ?? '—'}</td>
                      <td className="py-1.5 pl-2">
                        <ConfidenceBadge value={row.confidence} />
                      </td>
                      <td className="py-1.5 pl-2 text-muted-foreground">
                        {row.outcome === 'approved'
                          ? <span className="text-emerald-600 font-medium">✓ approved</span>
                          : <span className="text-rose-500">{row.reason ?? 'filtered'}</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Sources (collapsible) ── */}
          <div>
            <button
              onClick={() => setShowSources(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 hover:text-foreground transition-colors"
            >
              {showSources ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Sources ({report.sources.length})
            </button>

            {showSources && (
              <>
                {hasErrors && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Sources com erro ainda foram parcialmente scraped quando possível.
                  </p>
                )}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="pb-2 text-left font-medium w-6" />
                      <th className="pb-2 text-left font-medium">Source</th>
                      <th className="pb-2 text-right font-medium">Articles</th>
                      <th className="pb-2 text-left font-medium pl-4">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sources.map(s => (
                      <tr key={s.name} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-2">
                          {s.status === 'ok'    && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                          {s.status === 'error' && <XCircle      className="h-3.5 w-3.5 text-rose-500" />}
                          {s.status === 'empty' && <MinusCircle  className="h-3.5 w-3.5 text-amber-400" />}
                        </td>
                        <td className="py-2 font-medium text-foreground">{s.name}</td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{s.articlesFound}</td>
                        <td className="py-2 pl-4 text-muted-foreground">
                          {s.error
                            ? <span className="text-rose-500">{str(s.error)}</span>
                            : s.status === 'empty'
                            ? <span className="text-amber-500">No articles found</span>
                            : <span className="text-emerald-600">OK</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border text-sm hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-700',
    amber:   'bg-amber-500/10 text-amber-700',
    blue:    'bg-blue-500/10 text-blue-700',
    rose:    'bg-rose-500/10 text-rose-700',
  }
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors[color]}`}>
      <span className="text-base font-bold leading-none">{value}</span>
      <span>{label}</span>
    </div>
  )
}

function ConfidenceBadge({ value }: { value: 'high' | 'medium' | 'low' }) {
  const map = {
    high:   'text-emerald-600 bg-emerald-500/10',
    medium: 'text-amber-600 bg-amber-500/10',
    low:    'text-rose-500 bg-rose-500/10',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${map[value]}`}>
      {value}
    </span>
  )
}
