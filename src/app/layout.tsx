import type { Metadata } from "next";
import "./globals.css";

/** Metadatos globales de la aplicación (título, descripción, favicon). */
export const metadata: Metadata = {
  title: "Appwrite Export Toolkit",
  description: "Structured export and validation toolkit for Appwrite projects.",
  icons: {
    icon: "/logo_aet2_512x512.webp",
  },
};

/** Layout raíz que envuelve todas las páginas con html y body. */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
