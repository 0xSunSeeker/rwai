"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { JsonRpcProvider, Contract, formatUnits } from "ethers"
import { cn } from "@/lib/utils"

const MANTLE_CHAIN_ID = "0x1388"
const USDY_MANTLE = "0x5be26527e817998a7206475496fde1e68957c5a6"
const USDY_ABI = ["function balanceOf(address) view returns (uint256)"]
const MANTLE_CHAIN_PARAMS = {
  chainId: MANTLE_CHAIN_ID,
  chainName: "Mantle",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: ["https://rpc.mantle.xyz"],
  blockExplorerUrls: ["https://explorer.mantle.xyz"],
}

interface EIP6963ProviderInfo {
  rdns: string
  name: string
  icon?: string
}

interface AnnouncedWallet {
  info: EIP6963ProviderInfo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: any
}

export interface WalletDashboardProps {
  liveYield: number | null
  modalOpen: boolean
  setModalOpen: (open: boolean) => void
  onAddressChange?: (address: string | null, wrongNetwork: boolean) => void
}

export function WalletDashboard({
  liveYield,
  modalOpen,
  setModalOpen,
  onAddressChange,
}: WalletDashboardProps) {
  const [address, setAddress] = useState<string | null>(null)
  const [walletName, setWalletName] = useState("")
  const [usdyBalance, setUsdyBalance] = useState<string | null>(null)
  const [isWrongNetwork, setIsWrongNetwork] = useState(false)
  const [announced, setAnnounced] = useState<AnnouncedWallet[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerRef = useRef<any>(null)

  // EIP-6963 discovery
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => {
      setAnnounced((prev) => {
        if (prev.find((w) => w.info.rdns === e.detail.info.rdns)) return prev
        return [...prev, e.detail]
      })
    }
    window.addEventListener("eip6963:announceProvider", handler)
    window.dispatchEvent(new Event("eip6963:requestProvider"))
    return () => window.removeEventListener("eip6963:announceProvider", handler)
  }, [])

  const loadBalance = useCallback(async (addr: string) => {
    setUsdyBalance("…")
    try {
      const rpcProvider = new JsonRpcProvider("https://rpc.mantle.xyz")
      const contract = new Contract(USDY_MANTLE, USDY_ABI, rpcProvider)
      const raw = await contract.balanceOf(addr)
      const bal = parseFloat(formatUnits(raw, 18))
      setUsdyBalance(
        "$" +
          bal.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
      )
    } catch {
      setUsdyBalance("—")
    }
  }, [])

  const onConnected = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (addr: string, eip1193: any) => {
      setAddress(addr)
      const chainId = await eip1193.request({ method: "eth_chainId" })
      if (chainId !== MANTLE_CHAIN_ID) {
        setIsWrongNetwork(true)
        setUsdyBalance("—")
        onAddressChange?.(addr, true)
        return
      }
      setIsWrongNetwork(false)
      onAddressChange?.(addr, false)
      await loadBalance(addr)
    },
    [loadBalance, onAddressChange],
  )

  const connectWith = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (eip1193: any, name: string) => {
      try {
        const accounts = await eip1193.request({ method: "eth_requestAccounts" })
        if (!accounts?.length) return
        providerRef.current = eip1193
        setWalletName(name)
        setModalOpen(false)
        await onConnected(accounts[0], eip1193)

        eip1193.on?.("accountsChanged", async (accs: string[]) => {
          if (!accs.length) {
            setAddress(null)
            setUsdyBalance(null)
            setIsWrongNetwork(false)
            onAddressChange?.(null, false)
            return
          }
          await onConnected(accs[0], eip1193)
        })
        eip1193.on?.("chainChanged", async () => {
          const current = await eip1193.request({ method: "eth_accounts" })
          if (current.length) await onConnected(current[0], eip1193)
        })
      } catch (err: unknown) {
        if ((err as { code?: number }).code !== 4001) {
          console.warn("Wallet connect error:", err)
        }
      }
    },
    [onConnected, setModalOpen, onAddressChange],
  )

  const switchToMantle = useCallback(async () => {
    if (!providerRef.current) return
    try {
      await providerRef.current.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MANTLE_CHAIN_ID }],
      })
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 4902) {
        await providerRef.current.request({
          method: "wallet_addEthereumChain",
          params: [MANTLE_CHAIN_PARAMS],
        })
      }
    }
  }, [])

  // Auto-reconnect on mount
  useEffect(() => {
    const tryAuto = async () => {
      await new Promise((r) => setTimeout(r, 200))
      for (const { info, provider } of announced) {
        try {
          const accounts = await provider.request({ method: "eth_accounts" })
          if (accounts.length > 0) {
            providerRef.current = provider
            setWalletName(info.name)
            await onConnected(accounts[0], provider)
            return
          }
        } catch {
          // ignore
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any
      if (win.ethereum) {
        try {
          const accounts = await win.ethereum.request({ method: "eth_accounts" })
          if (accounts.length > 0) {
            providerRef.current = win.ethereum
            await onConnected(accounts[0], win.ethereum)
          }
        } catch {
          // ignore
        }
      }
    }
    if (announced.length > 0) tryAuto()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announced])

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null
  const yieldDisplay =
    liveYield != null ? `${liveYield.toFixed(2)}% APY` : "—"

  return (
    <>
      {/* Network warning */}
      {address && isWrongNetwork && (
        <div className="mx-auto mb-8 max-w-[900px] px-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-[#f0b429]/25 bg-[#f0b429]/06 px-6 py-4">
            <p className="text-[0.88rem] text-[#f0b429]">
              Switch to Mantle Mainnet to see your on-chain USDY balance.
            </p>
            <button
              onClick={switchToMantle}
              className="rounded-md border border-[#f0b429]/40 bg-[#f0b429]/15 px-4 py-1.5 text-[0.82rem] font-semibold text-[#f0b429] transition-colors hover:bg-[#f0b429]/25"
            >
              Switch to Mantle
            </button>
          </div>
        </div>
      )}

      {/* Connected wallet panel */}
      {address && (
        <div className="mx-auto mb-16 max-w-[900px] px-4">
          <div className="overflow-hidden rounded-xl border border-[#1e1e2e] bg-[#12121a]">
            <div className="flex items-center justify-between border-b border-[#1e1e2e] px-7 py-4">
              <span className="text-[0.75rem] font-semibold uppercase tracking-widest text-[#94a3b8]">
                Your Position
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#00d084]/25 bg-[#00d084]/10 px-3 py-1 text-[0.72rem] font-semibold text-[#00d084]">
                <span className="h-[5px] w-[5px] rounded-full bg-[#00d084]" />
                Mantle Mainnet
              </span>
            </div>
            <div className="grid grid-cols-1 gap-px bg-[#1e1e2e] sm:grid-cols-3">
              {[
                {
                  label: "Wallet",
                  value: short!,
                  sub: walletName || "Connected",
                  mono: true,
                },
                {
                  label: "USDY Balance",
                  value: usdyBalance ?? "—",
                  sub: "on Mantle Mainnet",
                },
                {
                  label: "Current USDY Yield",
                  value: yieldDisplay,
                  sub: "via DeFiLlama",
                  green: true,
                },
              ].map((stat) => (
                <div key={stat.label} className="bg-[#12121a] px-7 py-6">
                  <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-widest text-[#94a3b8]">
                    {stat.label}
                  </div>
                  <div
                    className={cn(
                      "text-[1.35rem] font-bold tracking-tight tabular-nums",
                      stat.mono && "font-mono text-[0.9rem]",
                      stat.green ? "text-[#00d084]" : "text-[#e2e8f0]",
                    )}
                  >
                    {stat.value}
                  </div>
                  <div className="mt-1 text-[0.75rem] text-[#94a3b8]">
                    {stat.sub}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#1e1e2e] px-7 py-4">
              <p className="text-[0.83rem] text-[#94a3b8]">
                Get{" "}
                <strong className="text-[#e2e8f0]">real-time alerts</strong>{" "}
                when yield shifts or a rebalance is worth considering.
              </p>
              <a
                href="https://t.me/rwaiapp_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-[#229ED9] px-4 py-2 text-[0.85rem] font-semibold text-white transition-opacity hover:opacity-85"
              >
                <TelegramIcon />
                Get alerts on Telegram
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Wallet modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}
          role="dialog"
          aria-modal
          aria-label="Connect wallet"
        >
          <div className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-[#1e1e2e] bg-[#16161f]">
            <div className="flex items-center justify-between border-b border-[#1e1e2e] px-6 py-5">
              <h3 className="text-[1rem] font-bold tracking-tight text-[#e2e8f0]">
                Connect Wallet
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded px-1 text-[1.5rem] leading-none text-[#94a3b8] hover:text-[#e2e8f0]"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-1 p-3">
              {announced.length === 0 ? (
                <p className="px-3 py-5 text-center text-[0.88rem] leading-relaxed text-[#94a3b8]">
                  No wallet detected. Install{" "}
                  <a
                    href="https://metamask.io/download/"
                    className="text-[#00d084] hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    MetaMask
                  </a>{" "}
                  or{" "}
                  <a
                    href="https://www.coinbase.com/wallet"
                    className="text-[#00d084] hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Coinbase Wallet
                  </a>{" "}
                  and refresh.
                </p>
              ) : (
                announced.map(({ info, provider }) => (
                  <button
                    key={info.rdns}
                    onClick={() => connectWith(provider, info.name)}
                    className="flex w-full items-center gap-3 rounded-[10px] border border-transparent px-4 py-3.5 text-left text-[0.92rem] font-medium text-[#e2e8f0] transition-colors hover:border-[#1e1e2e] hover:bg-[#12121a]"
                  >
                    {info.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={info.icon}
                        alt={info.name}
                        className="h-9 w-9 rounded-lg bg-white object-contain"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e1e2e] text-xl">
                        🔑
                      </div>
                    )}
                    <span className="flex-1">{info.name}</span>
                    <span className="rounded-full border border-[#00d084]/20 bg-[#00d084]/10 px-2 py-0.5 text-[0.68rem] font-semibold text-[#00d084]">
                      Detected
                    </span>
                  </button>
                ))
              )}

              <div className="my-1 h-px bg-[#1e1e2e]" />

              <button
                disabled
                className="flex w-full cursor-not-allowed items-center gap-3 rounded-[10px] px-4 py-3.5 text-left text-[0.92rem] font-medium text-[#e2e8f0] opacity-35"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3B99FC] text-xs font-bold text-white">
                  WC
                </div>
                <span className="flex-1">WalletConnect</span>
                <span className="rounded-full border border-[#1e1e2e] px-2 py-0.5 text-[0.68rem] font-semibold text-[#94a3b8]">
                  Coming soon
                </span>
              </button>
            </div>

            <div className="border-t border-[#1e1e2e] px-6 py-4">
              <p className="text-center text-[0.73rem] leading-relaxed text-[#94a3b8]">
                By connecting, you confirm you own this wallet.
                <br />
                No transaction will be sent without your approval.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function TelegramIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.847l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.712z" />
    </svg>
  )
}
