export default function SupportPage() {
  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
      </div>

      <div className="space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="text-base font-medium mb-2">Fund Data & Account Setup</h2>
          <p className="text-muted-foreground">
            For questions about your fund data, company information, metrics configuration, or account setup,
            please contact the admin for your account at your fund. They can help with managing companies,
            configuring metrics, adjusting settings, and granting access to team members.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium mb-2">Platform & Technical Support</h2>
          <p className="text-muted-foreground">
            This platform was created by Taylor Davidson of{' '}
            <a
              href="https://www.hemrock.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              Hemrock
            </a>
            . For technical questions, feature requests, or bug reports, please reach out to Taylor directly
            or open an issue on{' '}
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
      </div>
    </div>
  )
}
