// Every DB read the reminder sources need, for one fund. Kept apart from the sources so those
// stay pure and testable over fixtures.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/accounting/load'
import { lastEndedQuarter, metricQuarter, responseKey } from '@/lib/requests/response-status'
import type { FundReminderData } from './collect'
import type { ComplianceItemRow } from './sources/compliance'

export interface ReminderSettings {
  enabled: boolean
  recipients: string[]
  asksSendOffsetDays: number
  fundName: string
}

export async function loadReminderSettings(admin: SupabaseClient, fundId: string): Promise<ReminderSettings> {
  const [{ data: s }, { data: fund }] = await Promise.all([
    (admin as any).from('fund_settings')
      .select('reminders_enabled, reminder_recipients, asks_send_offset_days')
      .eq('fund_id', fundId).maybeSingle(),
    admin.from('funds').select('name').eq('id', fundId).maybeSingle(),
  ])
  return {
    enabled: !!s?.reminders_enabled,
    recipients: (s?.reminder_recipients as string[] | null) ?? [],
    asksSendOffsetDays: (s?.asks_send_offset_days as number | null) ?? 0,
    fundName: (fund as { name?: string } | null)?.name ?? 'Your fund',
  }
}

export async function loadFundReminderData(
  admin: SupabaseClient,
  fundId: string,
  today: string,
  asksSendOffsetDays: number,
): Promise<FundReminderData> {
  const y = Number(today.slice(0, 4))
  const rq = lastEndedQuarter(today)
  const db = admin as any

  const [items, profile, settings, closed, vehicles, closes, requests, companies, metrics, overrides] = await Promise.all([
    db.from('compliance_items')
      .select('id, name, short_name, frequency, scope, deadline_month, deadline_day, rolling_days')
      .order('sort_order'),
    db.from('fund_compliance_profile').select('*').eq('fund_id', fundId).maybeSingle(),
    db.from('compliance_fund_settings').select('compliance_item_id, portfolio_group, applies, dismissed').eq('fund_id', fundId),
    db.from('compliance_deadlines').select('compliance_item_id, portfolio_group, quarter, year')
      .eq('fund_id', fundId).in('status', ['filed', 'not_applicable']).gte('year', y - 1),
    db.from('fund_vehicles').select('name').eq('fund_id', fundId),
    fetchAllRows<{ portfolio_group: string; flow_date: string }>((from, to) =>
      db.from('fund_cash_flows').select('portfolio_group, flow_date')
        .eq('fund_id', fundId).eq('flow_type', 'commitment')
        .gte('flow_date', `${y - 1}-01-01`).lte('flow_date', `${y + 1}-12-31`)
        .order('flow_date').range(from, to)),
    db.from('email_requests').select('quarter, year, due_date, status')
      .eq('fund_id', fundId).not('quarter', 'is', null).gte('year', rq.year - 1),
    db.from('companies').select('id, name')
      .eq('fund_id', fundId).eq('holding_type', 'company').eq('status', 'active').order('name'),
    fetchAllRows<{ company_id: string; period_year: number; period_quarter: number | null; period_month: number | null }>((from, to) =>
      db.from('metric_values').select('company_id, period_year, period_quarter, period_month')
        .eq('fund_id', fundId).eq('period_year', rq.year).range(from, to)),
    db.from('ask_response_overrides').select('company_id, status')
      .eq('fund_id', fundId).eq('year', rq.year).eq('quarter', rq.quarter),
  ])

  const closeDates: Record<string, string[]> = {}
  for (const c of closes) (closeDates[c.portfolio_group] ??= []).push(c.flow_date.slice(0, 10))

  const hasData = new Set<string>()
  for (const mv of metrics) {
    if (metricQuarter(mv) === rq.quarter) hasData.add(responseKey(mv.company_id, mv.period_year, rq.quarter))
  }

  const overrideMap = new Map<string, string>()
  for (const o of (overrides.data ?? []) as { company_id: string; status: string }[]) {
    overrideMap.set(responseKey(o.company_id, rq.year, rq.quarter), o.status)
  }

  return {
    compliance: {
      items: (items.data ?? []) as ComplianceItemRow[],
      profile: profile.data ?? null,
      settings: settings.data ?? [],
      closed: closed.data ?? [],
      portfolioGroups: ((vehicles.data ?? []) as { name: string }[]).map(v => v.name).sort(),
      closeDates,
    },
    asks: {
      sendOffsetDays: asksSendOffsetDays,
      requests: requests.data ?? [],
      companies: companies.data ?? [],
      hasData,
      overrides: overrideMap,
    },
  }
}
