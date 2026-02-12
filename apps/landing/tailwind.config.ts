import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-space-grotesk)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'Fira Code', 'monospace'],
      },
      colors: {
        surface: {
          0: '#0A0B10',
          1: '#12131A',
          2: '#1A1B25',
          3: '#252633',
        },
        accent: {
          DEFAULT: '#34D399',
          dim: '#065F46',
          muted: '#0D9668',
        },
      },
      animation: {
        float1: 'float1 20s ease-in-out infinite',
        float2: 'float2 25s ease-in-out infinite',
        float3: 'float3 18s ease-in-out infinite',
      },
      keyframes: {
        float1: {
          '0%, 100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(40px,-30px) scale(1.08)' },
          '66%': { transform: 'translate(-25px,25px) scale(0.95)' },
        },
        float2: {
          '0%, 100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(-35px,25px) scale(0.92)' },
          '66%': { transform: 'translate(30px,-35px) scale(1.06)' },
        },
        float3: {
          '0%, 100%': { transform: 'translate(0,0)' },
          '50%': { transform: 'translate(20px,15px)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
