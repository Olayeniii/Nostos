"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Network } from "../../../packages/network/src/index.js";
const Context = createContext<Network | undefined>(undefined);
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<Network>();
  useEffect(() => {
    const c = new AbortController();
    void fetch("/api/product/network", { cache: "no-store", signal: c.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((v: { network?: unknown }) => {
        if (v.network === "testnet" || v.network === "mainnet")
          setNetwork(v.network);
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  return <Context.Provider value={network}>{children}</Context.Provider>;
}
export function useNetwork() {
  return useContext(Context);
}
export function NetworkLabel() {
  const n = useNetwork();
  return <>{n ? `Zcash ${n}` : "Checking network"}</>;
}
export function NetworkNotice() {
  const n = useNetwork();
  return (
    <>
      {n === "mainnet"
        ? "Mainnet. Real ZEC. Hosted merchant custody."
        : n === "testnet"
          ? "Testnet only. No real funds."
          : "Confirm the network before paying."}
    </>
  );
}
