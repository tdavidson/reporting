'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Sparkles, Send, X, Save, Clock, Plus, Trash2, ArrowLeft, Paperclip, ArrowUp } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAnalystContext, type AnalystDomain } from '@/components/analyst-context'
import { AnalystProposals, type Proposal } from '@/components/analyst-proposals'
import { AnalystPendingActions, type StagedAction } from '@/components/analyst-pending-actions'

/**
 * The Analyst thread itself — messages, composer, history, drafted entries.
 *
 * One engine, two presentations. `panel` is the side drawer that rides along on a company, a deal
 * or a set of books; `page` is /start, where the same conversation is the whole screen. They share
 * this component rather than a second chat UI so that scope handling, staged writes and the
 * conversation list cannot drift apart between the two — the panel and the page are literally the
 * same thread, because both read the same `useAnalystContext()`.
 *
 * The drawer chrome (open/close, mobile sheet) stays in analyst-panel.tsx: it is the part that is
 * genuinely panel-only.
 */

interface Scope {
  dealId: string | null
  companyId: string | null
  vehicle: string | null
  domain: AnalystDomain | null
}

/** What the Analyst offers to do here, before anything has been asked. Ordered by how specific the
 *  scope is — a deal or company is narrower than a whole domain. */
function emptyState({ dealId, companyId, vehicle, domain }: Scope): string {
  if (dealId) return "Ask about this deal — fit against your thesis, founder background, dilution math, or comparable deals you've seen."
  if (companyId) return 'Ask about this company’s metrics, performance, documents, or portfolio position. You can also ask the AI to draft a summary.'
  if (vehicle) return `Ask about ${vehicle}’s financials or ask me to draft a journal entry for you to review. You can attach a capital-call notice, invoice, or wire confirmation and I’ll draft the entry from it.`
  if (domain === 'lps') return 'Ask about your LPs — who’s furthest behind on funding, who has the largest unfunded commitment, how DPI and TVPI look across the fund.'
  if (domain === 'diligence') return 'Ask about your diligence pipeline — what’s active, what’s stalled mid-memo, how deals break down by sector or stage.'
  return 'Ask about your portfolio, compare companies, or get high-level insights across all investments.'
}

function inputPlaceholder({ dealId, companyId, vehicle, domain }: Scope): string {
  if (dealId) return 'Ask about this deal...'
  if (companyId) return 'Ask about this company...'
  if (vehicle) return `Ask about ${vehicle}...`
  if (domain === 'lps') return 'Ask about your LPs...'
  if (domain === 'diligence') return 'Ask about your pipeline...'
  return 'Ask about your portfolio...'
}

export interface AnalystConversationProps {
  variant?: 'panel' | 'page'
  /** Shown as an × in the header. Omitted on the page variant, which has nothing to close. */
  onClose?: () => void
  /** Whether to pull focus on mount. The panel does it when it opens; the page does it always. */
  autoFocus?: boolean
  /** Page variant only: rendered above the composer while the thread is empty. */
  hero?: ReactNode
  /** Page variant only: rendered below the composer while the thread is empty. */
  belowComposer?: ReactNode
  /** Prompts that fill the composer on click. Shown only while the thread is empty. */
  suggestions?: string[]
}

export function AnalystConversation({
  variant = 'panel',
  onClose,
  autoFocus,
  hero,
  belowComposer,
  suggestions,
}: AnalystConversationProps) {
  const {
    messages,
    setMessages,
    companyId,
    dealId,
    vehicle,
    domain,
    selectedModel,
    setSelectedModel,
    availableModels,
    conversationId,
    setConversationId,
    conversations,
    loadConversations,
    loadConversation,
    startNewConversation,
    deleteConversation,
    showHistory,
    setShowHistory,
  } = useAnalystContext()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingIdx, setSavingIdx] = useState<number | null>(null)
  // Drafted entries for a given assistant message, by its index in `messages`. Deliberately not
  // persisted with the conversation — a stale draft from a reloaded thread shouldn't be
  // applicable against books that have moved on since.
  const [proposals, setProposals] = useState<Record<number, Proposal[]>>({})
  const [stagedActions, setStagedActions] = useState<Record<number, StagedAction[]>>({})
  // An attached source document (accounting scope only) — a capital-call notice, invoice, or wire
  // confirmation the Analyst drafts an entry from. It stays attached until removed, so follow-ups
  // ("now attribute it to Cranmore") still see it; the server re-extracts it each turn.
  const [doc, setDoc] = useState<{ name: string; format: string; base64: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [autoFocus])

  // The thread was reset (new conversation, or a scope change cleared it) — the drafts that went
  // with those messages go too, since they're keyed by message index.
  useEffect(() => {
    if (messages.length === 0) {
      setProposals({})
      setStagedActions({})
    }
  }, [messages.length])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    const format = file.name.split('.').pop()?.toLowerCase() ?? ''
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      setDoc({ name: file.name, format, base64: btoa(binary) })
    } catch {
      setError('Could not read that file.')
    }
  }

  async function handleSend() {
    // With a document attached, "record this" is implied — no typing required.
    if ((!input.trim() && !doc) || loading) return
    const userMessage = {
      role: 'user' as const,
      content: input.trim() || `Draft the entry that records ${doc?.name ?? 'the attached document'}.`,
    }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          companyId: companyId ?? undefined,
          dealId: dealId ?? undefined,
          vehicle: vehicle ?? undefined,
          domain: domain ?? undefined,
          document: doc ?? undefined,
          model: selectedModel ? { id: selectedModel.id, provider: selectedModel.provider } : undefined,
          conversationId: conversationId ?? undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Request failed')
        return
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
      if (Array.isArray(data.proposals) && data.proposals.length > 0) {
        setProposals(prev => ({ ...prev, [newMessages.length]: data.proposals }))
      }
      if (Array.isArray(data.stagedActions) && data.stagedActions.length > 0) {
        setStagedActions(prev => ({ ...prev, [newMessages.length]: data.stagedActions }))
      }
      // Capture conversationId from response
      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveAsSummary(idx: number) {
    const msg = messages[idx]
    if (!msg || msg.role !== 'assistant' || !companyId) return
    setSavingIdx(idx)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary_text: msg.content }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save summary')
      }
    } catch {
      setError('Failed to save summary')
    } finally {
      setSavingIdx(null)
    }
  }

  function handleShowHistory() {
    loadConversations()
    setShowHistory(true)
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  }

  const modelKey = selectedModel ? `${selectedModel.provider}:${selectedModel.id}` : 'auto'
  const scope: Scope = { dealId, companyId, vehicle, domain }
  const isPage = variant === 'page'
  // The page runs at the app's full page width so its header lines up with every other page's;
  // the thread itself still reads in a measure, centred the way Claude and ChatGPT centre theirs.
  // The panel is already narrower than the measure, so it caps nothing.
  const readableColumn = isPage ? 'mx-auto w-full max-w-readable' : ''
  // The page opens on an empty thread and is meant to look like an invitation rather than an empty
  // transcript: hero, composer, shortcuts, vertically centred. The moment there is a thread it
  // becomes an ordinary conversation.
  const heroLayout = isPage && messages.length === 0 && !showHistory && !loading

  const modelPicker = availableModels.length > 0 && !showHistory && (
    <Select
      value={modelKey}
      onValueChange={(val) => {
        if (val === 'auto') {
          setSelectedModel(null)
        } else {
          const model = availableModels.find(m => `${m.provider}:${m.id}` === val)
          if (model) setSelectedModel(model)
        }
      }}
    >
      <SelectTrigger className={isPage ? 'h-8 w-36 text-xs' : 'h-7 flex-1 min-w-0 text-[11px]'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Auto</SelectItem>
        {availableModels.map((m) => (
          <SelectItem key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  // The page header is the app's standard one — h1 + description on the left, an action group on
  // the right — so /start reads as a page rather than a panel that grew. The model picker and the
  // two conversation controls are ordinary outline actions there, matching every other page's
  // toolbar; the panel keeps its compact icon row, where a labelled button would not fit.
  const pageHeader = (
    <div className="flex items-end justify-between gap-3 mb-6">
      <div className="space-y-1 min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">Analyst</h1>
        <p className="text-sm text-muted-foreground">{emptyState(scope)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {modelPicker}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 py-2 text-muted-foreground hover:text-foreground"
          onClick={handleShowHistory}
        >
          <Clock className="h-3.5 w-3.5" />
          History
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 py-2 text-muted-foreground hover:text-foreground"
          onClick={startNewConversation}
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>
    </div>
  )

  const panelHeader = (
    <div className="flex items-center gap-2 px-4 py-3">
      <h2 className="text-base font-medium text-muted-foreground flex items-center gap-1.5 shrink-0">
        <Sparkles className="h-3.5 w-3.5" />
        Analyst
      </h2>
      {modelPicker}
      <div className="flex items-center gap-1 shrink-0 ml-auto">
        <button
          onClick={handleShowHistory}
          title="Conversation history"
          className="p-1 rounded hover:bg-muted"
        >
          <Clock className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
        <button
          onClick={startNewConversation}
          title="New conversation"
          className="p-1 rounded hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-muted hidden lg:block">
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
    </div>
  )

  const historyView = (
    <div className={`flex-1 overflow-y-auto pb-3 ${isPage ? 'px-1' : 'px-4'}`}>
     <div className={readableColumn}>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setShowHistory(false)} className="p-1 rounded hover:bg-muted">
          <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <span className="text-xs font-medium text-muted-foreground">Conversation History</span>
      </div>
      {conversations.length === 0 ? (
        <p className="text-xs text-muted-foreground">No previous conversations.</p>
      ) : (
        <div className="space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-muted ${conv.id === conversationId ? 'bg-muted' : ''}`}
              onClick={() => loadConversation(conv.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{conv.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {conv.message_count} messages &middot; {formatDate(conv.updated_at)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteConversation(conv.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10"
                title="Delete conversation"
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>
      )}
     </div>
    </div>
  )

  // Two speakers, two shapes — the convention every chat UI has converged on, and the reason the
  // "You" / "Analyst" labels are gone: the question is a right-aligned bubble that stops short of
  // the full measure, the answer is unadorned prose running the whole column. Reading a long
  // answer no longer means finding the speaker label first, and a short question no longer looks
  // like the start of one. Shared by both variants: the panel is the same thread, narrower.
  const transcript = (
    <div ref={scrollRef} className={`flex-1 overflow-y-auto ${isPage ? 'px-1 pb-6' : 'px-4 pb-3'}`}>
      <div className={`${readableColumn} ${isPage ? 'space-y-6' : 'space-y-4'}`}>
        {messages.length === 0 && !loading && !isPage && (
          <p className="text-xs text-muted-foreground">{emptyState(scope)}</p>
        )}
        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-card bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              <Markdown>{msg.content}</Markdown>
              {proposals[i] && <AnalystProposals proposals={proposals[i]} vehicle={vehicle} />}
              {stagedActions[i] && <AnalystPendingActions actions={stagedActions[i]} />}
              {companyId && (
                <button
                  onClick={() => handleSaveAsSummary(i)}
                  disabled={savingIdx === i}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <Save className="h-3 w-3" />
                  {savingIdx === i ? 'Saving...' : 'Save as Summary'}
                </button>
              )}
            </div>
          )
        )}
        {loading && <p className="text-sm text-muted-foreground animate-pulse">Thinking...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )

  const attachment = vehicle && (
    <div className="mb-2">
      {doc ? (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded border bg-accent/50 px-2 py-1 text-[11px]">
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{doc.name}</span>
          <button onClick={() => setDoc(null)} className="text-muted-foreground hover:text-foreground" aria-label="Remove document">
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent">
          <Paperclip className="h-3 w-3" />
          Attach document
          <input type="file" accept=".pdf,.docx,.xlsx,.xls,.md,.txt,.csv" onChange={handleFile} className="hidden" />
        </label>
      )}
    </div>
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /** The page composer: one filled surface with the send control tucked into its corner. */
  const largeComposer = (
    <div className="relative rounded-card border bg-muted/40 focus-within:ring-1 focus-within:ring-ring transition-colors duration-200 ease-out-soft">
      <textarea
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={inputPlaceholder(scope)}
        rows={3}
        className="w-full resize-none bg-transparent px-4 pt-4 pb-12 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
      />
      <Button
        size="icon"
        onClick={handleSend}
        disabled={(!input.trim() && !doc) || loading}
        aria-label="Send"
        className="absolute bottom-3 right-3 h-8 w-8 rounded-full"
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    </div>
  )

  const smallComposer = (
    <div className="flex gap-2">
      <textarea
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={inputPlaceholder(scope)}
        rows={2}
        className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button
        size="icon"
        onClick={handleSend}
        disabled={(!input.trim() && !doc) || loading}
        aria-label="Send"
        className="h-auto self-end px-2 py-2"
      >
        <Send className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  const suggestionChips = suggestions && suggestions.length > 0 && messages.length === 0 && (
    <div className={`flex flex-wrap justify-center gap-2 ${readableColumn}`}>
      {suggestions.map(s => (
        <button
          key={s}
          type="button"
          onClick={() => {
            setInput(s)
            inputRef.current?.focus()
          }}
          className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors duration-200 ease-out-soft hover:bg-accent hover:text-foreground"
        >
          {s}
        </button>
      ))}
    </div>
  )

  const composerBlock = (
    <div className={isPage ? readableColumn : 'px-4 py-3'}>
      {attachment}
      {isPage ? largeComposer : smallComposer}
    </div>
  )

  const storageNote = (
    <p className="text-[10px] text-muted-foreground/60 text-center mt-3 px-4 shrink-0">
      Conversations are stored to provide context and improve AI performance.
    </p>
  )

  if (isPage) {
    return (
      <div className="flex flex-col h-full">
        {pageHeader}
        {showHistory ? (
          <div className="flex flex-col flex-1 min-h-0">{historyView}</div>
        ) : heroLayout ? (
          <div className={`flex flex-1 flex-col justify-center gap-8 py-10 ${readableColumn}`}>
            {hero}
            <div className="space-y-4">
              {composerBlock}
              {suggestionChips}
            </div>
            {belowComposer}
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            {transcript}
            {composerBlock}
          </div>
        )}
        {storageNote}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="max-h-[80vh] lg:max-h-[calc(100vh-6rem)] rounded-lg border bg-card flex flex-col flex-1">
        {panelHeader}
        {showHistory ? historyView : (
          <>
            {transcript}
            {composerBlock}
          </>
        )}
      </div>
      {storageNote}
    </div>
  )
}
