/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The legacy static Dia-Dia app (app.js, index.html, vendor/) is unrelated to
  // WalletQuantso and is excluded from this build.
  env: {
    // Carimbo de versão exibido no menu lateral: identifica qual build está na
    // tela (resolve a dúvida "atualizou ou é cache do Safari?").
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7),
    NEXT_PUBLIC_BUILD_TIME: new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  },
};

export default nextConfig;
