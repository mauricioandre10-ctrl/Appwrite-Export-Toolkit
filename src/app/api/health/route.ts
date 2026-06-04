import { NextResponse } from "next/server";

/** Devuelve el estado del servicio y un timestamp actual. */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "appwrite-export-toolkit",
    timestamp: new Date().toISOString(),
  });
}
