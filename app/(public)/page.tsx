import { ogMetadata } from '@/lib/og-metadata'
import Image from 'next/image'
import Link from 'next/link'

export const metadata = ogMetadata({
  title: 'Run your fund with Hemrock',
  description: 'Source-available portfolio reporting for venture capital firms, accelerators, and angel investors. Forward or upload your investor updates, and Analyst does the rest.',
})
import { Button } from '@/components/ui/button'
import { Github, Play, Mail, Upload, BarChart3, Brain, Handshake, FileText, ChevronRight, Lightbulb, Database, TableProperties, ShieldUser, Users, Calendar, Send, ArrowDown, StickyNote, MessageCircle, FolderOpen, ShieldCheck, LineChart } from 'lucide-react'
import { CalendlyButton } from '@/components/calendly-button'
import { SubscriptionInquiryButton } from '@/components/subscription-inquiry-modal'
import type { LucideIcon } from 'lucide-react'

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

const steps: { icon: LucideIcon; step: string; title: string; text: string; href: string; screenshot: string }[] = [
  { icon: Mail, step: '1', title: 'Forward your investor updates', text: 'Send investor updates in any format to your inbound address. AI identifies the company, extracts metrics, and flags anything that needs review.', href: '/inbound-explainer', screenshot: '/screenshots/inbound-cropped.png' },
  { icon: Upload, step: '2', title: 'Import your portfolio data', text: 'Paste text, upload files, or bulk-import spreadsheet data. The same AI pipeline processes everything — metrics, investments, and cash flows.', href: '/import-explainer', screenshot: '/screenshots/import-cropped.png' },
  { icon: LineChart, step: '3', title: 'Automated metrics tracking', text: 'Define the metrics that matter for each company in your portfolio. AI finds and charts them over time from your updates, and you can manually input anything it doesn\u2019t pick up.', href: '/dashboard-explainer', screenshot: '/screenshots/company-metrics-cropped.png' },
  { icon: BarChart3, step: '4', title: 'Track investments and performance', text: 'Track investments per company, per fund, and overall. Record rounds, proceeds, valuations, and compute metrics like TVPI, DPI, and Net IRR.', href: '/investments-explainer', screenshot: '/screenshots/investments-cropped.png' },
  { icon: StickyNote, step: '5', title: 'Communicate insights via Notes', text: 'Share metrics, observations, and context with your team through Notes. Keep a running record of what matters across your portfolio and surface it when you need it.', href: '/notes-explainer', screenshot: '/screenshots/notes-cropped.png' },
  { icon: MessageCircle, step: '6', title: 'Ask your AI analyst anything', text: 'An always-available analyst to ask questions, interpret data, compare companies, and surface trends across your portfolio — grounded in your actual metrics and notes.', href: '/dashboard-explainer', screenshot: '/screenshots/company-cropped.png' },
  { icon: Handshake, step: '7', title: 'Log interactions automatically', text: 'BCC your inbound address on conversations to log interactions and introductions automatically. A lightweight CRM built into your workflow.', href: '/interactions-explainer', screenshot: '/screenshots/interactions-cropped.png' },
  { icon: FileText, step: '8', title: 'Generate LP letters', text: 'Draft quarterly update letters for your LPs using AI and your portfolio data — metrics, summaries, performance, and team notes.', href: '/letters-explainer', screenshot: '/screenshots/letters-cropped.png' },
  { icon: FolderOpen, step: '9', title: 'Consolidate everything in one place', text: 'Manage your portfolio, funds, SPVs, personal investments, and LPs by consolidating data from multiple platforms, spreadsheets, emails, and documents into a single source of truth. Works alongside your fund admin.', href: '/dashboard-explainer', screenshot: '/screenshots/dashboard-cropped.png' },
  { icon: ShieldCheck, step: '10', title: 'Stay on top of compliance', text: 'Track regulatory filings, tax deadlines, and internal compliance requirements in a calendar tailored to your fund profile. Color-coded by category, with automatic applicability and dismiss tracking.', href: '/compliance-explainer', screenshot: '/screenshots/compliance-cropped.png' },
]

const faqs: { q: string; a: React.ReactNode }[] = [
  { q: 'Why are you building this?', a: <>I&apos;ve worked as an investor, CFO, and consultant for funds for over a decade and have experienced first hand the problems with manually collecting, analyzing, and presenting quantitative and qualitative data about the performance and forecasts for funds and their portfolio investments. At the same time, I am not interested in adding another SaaS app to the mix of operating systems in the private investment space, and am looking to provide tools to help investors and fund operators better solutions to build and manage their own solutions, just like I have done with{' '}<a href="https://www.hemrock.com/downloads" className="underline hover:text-foreground">financial model templates</a>, but evolved for today&apos;s technologies.</> },
  { q: 'How long does it take to get started?', a: <>A technical user can deploy in about 1-2 hours. Setting up the infrastructure and obtaining API keys for the various services takes most of the setup time. Onboarding involves importing your existing portfolio data via spreadsheet paste or CSV upload, which can vary based on your number of investment vehicles and the size of your portfolios. The AI pipeline creates companies, metrics, and historical values automatically from your imported data. I&apos;m available for questions, and also offer managed onboarding for a one-time setup fee,<Link href="/contact" className="underline hover:text-foreground">contact me</Link> for details.</> },
  { q: 'What is the tech stack?', a: 'Next.js and React for the frontend, Supabase (Postgres) for the database and authentication, Vercel or Netlify for hosting, and Anthropic, OpenAI, Google Gemini, or Ollama for AI features. Postmark or Mailgun for inbound mail processing, Google Drive or Dropbox for optional file storage, and Gmail, Resend, Postmark, or Mailgun for outbound emails. For the self-hosted and managed deployment solutions, all services run on your own accounts so you can control access and costs. For the hosted solution, we provide all the infrastructure except for the API keys for your selected API provider(s), which you pay for using your own account.' },
  { q: 'How much does it cost to run?', a: 'Most services in the stack have generous free tiers that cover normal usage. The main variable cost is AI API usage (Anthropic, OpenAI, or Gemini) for metric extraction, summaries, and analysis, which scales with your portfolio size and how often you generate reports.' },
  { q: 'Is my portfolio data private?', a: 'Yes. You deploy on your own infrastructure with your own database. No data is shared with other users or stored on third-party servers beyond the services you configure (your Supabase instance, your AI provider). You own and control everything. A hosted solution is also available for a select number of funds, which involves shared resources, but the platform is designed for data security and isolation between funds.' },
  { q: 'What AI models are supported?', a: 'The platform supports Anthropic (Claude), OpenAI (GPT), Google (Gemini), and Ollama for local models. You bring your own API key and can switch between providers. AI powers metric extraction from emails, company summaries, portfolio analysis chat, and LP letter drafting.' },
  { q: 'Can I modify the code?', a: <>Yes. The source is available under a single-fund free use <a href="https://github.com/tdavidson/reporting/blob/main/LICENSE" className="underline hover:text-foreground">license</a>. You can customize the platform for your own fund. Commercial use across multiple clients requires a separate license. I&apos;m also available to assist with modifications — <Link href="/contact" className="underline hover:text-foreground">contact me</Link> to discuss.</> },
]

export default function HomePage() {
  return (
    <div className="p-4 pt-6 md:p-8">
      <h1 className="text-4xl md:text-7xl font-semibold tracking-tight mb-2 max-w-3xl">
        Run your fund with Hemrock
      </h1>
      <p className="text-xl text-muted-foreground mb-12 max-w-2xl">
        Source-available portfolio reporting for venture capital firms, accelerators, and angel investors.
        Forward or upload your investor updates, and Hemrock does the rest.
      </p>

      {/* Timeline / Flow */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold tracking-tight mb-8">How it works</h2>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[19px] top-8 bottom-8 w-px bg-border hidden md:block" />

          <div className="space-y-8 md:space-y-12">
            {steps.map(({ icon: Icon, step, title, text, href, screenshot }, i) => (
              <Link
                key={title}
                href={href}
                className="group block"
              >
                <div className="flex gap-4 md:gap-6 items-start">
                  {/* Step indicator */}
                  <div className="relative z-10 shrink-0">
                    <div className="h-10 w-10 rounded-full border-2 border-border bg-background flex items-center justify-center group-hover:border-foreground transition-colors">
                      <span className="text-sm font-semibold text-muted-foreground group-hover:text-foreground transition-colors">{step}</span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h3 className="text-base font-medium group-hover:text-foreground transition-colors">{title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3 max-w-xl">{text}</p>
                    <div className="relative h-[200px] md:h-[280px] rounded-lg border shadow-sm overflow-hidden">
                      <Image
                        src={screenshot}
                        alt={title}
                        fill
                        sizes="(max-width: 768px) 100vw, 80vw"
                        className="object-cover object-left-top"
                      />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Why use this */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold tracking-tight mb-6">Why should you use this?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border p-5">
            <Database className="h-5 w-5 text-muted-foreground mb-3" />
            <h3 className="text-sm font-medium mb-1">Data consistency and availability</h3>
            <p className="text-sm text-muted-foreground">One source of truth for your team. Reduce your reliance on a maze of spreadsheets. Everyone works from the same portfolio data, metrics, and reports from a central location.</p>
          </div>
          <div className="rounded-lg border p-5">
            <Brain className="h-5 w-5 text-muted-foreground mb-3" />
            <h3 className="text-sm font-medium mb-1">Built to work with AI</h3>
            <p className="text-sm text-muted-foreground">Bring your fund data to your own AI, and use it to ask anything about your portfolio and fund. Ask about benchmarks, trends, industry data, research, and more.</p>
          </div>
          <div className="rounded-lg border p-5">
            <ShieldUser className="h-5 w-5 text-muted-foreground mb-3" />
            <h3 className="text-sm font-medium mb-1">Professionalize internal operations</h3>
            <p className="text-sm text-muted-foreground">Institutional-quality reporting infrastructure without the cost of enterprise software. Run it yourself, on your own terms.</p>
          </div>
          <div className="rounded-lg border p-5">
            <Users className="h-5 w-5 text-muted-foreground mb-3" />
            <h3 className="text-sm font-medium mb-1">Built for how funds work</h3>
            <p className="text-sm text-muted-foreground">Designed by a fund CFO for key workflows, including investor updates, LP reporting, and portfolio monitoring. Works alongside your fund admin and operations team.</p>
          </div>
        </div>
      </section>

      {/* Pricing & License */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight mb-2">Pricing</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Source-available under a single-fund free use license. See the full{' '}
          <a href="https://github.com/tdavidson/reporting/blob/main/LICENSE" className="underline hover:text-foreground">
            license on GitHub
          </a>
          .
        </p>
        <div className="rounded-lg border bg-muted/50 p-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-base text-muted-foreground flex-1">
            Explore the platform with sample portfolio data, no account or setup required.
          </p>
          <Button asChild size="lg" className="shrink-0">
            <a href="https://portfolio.hemrock.com/demo" target="_blank" rel="noopener noreferrer" className="gap-2">
              <Play className="h-4 w-4" />
              Try the Demo
            </a>
          </Button>
        </div>
        <div className="h-8 md:h-12" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border-2 border-foreground p-6 flex flex-col relative">
            <span className="absolute -top-3 left-4 bg-foreground text-background text-xs font-medium px-2.5 py-0.5 rounded-full">Start here</span>
            <h3 className="font-semibold mb-1">Self-Hosted</h3>
            <p className="text-2xl font-bold mb-1">Free</p>
            <p className="text-xs text-muted-foreground mb-3">Run on your own servers</p>
            <ul className="text-sm text-muted-foreground space-y-1.5 mb-4 flex-1">
              <li>Single fund management company</li>
              <li>All your funds, SPVs, and team members</li>
              <li>Deploy on your own infrastructure</li>
              <li>Modify and use on your own domain</li>
              <li>Estimated $0 to $75 per month in operational costs</li>
            </ul>
            <Button size="sm" asChild className="w-full">
              <a href="https://github.com/tdavidson/reporting" className="gap-2">
                <Github className="h-4 w-4" />
                View on GitHub
              </a>
            </Button>
          </div>
          <div className="rounded-lg border p-6 flex flex-col">
            <h3 className="font-semibold mb-1">Self-Hosted</h3>
            <p className="text-2xl font-bold mb-1">Managed</p>
            <p className="text-xs text-muted-foreground mb-3">One-time setup cost, run on your own servers</p>
            <ul className="text-sm text-muted-foreground space-y-1.5 mb-4 flex-1">
              <li>Deployed on your infrastructure and accounts</li>
              <li>Setup and onboarding included</li>
              <li>Ongoing support available</li>
              <li>$2,500+ one-time setup costs, ongoing based on need</li>
            </ul>
            <CalendlyButton url="https://calendly.com/foresighthq/15min" className="w-full">
              <Calendar className="h-4 w-4 mr-1.5" />
              Book a Demo
            </CalendlyButton>
          </div>
          <div className="rounded-lg border p-6 flex flex-col">
            <h3 className="font-semibold mb-1">Commercial</h3>
            <p className="text-2xl font-bold mb-1">Licensed</p>
            <p className="text-xs text-muted-foreground mb-3">Deploy to your customers</p>
            <ul className="text-sm text-muted-foreground space-y-1.5 mb-4 flex-1">
              <li>Fund administrators and outsourced CFOs</li>
              <li>Consultants and service providers</li>
              <li>Use across multiple clients</li>
              <li>License fee based on deployment</li>
            </ul>
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link href="/contact"><Mail className="h-3.5 w-3.5 mr-1.5" />Contact Taylor</Link>
            </Button>
          </div>
        </div>
        <div className="rounded-lg border p-6 mt-6 relative">
          <span className="absolute -top-3 left-4 bg-muted text-muted-foreground text-xs font-medium px-2.5 py-0.5 rounded-full">Early Access</span>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-base text-muted-foreground flex-1">
              <span className="font-medium text-foreground">Hosted</span> — Let us host your fund. Get help onboarding your information and processes. $250+ monthly subscription, cancel anytime.
            </p>
            <SubscriptionInquiryButton variant="outline" size="sm" className="w-full sm:w-auto shrink-0">
              <Send className="h-3.5 w-3.5 mr-1.5" />Request Access
            </SubscriptionInquiryButton>
          </div>
        </div>
      </section>

      {/* FAQ — 2 columns */}
      <section className="mb-12 mt-12">
        <h2 className="text-2xl font-semibold tracking-tight mb-6">Common Questions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div className="space-y-1">
            {faqs.slice(0, Math.ceil(faqs.length / 2)).map(({ q, a }, i) => (
              <details key={i} className="group">
                <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
                  {q}
                </summary>
                <p className="pl-7 pb-3 text-base text-muted-foreground">
                  {a}
                </p>
              </details>
            ))}
          </div>
          <div className="space-y-1">
            {faqs.slice(Math.ceil(faqs.length / 2)).map(({ q, a }, i) => (
              <details key={i} className="group">
                <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
                  {q}
                </summary>
                <p className="pl-7 pb-3 text-base text-muted-foreground">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section className="mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="sm:col-span-3 rounded-lg border bg-muted/50 p-5">
            <div className="flex items-start gap-4">
              <img
                src="/tdavidson.jpg"
                alt="Taylor Davidson"
                width={128}
                height={128}
                className="rounded-lg shrink-0"
              />
              {/* Mobile: name + icon links */}
              <div className="flex sm:hidden flex-col justify-center h-[128px]">
                <p className="font-medium text-base mb-2">Taylor Davidson</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>
                    <a href="https://github.com/tdavidson" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground transition-colors">
                      <Github className="h-4 w-4 shrink-0" />
                      <span>github.com/tdavidson</span>
                    </a>
                  </li>
                  <li>
                    <a href="https://x.com/tdavidson" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground transition-colors">
                      <XIcon className="h-4 w-4 shrink-0" />
                      <span>x.com/tdavidson</span>
                    </a>
                  </li>
                </ul>
              </div>
              {/* Desktop: full paragraph */}
              <p className="hidden sm:block text-base text-muted-foreground">
                <strong className="text-foreground">Taylor Davidson</strong> helps entrepreneurs and investors create and use financial
                models for business decisions through his template financial models and
                strategic advisory services at{' '}
                <a href="https://www.hemrock.com" className="underline hover:text-foreground">
                  Hemrock
                </a>{' '}
                (formerly Foresight). Chief Financial Officer (fractional) for{' '}
                <a href="https://laconiacapitalgroup.com" className="underline hover:text-foreground">
                  Laconia Capital Group
                </a>
                . Learn more and contact at{' '}
                <a href="https://www.hemrock.com/about" className="underline hover:text-foreground">
                  About
                </a>
                .
              </p>
            </div>
            {/* Mobile: paragraph below */}
            <p className="sm:hidden text-base text-muted-foreground mt-3">
              Helps entrepreneurs and investors create and use financial
              models for business decisions through his template financial models and
              strategic advisory services at{' '}
              <a href="https://www.hemrock.com" className="underline hover:text-foreground">
                Hemrock
              </a>{' '}
              (formerly Foresight). Chief Financial Officer (fractional) for{' '}
              <a href="https://laconiacapitalgroup.com" className="underline hover:text-foreground">
                Laconia Capital Group
              </a>
              . Learn more and contact at{' '}
              <a href="https://www.hemrock.com/about" className="underline hover:text-foreground">
                About
              </a>
              .
            </p>
          </div>
          <a
            href="https://foresight.is/fractional-cfo/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-3 flex items-start gap-3 transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/60"
          >
            <Lightbulb className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
              Work with an experienced fractional CFO on a flexible basis.{' '}
              <span className="text-foreground underline underline-offset-4">Learn more here</span>.
            </p>
          </a>
        </div>
      </section>
    </div>
  )
}
