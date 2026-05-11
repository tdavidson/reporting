import { ogMetadata } from '@/lib/og-metadata'
import { FileText } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'LP Letters',
  description: 'Generate AI-drafted quarterly LP update letters from your portfolio data with customizable templates.',
})

export default function LettersExplainerPage() {
  return (
    <ExplainerContent
      title="LP Letters"
      icon={FileText}
      screenshotSrc="/screenshots/letters.png"
      screenshotLabel="LP Letters"
    >
      <p className="text-muted-foreground">
        LP Letters helps you generate quarterly update letters for your limited partners.
        Using AI and your portfolio data - reported metrics, company summaries, investment
        performance, and team notes - the system drafts professional LP communications
        scoped to a specific portfolio group and reporting period.
      </p>
      <p className="text-muted-foreground">
        <strong>Creating a letter</strong> - click &ldquo;New letter&rdquo; and select the year,
        quarter, portfolio group, and template. Optionally toggle &ldquo;year-end summary&rdquo; for
        Q4 letters and add custom instructions to guide the AI. A preview step shows the companies
        and data that will be included before generation begins.
      </p>
      <p className="text-muted-foreground">
        <strong>Templates</strong> - upload a previous LP letter (.docx or .pdf) and AI analyzes
        it to match your writing style, tone, and structure. Or use the built-in default template.
        Templates are reusable across letters and managed from the Templates dialog on the LP Letters page.
      </p>
      <p className="text-muted-foreground">
        <strong>Generation</strong> - the AI generates a narrative for each company in the portfolio
        group, drawing on reported metrics, recent trends, company summaries, investment data, and team
        notes. A portfolio summary table with investment performance is also generated. The full letter
        is assembled from these sections.
      </p>
      <p className="text-muted-foreground">
        <strong>Editing</strong> - after generation, the letter opens in an editor with two views:
        &ldquo;Sections&rdquo; shows each company narrative individually for targeted editing,
        and &ldquo;Full&rdquo; shows the complete assembled letter. Edit narratives inline, regenerate
        individual company sections or the entire letter, and add per-company or global custom prompts
        to refine the output. Per-company prompts can either add to or replace the default generation prompt.
      </p>
      <p className="text-muted-foreground">
        <strong>Export</strong> - export the finished letter as a .docx file for final formatting
        and distribution. If Google Drive is connected, you can export directly to Drive.
      </p>
    </ExplainerContent>
  )
}
