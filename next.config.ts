import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships native binaries; the API route loads it at runtime.
  serverExternalPackages: ["sharp"],

  async headers() {
    return [
      {
        // The codecs are rebuilt with the app and never change in place, and
        // they are big enough that re-fetching them is noticeable.
        source: "/codecs/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
