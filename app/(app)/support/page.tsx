import type { Metadata } from 'next'
import { Building2, ClipboardCheck, Mail, Upload, Send, Settings, MessageSquare, Monitor, PanelLeftClose } from 'lucide-react'

export const metadata: Metadata = { title: 'Support' }

export default function SupportPage() {
  const tocLinks = (
    <ul className="space-y-1 text-muted-foreground">
      <li><a href="#getting-started" className="hover:text-foreground underline underline-offset-4">Getting Started</a></li>
      <li className="pl-4"><a href="#setup" className="hover:text-foreground underline underline-offset-4">Setup</a></li>
      <li className="pl-4"><a href="#license" className="hover:text-foreground underline underline-offset-4">License</a></li>
      <li className="pl-4"><a href="#pricing" className="hover:text-foreground underline underline-offset-4">Pricing</a></li>
      <li><a href="#portfolio" className="hover:text-foreground underline underline-offset-4">Portfolio</a></li>
      <li className="pl-4"><a href="#company-detail" className="hover:text-foreground underline underline-offset-4">Company Detail</a></li>
      <li><a href="#review" className="hover:text-foreground underline underline-offset-4">Review</a></li>
      <li><a href="#inbound" className="hover:text-foreground underline underline-offset-4">Inbound</a></li>
      <li className="pl-4"><a href="#email-detail" className="hover:text-foreground underline underline-offset-4">Email Detail</a></li>
      <li><a href="#import" className="hover:text-foreground underline underline-offset-4">Import</a></li>
      <li><a href="#asks" className="hover:text-foreground underline underline-offset-4">Asks</a></li>
      <li><a href="#settings" className="hover:text-foreground underline underline-offset-4">Settings</a></li>
      <li><a href="#notes" className="hover:text-foreground underline underline-offset-4">Notes</a></li>
      <li><a href="#sidebar" className="hover:text-foreground underline underline-offset-4">Theme &amp; Sidebar</a></li>
    </ul>
  )

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
      </div>

      <div className="flex gap-16">
        {/* Main content */}
        <div className="flex-1 min-w-0 max-w-3xl space-y-8 text-sm leading-relaxed">
          {/* Contact info */}
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-medium mb-2">Need help?</h2>
            <p className="text-muted-foreground">
              For questions about your fund&apos;s data, companies, metrics, or account access,
              contact the admin on your team. For technical questions, feature requests, or bug reports,
              reach out to Taylor Davidson at{' '}
              <a
                href="https://www.hemrock.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                Hemrock
              </a>
              {' '}or open an issue on{' '}
              <a
                href="https://github.com/tdavidson/reporting"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                GitHub
              </a>
              .
            </p>
          </div>

          {/* Table of contents — inline on mobile only */}
          <nav className="xl:hidden">
            <h2 className="text-base font-medium mb-2">On this page</h2>
            {tocLinks}
          </nav>

          {/* Sections */}
        <div id="getting-started">
          <h2 className="text-base font-medium mb-2">Getting Started</h2>
          <p className="text-muted-foreground mb-2">
            This platform is designed to automate the collection, parsing, and tracking of portfolio
            company reports. Instead of manually copying numbers out of emails and spreadsheets,
            the system uses AI to extract metrics from whatever format your companies send &mdash;
            emails, PDFs, Excel workbooks, slide decks, images &mdash; and writes the data directly
            into each company&apos;s metrics history.
          </p>
          <p className="text-muted-foreground mb-2">
            The fastest way to get data flowing is to forward reporting emails to the inbound address
            shown in Settings. You can forward emails yourself, or give the inbound address to your
            founders or fund analysts and ask them to CC or send reports directly. Every email that
            arrives at that address is automatically parsed: the system identifies which company it&apos;s
            from, extracts the metrics you&apos;ve defined, and flags anything it&apos;s unsure about
            for your review.
          </p>
          <p className="text-muted-foreground mb-2">
            Not everything arrives by email. When someone sends you a link to a Google Sheet, Google
            Slides, Docsend deck, or any other hosted file, download it and upload it through the
            Import page. The same goes for PDFs, Excel workbooks, Word docs, PowerPoint decks, CSVs,
            and images &mdash; anything you can download, you can import. The AI pipeline processes
            uploads identically to inbound emails.
          </p>
          <p className="text-muted-foreground">
            Once data starts flowing, the Portfolio dashboard gives you a real-time view of every
            company, the Review queue catches anything that needs a human decision, and the AI Analyst
            on each company page synthesizes the data into actionable summaries. The goal is to spend
            less time on data entry and more time on the analysis and conversations that matter.
          </p>
        </div>

        <div id="setup" className="pl-4 border-l-2 border-border">
          <h3 className="text-sm font-medium mb-2">Setup</h3>
          <p className="text-muted-foreground mb-2">
            Under the hood, the platform uses a database, authentication, file storage, inbound email
            processing, and an AI provider, with prebuilt integrations for several third-party services
            across the stack. The software can be downloaded and deployed on your own infrastructure
            from{' '}
            <a
              href="https://github.com/tdavidson/reporting"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              GitHub
            </a>
            . The README provides a detailed installation guide covering database setup, environment
            variables, encryption, email providers, AI configuration, and deployment.
          </p>
          <p className="text-muted-foreground">
            <a
              href="https://www.hemrock.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              Taylor Davidson
            </a>
            {' '}of Hemrock is available to set this up, onboard you and your portfolio data, and
            provide ongoing support &mdash;{' '}
            <a
              href="https://www.hemrock.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              contact him for details
            </a>
            . A hosted solution is also available to a select number of funds; reach out to Taylor
            if that&apos;s of interest.
          </p>
        </div>

        <div id="license" className="pl-4 border-l-2 border-border">
          <h3 className="text-sm font-medium mb-2">License</h3>
          <p className="text-muted-foreground mb-2">
            This software is free to use if you are a single fund management company running your own
            operations &mdash; that includes all of your funds, SPVs, and internal team members. You can
            modify it and deploy it on your own infrastructure. If you are a fund administrator, outsourced
            CFO, consultant, or any kind of service provider using this software across multiple clients or
            management companies, you need a paid commercial license.
          </p>
          <p className="text-muted-foreground mb-2">
            You also cannot resell it, white-label it, offer it as SaaS, or bundle it into another product.
            All intellectual property stays with Unstructured Ventures, LLC. The software is provided as-is
            with no warranties, and liability is capped at $100. If you violate the terms, your license ends
            immediately.
          </p>
          <p className="text-muted-foreground">
            For commercial licensing, reach out to{' '}
            <a
              href="mailto:hello@hemrock.com"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              hello@hemrock.com
            </a>
            . Read the{' '}
            <a
              href="/license"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              full license
            </a>
            .
          </p>
        </div>

        <div id="pricing" className="pl-4 border-l-2 border-border">
          <h3 className="text-sm font-medium mb-2">Pricing</h3>
          <p className="text-muted-foreground mb-2">
            You can download and deploy this platform for your own use under the terms of the{' '}
            <a
              href="/license"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              license
            </a>
            , using your own accounts for the components in the stack &mdash; database, hosting,
            email providers, file storage, and AI. This means you control your own operational
            details and costs, and all of those costs are controlled by you.
          </p>
          <p className="text-muted-foreground mb-2">
            Most of the services used in the stack have fairly generous free pricing tiers that
            should handle normal usage of the product, but your costs may vary depending on your
            portfolio size and usage patterns. The platform does require use of Anthropic or OpenAI
            API keys for AI-powered features (metric extraction, summaries, and analysis), which
            will require paid accounts with those providers.
          </p>
          <p className="text-muted-foreground">
            <a
              href="https://www.hemrock.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              Taylor Davidson
            </a>
            {' '}of Hemrock is also available to set up, host, and manage the platform for you,
            including onboarding your portfolio data and providing ongoing support &mdash;{' '}
            <a
              href="https://www.hemrock.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              contact him for details and pricing
            </a>
            .
          </p>
        </div>

        <div id="portfolio">
          <h2 className="text-base font-medium mb-2 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Portfolio
          </h2>
          <p className="text-muted-foreground mb-2">
            The Portfolio page is the main dashboard and your starting point for monitoring the fund.
            It shows all active companies with key headline metrics (such as MRR and cash balance) so you
            can quickly scan the health of the portfolio without clicking into individual companies.
            Companies are displayed as cards with their most recently reported figures.
          </p>
          <p className="text-muted-foreground mb-2">
            Click any company card to open its detail page. The detail page shows historical metric
            charts, the AI Analyst summary, uploaded documents, and a notes panel. You can track how
            metrics have trended over time, upload supplementary documents (board decks, strategy memos,
            etc.) to give the AI more context, and generate or regenerate AI summaries on demand.
          </p>
          <p className="text-muted-foreground mb-2">
            At the top of each company page you&apos;ll see headline numbers and metadata like industry,
            stage, and any tags your team has applied. Admins can edit company details, add or remove
            metrics, and manage aliases (alternative names) that help the system match inbound emails
            to the right company.
          </p>
          <p className="text-muted-foreground">
            The dashboard also includes a shared notes section at the bottom where team members can post
            fund-level observations &mdash; market commentary, cross-portfolio themes, reminders for the
            next IC meeting, and so on. These notes are visible to everyone on the team.
          </p>
        </div>

        <div id="company-detail" className="pl-4 border-l-2 border-border">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            Company Detail
          </h3>
          <p className="text-muted-foreground mb-2">
            Clicking a company on the Portfolio dashboard opens its detail page. At the top you&apos;ll
            see the company name, headline metrics (like MRR and cash balance), and badges for stage,
            industry, and portfolio groups. Admins can click the edit button to update the company&apos;s
            name, aliases, stage, industry, founders, overview, and other details that give the AI more
            context for analysis.
          </p>
          <p className="text-muted-foreground mb-2">
            The main content area starts with the <strong>AI Analyst</strong> card. This is where you
            can generate an AI-powered summary of the company based on all available data &mdash; reported
            metrics, email content, uploaded documents, and any previous summaries. The AI acts as a
            senior analyst preparing a portfolio review memo: it highlights current performance, trends,
            strengths, risks, and follow-up questions. You can regenerate the summary at any time as new
            data comes in, clear it to start fresh, or upload additional context documents (board decks,
            strategy memos, investor updates) directly from this card to give the AI more to work with.
            If your fund has both Anthropic and OpenAI configured, a provider selector lets you choose
            which AI to use for each generation.
          </p>
          <p className="text-muted-foreground mb-2">
            Below the AI Analyst is the <strong>metrics section</strong>, where each metric has its own
            chart card. You can add new metrics directly from this page using the &ldquo;Add metric&rdquo;
            button, or delete a metric and all its data from its card. Each chart shows data points over
            time, color-coded by confidence level (green for high, amber for medium, red for low) with
            manual entries shown as hollow circles. Click any data point on a chart to open a popover
            where you can view the full details &mdash; period, value, confidence, source email, and
            notes &mdash; and edit or delete the value directly. You can also add data points manually
            using the &ldquo;Add&rdquo; button on each card, which is useful for entering historical data
            or correcting values. An export button at the top lets you download all metric data as a CSV.
          </p>
          <p className="text-muted-foreground mb-2">
            Further down the page, a <strong>documents section</strong> lists all files associated with
            the company &mdash; both files you&apos;ve uploaded and attachments from processed emails.
            These documents are available to the AI Analyst when generating summaries. Individual file
            uploads are limited to 10 MB. Finally, if the company has additional details like founders,
            contact emails, an overview, investment thesis, or a current business update, those appear
            at the bottom. A <strong>notes panel</strong> on
            the right side (or toggled via the chat button on mobile) lets your team leave company-specific
            observations visible to all members.
          </p>
          <p className="text-muted-foreground">
            The company page also includes an <strong>Investments</strong> section that tracks the
            fund&apos;s transaction history with that company. You can record investment rounds (with
            date, round name, amount invested, shares acquired, and cost per share), proceeds from
            exits or distributions (including escrowed amounts), and unrealized gain changes (current
            share price updates). The section displays summary metrics &mdash; total invested, current
            fair market value, MOIC, and total realized &mdash; along with a detailed transaction
            table. Admins can add, edit, and delete transactions directly from this panel. For exited
            companies the FMV reflects total realized proceeds; for written-off companies it shows zero;
            and for active companies it uses the latest share price multiplied by total shares held.
          </p>
        </div>

        <div id="review">
          <h2 className="text-base font-medium mb-2 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            Review
          </h2>
          <p className="text-muted-foreground mb-2">
            When inbound emails are processed, the AI pipeline sometimes flags items that need a human
            decision. These flagged items appear in the Review queue. Common reasons include: a new
            company name was detected that doesn&apos;t match any existing portfolio company, a metric
            value was extracted with low confidence, a reporting period was ambiguous, or a metric
            couldn&apos;t be found in the report at all.
          </p>
          <p className="text-muted-foreground mb-2">
            Each review item shows you the issue type, the extracted value (if any), and a snippet of
            context from the source email so you can make an informed decision. You can accept the
            extracted value as-is, reject it, or manually correct it with the right number. For new
            company detections, you can create the company or map it to an existing one.
          </p>
          <p className="text-muted-foreground mb-2">
            The review badge in the sidebar shows how many items are waiting for attention. Once all
            review items for a given email are resolved, that email&apos;s status automatically moves
            from &ldquo;needs review&rdquo; to &ldquo;success.&rdquo; You can also dismiss all review
            items for an email at once if the entire report should be skipped.
          </p>
          <p className="text-muted-foreground">
            Staying on top of the review queue is important &mdash; it&apos;s how you ensure the
            data flowing into your portfolio metrics is accurate. The system is designed to err on the
            side of flagging rather than silently writing bad data.
          </p>
        </div>

        <div id="inbound">
          <h2 className="text-base font-medium mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Inbound
          </h2>
          <p className="text-muted-foreground mb-2">
            Inbound shows every email that has been received and processed by the system. It&apos;s the
            audit trail for all automated report ingestion. Each row displays the sender, subject line,
            which company the email was matched to, and the processing status (success, needs review,
            failed, processing, or pending).
          </p>
          <p className="text-muted-foreground mb-2">
            You can filter the list by status and date range to quickly find specific emails. Filters
            apply immediately as you change them. The list is paginated and sorted by most recent first,
            so new emails always appear at the top.
          </p>
          <p className="text-muted-foreground mb-2">
            Clicking on any email opens its detail view. There you&apos;ll see the full processing
            result: which company was identified, which metrics were extracted and their values, the
            reporting period that was detected, and any review items that were created. The raw email
            body and attachment information are also available for reference.
          </p>
          <p className="text-muted-foreground mb-2">
            If an email failed processing (for example, the AI key was misconfigured or the email
            content was unreadable), you can see the error message in the detail view. For emails
            stuck in &ldquo;needs review,&rdquo; you can open the review modal directly from the
            Inbound page to resolve flagged items without navigating to the Review queue.
          </p>
          <p className="text-muted-foreground">
            The platform can also store documents for you automatically. If your admin has connected
            Google Drive or Dropbox in Settings, every inbound email and its attachments are saved
            into company-specific folders &mdash; organized by company name &mdash; so you always have
            the original source files alongside the extracted data.
          </p>
        </div>

        <div id="email-detail" className="pl-4 border-l-2 border-border">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            Email Detail
          </h3>
          <p className="text-muted-foreground mb-2">
            Clicking on any email in the Inbound list opens its detail page. At the top you&apos;ll
            see the subject line, sender address, received date, processing status badge, and the
            company the email was matched to (if identified). If processing failed, an error message
            explains what went wrong.
          </p>
          <p className="text-muted-foreground mb-2">
            Below that, the page shows the metrics that were extracted &mdash; a table with each
            metric name, the reporting period, the extracted value, and a confidence indicator (high,
            medium, or low). If there are unresolved review items for this email, they appear next
            with their issue type, context snippet, and action buttons so you can accept, reject,
            edit, or dismiss each one. For new company detections, you can create the company directly
            from this page.
          </p>
          <p className="text-muted-foreground mb-2">
            The detail page also lists any attachments that came with the email (with filename, type,
            and size), the raw email body text, and a collapsible view of the AI&apos;s full response
            for debugging or reference.
          </p>
          <p className="text-muted-foreground">
            Two actions are available at the bottom. <strong>Process Email</strong> lets you rerun the
            entire AI pipeline on this email &mdash; useful if you&apos;ve since added the company to
            your portfolio, updated metric definitions, or changed AI providers. It will replace any
            existing extracted metrics and review items with fresh results. If file storage is
            connected, a <strong>Save to File Storage</strong> button lets you manually push the email
            and its attachments to your Google Drive or Dropbox, organized into the appropriate company
            folder.
          </p>
        </div>

        <div id="import">
          <h2 className="text-base font-medium mb-2 flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            Import
          </h2>
          <p className="text-muted-foreground mb-2">
            Import lets you process reports manually when they arrive outside the normal email flow.
            You can paste email text directly, upload file attachments (PDFs, Excel spreadsheets, Word
            documents, PowerPoint decks, CSV files, and images up to 10 MB each), or combine both. The system runs the
            same AI pipeline as automated inbound processing &mdash; identifying the company, extracting
            metrics, and writing results to the database.
          </p>
          <p className="text-muted-foreground mb-2">
            This is useful for several scenarios: reports received through Slack or other messaging tools,
            historical data you want to backfill from older files, reports forwarded from colleagues
            outside the authorized sender list, or situations where you want to re-extract data from a
            document with updated metrics definitions.
          </p>
          <p className="text-muted-foreground mb-2">
            When you submit an import, the system processes it identically to an inbound email. The
            result appears in the Inbound list with the same status tracking, and any flagged items
            show up in the Review queue. You can import multiple reports in sequence without waiting
            for each one to finish.
          </p>
          <p className="text-muted-foreground mb-2">
            You can also paste data that covers multiple companies at once &mdash; for example, rows copied
            from a spreadsheet or CSV file containing metrics across your portfolio. The system will parse
            the data, create new companies if they don&apos;t already exist, add new metrics as needed, and
            populate values for existing companies and metrics. This makes it easy to bulk import historical
            data or onboard an entire portfolio in one step.
          </p>
          <p className="text-muted-foreground mb-2">
            Additionally, you can paste investment transaction data &mdash; rounds, proceeds, valuations,
            and share prices &mdash; and the AI will parse the entries and match them to your portfolio
            companies. This is useful for bulk-importing cap table history, backfilling historical rounds,
            or onboarding an entire portfolio&apos;s investment data at once. Transactions are written to
            each company&apos;s Investments section automatically.
          </p>
          <p className="text-muted-foreground">
            Tip: for best results, include the company name and reporting period somewhere in the pasted
            text or attachment. The AI uses these cues to match the report to the correct company and
            assign the right period to extracted metrics.
          </p>
        </div>

        <div id="asks">
          <h2 className="text-base font-medium mb-2 flex items-center gap-2">
            <Send className="h-4 w-4 text-muted-foreground" />
            Asks
          </h2>
          <p className="text-muted-foreground mb-2">
            Asks lets you send reporting request emails to your portfolio companies. This is how you
            kick off a reporting cycle &mdash; compose a message asking companies to send in their latest
            numbers, select which companies should receive it, and send it out. The system tracks each
            request so you know what was sent and when.
          </p>
          <p className="text-muted-foreground mb-2">
            The email composer supports a customizable subject and HTML body. You can write a standard
            template that you reuse each quarter, or tailor messages for specific companies. Emails are
            sent through whichever outbound email provider your admin has configured (Gmail, Resend,
            Postmark, or Mailgun).
          </p>
          <p className="text-muted-foreground mb-2">
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
        </div>

        <div id="settings">
          <h2 className="text-base font-medium mb-2 flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Settings
          </h2>
          <p className="text-muted-foreground mb-2">
            Settings is where the platform is configured. Most settings are admin-only, but all users
            can update their display name (shown on notes and activity) and enable two-factor
            authentication for additional account security.
          </p>
          <p className="text-muted-foreground mb-2">
            For admins, Settings covers the full platform configuration: AI provider keys and model
            selection (Anthropic and/or OpenAI), the default AI provider for the fund, inbound email
            setup (Postmark or Mailgun), outbound email providers (Gmail, Resend, Postmark, or Mailgun),
            file storage connections (Google Drive or Dropbox), the AI summary prompt, and email
            templates for reporting asks.
          </p>
          <p className="text-muted-foreground mb-2">
            Admins also manage the authorized senders list (email addresses allowed to submit reports
            via the inbound pipeline), team members and their roles, and an allow-list that controls
            who can sign up for the platform. A danger zone at the bottom allows admins to permanently
            delete all fund data if needed.
          </p>
          <p className="text-muted-foreground">
            For detailed technical setup instructions &mdash; configuring Supabase, environment
            variables, encryption keys, email providers, deployment, and more &mdash; see the{' '}
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
        </div>

        <div id="notes">
          <h2 className="text-base font-medium mb-2 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            Notes
          </h2>
          <p className="text-muted-foreground mb-2">
            Notes are available in three places: on each company&apos;s detail page, on the Portfolio
            dashboard, and on the dedicated Notes page. They provide a lightweight way for team members
            to share observations, context, and follow-up items without leaving the platform.
          </p>
          <p className="text-muted-foreground mb-2">
            On a company detail page, the notes panel appears on the right side on desktop or can be
            toggled via a chat button on mobile. Notes here are specific to that company &mdash; use
            them for takeaways from founder calls, questions to raise at the next board meeting, context
            on a metric anomaly, or anything else your team should know about that particular investment.
            On the Portfolio dashboard, the shared notes section is for fund-level observations that
            apply across the portfolio: market trends, cross-company themes, reminders for the next
            investment committee, or general team updates.
          </p>
          <p className="text-muted-foreground mb-2">
            The Notes page is a centralized feed that collects all notes across the fund in one place.
            You can filter by All notes, General (fund-level) notes, or just notes where you were
            @mentioned. Each note shows the author, timestamp, and which company it belongs to (if any),
            with unread notes highlighted so you can quickly catch up on what you&apos;ve missed.
          </p>
          <p className="text-muted-foreground mb-2">
            Notes support <strong>@mentions</strong> &mdash; type <strong>@</strong> while writing a note
            to see a dropdown of team members, then select a name to mention them. Mentioned team members
            are highlighted in the note text and can receive email notifications depending on their
            preferences.
          </p>
          <p className="text-muted-foreground mb-2">
            You can also <strong>follow companies</strong> to stay informed about notes posted on companies
            you care about, even if you aren&apos;t directly mentioned. When someone posts a note on a
            company you follow, you&apos;ll receive a notification.
          </p>
          <p className="text-muted-foreground mb-2">
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
        </div>

        <div id="sidebar">
          <h2 className="text-base font-medium mb-2 flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
            Theme &amp; Sidebar
          </h2>
          <p className="text-muted-foreground mb-2">
            At the bottom of the sidebar you&apos;ll find two utility controls. The theme toggle cycles
            between System, Light, and Dark modes. System mode follows your operating system&apos;s
            preference, so if your OS switches to dark mode at night, the platform will follow
            automatically.
          </p>
          <p className="text-muted-foreground">
            Below the theme toggle is the sidebar collapse button. Collapsing the sidebar reduces it
            to a narrow icon-only strip, giving you more horizontal space for content &mdash; especially
            useful on smaller screens or when viewing wide metric charts. Click the button again to
            expand the sidebar back to its full width. On mobile, the sidebar opens as a slide-over
            overlay and closes when you navigate or tap outside it.
          </p>
        </div>
        </div>

        {/* Sticky sidebar TOC — desktop only */}
        <nav className="hidden xl:block w-44 shrink-0 text-sm">
          <div className="sticky top-8">
            <h2 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-3">On this page</h2>
            {tocLinks}
          </div>
        </nav>
      </div>
    </div>
  )
}
