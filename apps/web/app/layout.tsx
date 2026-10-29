import type { Metadata } from 'next'
import { Barlow_Condensed, Azeret_Mono } from 'next/font/google'
import './globals.css'

// Barlow Condensed for signage-style panel legends, Azeret Mono for the
// numeric readouts. Both chosen against the hardware idiom: condensed
// industrial lettering and a mono with real character for the display glass.
const barlow = Barlow_Condensed({
  variable: '--font-barlow',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const azeret = Azeret_Mono({
  variable: '--font-azeret',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
})

export const metadata: Metadata = {
  title: 'KeyChange — local audio studio',
  description: 'Analyse key and BPM, shift pitch and speed, loop, separate stems and export. Runs locally.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${azeret.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
