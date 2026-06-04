import { NextResponse } from "next/server";

/**
 * Endpoint de verificación de salud del servicio.
 *
 * Devuelve un JSON indicando que el servicio está operativo, junto con
 * un timestamp ISO 8601 de la hora actual del servidor.
 * No requiere autenticación ni tokens CSRF.
 *
 * @returns JSON con `{ ok: true, service: string, timestamp: string }` y status 200.
 *
 * @error 500 - No es esperado, pero podría devolverse si el servicio no puede generar el timestamp.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "appwrite-export-toolkit",
    timestamp: new Date().toISOString(),
  });
}
