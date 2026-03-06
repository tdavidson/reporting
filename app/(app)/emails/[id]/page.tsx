import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { InboundEmail } from '@/lib/types/database'

export const metadata: Metadata = { title: 'Email' }
import { ChevronLeft } from 'lucide-react'
import { ReprocessButton } from './reprocess-button'
import { ApproveButton } from './approve-button'
import { UploadDocumentButton } from './upload-document-button'
import { SaveToDriveButton } from './save-to-drive-button'
import { CollapsibleJson } from './collapsible-json'
import { ReviewItems } from './review-items'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MetricRow = {
  id: string
  period_label: string
  value_number: number | null
  value_text: string | null
  confidence: string
  metric_id: string
}

type MetricDef = {
  id: string
  name: string
  unit: string | null
  unit_position: string
}

type ReviewRow = {
  id: string
  issue_type: string
  resolution: string | null
  resolved_at: string | null
  extracted_value: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  processing: { label: 'Processing', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  success: { label: 'Success', className: 'bg-green-100 text-green-800 border-green-200' },
  not_processed: { label: 'Not processed', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 border-red-200' },
  needs_review: {
    label: 'Review',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatValue(mv: MetricRow, metric: MetricDef | null): string {
  const v = mv.value_number !== null ? String(mv.value_number) : (mv.value_text ?? '—')
  if (!metric?.unit) return v
  return metric.unit_position === 'prefix' ? `${metric.unit}${v}` : `${v} ${metric.unit}`
}

// ---------------------------------------------------------------------------
// Page (server component)
// ---------------------------------------------------------------------------

export default async function EmailDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  // Fetch email row (no join — avoids TS inference issues with hand-written DB types)
  const { data: emailData, error } = await supabase
    .from('inbound_emails')
    .select(
      'id, from_address, subject, received_at, processing_status, processing_error, claude_response, metrics_extracted, attachments_count, raw_payload, company_id, fund_id'
    )
    .eq('id', params.id)
    .maybeSingle()

  if (error || !emailData) notFound()

  const email = emailData as unknown as InboundEmail

  // Parallel fetches
  const [companyResult, metricValuesResult, reviewsResult] = await Promise.all([
    email.company_id
      ? supabase
          .from('companies')
          .select('id, name')
          .eq('id', email.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('metric_values')
      .select('id, period_label, value_number, value_text, confidence, metric_id')
      .eq('source_email_id', params.id)
      .order('created_at'),
    supabase
      .from('parsing_reviews')
      .select('id, issue_type, resolution, resolved_at, extracted_value')
      .eq('email_id', params.id)
      .order('created_at'),
  ])

  const company = companyResult.data as { id: string; name: string } | null
  const metricValues = (metricValuesResult.data ?? []) as MetricRow[]
  const reviews = (reviewsResult.data ?? []) as ReviewRow[]

  // Fetch metric definitions for the metric_values
  const metricIds = Array.from(new Set(metricValues.map(mv => mv.metric_id)))
  const { data: metricsData } = metricIds.length
    ? await supabase.from('metrics').select('id, name, unit, unit_position').in('id', metricIds)
    : { data: [] }

  const metricsById = Object.fromEntries(
    ((metricsData ?? []) as MetricDef[]).map(m => [m.id, m])
  )

  // Parse raw payload for body and attachments
  // Check if file storage is configured
  const { data: settingsData } = await supabase
    .from('fund_settings')
    .select('file_storage_provider')
    .eq('fund_id', email.fund_id)
    .maybeSingle() as { data: { file_storage_provider: string | null } | null }
  const hasFileStorage = !!settingsData?.file_storage_provider

  const payload = email.raw_payload as Record<string, unknown> | null
  const textBody: string = (payload?.TextBody as string) ?? ''
  const attachments = (
    payload?.Attachments as Array<{ Name: string; ContentType: string; ContentLength: number }>
  ) ?? []

  const sv = STATUS_VARIANTS[email.processing_status] ?? {
    label: email.processing_status,
    className: '',
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-6">
      {/* Back link */}
      <Link
        href="/emails"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Email Log
      </Link>

      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-xl font-semibold leading-tight flex-1">
            {email.subject ?? <span className="italic text-muted-foreground">(no subject)</span>}
          </h1>
          <span
            className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium shrink-0 ${sv.className}`}
          >
            {sv.label}
          </span>
        </div>
        <div className="text-sm text-muted-foreground space-y-0.5">
          <p>
            From <span className="font-medium text-foreground">{email.from_address}</span>
          </p>
          <p>{fmt(email.received_at)}</p>
          {company && (
            <p>
              Company: <span className="font-medium text-foreground">{company.name}</span>
            </p>
          )}
        </div>
      </div>

      {/* Error message */}
      {email.processing_error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium mb-1">Processing error</p>
          <p className="font-mono text-xs break-all">{email.processing_error}</p>
        </div>
      )}

      {/* Metrics written */}
      {metricValues.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Metrics Written ({metricValues.length})</h2>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Metric
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Period
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Value
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {metricValues.map(mv => {
                  const metric = metricsById[mv.metric_id] ?? null
                  return (
                    <tr key={mv.id}>
                      <td className="px-4 py-2.5 font-medium">{metric?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{mv.period_label}</td>
                      <td className="px-4 py-2.5 font-mono">{formatValue(mv, metric)}</td>
                      <td className="px-4 py-2.5">
                        <ConfidenceBadge confidence={mv.confidence} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Review items */}
      <ReviewItems emailId={params.id} hasReviews={reviews.length > 0} />

      {/* Attachments */}
      {attachments.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Attachments ({attachments.length})</h2>
          <div className="space-y-1.5">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-3 text-sm rounded-md border px-3 py-2"
              >
                <span className="font-medium">{att.Name}</span>
                <span className="text-muted-foreground text-xs">{att.ContentType}</span>
                <span className="ml-auto text-muted-foreground text-xs tabular-nums">
                  {Math.round(att.ContentLength / 1024)} KB
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Email body */}
      {textBody && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Email Body</h2>
          <pre className="text-xs bg-muted rounded-lg p-4 whitespace-pre-wrap break-words font-mono max-h-96 overflow-auto border">
            {textBody}
          </pre>
        </section>
      )}

      {/* Claude response */}
      {email.claude_response && (
        <section>
          <CollapsibleJson label="Claude's Response" data={email.claude_response} />
        </section>
      )}

      {/* Actions */}
      <section className="pt-2 border-t space-y-4">
        {(email.processing_status === 'needs_review' || email.processing_status === 'processing' || email.processing_status === 'failed' || email.processing_status === 'not_processed') && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
            <div>
              <p className="text-sm font-medium">
                {email.processing_status === 'needs_review' ? 'Approve email' : 'Mark as complete'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {email.processing_status === 'needs_review'
                  ? 'Accept all outstanding reviews and mark this email as successfully processed.'
                  : 'Override the current status and mark this email as successfully processed.'}
              </p>
            </div>
            <ApproveButton emailId={email.id} />
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <p className="text-sm font-medium">Upload document</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              If the report was linked rather than attached, upload it here so it can be processed with the email.
            </p>
          </div>
          <UploadDocumentButton emailId={email.id} />
        </div>

        {hasFileStorage && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
            <div>
              <p className="text-sm font-medium">Save to file storage</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Saves the email body and attachments to your connected file storage provider.
              </p>
            </div>
            <SaveToDriveButton emailId={email.id} />
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <p className="text-sm font-medium">Process email</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Runs the full pipeline on the stored payload. Existing reviews and metric
              values from this email will be replaced.
            </p>
          </div>
          <ReprocessButton emailId={email.id} />
        </div>
      </section>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    high: 'bg-green-100 text-green-800 border-green-200',
    medium: 'bg-amber-100 text-amber-800 border-amber-200',
    low: 'bg-red-100 text-red-800 border-red-200',
  }
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${styles[confidence] ?? ''}`}
    >
      {confidence}
    </span>
  )
}
