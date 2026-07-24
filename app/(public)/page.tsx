import { redirect } from 'next/navigation'
import Image from 'next/image'
import { ChevronRight, Github, Send, Calendar } from 'lucide-react'
import { ogMetadata } from '@/lib/og-metadata'
import { Button } from '@/components/ui/button'
import { CalendlyButton } from '@/components/calendly-button'
import { SubscriptionInquiryButton } from '@/components/subscription-inquiry-modal'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseSiteContent, resolveIcon, type SiteTier } from '@/lib/marketing/content'
import { renderInlineMarkdown } from '@/lib/marketing/markdown'

export const metadata = ogMetadata({
  title: 'Run your fund with Hemrock',
  description: 'Open source portfolio reporting for venture capital firms, accelerators, and angel investors.',
})

function TierCta({ tier }: { tier: SiteTier }) {
  if (tier.cta.kind === 'calendly' && tier.cta.href) {
    return <CalendlyButton url={tier.cta.href} className="w-full"><Calendar className="h-4 w-4 mr-1.5" />{tier.cta.label}</CalendlyButton>
  }
  if (tier.cta.kind === 'subscription') {
    return <SubscriptionInquiryButton variant="outline" size="sm" className="w-full"><Send className="h-3.5 w-3.5 mr-1.5" />{tier.cta.label}</SubscriptionInquiryButton>
  }
  return (
    <Button size="sm" asChild className="w-full">
      <a href={tier.cta.href} className="gap-2"><Github className="h-4 w-4" />{tier.cta.label}</a>
    </Button>
  )
}

export default async function HomePage() {
  const admin = createAdminClient()
  const { data } = await (admin as any).from('site_content').select('content').eq('id', true).maybeSingle()
  const content = parseSiteContent(data?.content)
  if (!content) redirect('/auth')

  return (
    <div className="px-4 md:px-8 pb-8 pt-12 md:pt-20">
      <h1 className="text-4xl md:text-7xl font-semibold tracking-tight mb-2 max-w-3xl">{content.hero.title}</h1>
      <p className="text-xl text-muted-foreground mb-16 max-w-2xl">{content.hero.subtitle}</p>

      {/* Product groups — mirrors the settings product structure. Every group presents its
          features as half-width cards (no full-width hero banner). */}
      {content.productGroups.map(group => (
        <section key={group.label} className="mb-16">
          <h2 className="text-2xl font-semibold tracking-tight mb-1">{group.label}</h2>
          <p className="text-muted-foreground mb-6 max-w-2xl">{group.description}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {group.features.map(f => {
              const Icon = resolveIcon(f.icon)
              return (
                <div key={f.title} className="rounded-lg border p-5 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <h3 className="text-base font-medium">{f.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">{f.text}</p>
                  {f.screenshot && (
                    <div className="relative h-[180px] rounded-md border shadow-sm overflow-hidden mt-auto">
                      <Image src={f.screenshot} alt={f.title} fill sizes="(max-width: 768px) 100vw, 40vw" className="object-cover object-left-top" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {/* Why */}
      {content.why.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Why should you use this?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {content.why.map(w => {
              const Icon = resolveIcon(w.icon)
              return (
                <div key={w.title} className="rounded-lg border p-5">
                  <Icon className="h-5 w-5 text-muted-foreground mb-3" />
                  <h3 className="text-sm font-medium mb-1">{w.title}</h3>
                  <p className="text-sm text-muted-foreground">{w.text}</p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Pricing */}
      {content.pricing.tiers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-2">Pricing</h2>
          {content.pricing.note && <p className="text-sm text-muted-foreground mb-6">{renderInlineMarkdown(content.pricing.note)}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {content.pricing.tiers.map(tier => (
              <div key={tier.name} className="rounded-lg border p-6 flex flex-col relative">
                {tier.badge && <span className="absolute -top-3 left-4 bg-foreground text-background text-xs font-medium px-2.5 py-0.5 rounded-full">{tier.badge}</span>}
                <h3 className="font-semibold mb-1">{tier.name}</h3>
                <p className="text-2xl font-bold mb-1">{tier.price}</p>
                {tier.subtitle && <p className="text-xs text-muted-foreground mb-3">{tier.subtitle}</p>}
                <ul className="text-sm text-muted-foreground space-y-1.5 mb-4 flex-1">
                  {tier.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
                <TierCta tier={tier} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      {content.faqs.length > 0 && (
        <section className="mb-12 mt-12">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Common Questions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            {content.faqs.map((f, i) => (
              <details key={i} className="group">
                <summary className="flex cursor-pointer items-center gap-3 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
                  {f.q}
                </summary>
                <p className="pl-7 pb-3 text-base text-muted-foreground">{renderInlineMarkdown(f.a)}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* About + optional CFO / Head of AI callout */}
      {(content.about.name || content.cfoCallout) && (
        <section className="mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {content.about.name && (
              <div className={`${content.cfoCallout ? 'sm:col-span-3' : 'sm:col-span-4'} rounded-lg border bg-muted/50 p-5 flex flex-col sm:flex-row items-start gap-4`}>
                {content.about.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={content.about.photo} alt={content.about.name} width={128} height={128} className="rounded-lg w-full h-auto sm:w-32 sm:h-32 sm:object-cover shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground break-words">{renderInlineMarkdown(content.about.bio)}</p>
                  {content.about.links.length > 0 && (
                    <ul className="text-sm text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1">
                      {content.about.links.map(l => (
                        <li key={l.href}><a href={l.href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">{l.label}</a></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {content.cfoCallout && (
              <a
                href={content.cfoCallout.href}
                target="_blank"
                rel="noopener noreferrer"
                className="relative rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-5 flex flex-col transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/60"
              >
                {content.cfoCallout.badge && <span className="absolute -top-3 left-4 bg-amber-500 text-white text-xs font-medium px-2.5 py-0.5 rounded-full">{content.cfoCallout.badge}</span>}
                {content.cfoCallout.title && <h3 className="text-base font-medium mb-1">{content.cfoCallout.title}</h3>}
                <p className="text-sm text-muted-foreground">{renderInlineMarkdown(content.cfoCallout.text)}</p>
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
