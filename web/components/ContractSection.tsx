"use client"

import { motion } from "framer-motion"

const REGISTRY_ADDRESS = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"
const LATEST_TX =
  "0xa041618da351ae12037d409c5981abd05aa708557337a798ab1a48426948b36c"

const ROWS = [
  {
    key: "Registry",
    val: "ERC-8004 Reputation Registry — Mantle Mainnet",
    href: null,
  },
  {
    key: "Address",
    val: `${REGISTRY_ADDRESS.slice(0, 14)}…${REGISTRY_ADDRESS.slice(-8)}`,
    fullVal: REGISTRY_ADDRESS,
    href: `https://explorer.mantle.xyz/address/${REGISTRY_ADDRESS}`,
  },
  {
    key: "Latest tx",
    val: `${LATEST_TX.slice(0, 14)}…${LATEST_TX.slice(-8)}`,
    fullVal: LATEST_TX,
    href: `https://explorer.mantle.xyz/tx/${LATEST_TX}`,
  },
  {
    key: "Hackathon",
    val: "Mantle Turing Test Hackathon 2026 — AI × RWA track",
    href: "https://dorahacks.io/hackathon/mantleturingtesthackathon2026",
  },
]

export function ContractSection() {
  return (
    <section id="contract" className="mx-auto max-w-[860px] px-6 pb-28 md:px-10">
      <div className="mb-3 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-[#00d084]">
        On-chain
      </div>
      <h2 className="mb-12 text-3xl font-bold tracking-tight text-[#e2e8f0] md:text-4xl">
        Verifiable from Day 1
      </h2>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="flex flex-col gap-5 rounded-xl border border-[#1e1e2e] bg-[#12121a] px-7 py-7"
      >
        {ROWS.map((row) => (
          <div
            key={row.key}
            className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
          >
            <span className="shrink-0 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">
              {row.key}
            </span>
            <span className="break-all text-right font-mono text-[0.82rem] text-[#e2e8f0] sm:max-w-[70%]">
              {row.href ? (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={row.fullVal}
                  className="text-[#00d084] transition-colors hover:underline"
                >
                  {row.val}
                </a>
              ) : (
                row.val
              )}
            </span>
          </div>
        ))}
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="mt-6 text-center text-[0.85rem] leading-relaxed text-[#94a3b8]"
      >
        Every prediction RWAI makes is logged on Mantle Mainnet before the
        outcome is known. Judges can audit the full track record — no other
        submission arrives at demo day with verifiable history.
      </motion.p>
    </section>
  )
}
