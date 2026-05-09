"use client"

import { useState, useCallback } from "react"
import { Navbar } from "@/components/Navbar"
import { Hero } from "@/components/ui/hero"
import { YieldTicker } from "@/components/YieldTicker"
import { WalletDashboard } from "@/components/WalletDashboard"
import { HowItWorks } from "@/components/HowItWorks"
import { ContractSection } from "@/components/ContractSection"

const HERO_ACTIONS = [
  {
    label: "Try the Bot",
    href: "https://t.me/rwaiapp_bot",
    variant: "default" as const,
  },
  {
    label: "View Contract",
    href: "https://explorer.mantle.xyz/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    variant: "outline" as const,
  },
]

export function PageShell() {
  const [address, setAddress] = useState<string | null>(null)
  const [isWrongNetwork, setIsWrongNetwork] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [liveYield, setLiveYield] = useState<number | null>(null)

  const handleAddressChange = useCallback(
    (addr: string | null, wrong: boolean) => {
      setAddress(addr)
      setIsWrongNetwork(wrong)
    },
    [],
  )

  return (
    <>
      <Navbar
        onConnectClick={() => setModalOpen(true)}
        address={address}
        isWrongNetwork={isWrongNetwork}
      />

      <main>
        <Hero
          title="Your RWA yield agent — watching while you sleep."
          subtitle="RWAI monitors USDY and mETH spread on Mantle, explains every shift in plain English, and sends a one-tap rebalancing proposal to your Telegram."
          actions={HERO_ACTIONS}
          badge="Live on Mantle Mainnet"
        />

        <YieldTicker onYieldLoaded={setLiveYield} />

        <WalletDashboard
          liveYield={liveYield}
          modalOpen={modalOpen}
          setModalOpen={setModalOpen}
          onAddressChange={handleAddressChange}
        />

        <HowItWorks />
        <ContractSection />
      </main>

      <footer className="border-t border-[#1e1e2e] px-8 py-8 text-center text-[0.82rem] text-[#94a3b8]">
        Built by{" "}
        <a
          href="https://x.com/0xSunSeeker"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e2e8f0]"
        >
          @0xSunSeeker
        </a>{" "}
        for the Mantle Turing Test Hackathon 2026 &nbsp;·&nbsp;
        <a
          href="https://t.me/rwaiapp_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e2e8f0]"
        >
          Telegram
        </a>{" "}
        &nbsp;·&nbsp;
        <a
          href="https://github.com/0xSunSeeker/rwai"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[#e2e8f0]"
        >
          GitHub
        </a>
      </footer>
    </>
  )
}
