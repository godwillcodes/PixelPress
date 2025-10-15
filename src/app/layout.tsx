import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

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
    default: "Exact80 - Precision Image Compression to 80KB",
    template: "%s | Exact80"
  },
  description: "Professional image compression tool that converts JPEG, JPG, and PNG images to WebP or AVIF with byte-exact control targeting exactly 80,000 bytes while preserving maximum visual fidelity through advanced binary search algorithms.",
  keywords: [
    "image compression",
    "WebP converter",
    "AVIF converter", 
    "JPEG optimization",
    "PNG compression",
    "exact file size",
    "80KB compression",
    "binary search algorithm",
    "image optimization",
    "web performance",
    "Next.js image tool",
    "precision compression"
  ],
  authors: [{ name: "Exact80 Team" }],
  creator: "Exact80",
  publisher: "Exact80",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://exact80.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://exact80.com",
    siteName: "Exact80",
    title: "Exact80 - Precision Image Compression to 80KB",
    description: "Convert images to WebP or AVIF with byte-exact control targeting exactly 80,000 bytes. Professional image compression with advanced binary search algorithms.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Exact80 - Precision Image Compression Tool",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Exact80 - Precision Image Compression to 80KB",
    description: "Convert images to WebP or AVIF with byte-exact control targeting exactly 80,000 bytes.",
    images: ["/og-image.png"],
    creator: "@exact80",
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
  verification: {
    google: "your-google-verification-code",
    yandex: "your-yandex-verification-code",
    yahoo: "your-yahoo-verification-code",
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
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#f97316" />
        <meta name="color-scheme" content="dark" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Exact80" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "Exact80",
              "description": "Precision image compression tool targeting exactly 80,000 bytes",
              "url": "https://exact80.com",
              "applicationCategory": "MultimediaApplication",
              "operatingSystem": "Web Browser",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "creator": {
                "@type": "Organization",
                "name": "Exact80 Team"
              },
              "featureList": [
                "Byte-exact compression to 80KB",
                "WebP and AVIF format support",
                "Binary search algorithm optimization",
                "Deterministic output",
                "Real-time compression metrics"
              ]
            })
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
