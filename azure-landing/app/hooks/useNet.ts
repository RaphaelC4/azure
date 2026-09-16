"use client";

import { useSyncExternalStore } from "react";
import { getNet, getNetId, setNet, subscribeNet, type NetConfig, type NetId } from "../lib/contract";

/** React binding for the studio-dev ⇄ studionet net registry in
    lib/contract.ts: `netId` re-renders every subscriber on a net switch,
    and `net` carries the active net's config (address, chain id, explorer,
    write health). */
export function useNet(): { netId: NetId; net: NetConfig; setNet: (id: NetId) => void } {
  const netId = useSyncExternalStore(subscribeNet, getNetId, getNetId);
  return { netId, net: getNet(), setNet };
}