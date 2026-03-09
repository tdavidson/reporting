import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  if (process.env.ENABLE_SETUP_PAGE !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  const encryptionKey = !!process.env.ENCRYPTION_KEY
  const appUrl = !!process.env.NEXT_PUBLIC_APP_URL
  const setupPageEnabled = process.env.ENABLE_SETUP_PAGE === 'true'

  // If Supabase env vars are missing, return early with just infrastructure checks
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({
      infrastructure: {
        supabaseUrl,
        supabaseAnonKey,
        serviceRoleKey,
        encryptionKey,
        appUrl,
        setupPageEnabled,
      },
      database: null,
      authentication: null,
      fund: null,
      ai: null,
      inboundEmail: null,
      outboundEmail: null,
      fileStorage: null,
      senders: null,
    })
  }

  const supabase = createAdminClient()

  // Database connectivity and core tables
  let dbConnected = false
  let coreTablesExist = false
  let coreTableCount = 0
  const expectedTables = [
    'app_settings',
    'funds',
    'fund_members',
    'fund_settings',
    'authorized_senders',
    'companies',
    'company_metrics',
    'documents',
    'emails',
    'investments',
  ]

  try {
    const { error } = await supabase.from('app_settings').select('id').limit(1)
    dbConnected = !error

    if (dbConnected) {
      const tableChecks = await Promise.all(
        expectedTables.map(async (table) => {
          const { error } = await supabase.from(table).select('id').limit(1)
          return !error
        })
      )
      coreTableCount = tableChecks.filter(Boolean).length
      coreTablesExist = coreTableCount === expectedTables.length
    }
  } catch {
    dbConnected = false
  }

  // Auth check
  let hasUser = false
  try {
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
    hasUser = (data?.users?.length ?? 0) > 0
  } catch {
    hasUser = false
  }

  // Fund check
  let hasFund = false
  try {
    const { count } = await supabase.from('funds').select('id', { count: 'exact', head: true })
    hasFund = (count ?? 0) > 0
  } catch {
    hasFund = false
  }

  // AI, email, storage, senders — only check if fund exists
  let ai = null
  let inboundEmail = null
  let outboundEmail = null
  let fileStorage = null
  let senders = null

  if (hasFund) {
    try {
      const [settingsResult, sendersResult] = await Promise.all([
        supabase
          .from('fund_settings')
          .select(
            'claude_api_key_encrypted, openai_api_key_encrypted, gemini_api_key_encrypted, default_ai_provider, ollama_base_url, ollama_model, inbound_email_provider, postmark_webhook_token_encrypted, mailgun_signing_key_encrypted, outbound_email_provider, postmark_server_token_encrypted, resend_api_key_encrypted, mailgun_api_key_encrypted, file_storage_provider, google_refresh_token_encrypted, dropbox_refresh_token_encrypted'
          )
          .limit(1)
          .maybeSingle(),
        supabase.from('authorized_senders').select('id', { count: 'exact', head: true }),
      ])

      const s = settingsResult.data

      const hasClaudeKey = !!s?.claude_api_key_encrypted
      const hasOpenAIKey = !!s?.openai_api_key_encrypted
      const hasGeminiKey = !!s?.gemini_api_key_encrypted
      const hasOllama = !!s?.ollama_base_url && !!s?.ollama_model
      ai = {
        hasProvider: hasClaudeKey || hasOpenAIKey || hasGeminiKey || hasOllama,
      }

      const hasInboundProvider = !!s?.inbound_email_provider
      const hasInboundKey =
        !!s?.postmark_webhook_token_encrypted || !!s?.mailgun_signing_key_encrypted
      inboundEmail = {
        providerConfigured: hasInboundProvider,
        keyConfigured: hasInboundKey,
      }

      const hasOutboundProvider = !!s?.outbound_email_provider
      const hasOutboundKey =
        !!s?.postmark_server_token_encrypted ||
        !!s?.resend_api_key_encrypted ||
        !!s?.mailgun_api_key_encrypted
      outboundEmail = {
        providerConfigured: hasOutboundProvider,
        keyConfigured: hasOutboundKey,
      }

      const hasGoogleDrive = !!s?.google_refresh_token_encrypted
      const hasDropbox = !!s?.dropbox_refresh_token_encrypted
      fileStorage = {
        connected: hasGoogleDrive || hasDropbox,
      }

      senders = {
        count: sendersResult.count ?? 0,
      }
    } catch {
      // partial failure — leave as null
    }
  }

  return NextResponse.json({
    infrastructure: {
      supabaseUrl,
      supabaseAnonKey,
      serviceRoleKey,
      encryptionKey,
      appUrl,
      setupPageEnabled,
    },
    database: {
      connected: dbConnected,
      coreTablesExist,
      coreTableCount,
      expectedTableCount: expectedTables.length,
    },
    authentication: { hasUser },
    fund: { hasFund },
    ai,
    inboundEmail,
    outboundEmail,
    fileStorage,
    senders,
  })
}
