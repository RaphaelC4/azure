"use client";

import { useSyncExternalStore } from "react";
import {
  connectWallet,
  disconnectWallet,
  getWallet,
  subscribeWallet,
} from "../lib/wallet";

export function useWallet() {
  const state = useSyncExternalStore(subscribeWallet, getWallet, getWallet);

  return {
    status: state.status,
    account: state.account,
    walletLabel: state.walletLabel,
    connect: () => connectWallet(),
    disconnect: () => disconnectWallet(),
  };
}