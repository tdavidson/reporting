import type { Config } from 'tailwindcss'

const config: Config = {
    darkMode: ['class'],
    content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
  			display: ['var(--font-display)', 'ui-serif', 'Georgia', 'Cambria', 'serif'],
  			serif: ['var(--font-serif)', 'ui-serif', 'Georgia', 'Cambria', 'serif'],
  			mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
  		},
  		// Named steps, added alongside Tailwind's defaults (text-xs/sm/... still work).
  		// Each carries its own line-height, tracking and — where it is part of the
  		// step's identity — weight, so an eyebrow can't be reassembled wrongly by hand.
  		fontSize: {
  			eyebrow: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.09em', fontWeight: '700' }],
  			caption: ['0.75rem', { lineHeight: '1.5' }],
  			label: ['0.8125rem', { lineHeight: '1.5' }],
  			lede: ['1.125rem', { lineHeight: '1.65', letterSpacing: '-0.005em' }],
  			heading: ['clamp(1.25rem, 2vw, 1.5rem)', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
  			title: ['clamp(1.875rem, 4vw, 2.875rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
  			display: ['clamp(2.625rem, 5.5vw, 4.25rem)', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
  		},
  		borderRadius: {
  			// --radius is the *control* radius (0.25rem, matching hemrock.com);
  			// cards use the larger --radius-card via `rounded-card`.
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 1px)',
  			sm: 'calc(var(--radius) - 2px)',
  			card: 'var(--radius-card)'
  		},
  		transitionTimingFunction: {
  			'out-soft': 'var(--ease-out)',
  			expo: 'var(--ease-expo)',
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			brand: {
  				DEFAULT: 'hsl(var(--brand))',
  				foreground: 'hsl(var(--brand-foreground))',
  				50: 'hsl(var(--brand-50))',
  				100: 'hsl(var(--brand-100))',
  				200: 'hsl(var(--brand-200))',
  				300: 'hsl(var(--brand-300))',
  				400: 'hsl(var(--brand-400))',
  				500: 'hsl(var(--brand-500))',
  				600: 'hsl(var(--brand-600))',
  				700: 'hsl(var(--brand-700))',
  				800: 'hsl(var(--brand-800))',
  				900: 'hsl(var(--brand-900))',
  				950: 'hsl(var(--brand-950))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))',
  				subtle: 'hsl(var(--success-subtle))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))',
  				subtle: 'hsl(var(--warning-subtle))'
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info))',
  				foreground: 'hsl(var(--info-foreground))',
  				subtle: 'hsl(var(--info-subtle))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))',
  				subtle: 'hsl(var(--destructive-subtle))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}

export default config
