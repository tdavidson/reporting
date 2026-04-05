import OpenAI from 'openai'
import type { AIProvider, AIModel, AIResult, CreateMessageParams, CreateChatParams, ContentBlock } from './types'

export class OpenAIProvider implements AIProvider {
  private client: OpenAI
  private customBaseURL: boolean
  private baseURL: string | undefined

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
    this.customBaseURL = !!baseURL
    this.baseURL = baseURL
  }

  private getOllamaTagsUrl(): string {
    const base = (this.baseURL ?? '').replace(/\/v1\/?$/, '')
    return base + '/api/tags'
  }

  async createMessage(params: CreateMessageParams): Promise<AIResult> {
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

    return {
      text: response.choices[0]?.message?.content ?? '',
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      truncated: response.choices[0]?.finish_reason === 'length',
    }
  }

  async createChat(params: CreateChatParams): Promise<AIResult> {
    const messages: OpenAI.ChatCompletionMessageParam[] = []

    if (params.system) {
      messages.push({ role: 'system', content: params.system })
    }

    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content })
    }

    const response = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
    })

    return {
      text: response.choices[0]?.message?.content ?? '',
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      truncated: response.choices[0]?.finish_reason === 'length',
    }
  }

  async testConnection(): Promise<void> {
    if (this.customBaseURL) {
      // Ollama uses /api/tags, not /models
      const res = await fetch(this.getOllamaTagsUrl())
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
      const data = await res.json()
      if (!data.models || data.models.length === 0) throw new Error('No models available')
      return
    }
    await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    })
  }

  async listModels(): Promise<AIModel[]> {
    if (this.customBaseURL) {
      // Ollama uses /api/tags, not /models
      const res = await fetch(this.getOllamaTagsUrl())
      const data = await res.json()
      return (data.models ?? []).map((m: { name: string }) => ({ id: m.name, name: m.name }))
    }

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
