const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export async function getAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth not configured (missing client ID or client secret)')
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to refresh Google token: ${text}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Google token refresh did not return an access token')
  }
  return data.access_token
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
}

export interface DriveFileWithMeta extends DriveFile {
  size?: number
  webViewLink?: string
}

/**
 * List the files (not folders) directly inside a Drive folder. Used by the
 * Diligence "import data room from Drive folder" flow.
 *
 * Pagination: returns up to 1000 files (10 pages × 100). Most data rooms are
 * smaller than this; if a fund hits the limit we'll add proper pagination.
 */
export async function listFiles(accessToken: string, folderId: string): Promise<DriveFileWithMeta[]> {
  if (!folderId || !/^[a-zA-Z0-9_-]+$/.test(folderId)) {
    throw new Error('Invalid folder ID')
  }

  const q = `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`
  const out: DriveFileWithMeta[] = []
  let pageToken: string | undefined
  for (let i = 0; i < 10; i++) {
    const url = new URL(`${DRIVE_API}/files`)
    url.searchParams.set('q', q)
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,webViewLink)')
    url.searchParams.set('orderBy', 'name')
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('includeItemsFromAllDrives', 'true')
    url.searchParams.set('supportsAllDrives', 'true')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to list files: ${text}`)
    }
    const data = await res.json()
    for (const f of data.files ?? []) {
      out.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? parseInt(f.size, 10) : undefined,
        webViewLink: f.webViewLink,
      })
    }
    pageToken = data.nextPageToken
    if (!pageToken) break
  }
  return out
}

/**
 * Download a file's bytes from Drive. Used during the from-drive import to
 * pull the file content into Supabase storage.
 */
export async function downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    throw new Error('Invalid file ID')
  }
  const url = new URL(`${DRIVE_API}/files/${fileId}`)
  url.searchParams.set('alt', 'media')
  url.searchParams.set('supportsAllDrives', 'true')
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to download file: ${text}`)
  }
  const arr = await res.arrayBuffer()
  return Buffer.from(arr)
}

/**
 * Extract a Google Drive folder ID from a URL like
 *   https://drive.google.com/drive/folders/<id>
 *   https://drive.google.com/drive/u/0/folders/<id>
 *   https://drive.google.com/drive/folders/<id>?usp=sharing
 * Returns null if the URL doesn't look like a Drive folder URL.
 */
export function parseDriveFolderUrl(url: string): string | null {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

export async function listFolders(
  accessToken: string,
  parentId?: string,
  sharedWithMe?: boolean
): Promise<DriveFile[]> {
  let q: string
  if (sharedWithMe) {
    q = `sharedWithMe=true and mimeType='application/vnd.google-apps.folder' and trashed=false`
  } else {
    const parent = parentId || 'root'
    if (parent !== 'root' && !/^[a-zA-Z0-9_-]+$/.test(parent)) {
      throw new Error('Invalid parent folder ID')
    }
    q = `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  }

  const url = new URL(`${DRIVE_API}/files`)
  url.searchParams.set('q', q)
  url.searchParams.set('fields', 'files(id,name,mimeType)')
  url.searchParams.set('orderBy', 'name')
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('includeItemsFromAllDrives', 'true')
  url.searchParams.set('supportsAllDrives', 'true')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to list folders: ${text}`)
  }

  const data = await res.json()
  return data.files ?? []
}

export async function findOrCreateFolder(
  accessToken: string,
  parentId: string,
  folderName: string
): Promise<string> {
  if (parentId !== 'root' && !/^[a-zA-Z0-9_-]+$/.test(parentId)) {
    throw new Error('Invalid parent folder ID')
  }
  // Search for existing folder
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`

  const searchUrl = new URL(`${DRIVE_API}/files`)
  searchUrl.searchParams.set('q', q)
  searchUrl.searchParams.set('fields', 'files(id)')
  searchUrl.searchParams.set('pageSize', '1')

  const searchRes = await fetch(searchUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (searchRes.ok) {
    const searchData = await searchRes.json()
    if (searchData.files?.length > 0) {
      return searchData.files[0].id
    }
  }

  // Create the folder
  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  })

  if (!createRes.ok) {
    const text = await createRes.text()
    throw new Error(`Failed to create folder "${folderName}": ${text}`)
  }

  const created = await createRes.json()
  return created.id
}

export async function uploadFile(
  accessToken: string,
  folderId: string,
  filename: string,
  content: Buffer | string,
  mimeType: string,
  options?: { convert?: boolean }
): Promise<string> {
  const metadata: Record<string, unknown> = {
    name: filename,
    parents: [folderId],
  }

  // When convert is true, set the target mimeType in metadata so Drive auto-converts
  if (options?.convert) {
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      metadata.mimeType = 'application/vnd.google-apps.document'
    }
  }

  const contentBuffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content

  // Use resumable upload for files > 4MB, multipart for smaller files
  let res: Response
  if (contentBuffer.length > 4 * 1024 * 1024) {
    // Step 1: Initiate resumable upload
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(contentBuffer.length),
        },
        body: JSON.stringify(metadata),
      }
    )
    if (!initRes.ok) {
      const text = await initRes.text()
      throw new Error(`Failed to initiate upload for "${filename}": ${text}`)
    }
    const uploadUrl = initRes.headers.get('Location')
    if (!uploadUrl) throw new Error(`No upload URL returned for "${filename}"`)

    // Step 2: Upload the file content
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(contentBuffer.length),
        'Content-Type': mimeType,
      },
      body: new Uint8Array(contentBuffer),
    })
  } else {
    const boundary = '----DriveUploadBoundary' + Date.now()
    const metadataPart = JSON.stringify(metadata)
    const bodyParts = [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      metadataPart,
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
    ]

    const prefix = Buffer.from(bodyParts.join(''))
    const suffix = Buffer.from(`\r\n--${boundary}--`)
    const body = Buffer.concat([prefix, contentBuffer, suffix])

    res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    )
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to upload file "${filename}": ${text}`)
  }

  const data = await res.json()
  return data.id
}
