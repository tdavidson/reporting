import { ogMetadata } from '@/lib/og-metadata'
import Link from 'next/link'
import { Tag, Github, Heart, Calendar, Mail, Send } from 'lucide-react'

export const metadata = ogMetadata({
  title: 'Pricing',
  description: 'Free self-hosted, managed deployment, commercial licensing, and hosted subscription options for Analyst portfolio reporting.',
})
import { Button } from '@/components/ui/button'
import { CalendlyButton } from '@/components/calendly-button'
import { SubscriptionInquiryButton } from '@/components/subscription-inquiry-modal'

export default function PricingPage() {
  return (
    <div className="p-4 pt-6 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-3">
        <Tag className="h-6 w-6 text-muted-foreground" />
        Pricing
      </h1>

      <div className="space-y-8 text-sm leading-relaxed">
        <p className="text-muted-foreground">
          Source-available under a single-fund free use license. See the full{' '}
          <Link href="/license" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
            license
          </Link>.
        </p>

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
        <div className="rounded-lg border p-6 mt-4 relative">
          <span className="absolute -top-3 left-4 bg-muted text-muted-foreground text-xs font-medium px-2.5 py-0.5 rounded-full">Early Access</span>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-base text-muted-foreground flex-1">
              <span className="font-medium text-foreground">Hosted</span> - Let us host your fund. Get help onboarding your information and processes. $250+ monthly subscription, cancel anytime.
            </p>
            <SubscriptionInquiryButton variant="outline" size="sm" className="w-full sm:w-auto shrink-0">
              <Send className="h-3.5 w-3.5 mr-1.5" />Request Access
            </SubscriptionInquiryButton>
          </div>
        </div>

        {/* Cost details */}
        <div className="max-w-3xl">
          <h2 className="text-base font-medium mb-2">What does it cost to run?</h2>
          <p className="text-muted-foreground mb-4">
            You deploy using your own accounts for the components in the stack - database, hosting,
            email providers, file storage, and AI. This means you control your own operational
            details and costs.
          </p>
          <p className="text-muted-foreground mb-4">
            Most of the services used in the stack have fairly generous free pricing tiers that
            should handle normal usage of the product, but your costs may vary depending on your
            portfolio size and usage patterns. The platform does require use of Anthropic, OpenAI,
            or Gemini API keys for AI-powered features (metric extraction, summaries, and analysis),
            which will require paid accounts with those providers.
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
            including onboarding your portfolio data and providing ongoing support, {' '}
            <Link
              href="/contact"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              contact him for details and pricing
            </Link>.
          </p>
        </div>

        {/* Sponsor */}
        <div className="max-w-3xl rounded-lg border bg-muted/50 p-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-base text-muted-foreground flex-1">
            If you find this project useful, consider sponsoring its development.
          </p>
          <Button variant="outline" size="sm" asChild className="shrink-0 gap-2">
            <a href="https://github.com/sponsors/tdavidson" target="_blank" rel="noopener noreferrer">
              <Heart className="h-4 w-4 text-pink-500" />
              Sponsor on GitHub
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}
