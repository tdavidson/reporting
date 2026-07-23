'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Loader2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

// ──────────────────────────── AI Summary Prompt ────────────────────────────

const DEFAULT_AI_SUMMARY_PROMPT = `Write a concise analyst summary covering:

1. **Current Status**, How is the company performing right now? Reference specific numbers.
2. **Trends**, What direction are the key metrics heading? Growth rates, acceleration or deceleration.
3. **Progress & Positives**, What's going well? Milestones, improvements, or strong execution.
4. **Challenges & Risks**, What concerns you? Declining metrics, missing data, red flags.
5. **Key Follow-ups**, What should the investment team ask about or monitor next?

Keep it to 2-4 short paragraphs. Be direct and analytical, not promotional. Use specific numbers. Do not use markdown formatting, write in plain prose paragraphs.`

export function AiSummaryPromptSection({ currentPrompt, onSaved }: { currentPrompt: string | null; onSaved: () => void }) {
  const [value, setValue] = useState(currentPrompt ?? DEFAULT_AI_SUMMARY_PROMPT)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const isCustomized = currentPrompt !== null

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiSummaryPrompt: value }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  const handleReset = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiSummaryPrompt: null }),
    })
    setSaving(false)
    if (res.ok) {
      setValue(DEFAULT_AI_SUMMARY_PROMPT)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="AI summary prompt">
      <p className="text-xs text-muted-foreground mb-3">
        Customize the analysis instructions for AI company summaries. Company data and metrics are provided automatically.
      </p>
      <textarea
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono leading-relaxed"
        rows={12}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-2 mt-3">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
        {isCustomized && (
          <Button onClick={handleReset} disabled={saving} variant="outline" size="sm">
            Reset to default
          </Button>
        )}
      </div>
    </Section>
  )
}

export function AiSummaryPromptReadOnly({ prompt }: { prompt: string | null }) {
  return (
    <Section title="AI summary prompt">
      <p className="text-xs text-muted-foreground mb-3">
        The analysis instructions used for AI company summaries. Contact an admin to change this.
      </p>
      <pre className="whitespace-pre-wrap text-sm bg-muted rounded-md px-3 py-2 font-mono leading-relaxed">
        {prompt || DEFAULT_AI_SUMMARY_PROMPT}
      </pre>
    </Section>
  )
}
