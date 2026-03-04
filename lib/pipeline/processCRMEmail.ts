import { createAdminClient } from '@/lib/supabase/admin'
import { extractAttachmentText } from '@/lib/parsing/extractAttachmentText'
import { identifyCompany } from '@/lib/claude/identifyCompany'
import { extractInteraction } from '@/lib/claude/extractInteraction'
import {
  getClaudeApiKey,
  getClaudeModel,
  getCompanies,
  finalizeEmail,
  type PostmarkPayload,
} from '@/lib/pipeline/processEmail'
import type { Json } from '@/lib/types/database'

type Supabase = ReturnType<typeof createAdminClient>

export async function runCRMPipeline(
  supabase: Supabase,
  emailId: string,
  fundId: string,
  userId: string,
  payload: PostmarkPayload
): Promise<void> {
  // Step 1: Extract text from email body
  const extracted = await extractAttachmentText(payload)
  const bodyText = extracted.emailBody

  // Step 2: Get AI credentials
  const claudeApiKey = await getClaudeApiKey(supabase, fundId)
  const claudeModel = await getClaudeModel(supabase, fundId)
  const logParams = { admin: supabase, fundId }

  // Step 3: Identify company
  const companies = await getCompanies(supabase, fundId)
  let companyId: string | null = null

  if (companies.length > 0) {
    try {
      const identification = await identifyCompany(
        payload.Subject ?? '',
        bodyText,
        companies,
        claudeApiKey,
        claudeModel,
        logParams
      )

      if (identification.company_id) {
        companyId = identification.company_id
        await supabase
          .from('inbound_emails')
          .update({ company_id: companyId })
          .eq('id', emailId)
      }
    } catch (err) {
      console.error('[crm-pipeline] Company identification failed (non-blocking):', err)
    }
  }

  // Step 4: Extract interaction details via AI
  const senderName = payload.FromFull?.Name || payload.From || ''
  const interaction = await extractInteraction(
    payload.Subject ?? '',
    bodyText,
    senderName,
    claudeApiKey,
    claudeModel,
    logParams
  )

  // Step 5: Insert interaction record
  const interactionType = interaction.is_intro ? 'intro' : 'email'

  await supabase.from('interactions').insert({
    fund_id: fundId,
    company_id: companyId,
    email_id: emailId,
    user_id: userId,
    type: interactionType,
    subject: payload.Subject ?? null,
    summary: interaction.summary,
    intro_contacts: interaction.intro_contacts as unknown as Json,
    body_preview: bodyText.slice(0, 500),
    interaction_date: new Date().toISOString(),
  })

  // Step 6: Finalize email
  await finalizeEmail(supabase, emailId, { status: 'success', metricsExtracted: 0 })
}
