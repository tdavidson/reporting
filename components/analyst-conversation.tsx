'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Sparkles, Send, X, Save, Clock, Plus, Trash2, ArrowLeft, Paperclip, ArrowUp, Copy, Check, ChevronDown, Upload } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

const ACCEPTED_DOCUMENTS = '.pdf,.docx,.xlsx,.xls,.md,.txt,.csv'
const ACCEPTED_FORMATS = new Set(ACCEPTED_DOCUMENTS.split(',').map(x => x.slice(1)))
/** The row of controls under an answer: quiet icons that only assert themselves on hover. */
const actionIconClass = 'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'

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
    ensureModels,
  } = useAnalystContext()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingIdx, setSavingIdx] = useState<number | null>(null)
  // Which answer was just copied, so its button can say so for a moment.
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  // Drafted entries for a given assistant message, by its index in `messages`. Deliberately not
  // persisted with the conversation — a stale draft from a reloaded thread shouldn't be
  // applicable against books that have moved on since.
  const [proposals, setProposals] = useState<Record<number, Proposal[]>>({})
  const [stagedActions, setStagedActions] = useState<Record<number, StagedAction[]>>({})
  // An attached source document — in accounting scope a capital-call notice or invoice the Analyst
  // drafts an entry from, anywhere else plain source material for the question. It stays attached
  // until removed, so follow-ups ("now attribute it to Cranmore") still see it; the server
  // re-extracts it each turn.
  const [doc, setDoc] = useState<{ name: string; format: string; base64: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [autoFocus])

  // The picker can't offer models it never asked for. The panel used to be the only thing that
  // triggered the fetch, which left /start with no picker at all.
  useEffect(() => { void ensureModels() }, [ensureModels])

  // The composer grows with what's typed, up to a cap past which it scrolls. The panel starts one
  // line tall; the page starts at three rows (its `rows` attribute is the floor, since an empty
  // textarea's scrollHeight is its box height), so the landing page reads as a place to write.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, variant === 'page' ? 320 : 160)}px`
  }, [input, variant, doc])

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

  // One reader for both ways a file arrives — the picker and a drop onto the composer. The picker
  // already filters by `accept`; a drop does not, so the format is checked here for both.
  async function readFile(file: File) {
    setError(null)
    const format = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ACCEPTED_FORMATS.has(format)) {
      setError(`Can't attach .${format || '?'} files. Use PDF, Word, Excel, Markdown, CSV or plain text.`)
      return
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      setDoc({ name: file.name, format, base64: btoa(binary) })
      setAttachOpen(false)
    } catch {
      setError('Could not read that file.')
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await readFile(file)
  }

  // Drag-and-drop onto the page composer. The counter is the standard fix for dragenter/dragleave
  // firing on every child crossed: the highlight lifts only when the pointer leaves the whole zone.
  const [dragDepth, setDragDepth] = useState(0)
  const dragging = dragDepth > 0
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragDepth(d => d + 1)
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragDepth(d => Math.max(0, d - 1))
  }
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragDepth(0)
    const file = e.dataTransfer.files?.[0]
    if (file) void readFile(file)
  }

  async function handleCopy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(i)
      setTimeout(() => setCopiedIdx(current => (current === i ? null : current)), 1500)
    } catch {
      setError('Could not copy to the clipboard.')
    }
  }

  // Per-answer meta (when it was asked, how long the answer took, which model answered), keyed by
  // the answer's index like `proposals`. Not persisted: a reloaded conversation shows none.
  const [turnMeta, setTurnMeta] = useState<Record<number, { at: number; ms: number; model: string | null }>>({})
  useEffect(() => {
    if (messages.length === 0) setTurnMeta({})
  }, [messages.length])

  async function handleSend() {
    // With a document attached, "record this" is implied — no typing required.
    if ((!input.trim() && !doc) || loading) return
    const startedAt = Date.now()
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
      setTurnMeta(prev => ({
        ...prev,
        [newMessages.length]: { at: startedAt, ms: Date.now() - startedAt, model: modelLabel(data.model) },
      }))
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
  // Two widths, doing two different jobs. The THREAD is the wider one: it sets how far a
  // right-aligned question can travel from the left edge, and that travel is the whole reason a
  // question is scannable at a glance. The ANSWER stays at the reading measure inside it, so the
  // gap between the two shapes is real rather than a few pixels of inset. The panel is narrower
  // than either, so it caps nothing.
  const threadColumn = isPage ? 'mx-auto w-full max-w-3xl' : ''
  const answerColumn = isPage ? 'max-w-readable' : ''
  // The page opens on an empty thread and is meant to look like an invitation rather than an empty
  // transcript: hero, composer, shortcuts, vertically centred. The moment there is a thread it
  // becomes an ordinary conversation.
  const heroLayout = isPage && messages.length === 0 && !showHistory && !loading

  /** Human name for a model the server reports it used; falls back to the raw id. */
  function modelLabel(model: { id?: string; provider?: string } | null | undefined): string | null {
    if (!model?.id) return null
    return availableModels.find(m => m.id === model.id && (!model.provider || m.provider === model.provider))?.name ?? model.id
  }
  const firstTurn = Object.values(turnMeta).sort((a, b) => a.at - b.at)[0]
  const threadMeta = isPage && messages.length > 0 && (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{new Date(firstTurn?.at ?? Date.now()).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
      <span aria-hidden>·</span>
      <span>{selectedModel ? selectedModel.name : `Auto${firstTurn?.model ? ` (${firstTurn.model})` : ''}`}</span>
    </div>
  )

  /** One picker, three faces: the panel header is a full select; the row under an answer and the
   *  page composer's control row are quiet text triggers — the model's name and a small chevron —
   *  because no glyph says "which model" on its own, and the name is the thing you are choosing
   *  anyway. The composer face is a step larger so it sits level with the + and send controls. */
  function renderModelPicker(face: 'labelled' | 'icon' | 'composer') {
    if (availableModels.length === 0 || showHistory) return null
    return (
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
        {face === 'icon' || face === 'composer' ? (
          <SelectTrigger
            aria-label="Switch model"
            title="Switch model"
            className={face === 'composer'
              ? 'flex h-8 w-auto items-center gap-1 rounded-md border-0 px-2 text-sm text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground [&>svg:last-child]:hidden'
              : `${actionIconClass} w-auto gap-1 border-0 px-2 text-xs shadow-none [&>svg:last-child]:hidden`}
          >
            <span>{selectedModel ? selectedModel.name : 'Auto'}</span>
            <ChevronDown className={face === 'composer' ? 'h-3.5 w-3.5 opacity-60' : 'h-3 w-3 opacity-60'} />
          </SelectTrigger>
        ) : (
          <SelectTrigger className="h-7 flex-1 min-w-0 text-[11px]">
            <SelectValue />
          </SelectTrigger>
        )}
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
  }

  // The page has no header at all. On an empty thread there is nothing to copy, switch, or go
  // back to, and a toolbar floating above "What would you like to do?" was the first thing the
  // eye landed on. Once there is a thread, the controls live under each answer, next to the
  // thing they act on. The panel keeps its compact header: it has a title and a close button to
  // house anyway, and its answers are too narrow to carry a full row.
  const panelHeader = (
    <div className="flex items-center gap-2 px-4 py-3">
      <h2 className="text-base font-medium text-muted-foreground flex items-center gap-1.5 shrink-0">
        <Sparkles className="h-3.5 w-3.5" />
        Analyst
      </h2>
      {renderModelPicker('labelled')}
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
     <div className={threadColumn}>
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
      <div className={`${threadColumn} ${isPage ? 'space-y-6' : 'space-y-4'}`}>
        {messages.length === 0 && !loading && !isPage && (
          <p className="text-xs text-muted-foreground">{emptyState(scope)}</p>
        )}
        {threadMeta}
        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-card bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={i} className={`space-y-2 ${answerColumn}`}>
              {turnMeta[i] && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {(turnMeta[i].ms / 1000).toFixed(1)}s{turnMeta[i].model ? ` · ${turnMeta[i].model}` : ''}
                </p>
              )}
              <Markdown>{msg.content}</Markdown>
              {proposals[i] && <AnalystProposals proposals={proposals[i]} vehicle={vehicle} />}
              {stagedActions[i] && <AnalystPendingActions actions={stagedActions[i]} />}
              <div className="flex items-center gap-0.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleCopy(i, msg.content)}
                  title={copiedIdx === i ? 'Copied' : 'Copy'}
                  aria-label="Copy answer"
                  className={actionIconClass}
                >
                  {copiedIdx === i ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                {isPage && (
                  <>
                    {renderModelPicker('icon')}
                    <button type="button" onClick={startNewConversation} title="New conversation" aria-label="New conversation" className={actionIconClass}>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={handleShowHistory} title="Conversation history" aria-label="Conversation history" className={actionIconClass}>
                      <Clock className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                {companyId && (
                  <button
                    type="button"
                    onClick={() => handleSaveAsSummary(i)}
                    disabled={savingIdx === i}
                    title="Save as Summary"
                    aria-label="Save as Summary"
                    className={actionIconClass}
                  >
                    <Save className={`h-3.5 w-3.5 ${savingIdx === i ? 'animate-pulse' : ''}`} />
                  </button>
                )}
              </div>
            </div>
          )
        )}
        {loading && <p className="text-sm text-muted-foreground animate-pulse">Thinking...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )

  const fileInput = <input type="file" accept={ACCEPTED_DOCUMENTS} onChange={handleFile} className="hidden" />

  const attachedChip = doc && (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border bg-accent/50 px-2 py-1 text-[11px]">
      <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{doc.name}</span>
      <button onClick={() => setDoc(null)} className="text-muted-foreground hover:text-foreground" aria-label="Remove document">
        <X className="h-3 w-3" />
      </button>
    </span>
  )

  // The panel's attach control is the chip itself; the page's is the + inside the composer, which
  // opens a dialog so the accepted formats and size limit are said once, up front, rather than
  // discovered from a 400 after the upload.
  const attachment = (
    <div className="mb-2 empty:hidden">
      {doc ? attachedChip : !isPage && (
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent">
          <Paperclip className="h-3 w-3" />
          Attach document
          {fileInput}
        </label>
      )}
    </div>
  )

  const attachDialog = (
    <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Attach a document</DialogTitle>
          <DialogDescription>
            PDF, Word, Excel, Markdown, CSV or plain text, up to 10MB. It stays attached to this
            conversation until you remove it.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors duration-200 ease-out-soft hover:bg-accent hover:text-foreground">
          <Upload className="h-5 w-5" />
          Choose a file
          {fileInput}
        </label>
      </DialogContent>
    </Dialog>
  )

  // Both textareas are 16px below md and 14px above. iOS Safari zooms the whole page into any
  // field smaller than 16px on focus, and does not zoom back out: the composer grew past the
  // screen edge, the send button slid off it, and the answer came back at the same magnification.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /** The page composer: one filled surface, the textarea running its full width and a control row
   *  beneath it — attach on the left, model and send on the right — so the text never has to
   *  route around a button. Two rows tall at rest (the row below makes up the third), and the
   *  effect above grows it as the question does. It is also the drop zone: a file dragged over it
   *  attaches exactly as the + would, and the dashed ring says so while it hovers. */
  const largeComposer = (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative rounded-card border bg-muted/40 focus-within:ring-1 focus-within:ring-ring transition-colors duration-200 ease-out-soft ${dragging ? 'border-dashed border-ring bg-accent' : ''}`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-card text-sm text-muted-foreground">
          <Upload className="h-4 w-4" />
          Drop to attach
        </div>
      )}
      <textarea
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={inputPlaceholder(scope)}
        rows={2}
        className="block w-full resize-none overflow-y-auto bg-transparent px-4 pb-1 pt-3 text-base leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none md:text-sm"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <button
          type="button"
          onClick={() => setAttachOpen(true)}
          title={doc ? `Attached: ${doc.name}` : 'Attach a document'}
          aria-label="Attach a document"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="ml-auto flex items-center gap-3">
          {renderModelPicker('composer')}
          <Button
            size="icon"
            onClick={handleSend}
            disabled={(!input.trim() && !doc) || loading}
            aria-label="Send"
            className="h-8 w-8 rounded-full"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
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
        rows={1}
        className="block w-full resize-none overflow-y-auto rounded-md border bg-transparent px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
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
    <div className={`flex flex-wrap justify-center gap-2 ${threadColumn}`}>
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

  // The hero has no toolbar, so this is how past conversations are reached before the first
  // answer puts the history icon under it. A text link, not a button: it is a way out of the
  // page, not one of the things the page invites you to do.
  const historyLink = (
    <p className="text-center">
      <button
        type="button"
        onClick={handleShowHistory}
        className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        See conversation history
      </button>
    </p>
  )

  const composerBlock = (
    <div className={isPage ? threadColumn : 'px-4 py-3'}>
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
        {attachDialog}
        {showHistory ? (
          <div className="flex flex-col flex-1 min-h-0">{historyView}</div>
        ) : heroLayout ? (
          <div className={`flex flex-1 flex-col gap-6 px-2 pt-14 md:px-0 md:pt-6 ${threadColumn}`}>
            {hero}
            <div className="space-y-4">
              {composerBlock}
              {suggestionChips}
              {historyLink}
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
