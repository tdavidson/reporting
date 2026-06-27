// cacheControl marks a block as a prompt-cache breakpoint (Anthropic ephemeral
// cache). Set it on a large, byte-identical leading block that's re-sent across
// many calls (e.g. shared data-room evidence across checklist batches) so those
// calls become cache reads. Ignored by providers without prompt caching.
export interface TextBlock { type: 'text'; text: string; cacheControl?: boolean }
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
  /** Non-cached input tokens (Anthropic reports cached input separately). */
  inputTokens: number
  outputTokens: number
  /** Tokens served from the prompt cache (billed ~0.1x input). */
  cacheReadTokens?: number
  /** Tokens written to the prompt cache (billed ~1.25x input). */
  cacheCreationTokens?: number
}

export interface AIResult {
  text: string
  usage: TokenUsage
  truncated: boolean
  /**
   * Number of server-side web searches the model actually performed. Only
   * meaningful when the request was made with enableWebSearch. 0 means the
   * tool was attached but the model chose not to search (or couldn't).
   */
  webSearchCount?: number
  /**
   * URLs the model cited via the web_search tool. Anthropic attaches citations
   * as metadata on text blocks; when the model writes JSON output it often
   * doesn't echo the URL into the JSON, so we surface them here for callers
   * that want to render or merge them. Deduped across blocks.
   */
  webSearchCitations?: Array<{ url: string; title: string }>
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
