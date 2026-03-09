import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Github, Play, Mail, Upload, BarChart3, Brain, Handshake, FileText, ChevronRight, Lightbulb } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

const features: { icon: LucideIcon; title: string; text: string; href: string; screenshot: string }[] = [
  { icon: Mail, title: 'Automated report ingestion', text: 'Forward investor updates in any format and AI identifies the company, extracts metrics, and flags anything that needs review.', href: '/inbound-explainer', screenshot: '/screenshots/inbound-cropped.png' },
  { icon: Brain, title: 'AI-powered analysis', text: 'Generate company summaries, chat with an AI analyst about your portfolio, and draft LP letters — all grounded in your actual data.', href: '/dashboard-explainer', screenshot: '/screenshots/company-cropped.png' },
  { icon: BarChart3, title: 'Investment tracking', text: 'Track investments per company, per fund, and overall. Record rounds, proceeds, valuations, and compute metrics like TVPI, DPI, and Net IRR.', href: '/investments-explainer', screenshot: '/screenshots/investments-cropped.png' },
  { icon: Upload, title: 'Flexible import', text: 'Paste text, upload files, or bulk-import spreadsheet data. The same AI pipeline processes everything — metrics, investments, and cash flows.', href: '/import-explainer', screenshot: '/screenshots/import-cropped.png' },
  { icon: Handshake, title: 'Lightweight CRM', text: 'BCC your inbound address on conversations to log interactions and introductions automatically.', href: '/interactions-explainer', screenshot: '/screenshots/interactions-cropped.png' },
  { icon: FileText, title: 'LP letter generation', text: 'Generate quarterly update letters for your LPs using AI and your portfolio data — metrics, summaries, performance, and team notes.', href: '/letters-explainer', screenshot: '/screenshots/letters-cropped.png' },
]

export default function HomePage() {
  return (
    <div className="p-4 pt-6 md:p-8">
      <h1 className="text-4xl md:text-7xl font-semibold tracking-tight mb-2 max-w-3xl">
        Track your portfolio. Forward updates.<br className="hidden md:block" /> Analyst does the rest.
      </h1>
      <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
        Source-available portfolio reporting for venture capital firms, accelerators, and angel investors.
        Forward or upload your investor updates, and Analyst does the rest.
      </p>

      {/* Feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        {features.map(({ icon: Icon, title, text, href, screenshot }) => (
          <Link
            key={title}
            href={href}
            className="group rounded-lg border overflow-hidden transition-colors hover:bg-accent/50"
          >
            <div className="p-4 flex gap-3">
              <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium mb-1 group-hover:text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            </div>
            <div className="relative h-[312px] bg-muted overflow-hidden border-t p-2">
              <Image
                src={screenshot}
                alt={title}
                width={1200}
                height={900}
                className="min-w-full min-h-full object-cover object-left-top rounded-sm"
              />
              <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted/60 to-transparent" />
            </div>
          </Link>
        ))}
      </div>

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
            </ul>
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link href="/contact">Contact Taylor</Link>
            </Button>
          </div>
          <div className="rounded-lg border p-6 flex flex-col">
            <h3 className="font-semibold mb-1">Commercial</h3>
            <p className="text-2xl font-bold mb-1">Licensed</p>
            <p className="text-xs text-muted-foreground mb-3">Deploy to your customers</p>
            <ul className="text-sm text-muted-foreground space-y-1.5 mb-4 flex-1">
              <li>Fund administrators and outsourced CFOs</li>
              <li>Consultants and service providers</li>
              <li>Use across multiple clients</li>
            </ul>
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link href="/contact">Contact Taylor</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mb-12 mt-12">
        <h2 className="text-2xl font-semibold tracking-tight mb-6">Common Questions</h2>
        <div className="space-y-1">
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
              How long does it take to get started?
            </summary>
            <p className="pl-7 pb-3 text-base text-muted-foreground">
              A technical user can deploy in about 1-2 hours. Setting up the infrastructure and
              obtaining API keys for the various services takes most of the setup time. Onboarding
              involves importing your existing portfolio data via spreadsheet paste or CSV upload,
              which can vary based on your number of investment vehicles and the size of your
              portfolios. The AI pipeline creates companies, metrics, and historical values
              automatically from your imported data. I'm available for questions, and also offer
              managed onboarding for a one-time setup fee —{' '}
              <Link href="/contact" className="underline hover:text-foreground">contact me</Link> for details.
            </p>
          </details>
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
              What is the tech stack?
            </summary>
            <p className="pl-7 pb-3 text-base text-muted-foreground">
              Next.js and React for the frontend, Supabase (Postgres) for the database and authentication,
              Vercel or Netlify for hosting, and Anthropic, OpenAI, Google Gemini, or Ollama for
              AI features. Postmark or Mailgun for inbound mail processing, Google Drive or Dropbox
              for optional file storage, and Gmail, Resend, Postmark, or Mailgun for outbound emails.
              All services run on your own accounts so you control access and costs.
            </p>
          </details>
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
              How much does it cost to run?
            </summary>
            <p className="pl-7 pb-3 text-base text-muted-foreground">
              Most services in the stack have generous free tiers that cover normal usage. The main
              variable cost is AI API usage (Anthropic, OpenAI, or Gemini) for metric extraction, summaries,
              and analysis, which scales with your portfolio size and how often you generate reports.
            </p>
          </details>
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
              Is my portfolio data private?
            </summary>
            <p className="pl-7 pb-3 text-base text-muted-foreground">
              Yes. You deploy on your own infrastructure with your own database. No data is shared
              with other users or stored on third-party servers beyond the services you configure
              (your Supabase instance, your AI provider). You own and control everything. A hosted
              solution is also available for a select number of funds, which involves shared
              resources, but the platform is designed for data security and isolation between funds.
            </p>
          </details>
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
              What AI models are supported?
            </summary>
            <p className="pl-7 pb-3 text-base text-muted-foreground">
              The platform supports Anthropic (Claude), OpenAI (GPT), Google (Gemini), and Ollama
              for local models. You bring your own API key and can switch between providers. AI
              powers metric extraction from emails, company summaries, portfolio analysis chat,
              and LP letter drafting.
            </p>
          </details>
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
              Can I modify the code?
            </summary>
            <p className="pl-7 pb-3 text-base text-muted-foreground">
              Yes. The source is available under a single-fund free use{' '}
              <a href="https://github.com/tdavidson/reporting/blob/main/LICENSE" className="underline hover:text-foreground">
                license
              </a>
              . You can customize the platform for your own fund. Commercial use across multiple
              clients requires a separate license. I'm also available to assist with
              modifications —{' '}
              <Link href="/contact" className="underline hover:text-foreground">contact me</Link> to discuss.
            </p>
          </details>
        </div>
      </section>

      {/* About */}
      <section className="mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="sm:col-span-3 rounded-lg border bg-muted/50 p-5">
            <div className="flex items-start gap-4">
              <img
                src="https://www.hemrock.com/_next/image?url=%2Fassets%2Ftdavidson.jpg&w=256&q=75"
                alt="Taylor Davidson"
                width={128}
                height={128}
                className="rounded-lg shrink-0"
              />
              {/* Mobile: name + icon links, vertically centered */}
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
                (formerly Foresight). Fractional Chief Financial Officer for{' '}
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
              (formerly Foresight). Fractional Chief Financial Officer for{' '}
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
              Need a fractional CFO?{' '}
              <span className="text-foreground underline underline-offset-4">Learn more here</span>.
            </p>
          </a>
        </div>
      </section>
    </div>
  )
}
