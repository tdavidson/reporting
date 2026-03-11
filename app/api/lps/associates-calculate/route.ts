import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'

// ---------------------------------------------------------------------------
// POST — recalculate pro-rata investment metrics for LPs in Associates entities
//
// The overrides table maps: investor_entity → associates_entity (with ownership %).
// For each mapping:
//   1. Find all investments where portfolio_group matches the associates_entity
//      (these are LPs who invested INTO the associates entity)
//   2. Find the associates entity's OWN investments as an investor
//      (associates entity invests into parent funds)
//   3. For each LP invested in the associates entity:
//      - ownership = LP commitment / total associates commitment (or override %)
//      - Pro-rata share of each of the associates entity's investments
//   4. Upsert the calculated values into lp_investments
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  // Rate limit: 20 per 5 minutes per user
  const limited = await rateLimit({ key: `lp-assoc-calc:${user.id}`, limit: 20, windowSeconds: 300 })
  if (limited) return limited

  const { snapshotId } = await req.json()
  if (!snapshotId) return NextResponse.json({ error: 'snapshotId is required' }, { status: 400 })

  const fundId = writeCheck.fundId

  // Verify snapshot
  const { data: snapCheck } = await admin
    .from('lp_snapshots' as any)
    .select('id')
    .eq('id', snapshotId)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!snapCheck) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })

  // Load overrides (fund-level, no snapshot filter)
  const { data: overrides, error: ovErr } = await admin
    .from('lp_associates_overrides' as any)
    .select('*')
    .eq('fund_id', fundId) as { data: any[] | null; error: any }

  if (ovErr) return dbError(ovErr, 'associates-calc-overrides')
  if (!overrides || overrides.length === 0) {
    return NextResponse.json({ message: 'No overrides configured', updated: 0 })
  }

  // Load all investments for this snapshot (with entity + investor info)
  const { data: allInvestments, error: invErr } = await admin
    .from('lp_investments' as any)
    .select('*, lp_entities!inner(id, entity_name, investor_id, lp_investors!inner(id, name))')
    .eq('fund_id', fundId)
    .eq('snapshot_id', snapshotId) as { data: any[] | null; error: any }

  if (invErr) return dbError(invErr, 'associates-calc-investments')

  // Load all entities for name lookups
  const { data: allEntities } = await admin
    .from('lp_entities' as any)
    .select('id, entity_name, investor_id')
    .eq('fund_id', fundId) as { data: { id: string; entity_name: string; investor_id: string }[] | null; error: any }

  // Load all investors for name lookups
  const { data: allInvestors } = await admin
    .from('lp_investors' as any)
    .select('id, name')
    .eq('fund_id', fundId) as { data: { id: string; name: string }[] | null; error: any }

  const investments = allInvestments ?? []
  const entities = allEntities ?? []
  const investors = allInvestors ?? []

  // Helper: normalize name for matching (strip commas, lowercase)
  const norm = (s: string) => s.replace(/,/g, '').toLowerCase().trim()

  // Build investor name → id map
  const investorByNorm = new Map<string, string>()
  for (const inv of investors) {
    investorByNorm.set(norm(inv.name), inv.id)
  }

  // Group overrides by associates_entity
  const overridesByAssoc = new Map<string, typeof overrides>()
  for (const ov of overrides) {
    const key = norm(ov.associates_entity)
    const list = overridesByAssoc.get(key) ?? []
    list.push(ov)
    overridesByAssoc.set(key, list)
  }

  let updated = 0
  const errors: string[] = []

  for (const [assocNorm, entityOverrides] of Array.from(overridesByAssoc.entries())) {
    const assocEntityName = entityOverrides[0].associates_entity

    // Find the Associates entity as an INVESTOR (it invests into parent funds)
    const assocInvestorId = investorByNorm.get(assocNorm)
    if (!assocInvestorId) {
      errors.push(`Investor not found for Associates entity: ${assocEntityName}`)
      continue
    }

    // Find all entity IDs belonging to the Associates investor
    const assocEntityIds = entities
      .filter(e => e.investor_id === assocInvestorId)
      .map(e => e.id)

    // Find all of the Associates entity's OWN investments (as an investor in parent funds)
    const assocInvestments = investments.filter(inv => assocEntityIds.includes(inv.entity_id))

    if (assocInvestments.length === 0) {
      errors.push(`No investments found for Associates entity: ${assocEntityName}`)
      continue
    }

    // Process each override (investor_entity → associates_entity mapping)
    for (const override of entityOverrides) {
      const investorEntityName = override.investor_entity
      const ownershipPct = override.ownership_pct != null ? Number(override.ownership_pct) : null
      const carriedInterestPct = override.carried_interest_pct != null ? Number(override.carried_interest_pct) : null

      // Find the investor entity in the entities list
      const investorEntity = entities.find(e => norm(e.entity_name) === norm(investorEntityName))
      if (!investorEntity) {
        errors.push(`Entity not found: ${investorEntityName}`)
        continue
      }

      // Find this entity's investment in the Associates portfolio group
      // (to get their commitment for default ownership calc)
      const entityAssocInvestment = investments.find(inv =>
        inv.entity_id === investorEntity.id &&
        norm(inv.portfolio_group) === assocNorm
      )

      // If no ownership override, compute from commitment ratio
      let ownership: number
      if (ownershipPct != null) {
        ownership = ownershipPct / 100
      } else if (entityAssocInvestment) {
        // Total commitment into the Associates entity from all LPs
        const allAssocPGInvestments = investments.filter(inv => norm(inv.portfolio_group) === assocNorm)
        const totalCommitment = allAssocPGInvestments.reduce(
          (sum: number, inv: any) => sum + (Number(inv.commitment) || 0), 0
        )
        const entityCommitment = Number(entityAssocInvestment.commitment) || 0
        ownership = totalCommitment > 0 ? entityCommitment / totalCommitment : 0
      } else {
        errors.push(`No investment found for ${investorEntityName} in ${assocEntityName} and no ownership % set`)
        continue
      }

      if (ownership === 0) continue

      // For each of the Associates entity's investments in parent funds,
      // compute the investor's pro-rata share
      for (const assocInv of assocInvestments) {
        const targetGroup = assocInv.portfolio_group

        const assocNav = Number(assocInv.nav) || 0
        const assocPaidIn = Number(assocInv.paid_in_capital) || Number(assocInv.called_capital) || 0
        const assocDistributions = Number(assocInv.distributions) || 0
        const assocTotalValue = Number(assocInv.total_value) || (assocDistributions + assocNav)
        const assocCommitment = Number(assocInv.commitment) || 0

        // Pro-rata metrics
        let proRataNav = ownership * assocNav
        let proRataPaidIn = ownership * assocPaidIn
        let proRataDistributions = ownership * assocDistributions
        let proRataTotalValue = ownership * assocTotalValue
        const proRataCommitment = ownership * assocCommitment

        // Apply carried interest reduction if specified
        if (carriedInterestPct != null && carriedInterestPct > 0) {
          const carryRate = carriedInterestPct / 100
          const gain = proRataTotalValue - proRataPaidIn
          if (gain > 0) {
            const carry = gain * carryRate
            proRataNav = Math.max(0, proRataNav - carry)
            proRataTotalValue = proRataDistributions + proRataNav
          }
        }

        // Find or create the investor entity's investment row for the target portfolio group
        const existing = investments.find(inv =>
          inv.entity_id === investorEntity.id &&
          norm(inv.portfolio_group) === norm(targetGroup)
        )

        const metricData: Record<string, any> = {
          commitment: Math.round(proRataCommitment * 100) / 100,
          nav: Math.round(proRataNav * 100) / 100,
          paid_in_capital: Math.round(proRataPaidIn * 100) / 100,
          distributions: Math.round(proRataDistributions * 100) / 100,
          total_value: Math.round(proRataTotalValue * 100) / 100,
          updated_at: new Date().toISOString(),
        }

        // Compute ratios
        if (proRataPaidIn > 0) {
          metricData.dpi = Math.round((proRataDistributions / proRataPaidIn) * 10000) / 10000
          metricData.rvpi = Math.round((proRataNav / proRataPaidIn) * 10000) / 10000
          metricData.tvpi = Math.round(((proRataDistributions + proRataNav) / proRataPaidIn) * 10000) / 10000
        }

        if (existing) {
          // Preserve original imported values in input_* columns for auditing
          const inputSnapshot: Record<string, any> = {}
          if (existing.input_commitment == null) inputSnapshot.input_commitment = Number(existing.commitment) || null
          if (existing.input_paid_in_capital == null) inputSnapshot.input_paid_in_capital = Number(existing.paid_in_capital) || null
          if (existing.input_distributions == null) inputSnapshot.input_distributions = Number(existing.distributions) || null
          if (existing.input_nav == null) inputSnapshot.input_nav = Number(existing.nav) || null
          if (existing.input_total_value == null) inputSnapshot.input_total_value = Number(existing.total_value) || null

          const { error } = await admin
            .from('lp_investments' as any)
            .update({ ...metricData, ...inputSnapshot })
            .eq('id', existing.id)
            .eq('fund_id', fundId)

          if (error) {
            errors.push(`Failed to update ${investorEntityName} → ${targetGroup}`)
          } else {
            updated++
          }
        } else {
          // Create new investment row — no input values since this is a new calc-generated row
          const { error } = await admin
            .from('lp_investments' as any)
            .insert({
              fund_id: fundId,
              entity_id: investorEntity.id,
              portfolio_group: targetGroup,
              snapshot_id: snapshotId,
              ...metricData,
            })

          if (error) {
            errors.push(`Failed to create ${investorEntityName} → ${targetGroup}`)
          } else {
            updated++
          }
        }
      }
    }
  }

  return NextResponse.json({ updated, errors })
}
