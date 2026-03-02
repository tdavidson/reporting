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

export async function listFolders(
  accessToken: string,
  parentId?: string
): Promise<DriveFile[]> {
  const parent = parentId || 'root'
  const q = `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`

  const url = new URL(`${DRIVE_API}/files`)
  url.searchParams.set('q', q)
  url.searchParams.set('fields', 'files(id,name,mimeType)')
  url.searchParams.set('orderBy', 'name')
  url.searchParams.set('pageSize', '100')

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
  mimeType: string
): Promise<string> {
  const metadata = {
    name: filename,
    parents: [folderId],
  }

  const boundary = '----DriveUploadBoundary' + Date.now()
  const contentBuffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content

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

  const res = await fetch(
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

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to upload file "${filename}": ${text}`)
  }

  const data = await res.json()
  return data.id
}
