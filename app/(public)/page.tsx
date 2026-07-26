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

/** Small uppercase label above a section heading. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-eyebrow uppercase text-muted-foreground mb-3">{children}</p>
}

function TierCta({ tier, featured }: { tier: SiteTier; featured?: boolean }) {
  if (tier.cta.kind === 'calendly' && tier.cta.href) {
    return <CalendlyButton url={tier.cta.href} className="w-full"><Calendar className="h-4 w-4 mr-1.5" />{tier.cta.label}</CalendlyButton>
  }
  if (tier.cta.kind === 'subscription') {
    return <SubscriptionInquiryButton variant="outline" size="sm" className="w-full"><Send className="h-3.5 w-3.5 mr-1.5" />{tier.cta.label}</SubscriptionInquiryButton>
  }
  return (
    <Button size="sm" asChild className={`w-full ${featured ? 'bg-brand text-brand-foreground hover:bg-brand-800' : ''}`}>
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
    <div className="px-6 md:px-8 pb-12 pt-16 md:pt-28">
      {/* Hero. Display serif at weight 400 — large and light, not large and bold.
          The emphasis phrase is the page's one flourish and the only place the
          brand accent appears above the fold. */}
      <section className="mb-20 md:mb-28">
        <h1 className="font-display text-display font-normal max-w-3xl text-balance">
          {content.hero.title}
          {content.hero.emphasis && (
            <>{' '}<em className="italic text-brand-700 dark:text-brand-400">{content.hero.emphasis}</em></>
          )}
        </h1>
        <p className="text-lede text-muted-foreground max-w-[640px] mt-7">{content.hero.subtitle}</p>
      </section>

      {/* Proof strip. Both reference sites lead with figures; absent from the JSON
          this renders nothing, so it stays optional. */}
      {content.stats.length > 0 && (
        <section className="mb-20 md:mb-28 border-y py-10">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {content.stats.map(s => (
              <div key={s.label}>
                <dt className="font-display text-title font-normal text-brand-700 dark:text-brand-400">{s.value}</dt>
                <dd className="text-label text-muted-foreground mt-2 max-w-[28ch]">{s.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Product groups. Feature cards are borderless surfaces lifted off the
          tinted paper by a hairline shadow — the border returns in dark mode,
          where shadows don't read. */}
      {content.productGroups.map(group => (
        <section key={group.label} className="mb-20 md:mb-28">
          {group.eyebrow && <Eyebrow>{group.eyebrow}</Eyebrow>}
          <h2 className="font-display text-title font-normal">{group.label}</h2>
          <p className="text-muted-foreground max-w-[640px] mt-3 mb-10">{group.description}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {group.features.map(f => {
              const Icon = resolveIcon(f.icon)
              return (
                <div key={f.title} className="rounded-card bg-card p-7 shadow-sm dark:shadow-none dark:border flex flex-col">
                  <Icon className="h-5 w-5 text-brand-700 dark:text-brand-400 shrink-0 mb-4" />
                  <h3 className="text-base font-medium mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground mb-5">{f.text}</p>
                  {f.screenshot && (
                    <div className="relative h-[180px] rounded-md border overflow-hidden mt-auto">
                      <Image src={f.screenshot} alt={f.title} fill sizes="(max-width: 768px) 100vw, 40vw" className="object-cover object-left-top" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {/* Why — deliberately no card chrome, so it reads as a lighter register
          than the feature grid above it rather than more of the same. */}
      {content.why.length > 0 && (
        <section className="mb-20 md:mb-28">
          <Eyebrow>Why Hemrock</Eyebrow>
          <h2 className="font-display text-title font-normal mb-10">Why should you use this?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
            {content.why.map(w => {
              const Icon = resolveIcon(w.icon)
              return (
                <div key={w.title}>
                  <Icon className="h-5 w-5 text-brand-700 dark:text-brand-400 mb-4" />
                  <h3 className="text-sm font-medium mb-1.5">{w.title}</h3>
                  <p className="text-sm text-muted-foreground">{w.text}</p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Pricing — the one place that keeps a visible border, so the decision
          moment carries more weight than a feature tile. */}
      {content.pricing.tiers.length > 0 && (
        <section className="mb-20 md:mb-28">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="font-display text-title font-normal">Pricing</h2>
          {content.pricing.note && <p className="text-sm text-muted-foreground mt-3 mb-10 max-w-[640px]">{renderInlineMarkdown(content.pricing.note)}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {content.pricing.tiers.map(tier => (
              <div
                key={tier.name}
                className={`rounded-card p-7 flex flex-col relative bg-card ${tier.badge ? 'border-2 border-brand-700 dark:border-brand-500' : 'border'}`}
              >
                {tier.badge && (
                  <span className="absolute -top-3 left-6 bg-brand text-brand-foreground text-eyebrow uppercase px-2.5 py-1 rounded-full">
                    {tier.badge}
                  </span>
                )}
                <h3 className="text-sm font-medium text-muted-foreground">{tier.name}</h3>
                <p className="font-display text-heading font-normal mt-2 mb-1">{tier.price}</p>
                {tier.subtitle && <p className="text-caption text-muted-foreground mb-5">{tier.subtitle}</p>}
                <ul className="text-sm text-muted-foreground space-y-2 mb-6 flex-1">
                  {tier.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
                <TierCta tier={tier} featured={Boolean(tier.badge)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      {content.faqs.length > 0 && (
        <section className="mb-20 md:mb-28">
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="font-display text-title font-normal mb-8">Common Questions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
            {content.faqs.map((f, i) => (
              <details key={i} className="group border-b">
                <summary className="flex cursor-pointer items-center gap-3 py-4 text-base font-medium [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-4 w-4 text-brand-700 dark:text-brand-400 shrink-0 transition-transform duration-200 ease-out-soft group-open:rotate-90" />
                  {f.q}
                </summary>
                <p className="pl-7 pb-4 text-sm text-muted-foreground">{renderInlineMarkdown(f.a)}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* About + optional CFO / Head of AI callout */}
      {(content.about.name || content.cfoCallout) && (
        <section className="mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
            {content.about.name && (
              <div className={`${content.cfoCallout ? 'sm:col-span-3' : 'sm:col-span-4'} rounded-card bg-muted/60 p-7 flex flex-col sm:flex-row items-start gap-5`}>
                {content.about.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={content.about.photo} alt={content.about.name} width={128} height={128} className="rounded-card w-full h-auto sm:w-32 sm:h-32 sm:object-cover shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground break-words">{renderInlineMarkdown(content.about.bio)}</p>
                  {content.about.links.length > 0 && (
                    <ul className="text-sm text-muted-foreground mt-4 flex flex-wrap gap-x-4 gap-y-1">
                      {content.about.links.map(l => (
                        <li key={l.href}><a href={l.href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">{l.label}</a></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {/* Was an amber alert box, which read as a validation warning. Amber is
                the app's warning colour; this is an invitation, so it takes the brand. */}
            {content.cfoCallout && (
              <a
                href={content.cfoCallout.href}
                target="_blank"
                rel="noopener noreferrer"
                className="relative rounded-card border border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950 p-7 flex flex-col transition-colors duration-200 ease-out-soft hover:bg-brand-100 dark:hover:bg-brand-900"
              >
                {content.cfoCallout.badge && (
                  <span className="absolute -top-3 left-6 bg-brand text-brand-foreground text-eyebrow uppercase px-2.5 py-1 rounded-full">
                    {content.cfoCallout.badge}
                  </span>
                )}
                {content.cfoCallout.title && <h3 className="text-base font-medium mb-2">{content.cfoCallout.title}</h3>}
                <p className="text-sm text-muted-foreground">{renderInlineMarkdown(content.cfoCallout.text)}</p>
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
