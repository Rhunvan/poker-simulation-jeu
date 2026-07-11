import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import '../src/index.css'

const title = 'Pokernaud — table privée'
const description = 'Simulation de cash game privée et assistant GTO adapté à la table réelle.'

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers()
  const host = (requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost')
    .split(',')[0]
    .trim()
  const forwardedProtocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProtocol === 'http' || host.startsWith('localhost') || host.startsWith('127.0.0.1')
    ? 'http'
    : 'https'
  const metadataBase = new URL(`${protocol}://${host}`)

  return {
    metadataBase,
    title,
    description,
    icons: {
      icon: '/favicon.svg',
      shortcut: '/favicon.svg',
    },
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Pokernaud — table privée' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og.png'],
    },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#090c0a',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
