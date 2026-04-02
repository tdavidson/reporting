import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f1117',
        }}
      >
        {/* Parallax brand mark — extracted from the geometric symbol (the parallel lines) */}
        <svg
          width="26"
          height="26"
          viewBox="408 33 159 112"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
        >
          <path d="M541.265 0H433.737V6.231H433.741L450.201 20.996H524.801L541.261 6.231H541.265V0Z" fill="white" transform="translate(0 33.452)" />
          <path d="M433.796 143.831H541.324V137.6H433.796V143.831Z" fill="white" />
          <path d="M566.402 33.452H408.599V39.683H566.402V33.452Z" fill="white" />
          <path d="M408.599 100.863H566.402V107.094H408.599V100.863Z" fill="white" />
          <path d="M580 67.66H395V73.891H580V67.66Z" fill="white" />
          <path d="M541.351 137.6L529.662 119.617H445.527L433.838 137.6H541.351Z" fill="white" />
          <path d="M454.214 48.223L408.599 39.685H566.402L520.787 48.223H454.214Z" fill="white" />
          <path d="M433.27 86.351L408.599 100.863H566.402L541.265 86.351H433.27Z" fill="white" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
