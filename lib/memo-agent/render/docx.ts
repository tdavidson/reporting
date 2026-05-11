import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, BorderStyle, WidthType } from 'docx'
import yaml from 'js-yaml'
import type { MemoDraftOutput } from '@/lib/memo-agent/stages/draft'
import type { DimensionScore } from '@/lib/memo-agent/stages/score'

interface RenderInput {
  memo: MemoDraftOutput & { scores?: DimensionScore[] }
  memoOutputYaml: string
  isDraft: boolean
  dealName: string
  draftVersion: string
}

const FALLBACK_ORDER = [
  'header', 'executive_summary', 'recommendation', 'company_overview', 'product', 'market',
  'traction', 'business_model', 'team', 'competition_moat', 'outcomes_analysis', 'deal_terms',
  'risks_and_open_questions', 'scoring_summary', 'appendix',
  // Backward-compat for drafts produced under v0.1 of memo_output.yaml.
  'product_technology',
]

/**
 * Word doc render. Reuses the docx library already in package.json (used by
 * lib/lp-letters/export.ts). Returns a Buffer suitable for upload to storage
 * or direct download.
 */
export async function renderDocx(input: RenderInput): Promise<Buffer> {
  const sections = parseSections(input.memoOutputYaml)
  const baseOrder = sections.length ? sections.map(s => s.id) : FALLBACK_ORDER
  // Append any section_ids referenced by paragraphs that aren't in the
  // schema's explicit order — keeps newly-added memo sections (product,
  // outcomes_analysis) renderable even on funds with an older schema row.
  const paragraphSectionIds = Array.from(new Set(input.memo.paragraphs.map(p => p.section_id)))
  const extras = paragraphSectionIds.filter(id => !baseOrder.includes(id))
  const order = [...baseOrder, ...extras]
  const sectionMeta = new Map(sections.map(s => [s.id, s]))
  // Fill in fallback meta for any section id in the order that the parsed
  // YAML didn't define — happens when memoOutputYaml is empty or stale.
  // Without this the loop below would skip every section and the doc would
  // come out empty.
  for (const id of order) {
    if (!sectionMeta.has(id)) {
      sectionMeta.set(id, { id, title: humanizeSectionId(id), kind: id === 'scoring_summary' || id === 'appendix' ? 'structured' : 'prose' })
    }
  }

  const paragraphsBySection = new Map<string, MemoDraftOutput['paragraphs']>()
  for (const p of input.memo.paragraphs) {
    if (!paragraphsBySection.has(p.section_id)) paragraphsBySection.set(p.section_id, [])
    paragraphsBySection.get(p.section_id)!.push(p)
  }

  // Citation key tracker (same approach as markdown).
  const citationKeys: string[] = []
  function citeNumber(sourceType: string, sourceId: string): number {
    const key = `${sourceType}:${sourceId}`
    const idx = citationKeys.indexOf(key)
    if (idx >= 0) return idx + 1
    citationKeys.push(key)
    return citationKeys.length
  }

  const children: (Paragraph | Table)[] = []

  if (input.isDraft) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'DRAFT — not finalized', bold: true, color: 'B8860B', size: 28 })],
    }))
    children.push(new Paragraph({ text: '' }))
  }

  // Header
  const header = input.memo.header ?? {}
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: header.company_name ?? input.dealName, bold: true })],
  }))
  const subBits = [header.sector, header.stage, header.round_size].filter(Boolean) as string[]
  if (subBits.length) {
    children.push(new Paragraph({
      children: [new TextRun({ text: subBits.join(' · '), italics: true })],
    }))
  }
  children.push(new Paragraph({ text: '' }))
  children.push(new Paragraph({
    children: [new TextRun({ text: `Deal lead: ${header.deal_lead ?? '[Partner to complete]'}` })],
  }))
  if (header.memo_date) children.push(new Paragraph({ children: [new TextRun({ text: `Date: ${header.memo_date}` })] }))
  children.push(new Paragraph({
    children: [new TextRun({ text: `Version: ${input.draftVersion} · Agent: ${header.agent_version ?? 'memo-agent v0.1'}`, color: '888888', size: 18 })],
  }))
  children.push(new Paragraph({ text: '' }))

  for (const sectionId of order) {
    if (sectionId === 'header') continue
    const meta = sectionMeta.get(sectionId)
    if (!meta) continue

    if (meta.kind === 'structured' && sectionId === 'scoring_summary') {
      children.push(headingPara(meta.title))
      children.push(buildScoresTable(input.memo.scores ?? []))
      children.push(new Paragraph({ text: '' }))
      continue
    }
    if (meta.kind === 'structured' && sectionId === 'appendix') {
      children.push(headingPara(meta.title))
      citationKeys.forEach((key, i) => {
        const [type, ...rest] = key.split(':')
        const id = rest.join(':')
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${i + 1}. `, bold: true }),
            new TextRun({ text: `${type} — `, italics: true }),
            new TextRun({ text: id, font: 'Courier New' }),
          ],
        }))
      })
      continue
    }

    const paragraphs = paragraphsBySection.get(sectionId) ?? []
    if (paragraphs.length === 0) continue

    children.push(headingPara(meta.title))

    paragraphs
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach(p => {
        const runs: TextRun[] = []
        const isPlaceholder = p.origin === 'partner_only_placeholder'
        runs.push(new TextRun({ text: p.prose, italics: isPlaceholder }))

        const cites = (p.sources ?? [])
          .filter(s => s.source_type !== 'partner_only')
          .map(s => citeNumber(s.source_type, s.source_id))
        if (cites.length > 0) {
          runs.push(new TextRun({ text: ` ${cites.map(n => `[${n}]`).join('')}`, superScript: true, color: '6B7280' }))
        }

        const markers: string[] = []
        if (p.contains_projection) markers.push('projection')
        if (p.contains_unverified_claim) markers.push('unverified')
        if (p.contains_contradiction) markers.push('contradiction')
        if (markers.length > 0) {
          runs.push(new TextRun({ text: ` (${markers.join(' · ')})`, italics: true, color: 'B8860B', size: 18 }))
        }

        children.push(new Paragraph({ children: runs }))
        children.push(new Paragraph({ text: '' }))
      })
  }

  const doc = new Document({ sections: [{ children }] })
  return Buffer.from(await Packer.toBuffer(doc))
}

function headingPara(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: title, bold: true })],
  })
}

function buildScoresTable(scores: DimensionScore[]): Table {
  const headerRow = new TableRow({
    children: ['Dimension', 'Mode', 'Score', 'Confidence', 'Rationale'].map(t => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
      width: { size: 20, type: WidthType.PERCENTAGE },
    })),
  })
  const rows = [headerRow, ...scores.map(s => new TableRow({
    children: [
      new TableCell({ children: [new Paragraph(s.dimension_id)] }),
      new TableCell({ children: [new Paragraph(s.mode)] }),
      new TableCell({ children: [new Paragraph(s.score === null ? (s.mode === 'partner_only' ? '[partner]' : '—') : String(s.score))] }),
      new TableCell({ children: [new Paragraph(s.confidence ?? '—')] }),
      new TableCell({ children: [new Paragraph(s.rationale ?? '')] }),
    ],
  }))]
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'EEEEEE' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'EEEEEE' },
    },
  })
}

function humanizeSectionId(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
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
