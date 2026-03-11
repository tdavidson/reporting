'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

export function SubscriptionInquiryButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', fundName: '', message: '' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.fundName.trim() || !form.message.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          subject: `Subscription inquiry: ${form.fundName.trim()}`,
          message: `Fund name: ${form.fundName.trim()}\n\n${form.message.trim() || '(No additional message)'}`,
        }),
      })
      if (res.ok) {
        setSent(true)
      } else {
        // Fallback: open mailto
        const subject = encodeURIComponent(`Subscription inquiry: ${form.fundName.trim()}`)
        const body = encodeURIComponent(`Name: ${form.name.trim()}\nEmail: ${form.email.trim()}\nFund: ${form.fundName.trim()}\n\n${form.message.trim()}`)
        window.open(`mailto:taylor@hemrock.com?subject=${subject}&body=${body}`, '_blank')
        setSent(true)
      }
    } catch {
      const subject = encodeURIComponent(`Subscription inquiry: ${form.fundName.trim()}`)
      const body = encodeURIComponent(`Name: ${form.name.trim()}\nEmail: ${form.email.trim()}\nFund: ${form.fundName.trim()}\n\n${form.message.trim()}`)
      window.open(`mailto:taylor@hemrock.com?subject=${subject}&body=${body}`, '_blank')
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className={className} onClick={() => { setOpen(true); setSent(false) }}>
        {children}
      </Button>
      <Dialog open={open} onOpenChange={o => { if (!o) setOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          {sent ? (
            <div className="py-6 text-center">
              <p className="text-sm font-medium mb-1 text-green-600 dark:text-green-400">Thanks for your interest!</p>
              <p className="text-sm text-green-600/80 dark:text-green-400/80">We&apos;ll be in touch shortly.</p>
            </div>
          ) : (
            <>
            <DialogHeader>
              <DialogTitle>Request Access</DialogTitle>
              <DialogDescription>
                Tell us about your fund and we&apos;ll set you up with the best solution.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-input rounded px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground mt-1"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full border border-input rounded px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground mt-1"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Fund Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={form.fundName}
                  onChange={e => setForm(f => ({ ...f, fundName: e.target.value }))}
                  className="w-full border border-input rounded px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground mt-1"
                  placeholder="Your fund or firm name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Message <span className="text-red-500">*</span></label>
                <textarea
                  required
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  rows={3}
                  className="w-full border border-input rounded px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground mt-1"
                  placeholder="Anything else you'd like us to know"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={sending || !form.name.trim() || !form.email.trim() || !form.fundName.trim()}>
                  {sending ? 'Sending...' : 'Submit'}
                </Button>
              </DialogFooter>
            </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
