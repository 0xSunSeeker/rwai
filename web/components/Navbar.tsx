"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"

interface NavbarProps {
  onConnectClick: () => void
  address: string | null
  isWrongNetwork: boolean
}

export function Navbar({ onConnectClick, address, isWrongNetwork }: NavbarProps) {
  const short = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-[#1e1e2e] bg-[#0a0a0f]/92 px-6 py-4 backdrop-blur-xl md:px-10">
      <Link href="/" className="text-[1.1rem] font-bold tracking-tight text-[#00d084]">
        RWAI
      </Link>

      <div className="flex items-center gap-3 md:gap-5">
        <Link
          href="#how"
          className="hidden text-[0.875rem] text-[#94a3b8] transition-colors hover:text-[#e2e8f0] sm:block"
        >
          How it works
        </Link>
        <Link
          href="#contract"
          className="hidden text-[0.875rem] text-[#94a3b8] transition-colors hover:text-[#e2e8f0] sm:block"
        >
          Contract
        </Link>
        <Link
          href="https://github.com/0xSunSeeker/rwai"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden text-[0.875rem] text-[#94a3b8] transition-colors hover:text-[#e2e8f0] sm:block"
        >
          GitHub
        </Link>

        <button
          onClick={onConnectClick}
          className={cn(
            "rounded-md border px-4 py-[0.45rem] text-[0.875rem] font-medium transition-colors",
            isWrongNetwork
              ? "border-[#f0b429]/50 text-[#f0b429]"
              : short
                ? "border-[#00d084]/30 bg-[#00d084]/8 text-[#00d084]"
                : "border-[#1e1e2e] text-[#e2e8f0] hover:border-[#00d084]/50 hover:text-[#00d084]",
          )}
        >
          {isWrongNetwork ? "Wrong network" : short ?? "Connect Wallet"}
        </button>

        <Link
          href="https://t.me/rwaiapp_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-[#00d084] px-4 py-[0.45rem] text-[0.875rem] font-semibold text-black transition-opacity hover:opacity-85"
        >
          Open Telegram
        </Link>
      </div>
    </nav>
  )
}
