import { Handshake } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function InteractionsExplainerPage() {
  return (
    <ExplainerContent
      title="Interactions"
      icon={Handshake}
      screenshotSrc="/screenshots/interactions.png"
      screenshotLabel="Interactions"
    >
      <p className="text-muted-foreground">
        Interactions gives GPs a searchable log of all conversations and introductions with portfolio
        companies. When a GP BCCs the fund&apos;s inbound email address on a conversation, the system
        automatically detects that the sender is a fund member, classifies the email as a CRM interaction
        (not a metrics report), and uses AI to extract a summary and identify any introductions.
      </p>
      <p className="text-muted-foreground">
        The classification is automatic: emails from fund members are routed to the interaction pipeline,
        while emails from authorized senders (portfolio companies) continue through the existing metrics
        extraction pipeline. No manual tagging is required.
      </p>
      <p className="text-muted-foreground">
        For each interaction, the AI generates a short summary, detects whether the email contains an
        introduction between parties, and extracts the names and context of anyone being introduced.
        Interactions are linked to portfolio companies when possible, so you can see all conversations
        related to a specific company.
      </p>
      <p className="text-muted-foreground">
        The Interactions page shows all logged interactions across the fund, with filter tabs
        for <strong>All</strong> and <strong>Intros</strong>. Each entry shows the date, linked company,
        subject line, AI summary, and an intro badge when introductions were detected. Click the intro
        details to expand and see the names, emails, and context of introduced contacts.
      </p>
      <p className="text-muted-foreground">
        On each company&apos;s detail page, a <strong>Recent Interactions</strong> section shows the
        latest interactions for that company, with intro entries highlighted in a distinct style. A
        &ldquo;View all&rdquo; link takes you to the full interactions list filtered to that company.
      </p>
      <p className="text-muted-foreground">
        The fund&apos;s inbound email address is displayed at the top of the Interactions page for
        easy reference and can be copied with one click. Simply BCC this address on any email conversation
        you want to log.
      </p>
    </ExplainerContent>
  )
}
