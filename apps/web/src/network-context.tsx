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
const CommerceContext = createContext(false);
export function useCommercePreview() {
  return useContext(CommerceContext);
}
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [commerce, setCommerce] = useState(false);
  const [network, setNetwork] = useState<Network>();
  useEffect(() => {
    const c = new AbortController();
    void fetch("/api/product/network", { cache: "no-store", signal: c.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((v: { network?: unknown; commerceEnabled?: unknown }) => {
        setCommerce(v.network === "mainnet" && v.commerceEnabled === true);
        if (v.network === "testnet" || v.network === "mainnet")
          setNetwork(v.network);
      })
      .catch(() => {});
    return () => c.abort();
  }, []);
  return (
    <Context.Provider value={network}>
      <CommerceContext.Provider value={commerce}>
        {children}
      </CommerceContext.Provider>
    </Context.Provider>
  );
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
  const commerce = useCommercePreview();
  return (
    <>
      {n === "mainnet"
        ? commerce
          ? "Mainnet payment preview. Payments and refunds are signed in your wallet."
          : "Mainnet connection preview. Merchant payments are disabled."
        : n === "testnet"
          ? "Testnet only. No real funds."
          : "Confirm the network before paying."}
    </>
  );
}
