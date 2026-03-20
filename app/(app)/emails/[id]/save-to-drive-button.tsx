'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { HardDrive, Check, AlertCircle } from 'lucide-react'
import { Loader2 } from 'lucide-react'

export function SaveToDriveButton({ emailId }: { emailId: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<'success' | 'error' | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setResult(null)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/emails/save-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId }),
      })
      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Server error (${res.status})`)
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      if (data.failed > 0) throw new Error(data.errors?.[0] ?? 'Failed to save')
      if (data.errors?.length > 0) {
        setResult('success')
        setErrorMsg(data.errors.join('; '))
      } else {
        setResult('success')
      }
    } catch (err) {
      setResult('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={loading || result === 'success'}
        className="gap-1.5 shrink-0"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : result === 'success' ? (
          <Check className="h-4 w-4" />
        ) : (
          <HardDrive className="h-4 w-4" />
        )}
        {result === 'success' ? 'Saved' : 'Save to storage'}
      </Button>
      {result === 'error' && errorMsg && (
        <span className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {errorMsg}
        </span>
      )}
    </div>
  )
}
