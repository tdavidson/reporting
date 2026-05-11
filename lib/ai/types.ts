export interface TextBlock { type: 'text'; text: string }
export interface DocumentBlock { type: 'document'; mediaType: string; data: string }
export interface ImageBlock { type: 'image'; mediaType: string; data: string }

export type ContentBlock = TextBlock | DocumentBlock | ImageBlock
export type MessageContent = string | ContentBlock[]

export interface CreateMessageParams {
  model: string
  maxTokens: number
  system?: string
  content: MessageContent
  /**
   * Enable provider-side web search. Only honored by Anthropic right now; other
   * providers ignore the flag (the prompt fallback handles graceful degradation).
   * Adds Anthropic's web_search billing (~$10 / 1,000 searches) on top of tokens.
   */
  enableWebSearch?: boolean
  /**
   * Maximum web search invocations per request. Only used when enableWebSearch
   * is true. Defaults to 5 if omitted.
   */
  webSearchMaxUses?: number
}

export interface AIModel { id: string; name: string }

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface AIResult {
  text: string
  usage: TokenUsage
  truncated: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CreateChatParams {
  model: string
  maxTokens: number
  system?: string
  messages: ChatMessage[]
}

export interface AIProvider {
  createMessage(params: CreateMessageParams): Promise<AIResult>
  createChat(params: CreateChatParams): Promise<AIResult>
  testConnection(): Promise<void>
  listModels(): Promise<AIModel[]>
}
