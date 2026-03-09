import Link from 'next/link'
import { Shield } from 'lucide-react'

export default function PrivacyPage() {
  const tocLinks = (
    <ul className="space-y-1 text-muted-foreground">
      <li><a href="#self-hosted" className="hover:text-foreground underline underline-offset-4">Self-Hosted</a></li>
      <li><a href="#managed-deployment" className="hover:text-foreground underline underline-offset-4">Managed Deployment</a></li>
      <li><a href="#managed-hosting" className="hover:text-foreground underline underline-offset-4">Managed Hosting</a></li>
      <li><a href="#this-website" className="hover:text-foreground underline underline-offset-4">This Website</a></li>
      <li><a href="#ai-providers" className="hover:text-foreground underline underline-offset-4">AI Providers</a></li>
      <li><a href="#third-party" className="hover:text-foreground underline underline-offset-4">Third-Party Services</a></li>
      <li><a href="#data-security" className="hover:text-foreground underline underline-offset-4">Data Security</a></li>
      <li><a href="#data-retention" className="hover:text-foreground underline underline-offset-4">Data Retention</a></li>
      <li><a href="#your-rights" className="hover:text-foreground underline underline-offset-4">Your Rights</a></li>
      <li><a href="#children" className="hover:text-foreground underline underline-offset-4">Children&apos;s Privacy</a></li>
      <li><a href="#changes" className="hover:text-foreground underline underline-offset-4">Changes</a></li>
    </ul>
  )

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
        <Shield className="h-6 w-6 text-muted-foreground" />
        Privacy Policy
      </h1>

      {/* Table of contents — inline on mobile only */}
      <nav className="xl:hidden mt-6 text-sm">
        <h2 className="text-base font-medium mb-2">On this page</h2>
        {tocLinks}
      </nav>

      <div className="flex gap-16 mt-6 xl:mt-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 max-w-3xl text-sm leading-relaxed space-y-8">
          <p className="text-muted-foreground">
            This Privacy Policy describes how Unstructured Ventures, LLC (&ldquo;we,&rdquo;
            &ldquo;us,&rdquo; or &ldquo;Hemrock&rdquo;) collects, uses, and protects information
            in connection with the portfolio reporting platform (&ldquo;Platform&rdquo;) and this
            website.
          </p>

          {/* 1. Self-Hosted */}
          <div id="self-hosted">
            <h2 className="text-base font-medium mb-2">1. Self-Hosted Deployments</h2>
            <p className="text-muted-foreground">
              If you deploy the Platform on your own infrastructure, we do not collect, store,
              access, or process any of your data. Your portfolio data, company information, metrics,
              user accounts, documents, and all other content reside entirely on your own systems.
              We have no access to your database, API keys, or any information processed by your
              instance. Your data privacy is entirely within your control and subject to the policies
              of the third-party services you choose to use (Supabase, Anthropic, OpenAI, Google,
              Vercel, Netlify, Postmark, Mailgun, etc.).
            </p>
          </div>

          {/* 2. Managed Deployment */}
          <div id="managed-deployment">
            <h2 className="text-base font-medium mb-2">2. Managed Deployment</h2>
            <p className="text-muted-foreground">
              If we set up the Platform on your infrastructure, we receive access to your deployment
              during the setup process. After setup, ongoing access is optional and provided only at
              your request to assist with maintenance, updates, or support. We will not access, use,
              or share your portfolio data except as necessary to fulfill those requests. Your data
              resides on your own infrastructure and accounts.
            </p>
          </div>

          {/* 3. Managed Hosting */}
          <div id="managed-hosting">
            <h2 className="text-base font-medium mb-2">3. Managed Hosting</h2>
            <p className="text-muted-foreground">
              We offer a hosted solution where your fund shares infrastructure with other funds. In
              this arrangement, your data is stored on shared resources (database, hosting). The
              Platform enforces strict data isolation between funds at the database level through
              row-level security policies &mdash; no fund can access another fund&apos;s data. We may
              access the shared infrastructure for maintenance and support, but will not access your
              portfolio data except as necessary to provide the service. Specific data handling terms
              are set forth in a separate managed hosting agreement.
            </p>
          </div>

          {/* 4. Website & Contact Form */}
          <div id="this-website">
            <h2 className="text-base font-medium mb-2">4. This Website</h2>
            <p className="text-muted-foreground mb-2">
              When you visit this marketing website or use the demo, we may collect:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1 mb-2">
              <li>
                <strong className="text-foreground">Hosting:</strong> This website is hosted on{' '}
                <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
                  Vercel
                </a>
                , which may collect standard server logs (IP address, browser type, access times).
              </li>
              <li>
                <strong className="text-foreground">Contact form submissions:</strong> Your name,
                email address, and message, used solely to respond to your inquiry. Submissions are
                sent via{' '}
                <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
                  Resend
                </a>
                {' '}and are not stored in a database or used for marketing.
              </li>
              <li>
                <strong className="text-foreground">Authentication &amp; storage:</strong>{' '}
                <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
                  Supabase
                </a>
                {' '}provides database storage and authentication for user accounts and the demo
                environment.
              </li>
              <li>
                <strong className="text-foreground">Analytics:</strong> We use{' '}
                <a href="https://usefathom.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
                  Fathom Analytics
                </a>
                , a privacy-first analytics service that does not use cookies, does not track
                personal data, and is GDPR compliant.
              </li>
              <li>
                <strong className="text-foreground">Demo usage:</strong> The demo environment
                contains fictitious sample data. No account creation is required. Demo sessions
                use Supabase authentication with anonymous tokens.
              </li>
            </ul>
            <p className="text-muted-foreground">
              We do not use tracking cookies, advertising pixels, or third-party analytics services
              that collect personal information.
            </p>
          </div>

          {/* 5. AI Providers */}
          <div id="ai-providers">
            <h2 className="text-base font-medium mb-2">5. AI Provider Data Handling</h2>
            <p className="text-muted-foreground">
              The Platform sends data to AI providers (Anthropic, OpenAI, Google, or local Ollama
              instances) for metric extraction, summaries, analysis, and letter generation. This data
              may include email content, company metrics, documents, and other portfolio information.
              Each AI provider has its own data handling and privacy policies. For self-hosted
              deployments, you choose which provider to use and are responsible for understanding
              that provider&apos;s data practices. Ollama runs locally and does not send data to
              external services.
            </p>
          </div>

          {/* 6. Third-Party Services */}
          <div id="third-party">
            <h2 className="text-base font-medium mb-2">6. Third-Party Services</h2>
            <p className="text-muted-foreground mb-2">
              The Platform integrates with third-party services, each with their own privacy policies:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li><strong className="text-foreground">Supabase</strong> &mdash; database, authentication, and file storage</li>
              <li><strong className="text-foreground">Vercel / Netlify</strong> &mdash; application hosting</li>
              <li><strong className="text-foreground">Anthropic / OpenAI / Google</strong> &mdash; AI processing</li>
              <li><strong className="text-foreground">Postmark / Mailgun</strong> &mdash; inbound email processing</li>
              <li><strong className="text-foreground">Gmail / Resend / Postmark / Mailgun</strong> &mdash; outbound email</li>
              <li><strong className="text-foreground">Google Drive / Dropbox</strong> &mdash; optional file storage</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              We encourage you to review the privacy policies of any third-party services you configure
              for your deployment.
            </p>
          </div>

          {/* 7. Data Security */}
          <div id="data-security">
            <h2 className="text-base font-medium mb-2">7. Data Security</h2>
            <p className="text-muted-foreground">
              The Platform includes security features such as role-based access controls, row-level
              security policies for fund data isolation, encrypted storage of API keys, and
              authentication via Supabase Auth (including optional multi-factor authentication).
              For self-hosted deployments, you are responsible for the security of your
              infrastructure and configuration. We do not guarantee that any system is completely
              secure.
            </p>
          </div>

          {/* 8. Data Retention */}
          <div id="data-retention">
            <h2 className="text-base font-medium mb-2">8. Data Retention</h2>
            <p className="text-muted-foreground">
              For self-hosted deployments, data retention is entirely under your control. For
              managed hosting, data retention is governed by the managed hosting agreement. Contact
              form submissions are retained only as email records for the purpose of responding to
              your inquiry.
            </p>
          </div>

          {/* 9. Your Rights */}
          <div id="your-rights">
            <h2 className="text-base font-medium mb-2">9. Your Rights</h2>
            <p className="text-muted-foreground">
              If you have submitted information through our contact form and wish to request access
              to, correction of, or deletion of your personal information, contact us at{' '}
              <a href="mailto:hello@hemrock.com" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
                hello@hemrock.com
              </a>
              . We will respond within 30 days. For self-hosted deployments, you have full control
              over all data and can access, modify, or delete it at any time through your own database.
            </p>
          </div>

          {/* 10. Children */}
          <div id="children">
            <h2 className="text-base font-medium mb-2">10. Children&apos;s Privacy</h2>
            <p className="text-muted-foreground">
              The Platform is not directed at children under 18. We do not knowingly collect personal
              information from children.
            </p>
          </div>

          {/* 11. Changes */}
          <div id="changes">
            <h2 className="text-base font-medium mb-2">11. Changes to This Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time. Changes will be posted on this
              page with an updated date.
            </p>
          </div>

          {/* Contact */}
          <div className="rounded-lg border bg-card p-5">
            <p className="text-muted-foreground">
              Questions about this Privacy Policy? Contact{' '}
              <a
                href="mailto:hello@hemrock.com"
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                hello@hemrock.com
              </a>
              .
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Last updated March 9, 2026 &mdash; Unstructured Ventures, LLC.
          </p>
        </div>

        {/* TOC sidebar — desktop only */}
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
