import './tokens.css'
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
        {/* Self-hosted from @tabler/icons-webfont 3.46.0, rather than
            @latest from a third-party CDN. @latest meant a stylesheet this
            app never reviewed could change under it at any time — and it
            already had: ti-blueprint existed in v2 and does not in v3, so
            the CAD file-type icons had silently become empty boxes.
            Serving it ourselves also drops a render-blocking request to
            another origin. Regular weight, woff2 only. */}
        <link rel="preload" as="font" type="font/woff2" href="/fonts/tabler-icons.woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/fonts/tabler-icons.min.css" />
      </head>
      <body>{children}</body>
    </html>
  )
}
