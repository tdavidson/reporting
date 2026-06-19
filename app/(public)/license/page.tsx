import { ogMetadata } from '@/lib/og-metadata'
import { Scale } from 'lucide-react'

export const metadata = ogMetadata({
  title: 'License',
  description: 'The portfolio reporting software is open source under the Apache License 2.0 — free to use, modify, and deploy.',
})

export default function LicensePage() {
  return (
    <div className="p-4 pt-6 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
        <Scale className="h-6 w-6 text-muted-foreground" />
        License
      </h1>

      <div className="mt-6 max-w-3xl text-sm leading-relaxed space-y-8">
        {/* Summary */}
        <div>
          <h2 className="text-base font-medium mb-2">Apache License 2.0</h2>
          <p className="text-muted-foreground mb-2">
            This software is open source under the Apache License, Version 2.0. You are free to use
            it, modify it, deploy it on your own infrastructure, and build on it, for personal use,
            for your own fund, or commercially. There are no per-seat fees and no single-fund
            restriction. The license also includes an express grant of patent rights from
            contributors.
          </p>
          <p className="text-muted-foreground mb-2">
            If you redistribute the software or a modified version, the Apache License asks you to
            keep the existing copyright, license, and attribution notices, to note any files you
            changed, and to include a copy of the license and the{' '}
            <code className="text-foreground">NOTICE</code> file.
          </p>
          <p className="text-muted-foreground mb-2">
            The license covers the source code and documentation in the{' '}
            <a
              href="https://github.com/tdavidson/reporting"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              GitHub repository
            </a>
            . Per Section 6 of the license, it does not grant rights to the &ldquo;Hemrock&rdquo; or
            &ldquo;Unstructured Ventures&rdquo; names or logos. If you fork or redeploy the
            software, please use your own branding.
          </p>
          <p className="text-muted-foreground">
            The software is provided &ldquo;as is,&rdquo; without warranties or conditions of any
            kind. Need help deploying, hosting, or supporting it?{' '}
            <a
              href="mailto:hello@hemrock.com"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              hello@hemrock.com
            </a>
            .
          </p>
        </div>

        {/* Full license text */}
        <div>
          <h2 className="text-base font-medium mb-2">Full license text</h2>
          <p className="text-muted-foreground">
            Read the complete Apache License 2.0 in the{' '}
            <a
              href="https://github.com/tdavidson/reporting/blob/main/LICENSE.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              LICENSE.md
            </a>{' '}
            file, or at{' '}
            <a
              href="https://www.apache.org/licenses/LICENSE-2.0"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              apache.org/licenses/LICENSE-2.0
            </a>
            .
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Copyright &copy; 2026 Unstructured Ventures, LLC. Licensed under the Apache License,
          Version 2.0.
        </p>
      </div>
    </div>
  )
}
