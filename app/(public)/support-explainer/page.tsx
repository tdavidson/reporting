import { LifeBuoy } from 'lucide-react'

export default function SupportExplainerPage() {
  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-3">
        <LifeBuoy className="h-6 w-6 text-muted-foreground" />
        Support
      </h1>

      <div className="space-y-8 text-sm leading-relaxed">
        {/* Contact info */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-medium mb-2">Need help?</h2>
          <p className="text-muted-foreground">
            For technical questions, feature requests, or bug reports,
            reach out to Taylor Davidson at{' '}
            <a
              href="https://www.hemrock.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              Hemrock
            </a>
            {' '}or open an issue on{' '}
            <a
              href="https://github.com/tdavidson/reporting"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              GitHub
            </a>
            .
          </p>
        </div>

        {/* Documentation */}
        <div>
          <h2 className="text-base font-medium mb-2">Documentation</h2>
          <p className="text-muted-foreground">
            Each feature has its own page in the sidebar that explains what it does and how it works.
            The deployed product behind authentication includes additional documentation in its
            Support section with detailed guides and usage instructions.
          </p>
        </div>
      </div>
    </div>
  )
}
