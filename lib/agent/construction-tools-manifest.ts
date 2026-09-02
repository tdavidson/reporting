import type { AgentToolMeta } from '@/lib/accounting/agent-tools-manifest'

export const CONSTRUCTION_TOOL_MANIFEST: AgentToolMeta[] = [
  {
    name: 'portfolio_construction',
    description:
      'Return portfolio-construction actuals, assumptions, forecasts, and capital availability ' +
      'for one investment vehicle. Use it to answer how much capital remains, how reserves and ' +
      'new investments are planned, and what portfolio outcomes imply for fund returns.',
    scope: 'read',
    // Fund-scoped dispatch, but the contents are governed by the accounting grant and switch.
    domain: 'portfolio',
    accessDomain: 'accounting',
    inputSchema: {
      type: 'object',
      properties: {
        vehicle: { type: 'string', description: 'Investment vehicle name.' },
      },
      required: ['vehicle'],
      additionalProperties: false,
    },
  },
]
