import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Norte · Analytics de anúncios", template: "%s · Norte" },
  description: "Veja investimento, compras, receita atribuída e ROAS das suas campanhas Meta em um painel claro e atualizado automaticamente.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0e" },
  ],
};

// Aplica o tema salvo antes da hidratação (evita flash).
const themeScript = `try{var t=localStorage.getItem("norte-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-[100dvh] font-sans antialiased">{children}</body>
    </html>
  );
}
