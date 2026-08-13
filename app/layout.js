import './globals.css'

export const metadata = {
  title: 'Relative Estates — Material Pricing',
  description: 'Material pricing and approval system',
}

// Without this, a phone browser lays the page out at about 980px and then
// scales the whole thing down — every page renders as a legible desktop
// layout shrunk to unreadable. No amount of responsive CSS below matters
// until this is set, because the media queries never match.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Left zoomable on purpose: these pages carry dense pricing tables, and
  // being able to pinch into one is the difference between usable and not.
  maximumScale: 5,
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
