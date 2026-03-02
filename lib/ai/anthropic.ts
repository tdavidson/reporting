import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, AIModel, CreateMessageParams, ContentBlock } from './types'

export class AnthropicProvider implements AIProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async createMessage(params: CreateMessageParams): Promise<string> {
    const content = typeof params.content === 'string'
      ? params.content
      : toAnthropicContent(params.content)

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      ...(params.system ? { system: params.system } : {}),
      messages: [{ role: 'user', content }],
    })

    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
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

function toAnthropicContent(blocks: ContentBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.map(block => {
    switch (block.type) {
      case 'text':
        return { type: 'text' as const, text: block.text }
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
