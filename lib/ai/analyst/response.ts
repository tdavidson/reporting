import type { ConstructionModelResponse } from '@/lib/accounting/construction-service'
import type { StagedActionRecord, CompletedAnalystTool } from '@/lib/ai/analyst-tools'

export interface MetricItem {
  label: string
  value: string | number | null
  unit?: string
}

export interface TableColumn {
  key: string
  label: string
}

export type AnalystPresentationBlock =
  | { version: 1; type: 'metricGrid'; title?: string; metrics: MetricItem[] }
  | { version: 1; type: 'table'; title?: string; columns: TableColumn[]; rows: Array<Array<string | number | boolean | null>> }
  | { version: 1; type: 'companyList'; companies: Array<{ id: string; name: string; status?: string | null }> }
  | { version: 1; type: 'fundPerformance'; vehicle: string; metrics: Record<string, number | null> }
  | { version: 1; type: 'constructionSummary'; data: ConstructionSummaryBlock }
  | { version: 1; type: 'pendingAction'; action: PendingActionBlock }
  | { version: 1; type: 'recordLink'; entityType: string; id: string; label: string }

export interface ConstructionSummaryBlock {
  vehicle: string
  vintageYear: number | null
  ledgerAvailable: boolean
  asOf: string
  capital: {
    committedCapital: number
    calledCapital: number
    uncalledCapital: number
    investable: number
    deployedTotal: number
    remaining: number
    plannedExistingFollowOn: number
    plannedNewCapital: number
    plannedNewFollowOn: number
    gap: number | null
  }
  assumptions: {
    feeAnnualRate: number
    feeBasis: string
    feeTermYears: number
    annualPartnershipExpense: number
    remainingOrgCosts: number
  }
  positions: Array<{
    companyId: string
    name: string
    status: string
    investedTotal: number
    currentValue: number
    estimatedReturn: number | null
    returnMethod: string
  }>
  warnings: string[]
}

export interface PendingActionBlock {
  id: string
  actionType: string
  summary: string
  details: Record<string, unknown>
}

function isConstructionResult(value: unknown): value is ConstructionModelResponse {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<ConstructionModelResponse>
  return typeof result.vehicle === 'string'
    && typeof result.asOf === 'string'
    && !!result.actuals
    && !!result.assumptions
    && !!result.forecast?.capital
    && Array.isArray(result.positions)
    && Array.isArray(result.warnings)
}

/** Build a compact, stable mobile/web presentation shape from the validated tool result. */
export function constructionSummaryBlock(value: unknown): AnalystPresentationBlock | null {
  if (!isConstructionResult(value)) return null
  const { capital } = value.forecast
  return {
    version: 1,
    type: 'constructionSummary',
    data: {
      vehicle: value.vehicle,
      vintageYear: value.vintageYear,
      ledgerAvailable: value.ledgerAvailable,
      asOf: value.asOf,
      capital: {
        committedCapital: capital.committedCapital,
        calledCapital: capital.calledCapital,
        uncalledCapital: capital.uncalledCapital,
        investable: capital.investable,
        deployedTotal: capital.deployedTotal,
        remaining: capital.remaining,
        plannedExistingFollowOn: capital.plannedExistingFollowOn,
        plannedNewCapital: capital.plannedNewCapital,
        plannedNewFollowOn: capital.plannedNewFollowOn,
        gap: capital.gap,
      },
      assumptions: {
        feeAnnualRate: value.assumptions.feeAnnualRate,
        feeBasis: value.assumptions.feeBasis,
        feeTermYears: value.assumptions.feeTermYears,
        annualPartnershipExpense: value.assumptions.annualPartnershipExpense,
        remainingOrgCosts: value.assumptions.remainingOrgCosts,
      },
      positions: value.positions.map(position => ({
        companyId: position.actual.companyId,
        name: position.actual.name,
        status: position.actual.status,
        investedTotal: position.actual.investedTotal,
        currentValue: position.currentValue,
        estimatedReturn: position.estimatedReturn,
        returnMethod: position.returnMethod,
      })),
      warnings: value.warnings,
    },
  }
}

export function buildPresentationBlocks(
  completedTools: CompletedAnalystTool[],
  stagedActions: StagedActionRecord[],
): AnalystPresentationBlock[] {
  const blocks: AnalystPresentationBlock[] = []
  for (const completed of completedTools) {
    if (completed.name !== 'portfolio_construction') continue
    const block = constructionSummaryBlock(completed.result)
    if (block) blocks.push(block)
  }
  for (const staged of stagedActions) {
    blocks.push({
      version: 1,
      type: 'pendingAction',
      action: {
        id: staged.id,
        actionType: staged.actionType,
        summary: staged.preview.summary,
        details: staged.preview.details,
      },
    })
  }
  return blocks
}
