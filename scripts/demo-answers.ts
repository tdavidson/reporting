/**
 * Replace the stored Analyst replies in demo-widget/data/answers.json with the real Analyst's
 * output, one question at a time, against the demo fund.
 *
 *   ANTHROPIC_API_KEY=… DEMO_SUPABASE_URL=https://<project>.supabase.co \
 *   DEMO_SUPABASE_KEY=<publishable key> DEMO_PASSWORD=… npx tsx scripts/demo-answers.ts
 *
 * Signs in as the demo fund's viewer (DEMO_EMAIL, default hello@hemrock.com) with the project's
 * publishable key, so every read the Analyst makes goes through RLS and the access grants exactly
 * as it would for a visitor to the hosted demo: it can only answer from what the viewer can see.
 * No service-role key is involved. The principal is a `demo` credential with drafts off, and each
 * run is ephemeral — no conversation memory, nothing persisted, no usage row — so one answer can't
 * leak into the next one's prompt.
 *
 * The model runs on ANTHROPIC_API_KEY from the environment, not the fund's stored key (which the
 * viewer can't read), so it costs whoever owns that key. DEMO_MODEL picks the model (default
 * claude-sonnet-5). Run it when the snapshot changes, not on every build. Questions, aliases,
 * scopes and suggestions are kept from the file; only `reply`, `model` and `generatedBy` change.
 * Pass --only "<question>" to regenerate one.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { AnthropicProvider } from '@/lib/ai/anthropic'
import { resolveAccessContext } from '@/lib/access/effective'
import { runAnalyst } from '@/lib/ai/analyst/orchestrator'
import type { AnalystPrincipal } from '@/lib/ai/analyst/types'
import type { DemoAnswers } from '@/demo-widget/types'

const FILE = path.join(process.cwd(), 'demo-widget', 'data', 'answers.json')
const SUPABASE_URL = process.env.DEMO_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.DEMO_SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = process.env.DEMO_EMAIL || 'hello@hemrock.com'
const PASSWORD = process.env.DEMO_PASSWORD
const API_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.DEMO_MODEL || 'claude-sonnet-5'
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

async function main() {
  const missing = [
    !API_KEY && 'ANTHROPIC_API_KEY',
    !SUPABASE_URL && 'DEMO_SUPABASE_URL',
    !SUPABASE_KEY && 'DEMO_SUPABASE_KEY',
    !PASSWORD && 'DEMO_PASSWORD',
  ].filter(Boolean)
  if (missing.length) throw new Error(`Set ${missing.join(', ')}.`)

  const answers = JSON.parse(readFileSync(FILE, 'utf8')) as DemoAnswers
  const client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { autoRefreshToken: true, persistSession: false },
  })
  const { data: session, error } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD! })
  if (error || !session.user) throw new Error(`Could not sign in as ${EMAIL}: ${error?.message ?? 'no user'}`)
  const access = await resolveAccessContext(client, session.user.id)
  if (!access) throw new Error(`${EMAIL} is not a member of any fund.`)
  const principal: AnalystPrincipal = {
    userId: session.user.id,
    fundId: access.fundId,
    role: access.role,
    access,
    credentialKind: 'demo',
  }
  console.log(`Signed in as ${EMAIL} (${access.role}); answering on ${MODEL}.`)

  const provider = { provider: new AnthropicProvider(API_KEY!), model: MODEL, providerType: 'anthropic' }
  let changed = 0
  for (const entry of answers.answers) {
    if (only && entry.question !== only) continue
    const companyId = entry.scope.startsWith('company:') ? entry.scope.slice('company:'.length) : undefined
    process.stdout.write(`${entry.scope}: ${entry.question} … `)
    const result = await runAnalyst(principal, {
      messages: [{ role: 'user', content: entry.question }],
      scope: { companyId },
      allowDrafts: false,
    }, { admin: client, provider, ephemeral: true, isRateLimited: async () => false })
    entry.reply = result.reply
    entry.model = { id: result.usage.model, provider: result.usage.provider }
    changed++
    console.log(`${result.reply.length} chars`)
  }

  await client.auth.signOut()
  if (changed > 0 && !only) answers.generatedBy = 'analyst'
  writeFileSync(FILE, JSON.stringify(answers, null, 2) + '\n')
  console.log(`Updated ${changed} repl${changed === 1 ? 'y' : 'ies'} in ${path.relative(process.cwd(), FILE)}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
