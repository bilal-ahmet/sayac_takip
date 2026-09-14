import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // mqtt, Next'in yerleşik harici paket listesinde YOK (pg var, bu yüzden db.ts
  // ayar gerektirmiyor). Bundle'lanırsa paketin "browser" koşulu seçilip net/tls
  // modülleri stub'lanabilir ve TLS transport'u sessizce kaybolur — build hatası
  // vermez, runtime'da anlaşılmaz bir şekilde bağlanamaz.
  serverExternalPackages: ["mqtt"],
};

export default nextConfig;
