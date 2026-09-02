import { NextResponse } from 'next/server'

export interface V1ErrorBody {
  error: {
    code: string
    message: string
    requestId: string
  }
}

export function requestId(): string {
  return crypto.randomUUID()
}

export function v1Json<T extends Record<string, unknown>>(
  body: T,
  options: { status?: number; requestId: string; cacheControl?: string; headers?: HeadersInit },
): NextResponse<T & { requestId: string }> {
  const headers = new Headers(options.headers)
  headers.set('Cache-Control', options.cacheControl ?? 'no-store')
  headers.set('X-Request-ID', options.requestId)
  return NextResponse.json(
    { ...body, requestId: options.requestId },
    { status: options.status ?? 200, headers },
  )
}

export function v1Error(
  code: string,
  message: string,
  status: number,
  id: string,
  headers?: HeadersInit,
): NextResponse<V1ErrorBody> {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('X-Request-ID', id)
  return NextResponse.json(
    { error: { code, message, requestId: id } },
    { status, headers: responseHeaders },
  )
}

