'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, X, Save, Clock, Plus, Trash2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAnalystContext } from '@/components/analyst-context'

export function AnalystPanel() {
  const {
    open,
    close,
    messages,
    setMessages,
    companyId,
    selectedModel,
    setSelectedModel,
    availableModels,
    fundName,
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  if (!open) return null

  async function handleSend() {
    if (!input.trim() || loading) return
    const userMessage = { role: 'user' as const, content: input.trim() }
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

  return (
    <div className="w-full lg:w-[340px] shrink-0 lg:sticky top-4">
    <div className="max-h-[80vh] lg:max-h-[calc(100vh-6rem)] rounded-lg border bg-card flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 flex items-center gap-2">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
            Analyst
          </h2>
          {availableModels.length > 0 && !showHistory && (
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
              <SelectTrigger className="h-7 text-[11px] flex-1 min-w-0">
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
          )}
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
            <button onClick={close} className="p-1 rounded hover:bg-muted">
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>
        </div>

        {showHistory ? (
          /* History view */
          <div className="flex-1 overflow-y-auto px-4 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 rounded hover:bg-muted"
              >
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
                    className={`group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-muted ${
                      conv.id === conversationId ? 'bg-muted' : ''
                    }`}
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
        ) : (
          <>
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
              {messages.length === 0 && !loading && (
                <p className="text-xs text-muted-foreground">
                  {companyId
                    ? "Ask about this company\u2019s metrics, performance, documents, or portfolio position. You can also ask the AI to draft a summary."
                    : 'Ask about your portfolio, compare companies, or get high-level insights across all investments.'}
                </p>
              )}
              {messages.map((msg, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium">
                      {msg.role === 'user' ? 'You' : 'Analyst'}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.role === 'assistant' && companyId && (
                    <button
                      onClick={() => handleSaveAsSummary(i)}
                      disabled={savingIdx === i}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      <Save className="h-3 w-3" />
                      {savingIdx === i ? 'Saving...' : 'Save as Summary'}
                    </button>
                  )}
                </div>
              ))}
              {loading && (
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium">Analyst</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Thinking...</p>
                </div>
              )}
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>

            {/* Input */}
            <div className="px-4 py-3">
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder={companyId ? 'Ask about this company...' : 'Ask about your portfolio...'}
                  rows={2}
                  className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="h-auto self-end px-2 py-2"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground/60 text-center mt-3 px-4">
        Conversations are stored to provide context and improve AI performance.
      </p>
    </div>
  )
}
