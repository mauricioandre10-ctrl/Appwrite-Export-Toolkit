/**
 * Configuración de Vitest.
 * Entorno Node, ejecuta tests en archivos *.test.ts dentro de src/.
 * Resuelve el alias @/ para que los imports coincidan con la configuración de TypeScript.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
