import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { APP_VERSION, checkForUpdate, getInstallationId } from '@/lib/version'

export const metadata = { title: 'Updates' }

export default async function UpdatesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // Check admin
  const { data: member } = await supabase
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (member?.role !== 'admin') redirect('/dashboard')

  const admin = createAdminClient()
  const [update, installationId] = await Promise.all([
    checkForUpdate(),
    getInstallationId(admin),
  ])

  return (
    <div className="p-6 md:p-10 max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Updates</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Check for new versions of the reporting platform.
        </p>
      </div>

      <div className="rounded-card border p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Current version</p>
            <p className="text-lg font-mono font-medium">v{APP_VERSION}</p>
          </div>
          {update && (
            <div>
              <p className="text-sm text-muted-foreground">Latest version</p>
              <p className={`text-lg font-mono font-medium ${update.hasUpdate ? 'text-warning dark:text-warning' : 'text-success dark:text-success'}`}>
                v{update.latestVersion}
              </p>
            </div>
          )}
        </div>

        {update?.hasUpdate ? (
          <div className="rounded-card bg-warning-subtle dark:bg-warning-subtle/30 border border-warning p-4">
            <p className="text-sm font-medium text-warning">
              A new version is available!
            </p>
            <p className="text-xs text-warning mt-1">
              Published {new Date(update.publishedAt).toLocaleDateString()}
            </p>
          </div>
        ) : update ? (
          <div className="rounded-card bg-success-subtle dark:bg-success-subtle/30 border border-success p-4">
            <p className="text-sm font-medium text-success">
              You&apos;re up to date!
            </p>
          </div>
        ) : (
          <div className="rounded-md bg-muted p-4">
            <p className="text-sm text-muted-foreground">
              Unable to check for updates. This may be due to network connectivity or GitHub API rate limits.
            </p>
          </div>
        )}
      </div>

      {update?.hasUpdate && update.body && (
        <div className="rounded-card border p-6 space-y-3">
          <h2 className="text-lg font-semibold">Release Notes</h2>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
            {update.body}
          </div>
          <a
            href={update.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline mt-2"
          >
            View release on GitHub &rarr;
          </a>
        </div>
      )}

      {update?.hasUpdate && <div className="rounded-card border p-6 space-y-3">
        <h2 className="text-lg font-semibold">How to Update</h2>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>To update your deployment, pull the latest code from GitHub and redeploy:</p>
          <pre className="rounded-md bg-muted p-3 font-mono text-xs overflow-x-auto">
{`cd reporting
git pull origin main
npm install
`}
          </pre>
          <p>
            Then redeploy on your hosting platform (Netlify, Vercel, etc.). If the new release includes
            database migrations, run them against your Supabase project:
          </p>
          <pre className="rounded-md bg-muted p-3 font-mono text-xs overflow-x-auto">
{`npx supabase db push`}
          </pre>
          <p>
            Or paste any new migration files from <span className="font-mono">supabase/migrations/</span> into the
            Supabase SQL Editor in filename order. Check the{' '}
            <a
              href="https://github.com/tdavidson/reporting/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              release notes
            </a>
            {' '}for details on what changed in each version.
          </p>
        </div>
      </div>}

      {installationId && (
        <p className="text-xs text-muted-foreground/60 font-mono">
          Installation ID: {installationId}
        </p>
      )}
    </div>
  )
}
