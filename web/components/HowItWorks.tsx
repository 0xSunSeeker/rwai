"use client"

import { motion } from "framer-motion"

const STEPS = [
  {
    num: 1,
    title: "Fetch",
    desc: "Every 30 minutes, RWAI pulls live yield data for USDY and mETH from DeFiLlama and compares it to the last snapshot stored on-disk.",
  },
  {
    num: 2,
    title: "Explain",
    desc: "When yield shifts more than 0.1% or the spread crosses 1.5%, Claude Sonnet writes a plain-English explanation — what changed, why it happened, and what it means for your position.",
  },
  {
    num: 3,
    title: "Propose",
    desc: "The agent sends a Telegram message with Approve / Dismiss inline buttons. Nothing executes until you tap Approve.",
  },
  {
    num: 4,
    title: "Anchor",
    desc: "Every approved decision is logged on Mantle Mainnet via the ERC-8004 Reputation Registry — a verifiable, auditable AI track record that accumulates from Day 1.",
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-[860px] px-6 pb-24 md:px-10">
      <div className="mb-3 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-[#00d084]">
        How it works
      </div>
      <h2 className="mb-12 text-3xl font-bold tracking-tight text-[#e2e8f0] md:text-4xl">
        Four layers. One tap to act.
      </h2>

      <div className="flex flex-col">
        {STEPS.map((step, i) => (
          <motion.div
            key={step.num}
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.12, duration: 0.5 }}
            className="relative grid grid-cols-[2.5rem_1fr] gap-5 pb-10"
          >
            {i < STEPS.length - 1 && (
              <div className="absolute left-[1.2rem] top-[2.8rem] bottom-0 w-px bg-[#1e1e2e]" />
            )}
            <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#00d084]/30 bg-[#00d084]/10 text-[0.85rem] font-bold text-[#00d084]">
              {step.num}
            </div>
            <div className="pt-1.5">
              <div className="mb-1.5 font-semibold text-[#e2e8f0]">
                {step.title}
              </div>
              <div className="text-[0.92rem] leading-relaxed text-[#94a3b8]">
                {step.desc}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
