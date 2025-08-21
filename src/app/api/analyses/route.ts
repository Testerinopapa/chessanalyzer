import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
	const items = await prisma.analysis.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
	return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
	const body = await req.json();
	const { pgn, depth, ply, sans, fens, series } = body || {};
	if (!pgn || !Array.isArray(sans) || !Array.isArray(fens) || !Array.isArray(series)) {
		return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
	}
	const created = await prisma.analysis.create({ data: {
		pgn,
		depth: Number(depth) || 12,
		ply: Number(ply) || 0,
		sans: JSON.stringify(sans),
		fens: JSON.stringify(fens),
		series: JSON.stringify(series),
	}});
	return NextResponse.json(created);
}


