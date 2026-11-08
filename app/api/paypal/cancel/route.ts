import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const mandateId = new URL(req.url).searchParams.get("mandate") ?? "";
  return NextResponse.redirect(`${env.appUrl}/?mandate=${mandateId}&cancelled=1`);
}
