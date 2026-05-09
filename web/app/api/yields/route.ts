import { NextResponse } from "next/server";

export const revalidate = 300;

export async function GET() {
  try {
    const res = await fetch("https://yields.llama.fi/pools", {
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`DeFiLlama responded ${res.status}`);
    const { data } = await res.json();

    const usdyPool =
      data.find(
        (p: Record<string, unknown>) =>
          p.project === "ondo-yield-assets" &&
          p.symbol === "USDY" &&
          p.chain === "Mantle",
      ) ??
      data.find(
        (p: Record<string, unknown>) =>
          p.project === "ondo-yield-assets" && p.symbol === "USDY",
      );

    const methPool =
      data.find(
        (p: Record<string, unknown>) =>
          p.pool === "b9f2f00a-ba96-4589-a171-dde979a23d87",
      ) ??
      data.find(
        (p: Record<string, unknown>) =>
          p.project === "meth-protocol" && p.chain === "Mantle",
      ) ??
      data.find(
        (p: Record<string, unknown>) => p.project === "meth-protocol",
      );

    const usdyApy = usdyPool ? parseFloat(String(usdyPool.apy)) : 3.55;
    const methApr = methPool ? parseFloat(String(methPool.apy)) : 1.98;
    const cmethApy = parseFloat(
      ((Math.pow(1 + methApr / 100 / 365, 365) - 1) * 100).toFixed(2),
    );
    const spread = parseFloat((usdyApy - methApr).toFixed(2));

    return NextResponse.json({
      usdyApy,
      methApr,
      cmethApy,
      spread,
      spreadWide: spread >= 1.5,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
