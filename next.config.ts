import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // emusks / cycletls はネイティブバイナリを spawn するのでバンドルさせない
  serverExternalPackages: ["emusks", "cycletls"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
};

export default nextConfig;
