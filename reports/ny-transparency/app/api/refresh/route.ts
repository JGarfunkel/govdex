import { NextResponse } from "next/server";
import { refreshNow } from "../../../lib/poller";

export async function POST() {
  try {
    const snapshot = await refreshNow();
    return NextResponse.json({ fetchedAt: snapshot.fetchedAt });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
