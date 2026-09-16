/**
 * Azure wallet connection.
 *
 * Uses WalletConnect (QR modal, mobile-friendly) when a Project ID is set
 * in the environment (NEXT_PUBLIC_WC_PROJECT_ID), otherwise falls back to an
 * injected EIP-1193 provider. Multiple wallet extensions fight over
 * `window.ethereum`, so resolveInjectedProvider() picks the right one
 * (MetaMask preferred) and the connection is labelled with the wallet that
 * actually answered — a conflicting extension can no longer win silently.
 *
 * The connected wallet is switched to the chain of the active GenLayer net
 * (the net registry in lib/contract.ts drives studio-dev 61997 ⇄ studionet
 * 61999; NEXT_PUBLIC_GENLAYER_CHAIN_ID picks the default) before any
 * signing, so later on-chain writes (filing a dispute, staking) are signed
 * on the right chain.
 *
 * All module state lives behind functions so nothing touches `window` at
 * import time — safe for Next.js SSR.
 */

/**
 * The WalletConnect SDK (provider + QR modal) is ~350 KB minified, so it is
 * imported dynamically and only when a connect or session-restore actually
 * needs it — it must not sit in the initial JS of every page. The promise is
 * memoised so the module loads at most once per session.
 */
let ethereumProviderPromise: Promise<(typeof import("@walletconnect/ethereum-provider"))["EthereumProvider"]> | null = null;

function getEthereumProvider() {
  ethereumProviderPromise ??= import("@walletconnect/ethereum-provider").then((m) => m.EthereumProvider);
  return ethereumProviderPromise;
}

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || 61997);

// Wallet chain params for wallet_addEthereumChain, per net. 61997 = studio-dev
// net (0xF22D), 61999 = legacy studionet (0xF22F).
export interface ChainParams {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

const CHAIN_PARAMS_BY_ID: Record<number, ChainParams> = {
  61997: {
    chainId: "0xf22d",
    chainName: "GenLayer Studio Devnet",
    rpcUrls: ["https://studio-dev.genlayer.com/api"],
    nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
    blockExplorerUrls: ["https://explorer-studio-dev.genlayer.com"],
  },
  61999: {
    chainId: "0xf22f",
    chainName: "Genlayer Studio Network",
    rpcUrls: ["https://studio.genlayer.com/api"],
    nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
    blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
  },
};

/** Wallet chain params for a chain id (the default net's when omitted). */
export function chainParamsFor(chainId = CHAIN_ID): ChainParams {
  return (
    CHAIN_PARAMS_BY_ID[chainId] ?? {
      chainId: `0x${chainId.toString(16)}`,
      chainName: "Genlayer Studio Network",
      rpcUrls: ["https://studio.genlayer.com/api"],
      nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
      blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
    }
  );
}

const CHAIN_PARAMS = chainParamsFor(CHAIN_ID);

/** Minimal EIP-1193 surface we actually call. */
export interface ProviderLike {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  disconnect?: () => unknown;
}

declare global {
  interface Window {
    /** Whoever installs this first wins; cooperating wallets append every
     *  installed provider to `providers` (see resolveInjectedProvider). */
    ethereum?: ProviderLike & { isMetaMask?: boolean; providers?: ProviderLike[] };
  }
}

/** Ensure the provider is on the given GenLayer net before signing (the
    default net when omitted; write calls and the net switcher pass their
    own net's params). */
export async function ensureStudionetChain(provider: ProviderLike | null, params: ChainParams = CHAIN_PARAMS) {
  if (!provider?.request) return;
  const current = await provider.request({ method: "eth_chainId" }).catch(() => "");
  if (String(current).toLowerCase() === params.chainId.toLowerCase()) return;
  // wallet_addEthereumChain is an optimisation: wallets that already know
  // the chain (or don't support adding) reject it, and that's fine — the
  // switch is what matters. Never let the add step abort the connection.
  await provider.request({ method: "wallet_addEthereumChain", params: [params] }).catch(() => {});
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: params.chainId }],
    });
  } catch (err) {
    if (String((err as { code?: number })?.code) === "4902") {
      throw new Error(
        `Could not switch your wallet to ${params.chainName} (chainId ${parseInt(params.chainId, 16)}). ` +
          "Approve the network prompt in your wallet, or add the network manually " +
          `(RPC ${params.rpcUrls[0]}, chainId ${parseInt(params.chainId, 16)}, symbol GEN) and retry.`
      );
    }
    throw err;
  }
}

const WC_METHODS = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_requestAccounts",
  "personal_sign",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
];

/** localStorage key recording which path connected, so refresh can restore silently. */
const WALLET_KIND_KEY = "azure-wallet-kind-v1";
/** Set when the user explicitly disconnects, so a refresh doesn't silently
 *  re-attach an injected wallet (eth_accounts would otherwise auto-restore it). */
const WALLET_LOGGED_OUT_KEY = "azure-wallet-logged-out-v1";

export interface WalletState {
  status: "disconnected" | "connected";
  account: string | null;
  provider: ProviderLike | null;
  /** Human name of the connected wallet (MetaMask, Rabby, …); null when unknown. */
  walletLabel: string | null;
}

const INITIAL_STATE: WalletState = { status: "disconnected", account: null, provider: null, walletLabel: null };
const listeners = new Set<(state: WalletState) => void>();
let state: WalletState = INITIAL_STATE;

function emit() {
  for (const fn of listeners) fn(state);
}

export function subscribeWallet(fn: (state: WalletState) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getWallet(): WalletState {
  return state;
}

export function shortAddress(a = "") {
  if (!a) return "";
  return a.length > 12 ? `${a.slice(0, 6)}\u2026${a.slice(-4)}` : a;
}

/** Identity flags various EIP-1193 wallets set on their provider object. */
const WALLET_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["isMetaMask", "MetaMask"],
  ["isRabby", "Rabby"],
  ["isCoinbaseWallet", "Coinbase Wallet"],
  ["isTrust", "Trust Wallet"],
  ["isTrustWallet", "Trust Wallet"],
  ["isOkxWallet", "OKX Wallet"],
  ["isBitKeep", "Bitget Wallet"],
  ["isBitGet", "Bitget Wallet"],
  ["isBraveWallet", "Brave Wallet"],
  ["isZerion", "Zerion"],
  ["isOneKey", "OneKey"],
  ["isTokenPocket", "TokenPocket"],
  ["isMathWallet", "MathWallet"],
];

/** Best-effort human name for whatever provider object we are holding. */
function walletLabel(provider: ProviderLike): string {
  for (const [flag, label] of WALLET_FLAGS) {
    if ((provider as unknown as Record<string, unknown>)[flag] === true) return label;
  }
  return "Browser wallet";
}

/**
 * Pick the injected EIP-1193 provider to connect through.
 *
 * Wallet extensions race for `window.ethereum`: the first to install it as a
 * read-only property wins and later ones (often MetaMask) fail in their own
 * console with "Cannot set property ethereum of #<Window> which has only a
 * getter" — so `window.ethereum` alone can be the *wrong* wallet. Cooperating
 * wallets register every installed provider in `window.ethereum.providers`;
 * prefer MetaMask there, else the first entry, else `window.ethereum` as-is.
 * The choice is never silent: the label flows into WalletState and the UI
 * shows exactly which wallet signs.
 */
export function resolveInjectedProvider(): { provider: ProviderLike; label: string } | null {
  if (typeof window === "undefined") return null;
  const current = window.ethereum;
  if (!current) return null;
  const candidates =
    Array.isArray(current.providers) && current.providers.length
      ? current.providers.filter(Boolean)
      : [current];
  const metamask = candidates.find((p) => (p as { isMetaMask?: boolean }).isMetaMask === true);
  const chosen = metamask ?? candidates[0];
  if (!chosen) return null;
  if (candidates.length > 1) {
    console.info(
      `[Azure] Multiple injected wallets detected (${candidates.map(walletLabel).join(", ")}); using ${walletLabel(chosen)}.`
    );
  }
  return { provider: chosen, label: walletLabel(chosen) };
}

async function connectInjected(ethereum: ProviderLike) {
  await ensureStudionetChain(ethereum);
  const accounts = (await ethereum.request({ method: "eth_requestAccounts", params: [] })) as string[];
  return { provider: ethereum, account: accounts[0], label: walletLabel(ethereum) };
}

async function connectWalletConnect() {
  const EthereumProvider = await getEthereumProvider();
  const provider = await EthereumProvider.init({
    projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID as string,
    chains: [CHAIN_ID],
    // Both live nets stay optional so a session survives a net switch
    // without reconnecting (the switcher re-issues wallet_switchEthereumChain).
    optionalChains: Array.from(new Set([CHAIN_ID, 61997, 61999])),
    methods: WC_METHODS,
    showQrModal: true,
  });
  await provider.connect(); // opens the WalletConnect QR modal
  await ensureStudionetChain(provider);
  const accounts = (await provider.request({ method: "eth_requestAccounts", params: [] })) as string[];
  return { provider, account: accounts[0], label: "WalletConnect" };
}

export async function connectWallet() {
  let connected: { provider: ProviderLike; account: string; label: string };
  const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
  if (projectId) {
    connected = await connectWalletConnect();
  } else {
    const injected = resolveInjectedProvider();
    if (!injected) {
      throw new Error(
        "No wallet found. Install a GEN-capable wallet extension (MetaMask or Rabby) " +
          "or set NEXT_PUBLIC_WC_PROJECT_ID in a .env file for WalletConnect."
      );
    }
    connected = await connectInjected(injected.provider);
  }
  state = {
    status: "connected",
    provider: connected.provider,
    account: connected.account,
    walletLabel: connected.label,
  };
  try {
    window.localStorage.removeItem(WALLET_LOGGED_OUT_KEY); // an explicit connect clears the opt-out
    window.localStorage.setItem(WALLET_KIND_KEY, projectId ? "walletconnect" : "injected");
  } catch {
    // Storage unavailable — the restore-on-refresh just won't fire.
  }
  emit();
  return state;
}

export function disconnectWallet() {
  try {
    state.provider?.disconnect?.();
  } catch {
    /* wallet already gone */
  }
  try {
    window.localStorage.removeItem(WALLET_KIND_KEY);
    window.localStorage.setItem(WALLET_LOGGED_OUT_KEY, "1"); // remember the opt-out across reloads
  } catch {
    /* storage unavailable */
  }
  state = { status: "disconnected", account: null, provider: null, walletLabel: null };
  emit();
}

/**
 * Silent reconnection after a page refresh — previously the wallet state was
 * module-level only, so a reload dropped it. No popups here:
 *   - injected (Rabby/MetaMask): eth_accounts returns the accounts already
 *     authorized for this site; empty means not connected, so stay quiet;
 *   - WalletConnect: re-initing the provider restores its persisted session
 *     when one is still valid.
 * The chain switch is deliberately NOT forced here (no surprise popups on
 * load) — the write path re-checks the chain before any signing.
 */
export async function restoreWallet(): Promise<void> {
  if (typeof window === "undefined" || state.status === "connected") return;
  try {
    // An explicit disconnect beats auto-restore — the user asked to be signed out.
    if (window.localStorage.getItem(WALLET_LOGGED_OUT_KEY)) return;
    const kind = window.localStorage.getItem(WALLET_KIND_KEY);
    if (kind === "walletconnect" && process.env.NEXT_PUBLIC_WC_PROJECT_ID) {
      const EthereumProvider = await getEthereumProvider();
      const provider = await EthereumProvider.init({
        projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID as string,
        chains: [CHAIN_ID],
        optionalChains: [CHAIN_ID],
        methods: WC_METHODS,
        showQrModal: true,
      });
      const hasSession = Boolean((provider as unknown as { session?: unknown }).session);
      if (!hasSession) return; // expired or never connected — stay disconnected
      const accounts = (await provider.request({ method: "eth_accounts", params: [] })) as string[];
      if (!accounts?.length) return;
      state = { status: "connected", provider, account: accounts[0], walletLabel: "WalletConnect" };
      emit();
      return;
    }
    const injected = resolveInjectedProvider();
    if (injected) {
      const accounts = (await injected.provider.request({ method: "eth_accounts", params: [] })) as string[];
      if (!accounts?.length) return;
      state = { status: "connected", provider: injected.provider, account: accounts[0], walletLabel: injected.label };
      emit();
    }
  } catch {
    // Restore is best-effort: on any failure the user just connects by hand.
  }
}