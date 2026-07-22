import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { getClaudeApiKey, getClaudeModel, getOpenAIApiKey, getOpenAIModel, getDefaultAIProvider, getOllamaConfig, getOpenRouterApiKey, getOpenRouterConfig } from '@/lib/pipeline/processEmail'
import type { AIProvider } from './types'

export type { AIProvider, AIModel, AIResult, TokenUsage, CreateMessageParams, CreateChatParams, ChatMessage, ContentBlock, TextBlock, DocumentBlock, ImageBlock, MessageContent } from './types'

export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'openrouter'

type Supabase = Parameters<typeof getClaudeApiKey>[0]

export async function createFundAIProvider(
  supabase: Supabase,
  fundId: string
): Promise<{ provider: AIProvider; model: string; providerType: ProviderType }> {
  const defaultProvider = await getDefaultAIProvider(supabase, fundId)
  return createProviderForType(supabase, fundId, defaultProvider)
}

const VALID_PROVIDERS: ProviderType[] = ['anthropic', 'openai', 'ollama', 'openrouter']

export async function createFundAIProviderWithOverride(
  supabase: Supabase,
  fundId: string,
  providerOverride?: string
): Promise<{ provider: AIProvider; model: string; providerType: ProviderType }> {
  const validated = providerOverride && VALID_PROVIDERS.includes(providerOverride as ProviderType)
    ? (providerOverride as ProviderType)
    : undefined
  const providerType = validated ?? await getDefaultAIProvider(supabase, fundId)
  return createProviderForType(supabase, fundId, providerType)
}

async function createProviderForType(
  supabase: Supabase,
  fundId: string,
  providerType: ProviderType
): Promise<{ provider: AIProvider; model: string; providerType: ProviderType }> {
  switch (providerType) {
    case 'openai': {
      const apiKey = await getOpenAIApiKey(supabase, fundId)
      const model = await getOpenAIModel(supabase, fundId)
      return { provider: new OpenAIProvider(apiKey), model, providerType: 'openai' }
    }
    case 'ollama': {
      const config = await getOllamaConfig(supabase, fundId)
      const { validateOllamaUrl } = await import('@/lib/validate-url')
      const validation = validateOllamaUrl(config.baseUrl)
      if (!validation.ok) throw new Error(validation.error)
      return {
        provider: new OpenAIProvider('ollama', validation.url),
        model: config.model,
        providerType: 'ollama',
      }
    }
    case 'openrouter': {
      const apiKey = await getOpenRouterApiKey(supabase, fundId)
      const config = await getOpenRouterConfig(supabase, fundId)
      const { validateOllamaUrl } = await import('@/lib/validate-url')
      const validation = validateOllamaUrl(config.baseUrl)
      if (!validation.ok) throw new Error(validation.error)
      return {
        provider: new OpenAIProvider(apiKey, validation.url),
        model: config.model,
        providerType: 'openrouter',
      }
    }
    default: {
      const apiKey = await getClaudeApiKey(supabase, fundId)
      const model = await getClaudeModel(supabase, fundId)
      return { provider: new AnthropicProvider(apiKey), model, providerType: 'anthropic' }
    }
  }
}

export function createProviderFromKey(apiKey: string, providerType?: ProviderType): AIProvider {
  switch (providerType) {
    case 'openai':
      return new OpenAIProvider(apiKey)
    default:
      return new AnthropicProvider(apiKey)
  }
}
