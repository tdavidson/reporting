import { Github, Scale, Play } from 'lucide-react'
import { FooterThemeToggle } from '@/components/footer-theme-toggle'

function HemrockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M13 14L17 9L22 18H2.84444C2.46441 18 2.2233 17.5928 2.40603 17.2596L10.0509 3.31896C10.2429 2.96885 10.7476 2.97394 10.9325 3.32786L15.122 11.3476" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// X mark, same glyph as the hemrock.com footer (monochrome via currentColor).
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="m21.742 21.75-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714h-6.189l7.29 10.776-7.399 8.724h2.456l6.035-7.118 4.818 7.118h6.191zm-14.003-17.932 11.071 16.364h-2.447l-11.073-16.364h2.447z" />
    </svg>
  )
}

// `social` adds the X link + theme toggle on the right (hemrock-style). On for the
// marketing page; off for the in-app footer, which already has theme controls elsewhere.
export function AppFooter({ social = false }: { social?: boolean }) {
  return (
    <footer className="px-4 md:px-8 pt-2 pb-8 shrink-0">
      <ul className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-9 text-sm text-muted-foreground border-t pt-3">
        <li className="flex items-center gap-1.5">
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
        </li>
        <li>
          <a
            href="https://github.com/tdavidson/reporting"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            View on <Github className="h-3 w-3" />
            GitHub
          </a>
        </li>
        <li>
          <a
            href="https://github.com/tdavidson/reporting/blob/main/LICENSE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Scale className="h-3 w-3" />
            License
          </a>
        </li>
        <li>
          <a
            href="https://www.hemrock.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Terms
          </a>
        </li>
        <li>
          <a
            href="https://www.hemrock.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Privacy
          </a>
        </li>
        {social && (
          <li className="sm:hidden">
            <a
              href="https://portfolio.hemrock.com/demo"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
              Try the Demo
            </a>
          </li>
        )}
        {social && (
          <li className="flex flex-col gap-3 sm:flex-row sm:items-center sm:ml-auto sm:gap-6">
            <a
              href="https://x.com/tdavidson"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="tdavidson on X"
              className="flex items-center gap-2 hover:text-foreground transition-colors"
            >
              <XIcon className="h-3.5 w-3.5" />
              <span className="sm:hidden">X / Twitter</span>
            </a>
            <FooterThemeToggle />
          </li>
        )}
      </ul>
    </footer>
  )
}
