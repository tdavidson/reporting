import { API_VERSION, PRESENTATION_BLOCKS_VERSION, SERVER_VERSION } from '@/lib/api-v1/constants'
import { requestId, v1Json } from '@/lib/api-v1/response'

export const dynamic = 'force-dynamic'

export async function GET() {
  const id = requestId()
  return v1Json({
    product: 'reporting',
    serverVersion: SERVER_VERSION,
    apiVersions: [API_VERSION],
    minimumIosAppVersion: null,
    oauth: {
      authorizationServerMetadata: '/.well-known/oauth-authorization-server',
      dynamicClientRegistration: true,
      pkceMethods: ['S256'],
    },
    capabilities: {
      chat: true,
      structuredBlocksVersion: PRESENTATION_BLOCKS_VERSION,
      pendingActions: true,
    },
  }, {
    requestId: id,
    cacheControl: 'public, max-age=300',
  })
}

