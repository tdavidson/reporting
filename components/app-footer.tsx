import Link from 'next/link'
import { Github, Scale } from 'lucide-react'

function HemrockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M13 14L17 9L22 18H2.84444C2.46441 18 2.2233 17.5928 2.40603 17.2596L10.0509 3.31896C10.2429 2.96885 10.7476 2.97394 10.9325 3.32786L15.122 11.3476" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AppFooter() {
  return (
    <footer className="flex items-center justify-start px-4 md:px-8 pt-2 pb-8 shrink-0">
      <div className="flex items-center gap-9 text-sm text-muted-foreground border-t pt-3">
        <span className="flex items-center gap-1.5">
          Made by{' '}
          <a
            href="https://hemrock.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <HemrockIcon className="h-3.5 w-3.5" />
            Hemrock
          </a>
        </span>
        <a
          href="https://github.com/tdavidson/reporting"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          View on <Github className="h-3 w-3" />
          GitHub
        </a>
        <Link
          href="/license"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <Scale className="h-3 w-3" />
          License
        </Link>
        <a
          href="https://www.hemrock.com/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Terms
        </a>
        <a
          href="https://www.hemrock.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Privacy
        </a>
      </div>
    </footer>
  )
}
