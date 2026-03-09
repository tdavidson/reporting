import { StickyNote } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export default function NotesExplainerPage() {
  return (
    <ExplainerContent
      title="Notes"
      icon={StickyNote}
      screenshotSrc="/screenshots/notes.png"
      screenshotLabel="Notes"
    >
      <p className="text-muted-foreground">
        Notes are available in three places: on each company&apos;s detail page, on the Portfolio
        dashboard, and on the dedicated Notes page. They provide a lightweight way for team members
        to share observations, context, and follow-up items without leaving the platform.
      </p>
      <p className="text-muted-foreground">
        On a company detail page, the notes panel appears on the right side on desktop or can be
        toggled via a chat button on mobile. Notes here are specific to that company &mdash; use
        them for takeaways from founder calls, questions to raise at the next board meeting, context
        on a metric anomaly, or anything else your team should know about that particular investment.
        On the Portfolio dashboard, the shared notes section is for fund-level observations that
        apply across the portfolio: market trends, cross-company themes, reminders for the next
        investment committee, or general team updates.
      </p>
      <p className="text-muted-foreground">
        The Notes page is a centralized feed that collects all notes across the fund in one place.
        You can filter by All notes, General (fund-level) notes, or just notes where you were
        @mentioned. Each note shows the author, timestamp, and which company it belongs to (if any),
        with unread notes highlighted so you can quickly catch up on what you&apos;ve missed.
      </p>
      <p className="text-muted-foreground">
        Notes support <strong>@mentions</strong> &mdash; type <strong>@</strong> while writing a note
        to see a dropdown of team members, then select a name to mention them. Mentioned team members
        are highlighted in the note text and can receive email notifications depending on their
        preferences.
      </p>
      <p className="text-muted-foreground">
        You can also <strong>follow companies</strong> to stay informed about notes posted on companies
        you care about, even if you aren&apos;t directly mentioned. When someone posts a note on a
        company you follow, you&apos;ll receive a notification.
      </p>
      <p className="text-muted-foreground">
        Notification preferences are managed in <strong>Settings</strong> under your user profile.
        You can choose to receive email notifications for all notes across the fund, only when you
        are @mentioned, or turn notifications off entirely. Company follows work alongside whichever
        level you choose &mdash; if you follow a company, you&apos;ll get notified about notes on
        that company regardless of your global setting.
      </p>
      <p className="text-muted-foreground">
        All notes show the author&apos;s display name and timestamp. Team members can edit or
        delete their own notes. Notes are visible to everyone on the team, so they work well as a
        lightweight internal communication tool alongside your existing workflows.
      </p>
    </ExplainerContent>
  )
}
