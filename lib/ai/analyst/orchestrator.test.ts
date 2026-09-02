import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'
import type { AccessContext } from '@/lib/access/effective'

const mocks = vi.hoisted(() => ({
  getConstructionModel: vi.fn(),
  createToolLoop: vi.fn(),
  createChat: vi.fn(),
  logAIUsage: vi.fn(),
  buildPortfolioContext: vi.fn(),
  conversationBelongsToPrincipal: vi.fn(),
  loadConversationMemory: vi.fn(),
  persistConversation: vi.fn(),
}))

vi.mock('@/lib/accounting/construction-service', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/accounting/construction-service')>()),
  getConstructionModel: mocks.getConstructionModel,
}))
vi.mock('@/lib/ai', () => ({
  createFundAIProviderWithOverride: async () => ({
    provider: {
      supportsToolLoop: true,
      createToolLoop: mocks.createToolLoop,
      createChat: mocks.createChat,
    },
    model: 'test-model',
    providerType: 'anthropic',
  }),
}))
vi.mock('@/lib/ai/usage', () => ({ logAIUsage: mocks.logAIUsage }))
vi.mock('@/lib/ai/topical-guard', () => ({ withTopicalGuardrail: (value: string) => value }))
vi.mock('@/lib/ai/context-builder', () => ({
  buildPortfolioContext: mocks.buildPortfolioContext,
  buildCompanyContext: async () => null,
  buildDealContext: async () => null,
}))
vi.mock('./conversation-store', () => ({
  conversationBelongsToPrincipal: mocks.conversationBelongsToPrincipal,
  loadConversationMemory: mocks.loadConversationMemory,
  persistConversation: mocks.persistConversation,
}))

import { runAnalyst } from './orchestrator'

function query(data: unknown): any {
  const result = { data, error: null }
  const handler: ProxyHandler<any> = {
    get(_target, property) {
      if (property === 'then') return (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
      if (property === 'maybeSingle' || property === 'single') return async () => result
      return () => proxy
    },
  }
  const proxy = new Proxy({}, handler)
  return proxy
}

const adminFrom = vi.fn(() => query([]))
const admin = { from: adminFrom } as any
const features = Object.fromEntries(
  Object.keys(DEFAULT_FEATURE_VISIBILITY).map(key => [key, 'everyone']),
) as FeatureVisibilityMap
const access: AccessContext = {
  fundId: 'fund-1',
  userId: 'user-1',
  role: 'member',
  features,
  grants: { accounting: 'read' },
  defaults: {},
}
const principal = { userId: 'user-1', fundId: 'fund-1', role: 'member', access }

const canonical = {
  vehicle: 'Fund II',
  vehicleId: 'vehicle-2',
  vintageYear: 2024,
  ledgerAvailable: true,
  asOf: '2026-09-02T12:00:00.000Z',
  actuals: {},
  assumptions: {
    feeAnnualRate: 0.02,
    feeBasis: 'committed',
    feeTermYears: 7,
    annualPartnershipExpense: 25_000,
    remainingOrgCosts: 10_000,
  },
  forecast: {
    capital: {
      committedCapital: 10_000_000,
      calledCapital: 4_000_000,
      uncalledCapital: 6_000_000,
      investable: 8_000_000,
      deployedTotal: 3_000_000,
      remaining: 5_000_000,
      plannedExistingFollowOn: 500_000,
      plannedNewCapital: 1_000_000,
      plannedNewFollowOn: 1_000_000,
      gap: 2_500_000,
    },
  },
  positions: [],
  warnings: [],
}

describe('runAnalyst', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConstructionModel.mockResolvedValue(canonical)
    mocks.buildPortfolioContext.mockResolvedValue({
      systemPrompt: 'You are the Analyst.',
      portfolioBlock: '',
      teamNotesBlock: '',
    })
    mocks.conversationBelongsToPrincipal.mockResolvedValue(true)
    mocks.loadConversationMemory.mockResolvedValue('')
    mocks.persistConversation.mockResolvedValue('conversation-1')
    mocks.logAIUsage.mockResolvedValue(undefined)
    mocks.createToolLoop.mockImplementation(async (params: any) => {
      await params.executeTool({ name: 'portfolio_construction', input: { vehicle: 'Fund II' } })
      return {
        text: 'Fund II has $5 million remaining.',
        usage: { inputTokens: 10, outputTokens: 8 },
        toolCalls: [{ name: 'portfolio_construction', input: {}, resultPreview: '{}', isError: false }],
      }
    })
  })

  it('runs outside a route and builds construction blocks from the completed tool result', async () => {
    const result = await runAnalyst(principal, {
      messages: [{ role: 'user', content: 'How much capital remains in Fund II?' }],
      scope: { domain: 'funds' },
    }, { admin, isRateLimited: async () => false })

    expect(result.reply).toBe('Fund II has $5 million remaining.')
    expect(result.conversationId).toBe('conversation-1')
    expect(result.toolCalls).toEqual([{ name: 'portfolio_construction' }])
    expect(result.blocks).toEqual([
      expect.objectContaining({
        version: 1,
        type: 'constructionSummary',
        data: expect.objectContaining({
          vehicle: 'Fund II',
          capital: expect.objectContaining({ remaining: 5_000_000 }),
        }),
      }),
    ])
    expect(mocks.getConstructionModel).toHaveBeenCalledWith(
      expect.objectContaining({ fundId: 'fund-1' }),
      { vehicle: 'Fund II' },
    )
    expect(mocks.logAIUsage).toHaveBeenCalledTimes(1)
  })

  it('does not request team notes without the relationships/notes grant', async () => {
    const portfolioPrincipal = {
      ...principal,
      access: { ...access, grants: { portfolio: 'read' as const } },
    }
    await runAnalyst(portfolioPrincipal, {
      messages: [{ role: 'user', content: 'How is the portfolio?' }],
    }, { admin, isRateLimited: async () => false })

    expect(mocks.buildPortfolioContext).toHaveBeenCalledWith(admin, 'fund-1', {
      includeTeamNotes: false,
    })
  })

  it('does not preload portfolio context for a principal without portfolio access', async () => {
    await runAnalyst(principal, {
      messages: [{ role: 'user', content: 'How much capital remains in Fund II?' }],
      scope: { domain: 'funds' },
    }, { admin, isRateLimited: async () => false })

    expect(mocks.buildPortfolioContext).not.toHaveBeenCalled()
    expect(adminFrom).not.toHaveBeenCalledWith('companies')
  })

  it('refuses an explicit company scope without portfolio access', async () => {
    await expect(runAnalyst(principal, {
      messages: [{ role: 'user', content: 'Tell me about the company' }],
      scope: { companyId: 'company-1' },
    }, { admin, isRateLimited: async () => false })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })
})
