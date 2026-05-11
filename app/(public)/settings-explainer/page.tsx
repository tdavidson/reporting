import { ogMetadata } from '@/lib/og-metadata'
import { Settings } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'Settings',
  description: 'Configure AI providers, email integrations, file storage, team members, and platform preferences.',
})

export default function SettingsExplainerPage() {
  return (
    <ExplainerContent
      title="Settings"
      icon={Settings}
      screenshotSrc="/screenshots/settings.png"
      screenshotLabel="Settings"
    >
      <p className="text-muted-foreground">
        Settings is where the platform is configured. Most settings are admin-only, but all users
        can update their display name (shown on notes and activity) and enable two-factor
        authentication for additional account security.
      </p>
      <p className="text-muted-foreground">
        For admins, Settings covers the full platform configuration: AI provider keys and model
        selection (Anthropic, OpenAI, Google Gemini, and/or Ollama for local models), the default AI provider
        for the fund, feature visibility controls, inbound email setup (Postmark or Mailgun), outbound email
        providers (Gmail, Resend, Postmark, or Mailgun), file storage connections (Google Drive or Dropbox),
        the AI summary prompt, and email templates for reporting asks.
      </p>
      <p className="text-muted-foreground">
        Admins also manage the authorized senders list (email addresses allowed to submit reports
        via the inbound pipeline), team members and their roles, and an allow-list that controls
        who can sign up for the platform. A danger zone at the bottom allows admins to permanently
        delete all fund data if needed.
      </p>
      <p className="text-muted-foreground">
        For detailed technical setup instructions - configuring Supabase, environment
        variables, encryption keys, email providers, deployment, and more - see the{' '}
        <a
          href="https://github.com/tdavidson/reporting"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-4 hover:text-foreground/80"
        >
          README on GitHub
        </a>
        . It is the best reference for technical implementation details.
      </p>
    </ExplainerContent>
  )
}
