/**
 * Replace the stored Analyst replies in demo-widget/data/answers.json with the real Analyst's
 * output, one question at a time, against the demo fund.
 *
 *   DEMO_USER_ID=<auth user id of a member of the demo fund> npx tsx scripts/demo-answers.ts
 *
 * Uses the fund's configured AI provider and key, so it costs what those questions cost; run it
 * when the snapshot changes, not on every build. Questions, aliases, scopes and suggestions are
 * kept from the file; only `reply`, `model` and `generatedBy` change. Pass --only "<question>"
 * to regenerate one.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { runAnalyst } from '@/lib/ai/analyst/orchestrator'
import { resolveAnalystPrincipal } from '@/lib/ai/analyst/request-context'
import type { DemoAnswers } from '@/demo-widget/types'

const FILE = path.join(process.cwd(), 'demo-widget', 'data', 'answers.json')
const USER_ID = process.env.DEMO_USER_ID
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

async function main() {
  if (!USER_ID) throw new Error('DEMO_USER_ID is required: a member of the demo fund the Analyst runs as.')
  const answers = JSON.parse(readFileSync(FILE, 'utf8')) as DemoAnswers
  const admin = createAdminClient()
  const principal = await resolveAnalystPrincipal(admin, USER_ID)
  if (!principal) throw new Error('DEMO_USER_ID is not a member of any fund.')

  let changed = 0
  for (const entry of answers.answers) {
    if (only && entry.question !== only) continue
    const companyId = entry.scope.startsWith('company:') ? entry.scope.slice('company:'.length) : undefined
    process.stdout.write(`${entry.scope}: ${entry.question} … `)
    const result = await runAnalyst(principal, {
      messages: [{ role: 'user', content: entry.question }],
      scope: { companyId },
    }, { admin, isRateLimited: async () => false })
    entry.reply = result.reply
    if (result.usage) entry.model = { id: result.usage.model, provider: result.usage.provider }
    changed++
    console.log(`${result.reply.length} chars`)
  }

  if (changed > 0 && !only) answers.generatedBy = 'analyst'
  writeFileSync(FILE, JSON.stringify(answers, null, 2) + '\n')
  console.log(`Updated ${changed} repl${changed === 1 ? 'y' : 'ies'} in ${path.relative(process.cwd(), FILE)}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
