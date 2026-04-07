import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { createFundAIProvider } from '@/lib/ai'
import { logAIUsage } from '@/lib/ai/usage'
import { logActivity } from '@/lib/activity'
import { rateLimit } from '@/lib/rate-limit'

interface ParsedMetric {
  name: string
  unit?: string
  unit_position?: 'prefix' | 'suffix'
  value_type?: 'number' | 'currency' | 'percentage' | 'text'
  cadence?: 'monthly' | 'quarterly' | 'annual'
  historical_values?: Array<{
    period: string
    value: number | string
  }>
}

interface ParsedCompany {
  name: string
  tags?: string[]
  sender_emails?: string[]
  summary?: string
  stage?: string
  industry?: string
  overview?: string
  founders?: string
  why_invested?: string
  current_update?: string
  contact_email?: string
  metrics?: ParsedMetric[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sanitize(val: string): string {
  return val
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 10_000)
}

function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function monthToQuarter(month: number): number {
  return Math.ceil(month / 3)
}

function parsePeriodLabel(period: string): {
  label: string
  year: number
  quarter: number | null
  month: number | null
} | null {
  const label = period.trim()
  if (!label) return null

  // "yyyy-MM-dd HH:mm:ss" or "yyyy-MM-ddTHH:mm:ss"
  const tsMatch = label.match(/^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}/)
  if (tsMatch) {
    const month = parseInt(tsMatch[2])
    if (month >= 1 && month <= 12)
      return { label, year: parseInt(tsMatch[1]), quarter: monthToQuarter(month), month }
  }

  // "Q1 2025" or "Q1/2025"
  const qSpaceMatch = label.match(/^Q(\d)[\s/]+(\d{4})$/i)
  if (qSpaceMatch)
    return { label, year: parseInt(qSpaceMatch[2]), quarter: parseInt(qSpaceMatch[1]), month: null }

  // "1Q25" or "1Q2025"
  const qSuffixMatch = label.match(/^(\d)Q(\d{2}|\d{4})$/i)
  if (qSuffixMatch) {
    const yr = qSuffixMatch[2].length === 2 ? 2000 + parseInt(qSuffixMatch[2]) : parseInt(qSuffixMatch[2])
    return { label, year: yr, quarter: parseInt(qSuffixMatch[1]), month: null }
  }

  const months     = ['january','february','march','april','may','june','july','august','september','october','november','december']
  const monthAbbrs = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  for (let i = 0; i < months.length; i++) {
    const re = new RegExp(`^(?:${months[i]}|${monthAbbrs[i]})\\s*(\\d{4})$`, 'i')
    const m = label.match(re)
    if (m) {
      const month = i + 1
      return { label, year: parseInt(m[1]), quarter: monthToQuarter(month), month }
    }
  }

  // "M/yyyy"
  const mSlashY = label.match(/^(\d{1,2})\/(\d{4})$/)
  if (mSlashY) {
    const month = parseInt(mSlashY[1])
    if (month >= 1 && month <= 12) return { label, year: parseInt(mSlashY[2]), quarter: monthToQuarter(month), month }
  }

  // "yyyy-M" or "yyyy/M"
  const yDashM = label.match(/^(\d{4})[-/](\d{1,2})$/)
  if (yDashM) {
    const month = parseInt(yDashM[2])
    if (month >= 1 && month <= 12) return { label, year: parseInt(yDashM[1]), quarter: monthToQuarter(month), month }
  }

  // "M-yyyy"
  const mDashY = label.match(/^(\d{1,2})-(\d{4})$/)
  if (mDashY) {
    const month = parseInt(mDashY[1])
    if (month >= 1 && month <= 12) return { label, year: parseInt(mDashY[2]), quarter: monthToQuarter(month), month }
  }

  // "M/D/yyyy" — 4-digit year, US convention (first = month)
  const mdY4 = label.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdY4) {
    const month = parseInt(mdY4[1])
    const year  = parseInt(mdY4[3])
    if (month >= 1 && month <= 12) return { label, year, quarter: monthToQuarter(month), month }
  }

  // "M/D/YY" — 2-digit year (e.g. 2/1/22 → Feb 2022)
  const mdY2 = label.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (mdY2) {
    const month = parseInt(mdY2[1])
    const year  = 2000 + parseInt(mdY2[3])
    if (month >= 1 && month <= 12) return { label, year, quarter: monthToQuarter(month), month }
  }

  // ISO "yyyy-MM-dd"
  const isoDate = label.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDate) {
    const month = parseInt(isoDate[2])
    if (month >= 1 && month <= 12) return { label, year: parseInt(isoDate[1]), quarter: monthToQuarter(month), month }
  }

  // "yyyy/MM/dd"
  const yMD = label.match(/^(\d{4})\/(\d{2})\/(\d{2})$/)
  if (yMD) {
    const month = parseInt(yMD[2])
    if (month >= 1 && month <= 12) return { label, year: parseInt(yMD[1]), quarter: monthToQuarter(month), month }
  }

  // "2025" or "FY2025"
  const yearOnly = label.match(/^(\d{4})$/)
  if (yearOnly) return { label, year: parseInt(yearOnly[1]), quarter: null, month: null }

  const fyMatch = label.match(/^FY\s*(\d{4})$/i)
  if (fyMatch) return { label, year: parseInt(fyMatch[1]), quarter: null, month: null }

  return null
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const limited = await rateLimit({ key: `import:${user.id}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const fundId = membership.fund_id
  const body = await req.json()
  const { text } = body

  if (typeof text !== 'string' || !text.trim())
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })

  if (text.length > 500_000)
    return NextResponse.json({ error: 'Input too large. Maximum 500KB of text allowed.' }, { status: 400 })

  let provider: Awaited<ReturnType<typeof createFundAIProvider>>['provider']
  let claudeModel: string
  let aiProviderType: string
  try {
    const result = await createFundAIProvider(admin, fundId)
    provider = result.provider
    claudeModel = result.model
    aiProviderType = result.providerType
  } catch {
    return NextResponse.json({ error: 'Claude API key not configured. Add one in Settings.' }, { status: 400 })
  }

  let responseText: string
  try {
    const aiResult = await provider.createMessage({
      model: claudeModel,
      maxTokens: 8192,
      content: `Parse the following spreadsheet/CSV data into structured JSON. Extract companies with their metrics and historical values.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "companies": [
    {
      "name": "Company Name",
      "tags": ["Fund I"],
      "sender_emails": ["email@example.com"],
      "summary": "Brief business description",
      "stage": "Series A",
      "industry": "SaaS",
      "overview": "Company overview paragraph",
      "founders": "Jane Doe, John Smith",
      "why_invested": "Investment thesis",
      "current_update": "Latest business update",
      "contact_email": "founder@company.com",
      "metrics": [
        {
          "name": "MRR",
          "unit": "R$",
          "unit_position": "prefix",
          "value_type": "currency",
          "cadence": "monthly",
          "historical_values": [
            { "period": "2/1/22", "value": 50000 },
            { "period": "3/1/22", "value": 55000 }
          ]
        }
      ]
    }
  ]
}

CRITICAL — Two common spreadsheet layouts:

1. WIDE FORMAT (pivot table): columns are dates/periods, rows are companies+metrics.
   Example:
     Company | Metric     | Unit | 2/1/22 | 3/1/22
     Klubi   | AuM        | R$   | 29300000 | 38270000
   → Each date column header becomes a period in historical_values.
   → PRESERVE the column header EXACTLY as-is in the "period" field. Do NOT reformat or normalize dates.
   → Group rows by Company: all metric rows for the same company become one company entry.

2. TALL FORMAT (normalized): each row is one value — columns: company, metric, period, value.

General rules:
- value_type: "currency" for monetary amounts, "percentage" for rates/percentages, "number" for counts
- unit_position: "prefix" for currency symbols (R$, $, €), "suffix" for percent (%)
- cadence: "monthly" if periods are month-level dates, "quarterly" if Q1/Q2..., "annual" if yearly
- Skip rows or columns that are entirely empty
- If you can't parse something, skip it rather than guessing wrong

Data to parse:
${text}`,
    })
    responseText = aiResult.text

    logAIUsage(admin, {
      fundId,
      userId: user.id,
      provider: aiProviderType,
      model: claudeModel,
      feature: 'import',
      usage: aiResult.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[import] Claude API error:', message)
    return NextResponse.json({ error: 'AI API call failed. Check your API key in Settings.' }, { status: 500 })
  }

  let parsed: { companies: ParsedCompany[] }
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json({
      error: 'Failed to parse AI response as JSON. Try importing fewer rows at a time.',
    }, { status: 500 })
  }

  if (!parsed.companies || !Array.isArray(parsed.companies))
    return NextResponse.json({ error: 'Invalid response structure' }, { status: 500 })

  if (parsed.companies.length > 1000)
    return NextResponse.json({ error: 'Too many companies in parsed result (max 1000)' }, { status: 400 })

  const { data: existingCompanies } = await admin
    .from('companies')
    .select('id, name')
    .eq('fund_id', fundId)

  const companyByName = new Map(
    (existingCompanies ?? []).map(c => [c.name.toLowerCase(), c.id])
  )

  const { data: existingSenders } = await admin
    .from('authorized_senders')
    .select('email')
    .eq('fund_id', fundId)
  const existingSenderEmails = new Set(
    (existingSenders ?? []).map(s => (s.email as string).toLowerCase())
  )

  const results = {
    companiesCreated: 0,
    companiesMatched: 0,
    companiesUpdated: 0,
    metricsCreated: 0,
    metricsMatched: 0,
    metricValuesCreated: 0,
    metricValuesSkippedDuplicate: 0,
    metricValuesSkippedParseFail: 0,
    rejectedPeriods: [] as string[],
    sendersCreated: 0,
    errors: [] as string[],
  }

  for (const pc of parsed.companies) {
    if (!pc.name || typeof pc.name !== 'string' || !pc.name.trim()) {
      results.errors.push('Skipped company with no name')
      continue
    }

    const companyName = sanitize(pc.name)
    if (!companyName) {
      results.errors.push('Skipped company with empty name after sanitization')
      continue
    }

    let companyId = companyByName.get(companyName.toLowerCase())

    const companyFields: Record<string, unknown> = {}
    if (pc.industry) {
      const ind = sanitize(pc.industry)
      companyFields.industry = ind ? [ind] : null
    }
    if (pc.overview) companyFields.overview = sanitize(pc.overview) || null
    if (pc.founders) companyFields.founders = sanitize(pc.founders) || null
    if (pc.why_invested) companyFields.why_invested = sanitize(pc.why_invested) || null
    if (pc.current_update) companyFields.current_update = sanitize(pc.current_update) || null
    if (pc.contact_email) {
      const email = sanitize(pc.contact_email)
      if (isValidEmail(email)) companyFields.contact_email = [email]
    }
    if (pc.stage) companyFields.stage = sanitize(pc.stage) || null
    if (pc.summary) companyFields.notes = sanitize(pc.summary) || null

    if (companyId) {
      results.companiesMatched++
      const updateFields: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(companyFields)) {
        if (val != null) updateFields[key] = val
      }
      if (Object.keys(updateFields).length > 0) {
        const { error: updateError } = await admin
          .from('companies')
          .update(updateFields)
          .eq('id', companyId)
        if (!updateError) results.companiesUpdated++
        else results.errors.push(`Failed to update company "${companyName}": ${updateError.message}`)
      }
    } else {
      const sanitizedTags = Array.isArray(pc.tags)
        ? pc.tags.filter(t => typeof t === 'string').map(t => sanitize(t)).filter(Boolean)
        : []

      const { data: newCompany, error: companyError } = await admin
        .from('companies')
        .insert({
          fund_id: fundId,
          name: companyName,
          tags: sanitizedTags,
          status: 'active',
          ...companyFields,
        })
        .select('id')
        .single()

      if (companyError || !newCompany) {
        results.errors.push(`Failed to create company "${companyName}": ${companyError?.message}`)
        continue
      }

      companyId = newCompany.id
      results.companiesCreated++
      companyByName.set(companyName.toLowerCase(), companyId)
    }

    if (Array.isArray(pc.sender_emails)) {
      for (const email of pc.sender_emails) {
        if (typeof email !== 'string') continue
        const trimmedEmail = sanitize(email).toLowerCase()
        if (!trimmedEmail || !isValidEmail(trimmedEmail) || existingSenderEmails.has(trimmedEmail)) continue
        const { error: senderError } = await admin
          .from('authorized_senders')
          .insert({ fund_id: fundId, email: trimmedEmail, label: companyName })
        if (!senderError) {
          results.sendersCreated++
          existingSenderEmails.add(trimmedEmail)
        }
      }
    }

    const { data: existingMetrics } = await admin
      .from('metrics')
      .select('id, slug')
      .eq('company_id', companyId)

    const metricBySlug = new Map(
      (existingMetrics ?? []).map(m => [m.slug as string, m.id as string])
    )

    if (Array.isArray(pc.metrics) && pc.metrics.length > 0) {
      const nextOrder = (existingMetrics ?? []).length

      for (let i = 0; i < pc.metrics.length; i++) {
        const m = pc.metrics[i]
        if (!m || typeof m.name !== 'string' || !m.name.trim()) continue

        const metricName = sanitize(m.name)
        if (!metricName) continue

        const slug = slugify(metricName)
        let metricId = metricBySlug.get(slug)

        if (metricId) {
          results.metricsMatched++
        } else {
          const { data: newMetric, error: metricError } = await admin
            .from('metrics')
            .insert({
              company_id: companyId,
              fund_id: fundId,
              name: metricName,
              slug,
              unit: m.unit ? sanitize(m.unit) : null,
              unit_position: m.unit_position === 'suffix' ? 'suffix' : 'prefix',
              value_type: (['number', 'currency', 'percentage', 'text'] as const).includes(m.value_type as 'number')
                ? m.value_type!
                : 'number',
              reporting_cadence: (['monthly', 'quarterly', 'annual'] as const).includes(m.cadence as 'monthly')
                ? m.cadence!
                : 'monthly',
              display_order: nextOrder + i,
              is_active: true,
            })
            .select('id')
            .single()

          if (metricError || !newMetric) {
            results.errors.push(`Failed to create metric "${metricName}" for "${companyName}": ${metricError?.message}`)
            continue
          }

          metricId = newMetric.id
          results.metricsCreated++
          metricBySlug.set(slug, metricId)
        }

        if (Array.isArray(m.historical_values)) {
          for (const hv of m.historical_values) {
            if (!hv || typeof hv.period !== 'string') continue

            const rawPeriod = sanitize(hv.period)
            const period = parsePeriodLabel(rawPeriod)

            if (!period) {
              if (results.rejectedPeriods.length < 20)
                results.rejectedPeriods.push(rawPeriod)
              results.metricValuesSkippedParseFail++
              continue
            }

            const valueNum = typeof hv.value === 'number'
              ? hv.value
              : parseFloat(String(hv.value).replace(/[^0-9.-]/g, ''))

            let existingQuery = admin
              .from('metric_values')
              .select('id')
              .eq('metric_id', metricId)
              .eq('period_year', period.year)

            existingQuery = period.quarter != null
              ? existingQuery.eq('period_quarter', period.quarter)
              : existingQuery.is('period_quarter', null)

            existingQuery = period.month != null
              ? existingQuery.eq('period_month', period.month)
              : existingQuery.is('period_month', null)

            const { data: existingVal } = await existingQuery.maybeSingle()

            if (existingVal) {
              results.metricValuesSkippedDuplicate++
              continue
            }

            const { error: valError } = await admin
              .from('metric_values')
              .insert({
                metric_id: metricId,
                company_id: companyId,
                fund_id: fundId,
                period_label: period.label,
                period_year: period.year,
                period_quarter: period.quarter,
                period_month: period.month,
                value_number: isNaN(valueNum) ? null : valueNum,
                value_text: isNaN(valueNum) ? sanitize(String(hv.value)) : null,
                confidence: 'high',
                is_manually_entered: true,
              })

            if (!valError) results.metricValuesCreated++
          }
        }
      }
    }
  }

  logActivity(admin, fundId, user.id, 'import.data', {
    companiesCreated: results.companiesCreated,
    companiesMatched: results.companiesMatched,
  })

  return NextResponse.json(results)
}
