import yaml from 'js-yaml'
import type { MemoDraftOutput } from '@/lib/memo-agent/stages/draft'
import type { DimensionScore } from '@/lib/memo-agent/stages/score'

export interface RenderInput {
  memo: MemoDraftOutput & { scores?: DimensionScore[] }
  memoOutputYaml: string
  rubricYaml: string
  isDraft: boolean
  dealName: string
  draftVersion: string
}

const SECTION_FALLBACK_ORDER = [
  'header',
  'executive_summary',
  'recommendation',
  'company_overview',
  'product',
  'market',
  'traction',
  'business_model',
  'team',
  'competition_moat',
  'outcomes_analysis',
  'deal_terms',
  'risks_and_open_questions',
  'scoring_summary',
  'appendix',
  // Backward-compat: legacy schemas used 'product_technology' instead of 'product'.
  // Keep it in the fallback order so older drafts render in roughly the same slot.
  'product_technology',
]

/**
 * Markdown render of a memo draft.
 *
 * Conforms to memo_output.yaml's section order. Each prose paragraph carries
 * inline citation markers (`[1][2]…`) that resolve to the appendix citation
 * map at the bottom of the doc. Projections and unverified claims are
 * marked inline (`[projection]`, `⚠ unverified`).
 */
export function renderMarkdown(input: RenderInput): string {
  const sections = parseSections(input.memoOutputYaml)
  const baseOrder = sections.length ? sections.map(s => s.id) : SECTION_FALLBACK_ORDER
  // Append section_ids from paragraphs that aren't in the schema's order —
  // keeps newly-added memo sections renderable on funds with older schemas.
  const paragraphSectionIds = Array.from(new Set(input.memo.paragraphs.map(p => p.section_id)))
  const extras = paragraphSectionIds.filter(id => !baseOrder.includes(id))
  const sectionOrder = [...baseOrder, ...extras]
  const sectionMeta = new Map(sections.map(s => [s.id, s]))
  // Fill in fallback meta for any section id in the order that the parsed
  // YAML didn't define — keeps render output non-empty when the schema is
  // missing or stale.
  for (const id of sectionOrder) {
    if (!sectionMeta.has(id)) {
      sectionMeta.set(id, { id, title: id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), kind: id === 'scoring_summary' || id === 'appendix' ? 'structured' : 'prose' })
    }
  }

  // Group paragraphs by section.
  const paragraphsBySection = new Map<string, typeof input.memo.paragraphs>()
  for (const p of input.memo.paragraphs) {
    if (!paragraphsBySection.has(p.section_id)) paragraphsBySection.set(p.section_id, [])
    paragraphsBySection.get(p.section_id)!.push(p)
  }

  // Build a stable citation key list as we walk paragraphs in order.
  const citationKeys: string[] = []
  function citeNumber(sourceType: string, sourceId: string): number {
    const key = `${sourceType}:${sourceId}`
    const idx = citationKeys.indexOf(key)
    if (idx >= 0) return idx + 1
    citationKeys.push(key)
    return citationKeys.length
  }

  const lines: string[] = []

  if (input.isDraft) lines.push('# DRAFT — not finalized', '')

  // Header
  const header = input.memo.header ?? {}
  lines.push(`# ${header.company_name ?? input.dealName}`)
  const headerBits: string[] = []
  if (header.sector) headerBits.push(header.sector)
  if (header.stage) headerBits.push(header.stage)
  if (header.round_size) headerBits.push(header.round_size)
  if (headerBits.length) lines.push(`*${headerBits.join(' · ')}*`)
  lines.push('')
  if (header.deal_lead) lines.push(`Deal lead: ${header.deal_lead}`)
  else lines.push('Deal lead: *[Partner to complete]*')
  if (header.memo_date) lines.push(`Date: ${header.memo_date}`)
  lines.push(`Version: ${input.draftVersion} · Agent: ${header.agent_version ?? 'memo-agent v0.1'}`)
  lines.push('')

  for (const sectionId of sectionOrder) {
    if (sectionId === 'header') continue
    const meta = sectionMeta.get(sectionId)
    if (!meta) continue

    if (meta.kind === 'structured' && sectionId === 'scoring_summary') {
      lines.push(`## ${meta.title}`)
      lines.push('')
      lines.push(...renderScoresMarkdown(input.memo.scores ?? []))
      lines.push('')
      continue
    }
    if (meta.kind === 'structured' && sectionId === 'appendix') {
      lines.push(`## ${meta.title}`)
      lines.push('')
      lines.push(...renderCitations(citationKeys))
      lines.push('')
      continue
    }

    const paragraphs = paragraphsBySection.get(sectionId) ?? []
    if (paragraphs.length === 0) continue

    lines.push(`## ${meta.title}`)
    lines.push('')

    paragraphs
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach(p => {
        // Inline markers
        const markers: string[] = []
        if (p.contains_projection) markers.push('[projection]')
        if (p.contains_unverified_claim) markers.push('⚠ unverified')
        if (p.contains_contradiction) markers.push('†contradiction')
        const markerSuffix = markers.length ? ` *${markers.join(' · ')}*` : ''

        let prose = p.prose
        if (p.origin === 'partner_only_placeholder') {
          prose = `*${prose}*`
        }

        // Citation footnotes
        const citationNumbers = (p.sources ?? [])
          .filter(s => s.source_type !== 'partner_only')
          .map(s => citeNumber(s.source_type, s.source_id))
        const cites = citationNumbers.length ? ' ' + citationNumbers.map(n => `[${n}]`).join('') : ''

        lines.push(`${prose}${cites}${markerSuffix}`)
        lines.push('')
      })
  }

  return lines.join('\n')
}

function renderScoresMarkdown(scores: DimensionScore[]): string[] {
  if (scores.length === 0) return ['*No scores yet.*']
  const lines: string[] = []
  lines.push('| Dimension | Mode | Score | Confidence | Rationale |')
  lines.push('|---|---|---|---|---|')
  for (const s of scores) {
    const score = s.score === null ? (s.mode === 'partner_only' ? '*[partner]*' : '—') : String(s.score)
    const conf = s.confidence ?? '—'
    const rationale = (s.rationale ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${s.dimension_id} | ${s.mode} | ${score} | ${conf} | ${rationale} |`)
  }
  return lines
}

function renderCitations(keys: string[]): string[] {
  if (keys.length === 0) return ['*No citations.*']
  const lines: string[] = []
  keys.forEach((key, i) => {
    const [type, ...rest] = key.split(':')
    const id = rest.join(':')
    lines.push(`${i + 1}. **${type}** — \`${id}\``)
  })
  return lines
}

interface SectionMeta { id: string; title: string; kind?: string }
function parseSections(yamlText: string): SectionMeta[] {
  try {
    const parsed = yaml.load(yamlText) as any
    const sections = parsed?.memo_structure?.sections
    if (!Array.isArray(sections)) return []
    return sections.map((s: any) => ({ id: s.id, title: s.title ?? s.id, kind: s.kind }))
  } catch {
    return []
  }
}
