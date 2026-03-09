import { Scale } from 'lucide-react'

export default function LicensePage() {
  const tocLinks = (
    <ul className="space-y-1 text-muted-foreground">
      <li><a href="#summary" className="hover:text-foreground underline underline-offset-4">Summary</a></li>
      <li><a href="#definitions" className="hover:text-foreground underline underline-offset-4">Definitions</a></li>
      <li><a href="#free-license" className="hover:text-foreground underline underline-offset-4">Free License Grant</a></li>
      <li><a href="#prohibited-uses" className="hover:text-foreground underline underline-offset-4">Prohibited Uses</a></li>
      <li><a href="#commercial-license" className="hover:text-foreground underline underline-offset-4">Commercial License</a></li>
      <li><a href="#modifications" className="hover:text-foreground underline underline-offset-4">Modifications</a></li>
      <li><a href="#ownership" className="hover:text-foreground underline underline-offset-4">Ownership &amp; IP</a></li>
      <li><a href="#no-warranty" className="hover:text-foreground underline underline-offset-4">No Warranty</a></li>
      <li><a href="#liability" className="hover:text-foreground underline underline-offset-4">Limitation of Liability</a></li>
      <li><a href="#termination" className="hover:text-foreground underline underline-offset-4">Termination</a></li>
      <li><a href="#general" className="hover:text-foreground underline underline-offset-4">General Provisions</a></li>
    </ul>
  )

  return (
    <div className="p-4 pt-6 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
        <Scale className="h-6 w-6 text-muted-foreground" />
        License
      </h1>

      {/* Table of contents — inline on mobile only */}
      <nav className="xl:hidden mt-6 text-sm">
        <h2 className="text-base font-medium mb-2">On this page</h2>
        {tocLinks}
      </nav>

      <div className="flex gap-16 mt-6 xl:mt-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 max-w-3xl text-sm leading-relaxed space-y-8">
          {/* Summary */}
          <div id="summary">
            <h2 className="text-base font-medium mb-2">Summary</h2>
            <p className="text-muted-foreground mb-2">
              This license applies to the portfolio fund reporting software developed by
              Unstructured Ventures, LLC and available at{' '}
              <a
                href="https://github.com/tdavidson/reporting"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                github.com/tdavidson/reporting
              </a>
              . It covers the source code in that repository, any instance deployed from it (including
              installations on hemrock.com, self-hosted deployments, and managed deployments), and all
              associated documentation, database schemas, and configuration files.
            </p>
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
              .
            </p>
          </div>

          {/* Definitions */}
          <div id="definitions">
            <h2 className="text-base font-medium mb-2">1. Definitions</h2>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">&ldquo;Software&rdquo;</strong> means the portfolio fund reporting
              software originally published at{' '}
              <a
                href="https://github.com/tdavidson/reporting"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                github.com/tdavidson/reporting
              </a>
              , including all source code, object code, documentation, configuration files, database schema, and related
              materials provided under this License. This definition includes any fork, copy, or deployment derived from
              the repository, whether self-hosted, managed by a third party, or hosted at any domain (including but not
              limited to hemrock.com and its subdomains).
            </p>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">&ldquo;Licensor&rdquo;</strong> means Unstructured Ventures, LLC.
            </p>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">&ldquo;Fund Entity&rdquo;</strong> means a single legal management
              company, general partner entity, or affiliated group of entities under common control that operates one or
              more investment funds, special purpose vehicles (SPVs), or investment vehicles.
            </p>
            <p className="text-muted-foreground mb-2">
              For purposes of clarity:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground mb-2 space-y-1">
              <li>Multiple funds operated by the same management company constitute one Fund Entity.</li>
              <li>Multiple SPVs operated by the same management company constitute one Fund Entity.</li>
              <li>Separate management companies, even if owned by the same or similar individuals, constitute separate Fund Entities.</li>
            </ul>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">&ldquo;Internal Use&rdquo;</strong> means use of the Software solely
              by employees, partners, members, or contractors of a single Fund Entity for that Fund Entity&apos;s own
              internal operations.
            </p>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">&ldquo;Service Provider&rdquo;</strong> means any person or entity
              that provides services to two or more Fund Entities.
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">&ldquo;Commercial Use&rdquo;</strong> means any use of the Software
              that involves one or more of the following:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground mt-1 space-y-1">
              <li>Use across more than one Fund Entity;</li>
              <li>Use to provide services to third parties;</li>
              <li>Use as part of a managed, hosted, software-as-a-service (SaaS), or white-labeled offering;</li>
              <li>Embedding within or incorporation into another commercial product or service.</li>
            </ul>
          </div>

          {/* Free License Grant */}
          <div id="free-license">
            <h2 className="text-base font-medium mb-2">2. Free License Grant (Single Fund Entity)</h2>
            <p className="text-muted-foreground mb-2">
              Subject to the terms and conditions of this License, Licensor hereby grants you a limited, non-exclusive,
              non-transferable, non-sublicensable, royalty-free license to:
            </p>
            <ol className="list-decimal pl-5 text-muted-foreground mb-2 space-y-1">
              <li>Use the Software for Internal Use by one Fund Entity;</li>
              <li>Modify the Software for Internal Use;</li>
              <li>Deploy the Software on infrastructure controlled by that Fund Entity; and</li>
              <li>Operate the Software across multiple funds and SPVs managed by that Fund Entity.</li>
            </ol>
            <p className="text-muted-foreground">
              This license grant applies to one Fund Entity only. Use by or on behalf of any additional Fund Entity
              requires a separate Commercial License.
            </p>
          </div>

          {/* Prohibited Uses */}
          <div id="prohibited-uses">
            <h2 className="text-base font-medium mb-2">3. Prohibited Uses</h2>
            <p className="text-muted-foreground mb-2">
              Without a separate written Commercial License from Licensor, you may not:
            </p>
            <ol className="list-decimal pl-5 text-muted-foreground space-y-1">
              <li>Use the Software across multiple unrelated management companies or Fund Entities;</li>
              <li>Use the Software to provide services to clients or third parties;</li>
              <li>Host, operate, or manage the Software on behalf of third parties;</li>
              <li>Offer the Software as a software-as-a-service (SaaS) product;</li>
              <li>White-label, rebrand, or relabel the Software;</li>
              <li>Distribute, sublicense, or otherwise make the Software available to any third party;</li>
              <li>Incorporate the Software into another commercial product or service; or</li>
              <li>Use the Software in a manner that competes with Licensor&apos;s consulting, licensing, or software business.</li>
            </ol>
          </div>

          {/* Commercial License */}
          <div id="commercial-license">
            <h2 className="text-base font-medium mb-2">4. Commercial License</h2>
            <p className="text-muted-foreground mb-2">
              A Commercial License is required if any of the following apply to your use of the Software:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground mb-2 space-y-1">
              <li>You are a fund administrator using the Software across client accounts;</li>
              <li>You are an outsourced CFO firm or accounting service provider;</li>
              <li>You provide reporting, analytics, or portfolio management services to third-party fund managers;</li>
              <li>You operate the Software on behalf of multiple client fund managers; or</li>
              <li>You deploy the Software across multiple independent management companies or Fund Entities.</li>
            </ul>
            <p className="text-muted-foreground mb-2">
              Commercial License terms shall be set forth in a separate written agreement between you and Licensor.
            </p>
            <p className="text-muted-foreground">
              For commercial licensing inquiries, contact{' '}
              <a
                href="mailto:hello@hemrock.com"
                className="text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                hello@hemrock.com
              </a>
              .
            </p>
          </div>

          {/* Modifications */}
          <div id="modifications">
            <h2 className="text-base font-medium mb-2">5. Modifications</h2>
            <p className="text-muted-foreground">
              You may modify the Software solely for Internal Use by one Fund Entity in accordance with Section 2.
              You may not distribute, publish, or otherwise make available any modified version of the Software without
              a Commercial License.
            </p>
          </div>

          {/* Ownership */}
          <div id="ownership">
            <h2 className="text-base font-medium mb-2">6. Ownership and Intellectual Property</h2>
            <p className="text-muted-foreground">
              The Software is licensed, not sold. Licensor retains all right, title, and interest in and to the
              Software, including all intellectual property rights therein. Nothing in this License conveys any
              ownership interest in the Software to you. Any modifications you make to the Software do not transfer
              ownership of the underlying Software or its intellectual property to you.
            </p>
          </div>

          {/* No Warranty */}
          <div id="no-warranty">
            <h2 className="text-base font-medium mb-2">7. No Warranty</h2>
            <p className="text-muted-foreground uppercase">
              The Software is provided &ldquo;as is,&rdquo; without warranty of any kind, express or implied,
              including but not limited to the warranties of merchantability, fitness for a particular purpose, and
              noninfringement. Licensor makes no warranty that the Software will be error-free, uninterrupted, or
              free of harmful components.
            </p>
          </div>

          {/* Limitation of Liability */}
          <div id="liability">
            <h2 className="text-base font-medium mb-2">8. Limitation of Liability</h2>
            <p className="text-muted-foreground uppercase mb-2">
              To the maximum extent permitted by applicable law, in no event shall Licensor be liable for any
              indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue,
              data, or use, arising out of or related to this License or the Software, regardless of the theory of
              liability.
            </p>
            <p className="text-muted-foreground uppercase">
              Licensor&apos;s total aggregate liability under this License shall not exceed one hundred U.S.
              dollars (USD $100.00).
            </p>
          </div>

          {/* Termination */}
          <div id="termination">
            <h2 className="text-base font-medium mb-2">9. Termination</h2>
            <p className="text-muted-foreground mb-2">
              This License is effective until terminated. Your rights under this License terminate automatically and
              immediately, without notice from Licensor, if you fail to comply with any term of this License. Upon
              termination, you must cease all use of the Software and destroy all copies in your possession or control.
            </p>
            <p className="text-muted-foreground mb-2">
              Licensor reserves the right to terminate this License at any time for any reason upon thirty (30) days&apos;
              written notice.
            </p>
            <p className="text-muted-foreground">
              Sections 6, 7, 8, and 10 shall survive any termination of this License.
            </p>
          </div>

          {/* General Provisions */}
          <div id="general">
            <h2 className="text-base font-medium mb-2">10. General Provisions</h2>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">Governing Law.</strong> This License shall be governed by and
              construed in accordance with the laws of the State of Delaware, without regard to its conflict of laws
              principles.
            </p>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">Entire Agreement.</strong> This License constitutes the entire
              agreement between you and Licensor with respect to the Software and supersedes all prior or
              contemporaneous understandings or agreements, whether written or oral, regarding the Software.
            </p>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">Severability.</strong> If any provision of this License is held to
              be invalid or unenforceable, the remaining provisions shall continue in full force and effect.
            </p>
            <p className="text-muted-foreground mb-2">
              <strong className="text-foreground">Waiver.</strong> The failure of Licensor to enforce any right or
              provision of this License shall not constitute a waiver of such right or provision.
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Assignment.</strong> You may not assign or transfer this License or
              any rights granted hereunder without the prior written consent of Licensor. Licensor may assign this
              License without restriction.
            </p>
          </div>

          {/* Contact */}
          <div className="rounded-lg border bg-card p-5">
            <p className="text-muted-foreground">
              For questions about this License or commercial licensing, contact{' '}
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
            Version 1.1 &mdash; Copyright &copy; 2026 Unstructured Ventures, LLC. All rights reserved.
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
