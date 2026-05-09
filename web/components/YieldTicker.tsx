"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface YieldData {
  usdyApy: number
  methApr: number
  cmethApy: number
  spread: number
  spreadWide: boolean
}

interface YieldTickerProps {
  onYieldLoaded?: (usdyApy: number) => void
}

function TickerCard({
  label,
  value,
  sub,
  risk,
  accent,
  loading,
  index,
}: {
  label: string
  value: string
  sub: string
  risk?: string
  accent?: "yellow"
  loading: boolean
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.5 }}
      className="bg-[#12121a] p-6 md:p-7"
    >
      <div className="mb-2 text-[0.72rem] font-semibold uppercase tracking-widest text-[#94a3b8]">
        {label}
      </div>
      <div
        className={cn(
          "text-3xl font-extrabold tracking-tighter tabular-nums",
          accent === "yellow" ? "text-[#f0b429]" : "text-[#00d084]",
          loading && "text-2xl text-[#94a3b8] opacity-40",
        )}
      >
        {loading ? "—" : value}
      </div>
      <div
        className={cn(
          "mt-1 text-[0.78rem] leading-snug",
          accent === "yellow" && !loading
            ? "text-[#f0b429]/80"
            : "text-[#94a3b8]",
        )}
      >
        {sub}
      </div>
      {risk && !loading && (
        <div className="mt-2 text-[0.68rem] font-mono text-[#94a3b8]/70">
          {risk}
        </div>
      )}
    </motion.div>
  )
}

export function YieldTicker({ onYieldLoaded }: YieldTickerProps) {
  const [data, setData] = useState<YieldData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/yields")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setData(d)
        setLoading(false)
        onYieldLoaded?.(d.usdyApy)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [onYieldLoaded])

  const cards = [
    {
      label: "USDY — Ondo Finance",
      value: data ? `${data.usdyApy.toFixed(2)}%` : "—",
      sub: "Tokenized US Treasuries · APY",
      risk: "● ○ ○ ○ ○  Risk 1/5 — Very Low",
    },
    {
      label: "mETH — Mantle Staking",
      value: data ? `${data.methApr.toFixed(2)}%` : "—",
      sub: "Liquid staked ETH · APR",
      risk: "● ● ● ○ ○  Risk 3/5 — Medium",
    },
    {
      label: "cmETH — Auto-compound",
      value: data ? `${data.cmethApy.toFixed(2)}%` : "—",
      sub: "Compounding mETH vault · APY",
      risk: "● ● ● ○ ○  Risk 3/5 — Medium",
    },
    {
      label: "Spread (USDY − mETH)",
      value: data ? `${data.spread >= 0 ? "+" : ""}${data.spread.toFixed(2)}%` : "—",
      sub: error
        ? "Could not load live data"
        : data?.spreadWide
          ? "Wide — rebalance may be worth it"
          : "Within normal range",
      accent: "yellow" as const,
    },
  ]

  return (
    <div className="mx-auto max-w-[900px] px-4 pb-10">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#1e1e2e] bg-[#1e1e2e] md:grid-cols-4">
        {cards.map((card, i) => (
          <TickerCard key={card.label} {...card} loading={loading} index={i} />
        ))}
      </div>
    </div>
  )
}
