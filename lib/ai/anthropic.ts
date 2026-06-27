import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, AIModel, AIResult, CreateMessageParams, CreateChatParams, ContentBlock } from './types'

export class AnthropicProvider implements AIProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async createMessage(params: CreateMessageParams): Promise<AIResult> {
    const content = typeof params.content === 'string'
      ? params.content
      : toAnthropicContent(params.content)

    const tools = params.enableWebSearch
      ? [{
          type: 'web_search_20250305' as const,
          name: 'web_search',
          max_uses: params.webSearchMaxUses ?? 5,
        }]
      : undefined

    // Prompt caching: mark the (large, reused) system prompt as ephemeral. The
    // same system prompt — schemas, guidance, instructions — is resent across
    // every batched call within a stage (per-doc ingest, draft fills, checklist,
    // scoring), so caching it turns those into cache reads (~5 min TTL) instead
    // of re-billing the full prefix each time. One breakpoint on system also
    // caches the tools block ahead of it. Below the model's min cacheable size
    // the marker is simply ignored, so it's always safe to set.
    const systemBlocks = cacheableSystem(params.system)

    // Use the streaming endpoint via the SDK's `.stream()` helper. Anthropic
    // requires streaming for any request that may take longer than 10 minutes
    // (large max_tokens + slow models like Opus, or long web-search runs).
    // `finalMessage()` reassembles the complete response so the rest of the
    // pipeline sees the same shape as the legacy non-streaming call.
    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens,
      ...(systemBlocks ? { system: systemBlocks } : {}),
      ...(tools ? { tools: tools as any } : {}),
      messages: [{ role: 'user', content }],
    })
    const response = await stream.finalMessage()

    // When web search runs server-side, the response interleaves
    // server_tool_use + web_search_tool_result blocks with text blocks. We
    // concatenate just the text — the model is instructed to bake any URLs
    // it relies on into the JSON output, so we don't need the tool results.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    // Count actual web searches performed so callers can tell "tool attached
    // but model didn't search" from "model searched but found nothing".
    const webSearchCount = params.enableWebSearch
      ? response.content.filter((b: any) => b.type === 'web_search_tool_result').length
      : undefined

    // Anthropic attaches citations to text blocks as metadata (not in the text
    // itself). When the model produces JSON output, it usually doesn't echo
    // the citation URL into a JSON sources field — so we expose them here for
    // callers to merge in. Deduped by URL across blocks.
    let webSearchCitations: Array<{ url: string; title: string }> | undefined
    if (params.enableWebSearch) {
      const seen = new Set<string>()
      const out: Array<{ url: string; title: string }> = []
      for (const block of response.content) {
        if (block.type !== 'text') continue
        const cites = (block as any).citations as Array<{ type?: string; url?: string; title?: string }> | undefined
        if (!Array.isArray(cites)) continue
        for (const c of cites) {
          if (!c || typeof c.url !== 'string' || !c.url || seen.has(c.url)) continue
          seen.add(c.url)
          out.push({ url: c.url, title: typeof c.title === 'string' ? c.title : c.url })
        }
      }
      webSearchCitations = out
    }

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      truncated: response.stop_reason === 'max_tokens',
      webSearchCount,
      webSearchCitations,
    }
  }

  async createChat(params: CreateChatParams): Promise<AIResult> {
    const messages = params.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const systemBlocks = cacheableSystem(params.system)

    // Same streaming-required reason as createMessage above.
    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens,
      ...(systemBlocks ? { system: systemBlocks } : {}),
      messages,
    })
    const response = await stream.finalMessage()

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      truncated: response.stop_reason === 'max_tokens',
    }
  }

  async testConnection(): Promise<void> {
    await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    })
  }

  async listModels(): Promise<AIModel[]> {
    const list = await this.client.models.list({ limit: 100 })

    return list.data
      .filter(m => m.type === 'model')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map(m => ({ id: m.id, name: m.display_name }))
  }
}

// Turn a system-prompt string into a single cached text block. Returns
// undefined for empty/missing prompts so we don't send an empty system param.
function cacheableSystem(system: string | undefined): Anthropic.TextBlockParam[] | undefined {
  if (!system) return undefined
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
}

function toAnthropicContent(blocks: ContentBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.map(block => {
    switch (block.type) {
      case 'text':
        return {
          type: 'text' as const,
          text: block.text,
          ...(block.cacheControl ? { cache_control: { type: 'ephemeral' as const } } : {}),
        }
      case 'document':
        return {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: block.mediaType as 'application/pdf',
            data: block.data,
          },
        }
      case 'image':
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: block.mediaType as Anthropic.Base64ImageSource['media_type'],
            data: block.data,
          },
        }
    }
  })
}
