import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "appwrite-export-toolkit",
    timestamp: new Date().toISOString(),
  });
}
