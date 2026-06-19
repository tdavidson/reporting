import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const title = searchParams.get('title') || 'Portfolio Reporting'
  const subtitle = searchParams.get('subtitle') || ''

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 80px',
          backgroundColor: '#09090b',
          color: '#fafafa',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 500,
              color: '#a1a1aa',
              letterSpacing: '-0.01em',
            }}
          >
            Analyst by Hemrock
          </div>
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: 1.1,
              maxWidth: '900px',
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: 24,
                color: '#a1a1aa',
                marginTop: '8px',
                maxWidth: '800px',
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '60px',
            left: '80px',
            right: '80px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 18, color: '#71717a' }}>
            portfolio.hemrock.com
          </div>
          <div
            style={{
              fontSize: 14,
              color: '#52525b',
              display: 'flex',
              gap: '16px',
            }}
          >
            <span>Open source</span>
            <span>·</span>
            <span>AI-powered</span>
            <span>·</span>
            <span>Self-hosted or managed</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  )
}
