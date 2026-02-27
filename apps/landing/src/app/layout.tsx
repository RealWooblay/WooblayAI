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
  title: 'Wooblay — Enterprise AI Agent Governance',
  description:
    'One governance layer for every AI agent in your organization. Policy enforcement, credential isolation, human approvals, and a cryptographic audit trail.',
  openGraph: {
    title: 'Wooblay — Enterprise AI Agent Governance',
    description:
      'One governance layer for every AI agent. Policy enforcement, credential isolation, human approvals, cryptographic audit trail. SOC 2 ready.',
    type: 'website',
    url: 'https://wooblay.com',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@RealWooblay',
    title: 'Wooblay — Enterprise AI Agent Governance',
    description:
      'One governance layer for every AI agent. Credential isolation, human approvals, cryptographic audit trail.',
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
