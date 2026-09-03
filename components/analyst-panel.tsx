'use client'

import { useAnalystContext } from '@/components/analyst-context'
import { MobileDrawerPanel } from '@/components/mobile-drawer-panel'
import { AnalystConversation } from '@/components/analyst-conversation'

/**
 * The Analyst as a side panel: drawer chrome around the shared conversation.
 *
 * Everything that is not open/close lives in AnalystConversation, which /start renders as a full
 * page. Same context, same thread — the panel is a presentation, not a second chat.
 */
export function AnalystPanel() {
  const { open, close } = useAnalystContext()

  return (
    <MobileDrawerPanel open={open} onOpenChange={(isOpen) => { if (!isOpen) close() }}>
      <AnalystConversation variant="panel" onClose={close} autoFocus={open} />
    </MobileDrawerPanel>
  )
}
