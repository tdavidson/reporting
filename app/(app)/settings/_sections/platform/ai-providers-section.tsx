'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

export function AIProvidersSection({
  hasClaudeKey, claudeModel, hasOpenAIKey, openaiModel, hasOpenRouterKey, openrouterModel, openrouterBaseUrl, defaultAIProvider, onSaved,
}: {
  hasClaudeKey: boolean
  claudeModel: string
  hasOpenAIKey: boolean
  openaiModel: string
  hasOpenRouterKey: boolean
  openrouterModel: string
  openrouterBaseUrl: string
  defaultAIProvider: string
  onSaved: () => void
}) {
  const [defaultProvider, setDefaultProvider] = useState(defaultAIProvider)
  const [savingDefault, setSavingDefault] = useState(false)
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set([defaultAIProvider]))

  useEffect(() => { setDefaultProvider(defaultAIProvider) }, [defaultAIProvider])

  const saveDefaultProvider = async (value: string) => {
    setDefaultProvider(value)
    setSavingDefault(true)
    // Open the newly selected provider section
    setOpenSections(prev => new Set(prev).add(value))
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultAIProvider: value }),
    })
    setSavingDefault(false)
    if (res.ok) onSaved()
  }

  const toggleSection = (key: string) => {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Section title="AI Providers">
      <p className="text-xs text-muted-foreground mb-3">
        Choose which AI provider to use by default for report parsing, summaries, and imports.
        Configure at least one provider below.
      </p>
      <div className="flex items-center gap-2 mb-4">
        <Label className="text-xs text-muted-foreground shrink-0">Default provider</Label>
        <select
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={defaultProvider}
          onChange={(e) => saveDefaultProvider(e.target.value)}
          disabled={savingDefault}
        >
          <option value="anthropic" disabled={!hasClaudeKey}>
            Anthropic (Claude){!hasClaudeKey ? ', no key configured' : ''}
          </option>
          <option value="openai" disabled={!hasOpenAIKey}>
            OpenAI{!hasOpenAIKey ? ', no key configured' : ''}
          </option>
          <option value="openrouter" disabled={!hasOpenRouterKey}>
            OpenRouter{!hasOpenRouterKey ? ', no key configured' : ''}
          </option>
        </select>
        {savingDefault && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
      </div>

      <div className="space-y-0 border rounded-lg overflow-hidden">
        <AIProviderDisclosure
          label="Anthropic (Claude)"
          providerKey="anthropic"
          isDefault={defaultProvider === 'anthropic'}
          isOpen={openSections.has('anthropic')}
          onToggle={() => toggleSection('anthropic')}
          hasKey={hasClaudeKey}
        >
          <ClaudeKeyContent hasKey={hasClaudeKey} currentModel={claudeModel} onSaved={onSaved} />
        </AIProviderDisclosure>
        <AIProviderDisclosure
          label="OpenAI"
          providerKey="openai"
          isDefault={defaultProvider === 'openai'}
          isOpen={openSections.has('openai')}
          onToggle={() => toggleSection('openai')}
          hasKey={hasOpenAIKey}
        >
          <OpenAIKeyContent hasKey={hasOpenAIKey} currentModel={openaiModel} onSaved={onSaved} />
        </AIProviderDisclosure>
        <AIProviderDisclosure
          label="OpenRouter"
          providerKey="openrouter"
          isDefault={defaultProvider === 'openrouter'}
          isOpen={openSections.has('openrouter')}
          onToggle={() => toggleSection('openrouter')}
          hasKey={hasOpenRouterKey}
        >
          <OpenRouterContent hasKey={hasOpenRouterKey} currentModel={openrouterModel} currentBaseUrl={openrouterBaseUrl} onSaved={onSaved} />
        </AIProviderDisclosure>
      </div>
    </Section>
  )
}

function OpenRouterContent({ hasKey, currentModel, currentBaseUrl, onSaved }: { hasKey: boolean; currentModel: string; currentBaseUrl: string; onSaved: () => void }) {
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(currentBaseUrl || 'https://openrouter.ai/api/v1')
  const [model, setModel] = useState(currentModel || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true); setError(null)
    try {
      const body: Record<string, string> = { openrouterBaseUrl: baseUrl, openrouterModel: model }
      if (key.trim()) body.openrouterApiKey = key.trim()
      const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? 'Save failed') }
      setKey(''); setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Connect OpenRouter (or any OpenAI-compatible endpoint) to use inexpensive open models — DeepSeek, GLM, Qwen, Llama. Create a key at openrouter.ai.
      </p>
      <div>
        <Label className="text-xs">API key {hasKey && <span className="text-muted-foreground">(saved — leave blank to keep)</span>}</Label>
        <Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={hasKey ? '••••••••' : 'sk-or-...'} className="h-9" />
      </div>
      <div>
        <Label className="text-xs">Base URL</Label>
        <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" className="h-9 font-mono text-xs" />
      </div>
      <div>
        <Label className="text-xs">Model</Label>
        <Input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. deepseek/deepseek-chat or z-ai/glm-4.6" className="h-9 font-mono text-xs" />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 mr-1" /> : null}
        Save
      </Button>
    </div>
  )
}

function AIProviderDisclosure({ label, providerKey, isDefault, isOpen, onToggle, hasKey, children }: {
  label: string
  providerKey: string
  isDefault: boolean
  isOpen: boolean
  onToggle: () => void
  hasKey: boolean
  children: React.ReactNode
}) {
  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors text-left"
      >
        {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="flex-1">{label}</span>
        {isDefault && (
          <span className="text-[9px] font-medium text-emerald-600 bg-emerald-500/10 rounded px-1.5 py-0.5 leading-none uppercase tracking-wider">default</span>
        )}
        {hasKey ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        ) : (
          <span className="text-[10px] text-muted-foreground">Not configured</span>
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

function ClaudeKeyContent({ hasKey, currentModel, onSaved }: { hasKey: boolean; currentModel: string; onSaved: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'valid' | 'invalid' | 'saved'>('idle')

  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(currentModel)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelsFetched, setModelsFetched] = useState(false)

  const fetchModels = useCallback(async () => {
    if (modelsFetched) return
    setModelsLoading(true)
    setModelsError(null)
    try {
      const res = await fetch('/api/claude-models')
      const data = await res.json()
      if (data.error) setModelsError(data.error)
      setModels(data.models ?? [])
      setModelsFetched(true)
    } catch {
      setModelsError('Failed to fetch models')
    } finally {
      setModelsLoading(false)
    }
  }, [modelsFetched])

  useEffect(() => {
    if (hasKey) fetchModels()
  }, [hasKey, fetchModels])

  useEffect(() => { setSelectedModel(currentModel) }, [currentModel])

  const testKey = async () => {
    setTesting(true)
    setStatus('idle')
    const res = await fetch('/api/test-claude-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: newKey }),
    })
    setTesting(false)
    setStatus(res.ok ? 'valid' : 'invalid')
  }

  const saveKey = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeApiKey: newKey }),
    })
    setSaving(false)
    if (res.ok) {
      setStatus('saved')
      setNewKey('')
      setModelsFetched(false)
      onSaved()
    }
  }

  const saveModel = async (modelId: string) => {
    setSelectedModel(modelId)
    setModelSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeModel: modelId }),
    })
    setModelSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <>
      <p className="text-xs text-muted-foreground mb-3">
        {hasKey
          ? 'A Claude API key is configured. Enter a new key below to replace it.'
          : 'No Claude API key configured. Add one to enable report parsing.'}
      </p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>API key</Label>
          <Input
            type="password"
            value={newKey}
            onChange={(e) => { setNewKey(e.target.value); setStatus('idle') }}
            placeholder="sk-ant-..."
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={testKey} disabled={!newKey.trim() || testing} variant="outline" size="sm">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
          </Button>
          <Button onClick={saveKey} disabled={!newKey.trim() || saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Update'}
          </Button>
        </div>
      </div>
      {status === 'valid' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key is valid</p>}
      {status === 'invalid' && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Key is invalid</p>}
      {status === 'saved' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key updated</p>}

      {hasKey && (
        <div className="mt-4 pt-4 border-t">
          <Label>Model</Label>
          <p className="text-xs text-muted-foreground mb-2">Choose which Claude model to use.</p>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models…</div>
          ) : modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : (
            <div className="flex items-center gap-2">
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={selectedModel} onChange={(e) => saveModel(e.target.value)} disabled={modelSaving}>
                {models.length === 0 && <option value={selectedModel}>{selectedModel}</option>}
                {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
              </select>
              {modelSaving && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function OpenAIKeyContent({ hasKey, currentModel, onSaved }: { hasKey: boolean; currentModel: string; onSaved: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'valid' | 'invalid' | 'saved'>('idle')

  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(currentModel)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelsFetched, setModelsFetched] = useState(false)

  const fetchModels = useCallback(async () => {
    if (modelsFetched) return
    setModelsLoading(true)
    setModelsError(null)
    try {
      const res = await fetch('/api/openai-models')
      const data = await res.json()
      if (data.error) setModelsError(data.error)
      setModels(data.models ?? [])
      setModelsFetched(true)
    } catch {
      setModelsError('Failed to fetch models')
    } finally {
      setModelsLoading(false)
    }
  }, [modelsFetched])

  useEffect(() => { if (hasKey) fetchModels() }, [hasKey, fetchModels])
  useEffect(() => { setSelectedModel(currentModel) }, [currentModel])

  const testKey = async () => {
    setTesting(true)
    setStatus('idle')
    const res = await fetch('/api/test-openai-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: newKey }),
    })
    setTesting(false)
    setStatus(res.ok ? 'valid' : 'invalid')
  }

  const saveKey = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openaiApiKey: newKey }),
    })
    setSaving(false)
    if (res.ok) {
      setStatus('saved')
      setNewKey('')
      setModelsFetched(false)
      onSaved()
    }
  }

  const saveModel = async (modelId: string) => {
    setSelectedModel(modelId)
    setModelSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openaiModel: modelId }),
    })
    setModelSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <>
      <p className="text-xs text-muted-foreground mb-3">
        {hasKey
          ? 'An OpenAI API key is configured. Enter a new key below to replace it.'
          : 'No OpenAI API key configured. Add one to enable OpenAI as an AI provider.'}
      </p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>API key</Label>
          <Input type="password" value={newKey} onChange={(e) => { setNewKey(e.target.value); setStatus('idle') }} placeholder="sk-..." />
        </div>
        <div className="flex gap-2">
          <Button onClick={testKey} disabled={!newKey.trim() || testing} variant="outline" size="sm">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
          </Button>
          <Button onClick={saveKey} disabled={!newKey.trim() || saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Update'}
          </Button>
        </div>
      </div>
      {status === 'valid' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key is valid</p>}
      {status === 'invalid' && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Key is invalid</p>}
      {status === 'saved' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key updated</p>}

      {hasKey && (
        <div className="mt-4 pt-4 border-t">
          <Label>Model</Label>
          <p className="text-xs text-muted-foreground mb-2">Choose which OpenAI model to use.</p>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models…</div>
          ) : modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : (
            <div className="flex items-center gap-2">
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={selectedModel} onChange={(e) => saveModel(e.target.value)} disabled={modelSaving}>
                {models.length === 0 && <option value={selectedModel}>{selectedModel}</option>}
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {modelSaving && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            </div>
          )}
        </div>
      )}
    </>
  )
}
