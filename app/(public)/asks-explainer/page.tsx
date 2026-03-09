import { Send } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function AsksExplainerPage() {
  return (
    <ExplainerContent
      title="Asks"
      icon={Send}
      screenshotSrc="/screenshots/asks.png"
      screenshotLabel="Asks"
    >
      <p className="text-muted-foreground">
        Asks lets you send reporting request emails to your portfolio companies. This is how you
        kick off a reporting cycle &mdash; compose a message asking companies to send in their latest
        numbers, select which companies should receive it, and send it out. The system tracks each
        request so you know what was sent and when.
      </p>
      <p className="text-muted-foreground">
        The email composer supports a customizable subject and HTML body. You can write a standard
        template that you reuse each quarter, or tailor messages for specific companies. Emails are
        sent through whichever outbound email provider your admin has configured (Gmail, Resend,
        Postmark, or Mailgun).
      </p>
      <p className="text-muted-foreground">
        Each request is logged with its recipient list, send timestamp, and delivery results. You
        can view past requests to see the full history of reporting asks. This is helpful for
        tracking which companies have been contacted and following up with those that haven&apos;t
        responded.
      </p>
      <p className="text-muted-foreground">
        When companies reply to your ask email with their report, those replies flow into the
        Inbound pipeline automatically (assuming the sender is on the authorized senders list and
        replies to the configured inbound address). The full loop &mdash; ask, receive, parse,
        review &mdash; is designed to work end to end with minimal manual effort.
      </p>
    </ExplainerContent>
  )
}
