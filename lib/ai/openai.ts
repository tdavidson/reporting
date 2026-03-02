import OpenAI from 'openai'
import type { AIProvider, AIModel, CreateMessageParams, ContentBlock } from './types'

export class OpenAIProvider implements AIProvider {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async createMessage(params: CreateMessageParams): Promise<string> {
    const userContent = typeof params.content === 'string'
      ? params.content
      : toOpenAIContent(params.content)

    const messages: OpenAI.ChatCompletionMessageParam[] = []

    if (params.system) {
      messages.push({ role: 'system', content: params.system })
    }

    messages.push({ role: 'user', content: userContent })

    const response = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
    })

    return response.choices[0]?.message?.content ?? ''
  }

  async testConnection(): Promise<void> {
    await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    })
  }

  async listModels(): Promise<AIModel[]> {
    const list = await this.client.models.list()
    const models: OpenAI.Model[] = []
    for await (const model of list) {
      models.push(model)
    }

    return models
      .filter(m => /gpt|o1|o3|o4/.test(m.id))
      .sort((a, b) => b.created - a.created)
      .map(m => ({ id: m.id, name: m.id }))
  }
}

function toOpenAIContent(blocks: ContentBlock[]): OpenAI.ChatCompletionContentPart[] {
  const parts: OpenAI.ChatCompletionContentPart[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text })
        break
      case 'image':
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${block.mediaType};base64,${block.data}` },
        })
        break
      case 'document':
        // PDFs are not natively supported by OpenAI — extracted text is already
        // included in the text content blocks, so we skip document blocks.
        break
    }
  }

  return parts
}
