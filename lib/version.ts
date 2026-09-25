import pkg from '@/package.json'

export const APP_VERSION: string = pkg.version

/** Read the installation_id from app_settings */
export async function getInstallationId(
  supabase: { from: (table: string) => any }
): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('installation_id')
    .limit(1)
    .single()
  return data?.installation_id ?? null
}

interface UpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  publishedAt: string
  body: string
  htmlUrl: string
}

/** Compare local version against latest GitHub release */
export async function checkForUpdate(
  installationId?: string | null
): Promise<UpdateInfo | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
    }
    if (installationId) {
      headers['X-Installation-Id'] = installationId
    }

    const res = await fetch(
      'https://api.github.com/repos/tdavidson/otheradmin/releases/latest',
      { headers, next: { revalidate: 3600 } }
    )
    if (!res.ok) return null

    const release = await res.json()
    const tag: string = release.tag_name ?? ''
    const latestVersion = tag.replace(/^v/, '')

    return {
      hasUpdate: compareSemver(latestVersion, APP_VERSION) > 0,
      latestVersion,
      publishedAt: release.published_at ?? '',
      body: release.body ?? '',
      htmlUrl: release.html_url ?? '',
    }
  } catch {
    return null
  }
}

/**
 * Simple semver comparison: returns positive if a > b, negative if a < b, 0 if equal.
 * Only handles numeric major.minor.patch.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}
