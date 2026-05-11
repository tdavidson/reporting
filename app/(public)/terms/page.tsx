import { ogMetadata } from '@/lib/og-metadata'
import Link from 'next/link'
import { FileText } from 'lucide-react'

export const metadata = ogMetadata({
  title: 'Terms of Service',
  description: 'Terms governing use of the portfolio reporting platform, including self-hosted and managed deployments.',
})

export default function TermsPage() {
  const tocLinks = (
    <ul className="space-y-1 text-muted-foreground">
      <li><a href="#platform-description" className="hover:text-foreground underline underline-offset-4">Platform Description</a></li>
      <li><a href="#self-hosted" className="hover:text-foreground underline underline-offset-4">Self-Hosted</a></li>
      <li><a href="#managed-deployment" className="hover:text-foreground underline underline-offset-4">Managed Deployment</a></li>
      <li><a href="#managed-hosting" className="hover:text-foreground underline underline-offset-4">Managed Hosting</a></li>
      <li><a href="#demo" className="hover:text-foreground underline underline-offset-4">Demo &amp; Marketing</a></li>
      <li><a href="#ai" className="hover:text-foreground underline underline-offset-4">AI Features</a></li>
      <li><a href="#not-advice" className="hover:text-foreground underline underline-offset-4">Not Financial Advice</a></li>
      <li><a href="#your-data" className="hover:text-foreground underline underline-offset-4">Your Data</a></li>
      <li><a href="#acceptable-use" className="hover:text-foreground underline underline-offset-4">Acceptable Use</a></li>
      <li><a href="#third-party" className="hover:text-foreground underline underline-offset-4">Third-Party Services</a></li>
      <li><a href="#warranties" className="hover:text-foreground underline underline-offset-4">Warranties</a></li>
      <li><a href="#liability" className="hover:text-foreground underline underline-offset-4">Liability</a></li>
      <li><a href="#changes" className="hover:text-foreground underline underline-offset-4">Changes</a></li>
      <li><a href="#governing-law" className="hover:text-foreground underline underline-offset-4">Governing Law</a></li>
    </ul>
  )

  return (
    <div className="p-4 pt-6 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
        <FileText className="h-6 w-6 text-muted-foreground" />
        Terms of Service
      </h1>

      {/* Table of contents - inline on mobile only */}
      <nav className="xl:hidden mt-6 text-sm">
        <h2 className="text-base font-medium mb-2">On this page</h2>
        {tocLinks}
      </nav>

      <div className="flex gap-16 mt-6 xl:mt-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 max-w-3xl text-sm leading-relaxed space-y-8">
          <p className="text-muted-foreground">
            These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the portfolio reporting
            platform (&ldquo;Platform&rdquo;) developed and maintained by Unstructured Ventures, LLC
            (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;Hemrock&rdquo;). By accessing or using
            the Platform, you agree to be bound by these Terms. If you do not agree, do not use the Platform.
          </p>

          <p className="text-muted-foreground">
            These Terms apply to the website, any hosted instance of the Platform, and the managed
            hosting service. The use of the source code itself is governed by the separate{' '}
            <Link href="/license" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
              Software License
            </Link>.
          </p>

          {/* 1. Platform Description */}
          <div id="platform-description">
            <h2 className="text-base font-medium mb-2">1. Platform Description</h2>
            <p className="text-muted-foreground">
              The Platform is a source-available portfolio reporting tool for venture capital firms,
              accelerators, and angel investors. It can be self-hosted on your own infrastructure or
              accessed through a managed hosting arrangement. The Platform integrates with third-party
              services including database providers (Supabase), hosting providers (Vercel, Netlify),
              AI providers (Anthropic, OpenAI, Google Gemini, Ollama), email services (Postmark,
              Mailgun, Gmail, Resend), and file storage providers (Google Drive, Dropbox).
            </p>
          </div>

          {/* 2. Self-Hosted Deployments */}
          <div id="self-hosted">
            <h2 className="text-base font-medium mb-2">2. Self-Hosted Deployments</h2>
            <p className="text-muted-foreground mb-2">
              If you deploy the Platform on your own infrastructure, you are solely responsible for:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>Provisioning, configuring, and maintaining your hosting environment, database, and all third-party service accounts</li>
              <li>Securing your deployment, including access controls, API keys, encryption, and backups</li>
              <li>All costs incurred from third-party services (hosting, database, AI APIs, email, storage)</li>
              <li>Ensuring your use complies with the terms of service of each third-party provider you use</li>
              <li>Keeping your deployment up to date with security patches</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              We do not have access to your self-hosted deployment, your database, your API keys, or
              any data processed by your instance.
            </p>
          </div>

          {/* 3. Managed Deployment */}
          <div id="managed-deployment">
            <h2 className="text-base font-medium mb-2">3. Managed Deployment</h2>
            <p className="text-muted-foreground mb-2">
              If we set up the Platform on your infrastructure, the following applies:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>We will deploy the Platform on infrastructure and accounts that you own</li>
              <li>We receive access to your deployment during the setup process</li>
              <li>After setup, ongoing access is optional and provided only at your request to assist with maintenance, updates, or support</li>
              <li>We will not access your portfolio data except as necessary to fulfill your requests</li>
              <li>Your data resides on your own infrastructure and accounts</li>
              <li>Specific fees are set forth in a separate written agreement</li>
            </ul>
          </div>

          {/* 4. Managed Hosting */}
          <div id="managed-hosting">
            <h2 className="text-base font-medium mb-2">4. Managed Hosting</h2>
            <p className="text-muted-foreground mb-2">
              We offer a hosted solution where your fund uses shared infrastructure with other funds.
              The following applies:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>Your data is stored on shared infrastructure (database, hosting) managed by us</li>
              <li>The Platform enforces strict data isolation between funds at the database level through row-level security policies - no fund can access another fund&apos;s data</li>
              <li>We may access the shared infrastructure for maintenance and support, but will not access your portfolio data except as necessary to provide the service</li>
              <li>Specific service levels, data handling, and fees are set forth in a separate written agreement</li>
              <li>Either party may terminate the managed hosting arrangement per the terms of that agreement</li>
            </ul>
          </div>

          {/* 5. Hosted Demo & Marketing Site */}
          <div id="demo">
            <h2 className="text-base font-medium mb-2">5. Hosted Demo &amp; Marketing Site</h2>
            <p className="text-muted-foreground">
              We operate a demo environment with sample portfolio data for evaluation purposes. The
              demo is read-only and contains fictitious data. We also operate this marketing website,
              which includes a contact form. Information submitted through the contact form (name,
              email, message) is used solely to respond to your inquiry. See our{' '}
              <Link href="/privacy" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
                Privacy Policy
              </Link>{' '}
              for details.
            </p>
          </div>

          {/* 6. AI Features */}
          <div id="ai">
            <h2 className="text-base font-medium mb-2">6. AI-Powered Features</h2>
            <p className="text-muted-foreground mb-2">
              The Platform uses artificial intelligence to extract metrics from emails, generate
              company summaries, power portfolio analysis conversations, and draft LP letters.
            </p>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>AI outputs are generated automatically and may contain errors, omissions, or inaccuracies. You are responsible for reviewing and verifying all AI-generated content before relying on it.</li>
              <li>Data sent to AI providers (Anthropic, OpenAI, Google, or local Ollama instances) is subject to those providers&apos; terms of service and privacy policies.</li>
              <li>AI-generated analysis, summaries, and letters do not constitute financial, investment, legal, or tax advice.</li>
            </ul>
          </div>

          {/* 7. Not Financial Advice */}
          <div id="not-advice">
            <h2 className="text-base font-medium mb-2">7. Not Financial or Investment Advice</h2>
            <p className="text-muted-foreground">
              The Platform is a reporting and data organization tool. Nothing in the Platform -
              including AI-generated summaries, metrics, investment calculations, IRR figures, or LP
              letter drafts - constitutes financial, investment, legal, or tax advice. You should
              consult qualified professionals for advice specific to your situation. We are not
              registered investment advisors, broker-dealers, or tax professionals.
            </p>
          </div>

          {/* 8. Your Data */}
          <div id="your-data">
            <h2 className="text-base font-medium mb-2">8. Your Data</h2>
            <p className="text-muted-foreground">
              You retain all rights to your portfolio data, company information, metrics, documents,
              and any other content you input into the Platform. For self-hosted and managed
              deployments, your data resides on your own infrastructure and we have no access except
              as described in Section 3. For managed hosting, your data resides on shared
              infrastructure as described in Section 4.
            </p>
          </div>

          {/* 9. Acceptable Use */}
          <div id="acceptable-use">
            <h2 className="text-base font-medium mb-2">9. Acceptable Use</h2>
            <p className="text-muted-foreground mb-2">
              You agree not to:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>Use the Platform for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to any part of the Platform or its related systems</li>
              <li>Interfere with or disrupt the integrity or performance of the Platform</li>
              <li>Scrape, crawl, or use automated means to access the Platform beyond normal use</li>
              <li>Circumvent any access controls, authentication, or security features</li>
              <li>Use the Platform in violation of the{' '}
                <Link href="/license" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
                  Software License
                </Link>
              </li>
            </ul>
          </div>

          {/* 10. Third-Party Services */}
          <div id="third-party">
            <h2 className="text-base font-medium mb-2">10. Third-Party Services</h2>
            <p className="text-muted-foreground">
              The Platform integrates with and depends on third-party services. We are not responsible
              for the availability, accuracy, or reliability of any third-party service. Your use of
              third-party services is subject to those services&apos; own terms and policies. We do not
              control and are not liable for any third-party service&apos;s handling of your data.
            </p>
          </div>

          {/* 11. Disclaimer of Warranties */}
          <div id="warranties">
            <h2 className="text-base font-medium mb-2">11. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground uppercase">
              The Platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
              warranties of any kind, express or implied, including but not limited to warranties of
              merchantability, fitness for a particular purpose, accuracy, and noninfringement. We do
              not warrant that the Platform will be uninterrupted, error-free, or secure, or that any
              data processed by the Platform (including AI-generated content) will be accurate or complete.
            </p>
          </div>

          {/* 12. Limitation of Liability */}
          <div id="liability">
            <h2 className="text-base font-medium mb-2">12. Limitation of Liability</h2>
            <p className="text-muted-foreground uppercase mb-2">
              To the maximum extent permitted by applicable law, in no event shall we be liable for
              any indirect, incidental, special, consequential, or punitive damages, or any loss of
              profits, revenue, data, or use, arising out of or related to your use of the Platform,
              regardless of the theory of liability.
            </p>
            <p className="text-muted-foreground uppercase">
              Our total aggregate liability under these Terms shall not exceed the greater of one
              hundred U.S. dollars (USD $100.00) or the amount you paid us in the twelve (12) months
              preceding the claim.
            </p>
          </div>

          {/* 13. Changes */}
          <div id="changes">
            <h2 className="text-base font-medium mb-2">13. Changes to These Terms</h2>
            <p className="text-muted-foreground">
              We may update these Terms from time to time. Changes will be posted on this page with
              an updated date. Your continued use of the Platform after any changes constitutes
              acceptance of the revised Terms.
            </p>
          </div>

          {/* 14. Governing Law */}
          <div id="governing-law">
            <h2 className="text-base font-medium mb-2">14. Governing Law</h2>
            <p className="text-muted-foreground">
              These Terms are governed by and construed in accordance with the laws of the State of
              Delaware, without regard to its conflict of laws principles.
            </p>
          </div>

          {/* Contact */}
          <div className="rounded-lg border bg-card p-5">
            <p className="text-muted-foreground mb-3">
              Questions about these Terms? Contact us:
            </p>
            <p className="text-muted-foreground">
              <a
                href="mailto:hello@hemrock.com"
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                hello@hemrock.com
              </a>
            </p>
            <p className="text-muted-foreground mt-3">
              Unstructured Ventures, LLC<br />
              Attn: Taylor Davidson<br />
              6360 Broad St., #5226<br />
              Pittsburgh, PA 15206
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Last updated March 9, 2026 - Unstructured Ventures, LLC.
          </p>
        </div>

        {/* TOC sidebar - desktop only */}
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
