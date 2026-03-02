import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { getClaudeApiKey, getClaudeModel, getOpenAIApiKey, getOpenAIModel, getDefaultAIProvider } from '@/lib/pipeline/processEmail'
import type { AIProvider } from './types'

export type { AIProvider, AIModel, CreateMessageParams, ContentBlock, TextBlock, DocumentBlock, ImageBlock, MessageContent } from './types'

type Supabase = Parameters<typeof getClaudeApiKey>[0]

export async function createFundAIProvider(
  supabase: Supabase,
  fundId: string
): Promise<{ provider: AIProvider; model: string }> {
  const defaultProvider = await getDefaultAIProvider(supabase, fundId)

  if (defaultProvider === 'openai') {
    const apiKey = await getOpenAIApiKey(supabase, fundId)
    const model = await getOpenAIModel(supabase, fundId)
    return { provider: new OpenAIProvider(apiKey), model }
  }

  const apiKey = await getClaudeApiKey(supabase, fundId)
  const model = await getClaudeModel(supabase, fundId)
  return { provider: new AnthropicProvider(apiKey), model }
}

export async function createFundAIProviderWithOverride(
  supabase: Supabase,
  fundId: string,
  providerOverride?: 'anthropic' | 'openai'
): Promise<{ provider: AIProvider; model: string }> {
  const providerType = providerOverride ?? await getDefaultAIProvider(supabase, fundId)

  if (providerType === 'openai') {
    const apiKey = await getOpenAIApiKey(supabase, fundId)
    const model = await getOpenAIModel(supabase, fundId)
    return { provider: new OpenAIProvider(apiKey), model }
  }

  const apiKey = await getClaudeApiKey(supabase, fundId)
  const model = await getClaudeModel(supabase, fundId)
  return { provider: new AnthropicProvider(apiKey), model }
}

export function createProviderFromKey(apiKey: string, providerType?: 'anthropic' | 'openai'): AIProvider {
  if (providerType === 'openai') {
    return new OpenAIProvider(apiKey)
  }
  return new AnthropicProvider(apiKey)
}
