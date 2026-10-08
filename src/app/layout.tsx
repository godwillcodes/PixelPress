import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: {
    default: "Exact80 — every image, exactly 80 KB",
    template: "%s | Exact80"
  },
  description: "Compress any image to exactly 80,000 bytes of WebP or AVIF. The best-looking version that fits, chosen by comparing candidates against the original. Runs in your browser; nothing is uploaded.",
  keywords: [
    "image compression",
    "WebP converter",
    "AVIF converter", 
    "JPEG optimization",
    "PNG compression",
    "exact file size",
    "80KB image",
    "browser image compression",
    "image optimization",
    "web performance",
    "Next.js image tool",
    "precision compression"
  ],
  authors: [{ name: "Godwill Barasa" }],
  creator: "Exact80",
  publisher: "Exact80",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://exact80.vercel.app"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://exact80.vercel.app",
    siteName: "Exact80",
    title: "Exact80 — every image, exactly 80 KB",
    description: "Compress any image to exactly 80,000 bytes of WebP or AVIF, in your browser.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Exact80 — every image, exactly 80 KB",
    description: "Compress any image to exactly 80,000 bytes of WebP or AVIF, in your browser.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "Exact80",
              "description": "Compress any image to exactly 80,000 bytes of WebP or AVIF, in your browser.",
              "url": "https://exact80.vercel.app",
              "applicationCategory": "MultimediaApplication",
              "operatingSystem": "Web Browser",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "creator": {
                "@type": "Person",
                "name": "Godwill Barasa"
              },
              "featureList": [
                "Exact 80,000-byte output",
                "WebP and AVIF",
                "Runs in the browser, no upload",
                "Deterministic output"
              ]
            })
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
