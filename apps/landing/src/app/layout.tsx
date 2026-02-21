import type { Metadata } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Wooblay — The governance layer for AI agents',
  description:
    'Wooblay intercepts every AI agent action before it happens. Approve what\'s safe. Block what\'s not. Cryptographically signed audit trail for every decision.',
  openGraph: {
    title: 'Wooblay — AI agents act. You should decide.',
    description:
      'The governance layer between AI agents and the real world. Policy engine, threat detection, cryptographic receipts, human approval workflows.',
    type: 'website',
    url: 'https://wooblay.com',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@RealWooblay',
    title: 'Wooblay — AI agents act. You should decide.',
    description:
      'The governance layer between AI agents and the real world.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
