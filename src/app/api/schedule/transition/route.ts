import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({ cutoverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });

export async function GET() {
  const [settings, schedules] = await Promise.all([
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    prisma.schedulePeriod.count(),
  ]);
  return NextResponse.json({
    cutoverDate: settings.projectStartDate?.toISOString().slice(0, 10) ?? null,
    historyWindowDays: settings.historyWindowDays,
    eligible: schedules === 0,
  });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid cutover date." }, { status: 400 });
  const schedules = await prisma.schedulePeriod.count();
  if (schedules > 0) return NextResponse.json({ error: "Initial transition can only be set before the first schedule is generated. Reset or start with a fresh deployment first." }, { status: 409 });
  const cutoverDate = parsed.data.cutoverDate ? new Date(`${parsed.data.cutoverDate}T00:00:00.000Z`) : null;
  await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global", projectStartDate: cutoverDate }, update: { projectStartDate: cutoverDate } });
  return NextResponse.json({ ok: true, cutoverDate: parsed.data.cutoverDate });
}
