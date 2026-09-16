"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { AzureLogo } from "../components/Logo";
import { useWallet } from "../hooks/useWallet";
import { useNet } from "../hooks/useNet";
import { getWallet, shortAddress } from "../lib/wallet";
import {
  acceptDisputeOnChain,
  acceptVerdictOnChain,
  approveEvidenceOnChain,
  contractAddress,
  evidenceFullyApproved,
  explorerAddress,
  explorerTx,
  fileDisputeOnChain,
  evidenceDisplay,
  formatGen,
  isLive,
  parseGenWei,
  readCase,
  reclaimUnacceptedStakeOnChain,
  requestVerdictOnChain,
  settleOnChain,
  settleValveOpen,
  submitEvidenceOnChain,
  submitEvidenceWithUrlOnChain,
  verdictFullyAccepted,
  verdictRevealed,
  type AzureCase,
} from "../lib/contract";

type Stage = "idle" | "filing" | "evidence" | "consensus" | "verdict";
type Tab = "case" | "evidence" | "validators" | "verdict";

interface Exhibit {
  id: string;
  by: string;
  name: string;
  ts: string;
  hash: string;
  status: "ADMITTED" | "HASH-OK" | "BREACH";
}

const STAGES: { key: Stage; label: string }[] = [
  { key: "idle", label: "Form" },
  { key: "filing", label: "Filing" },
  { key: "evidence", label: "Evidence" },
  { key: "consensus", label: "Consensus" },
  { key: "verdict", label: "Verdict" },
];

const TABS: { key: Tab; label: string; min: number }[] = [
  { key: "case", label: "Case", min: 1 },
  { key: "evidence", label: "Evidence", min: 2 },
  { key: "validators", label: "Validators", min: 3 },
  { key: "verdict", label: "Verdict", min: 4 },
];

const SEED_EXHIBITS: Exhibit[] = [
  { id: "EXH-01", by: "DLV-11", name: "signed manifest payload", ts: "14:02:11", hash: "9f31…a4c1", status: "ADMITTED" },
  { id: "EXH-02", by: "ESC-04", name: "transport gap log", ts: "14:03:58", hash: "77c2…1b3a", status: "ADMITTED" },
  { id: "EXH-03", by: "DLV-11", name: "GPS breadcrumb trail", ts: "14:07:40", hash: "3d0c…9e52", status: "HASH-OK" },
  { id: "EXH-04", by: "ESC-04", name: "unsigned challenge", ts: "14:09:02", hash: "b8f1…00d7", status: "BREACH" },
];

const SCORES = [78, 82, 74, 80];
const BAND: [number, number] = [70, 84];
const inBand = (s: number) => s >= BAND[0] && s <= BAND[1];
const randHash = () => {
  const h = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${h()}…${h()}`;
};

const STATUS_LABEL: Record<string, string> = {
  pending_acceptance: "Awaiting acceptance",
  cancelled: "Cancelled · stake reclaimed",
  evidence_open: "Evidence window",
  consensus: "Consensus forming",
  settled_pending: "Verdict awaiting acceptance",
  settled: "Settled",
};
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const CASE_ID_RE = /^AZ-\d+$/i;
const DRAFT_KEY = "azure-file-draft-v1";

/** A finalized-but-failed evidence write: which side it was, and the tx hash. */
type EvidenceFail = { side: "claimant" | "respondent"; tx: string };

const EVIDENCE_FAIL_KEY = (id: string) => `azure.evidenceFail.v1.${id}`;

/** Read the per-case evidence-failure tag from sessionStorage (null if none). */
const loadEvidenceFail = (id: string): EvidenceFail | null => {
  try {
    const raw = window.sessionStorage.getItem(EVIDENCE_FAIL_KEY(id));
    if (!raw) return null;
    const p = JSON.parse(raw) as { side?: unknown; tx?: unknown };
    return p && (p.side === "claimant" || p.side === "respondent") && typeof p.tx === "string"
      ? { side: p.side, tx: p.tx }
      : null;
  } catch {
    return null;
  }
};

/** Store/clear the per-case evidence-failure tag in sessionStorage. */
const saveEvidenceFail = (id: string, fail: EvidenceFail | null) => {
  try {
    if (fail) window.sessionStorage.setItem(EVIDENCE_FAIL_KEY(id), JSON.stringify(fail));
    else window.sessionStorage.removeItem(EVIDENCE_FAIL_KEY(id));
  } catch {
    /* storage unavailable — the in-memory tag still works */
  }
};

/** First 0x-64-hex tx hash found in an error message (or value). */
const txHashOf = (subject: unknown): string | null => {
  const m = String(subject instanceof Error ? subject.message : subject).match(/0x[0-9a-fA-F]{64}/);
  return m ? m[0] : null;
};

/** Map an on-chain case status onto the page's stage model. */
const stageForCase = (c: AzureCase | null): Stage => {
  if (!c) return "evidence";
  if (c.status === "pending_acceptance") return "filing";
  if (c.status === "evidence_open") return "evidence";
  if (c.status === "consensus") return "consensus";
  return "verdict"; // settled_pending | settled | cancelled
};

/** Human countdown until an ISO deadline: "3h 12m left", or "passed". */
const deadlineLeft = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.floor((t - Date.now()) / 1000);
  if (s <= 0) return "passed";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m ${sec}s left`;
};

export default function FilePage() {
  // Net-aware: `netId` re-renders on a studio-dev ⇄ studionet switch; `live`
  // and every contract address below follow the active net.
  const { netId, net } = useNet();
  const live = isLive();

  // Shared / demo state
  const [stage, setStage] = useState<Stage>("idle");
  const [tab, setTab] = useState<Tab>("case");
  const [caseId, setCaseId] = useState("AZ-0142");
  const [claimant, setClaimant] = useState("DLV-11");
  const [respondent, setRespondent] = useState("");
  const [stake, setStake] = useState("2");
  const [terms, setTerms] = useState("");
  const [exhibits, setExhibits] = useState<Exhibit[]>(SEED_EXHIBITS);
  const [exhibitName, setExhibitName] = useState("");
  const [chainOpen, setChainOpen] = useState(false);
  const timers = useRef<number[]>([]);

  // Live state — real contract interactions
  const { status: walletStatus, account, connect } = useWallet();
  const [liveCase, setLiveCase] = useState<AzureCase | null>(null);
  const [liveCaseId, setLiveCaseId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "file" | "evidence" | "approve" | "verdict" | "settle" | "accept" | "accept_verdict" | "reclaim">(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [evidenceInput, setEvidenceInput] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceFail, setEvidenceFail] = useState<EvidenceFail | null>(null);
  // Resume-by-case-ID state (see resumeCase below).
  const [resumeId, setResumeId] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeErr, setResumeErr] = useState<string | null>(null);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // A net switch re-targets every read and write — drop the previous net's
  // case, tx and errors so the other net's data can't linger on screen.
  useEffect(() => {
    setLiveCase(null);
    setLiveCaseId(null);
    setTxHash(null);
    setLiveErr(null);
    setResumeErr(null);
  }, [netId]);

  // The chain is the source of truth for how far a live case has progressed.
  // Derive the effective stage during render (no effect needed) so the progress
  // bar and tab locks advance as soon as a poll reports the next phase — e.g.
  // the respondent acting from their own wallet — without a manual re-resume
  // of the case ID. Forward-only: the user's own actions are never regressed
  // by a stale chain read.
  const manualIdx = STAGES.findIndex((s) => s.key === stage);
  const chainIdx = liveCase ? STAGES.findIndex((s) => s.key === stageForCase(liveCase)) : -1;
  const stageIdx = Math.max(manualIdx, chainIdx);
  const effStage = STAGES[stageIdx]?.key ?? stage;

  // Re-render every second while a deadline is live so countdowns tick.
  const [tick, setTick] = useState(0);
  const deadlineLive =
    live && liveCase && (liveCase.status === "pending_acceptance" || liveCase.status === "evidence_open" || liveCase.status === "settled_pending");
  useEffect(() => {
    if (!deadlineLive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [deadlineLive]);
  void tick;

  // Deadline + party derivations for the lifecycle actions below.
  const accLeft = deadlineLeft(liveCase?.acceptance_deadline);
  const evLeft = deadlineLeft(liveCase?.evidence_deadline);
  const evPassed = evLeft === "passed";
  const bothEvidence = !!liveCase && !!liveCase.claimant_evidence && !!liveCase.respondent_evidence;
  const isRespondent = !!account && !!liveCase && account.toLowerCase() === liveCase.respondent.toLowerCase();
  const isClaimant = !!account && !!liveCase && account.toLowerCase() === liveCase.claimant.toLowerCase();

  // Consent-gated lifecycle derivations. The UI only ever offers a write the
  // contract would accept — every button below is rendered behind one of
  // these flags (the contract's own guards stay as defense-in-depth).
  const vaLeft = deadlineLeft(liveCase?.verdict_acceptance_deadline);
  const bothApproved = !!liveCase && evidenceFullyApproved(liveCase);
  const myApproval = isClaimant
    ? liveCase?.claimant_evidence_approved === true
    : isRespondent
      ? liveCase?.respondent_evidence_approved === true
      : false;
  // Whose approval is still missing — names the blocking party in pills.
  const awaitingApprovalFrom = !liveCase?.claimant_evidence_approved
    ? liveCase?.respondent_evidence_approved
      ? "the claimant"
      : "both parties"
    : "the respondent";
  const bothAccepted = !!liveCase && verdictFullyAccepted(liveCase);
  const myAccepted = isClaimant
    ? liveCase?.claimant_verdict_accepted === true
    : isRespondent
      ? liveCase?.respondent_verdict_accepted === true
      : false;
  const valveOpen = !!liveCase && settleValveOpen(liveCase);
  const revealed = !!liveCase && verdictRevealed(liveCase);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const stakeWei = useMemo(() => parseGenWei(stake), [stake]);
  const connected = walletStatus === "connected";
  const liveFormValid =
    !!stakeWei && terms.trim().length > 0 && (!live || ADDRESS_RE.test(respondent.trim()));

  const refreshLiveCase = useCallback(async (id: string) => {
    try {
      const c = await readCase(id);
      if (c) setLiveCase(c);
      return c;
    } catch {
      return null; // keep whatever we last read
    }
  }, []);

  // Poll the on-chain case while it is still moving.
  useEffect(() => {
    if (!liveCaseId || liveCase?.status === "settled") return;
    const id = window.setInterval(() => {
      // Skip the read while the tab is hidden — the Studio RPC rate-limits per IP.
      if (document.visibilityState !== "visible") return;
      refreshLiveCase(liveCaseId);
    }, 5000);
    return () => window.clearInterval(id);
  }, [liveCaseId, liveCase?.status, refreshLiveCase]);

  // ---------------------------------------------------------------------------
  // Resume an already-filed case + protect the in-progress form.
  //
  // The whole filing session lives in component state, so a navigation or
  // refresh used to drop it. Two safeguards:
  //   1. Draft fields (respondent / stake / terms) persist to localStorage
  //      while the form is idle and are restored on mount.
  //   2. A filed case can be re-opened by its on-chain ID at any time — the
  //      evidence window stays open until both sides have submitted.
  // ---------------------------------------------------------------------------

  const resumeCase = useCallback(async (rawId: string) => {
    const id = rawId.trim().toUpperCase();
    if (!CASE_ID_RE.test(id)) {
      setResumeErr("Enter a case ID like AZ-4.");
      return;
    }
    setResumeBusy(true);
    setResumeErr(null);
    setLiveErr(null);
    try {
      const c = await readCase(id);
      if (!c) {
        setResumeErr(`No case found for ${id} on the contract.`);
        return;
      }
      setCaseId(c.case_id);
      setLiveCaseId(c.case_id);
      setLiveCase(c);
      setEvidenceFail(loadEvidenceFail(c.case_id));
      setTxHash(null);
      const st = stageForCase(c);
      setStage(st);
      setTab(st === "evidence" ? "evidence" : st === "consensus" ? "validators" : "verdict");
    } catch (err) {
      setResumeErr(err instanceof Error ? err.message : `Could not read case ${id}.`);
    } finally {
      setResumeBusy(false);
    }
  }, []);

  // Restore an unfinished draft + honor ?case= deep links. Both update state
  // after mount, so they run deferred (via a timer, matching the demo-flow
  // pattern above) — the effect body itself stays free of setState.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as { respondent?: unknown; stake?: unknown; terms?: unknown };
          if (typeof d.respondent === "string") setRespondent(d.respondent);
          if (typeof d.stake === "string") setStake(d.stake);
          if (typeof d.terms === "string") setTerms(d.terms);
        }
      } catch {
        // Corrupt or unreadable draft — start clean.
      }
      if (!live) return;
      const q = new URLSearchParams(window.location.search).get("case");
      if (q) void resumeCase(q);
    }, 0);
    return () => window.clearTimeout(t);
  }, [live, resumeCase]);

  // Persist the idle form so leaving mid-filing no longer loses the typed text.
  useEffect(() => {
    if (stage !== "idle") return;
    if (!respondent && !stake && !terms) return; // don't persist a blank form
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ respondent, stake, terms }));
    } catch {
      // Storage unavailable (private mode, quota) — the form still works in-memory.
    }
  }, [stage, respondent, stake, terms]);

  const resetAll = () => {
    clearTimers();
    setStage("idle");
    setTab("case");
    setExhibits(SEED_EXHIBITS);
    setChainOpen(false);
    setLiveCase(null);
    setLiveCaseId(null);
    setTxHash(null);
    setLiveErr(null);
    setEvidenceInput("");
    setEvidenceUrl("");
    setEvidenceFail(null);
    if (liveCaseId) saveEvidenceFail(liveCaseId, null);
  };

  const chainHash = useMemo(() => {
    let h = 0x15ea79;
    for (const ex of exhibits) {
      const n = parseInt(ex.hash.replace(/[^0-9a-f]/g, "").slice(0, 4), 16) || 0;
      h = (h * 33 + n) >>> 0;
    }
    return "0x" + h.toString(16).padStart(8, "0");
  }, [exhibits]);

  // ------------------------------ demo flow ------------------------------

  const startDemo = (e: FormEvent) => {
    e.preventDefault();
    clearTimers();
    setCaseId(`AZ-0${Math.floor(140 + Math.random() * 60)}`);
    setExhibits(SEED_EXHIBITS);
    setStage("filing");
    setTab("case");
    // Guide the demo: tab follows the case as each stage lands.
    timers.current.push(window.setTimeout(() => { setStage("evidence"); setTab("evidence"); }, 900));
    timers.current.push(window.setTimeout(() => { setStage("consensus"); setTab("validators"); }, 1900));
    timers.current.push(window.setTimeout(() => { setStage("verdict"); setTab("verdict"); }, 3100));
  };

  const addExhibit = (e: FormEvent) => {
    e.preventDefault();
    const name = exhibitName.trim() || `exhibit log #${exhibits.length + 1}`;
    setExhibits((prev) => [...prev, { id: `EXH-${String(prev.length + 1).padStart(2, "0")}`, by: claimant, name, ts: "now", hash: randHash(), status: "HASH-OK" }]);
    setExhibitName("");
  };

  // ------------------------------ live flow ------------------------------

  const walletOf = () => {
    const w = getWallet();
    if (w.status !== "connected" || !w.provider || !w.account) {
      setLiveErr("Wallet is not connected. Connect a wallet on the GenLayer Studio Network first.");
      return null;
    }
    // Narrowed copy — WalletState's nullable fields don't keep their
    // narrowing through `return w`.
    return { provider: w.provider, account: w.account };
  };

  const runFileLive = async () => {
    const w = walletOf();
    if (!w || !stakeWei) return;
    setBusy("file");
    setLiveErr(null);
    setTxHash(null);
    setLiveCase(null);
    setStage("filing");
    setTab("case");
    try {
      const res = await fileDisputeOnChain({
        provider: w.provider,
        account: w.account,
        respondent: respondent.trim(),
        terms: terms.trim(),
        stakeWei,
      });
      setTxHash(res.txHash);
      setLiveCaseId(res.caseId);
      setCaseId(res.caseId);
      const c = await refreshLiveCase(res.caseId);
      setStage(stageForCase(c));
      try {
        window.localStorage.removeItem(DRAFT_KEY); // filed — the draft has done its job
      } catch {
        // storage unavailable — nothing to clean up
      }
    } catch (err) {
      setLiveErr(err instanceof Error ? err.message : "Filing failed.");
      setStage("idle");
    } finally {
      setBusy(null);
    }
  };

  const runEvidence = async (e: FormEvent) => {
    e.preventDefault();
    const w = walletOf();
    const text = evidenceInput.trim();
    const url = evidenceUrl.trim();
    if (!w || !liveCaseId || !text) return;
    // Mirror the contract's own check (azure_contract.py submit_evidence_with_url)
    // so users get a fast, local error instead of a reverted transaction.
    if (url && !/^https?:\/\//i.test(url)) {
      setLiveErr("Evidence URL must start with http:// or https:// — or leave it empty.");
      return;
    }
    setBusy("evidence");
    setLiveErr(null);
    try {
      const hash = url
        ? await submitEvidenceWithUrlOnChain({ provider: w.provider, account: w.account, caseId: liveCaseId, evidence: text, evidenceUrl: url })
        : await submitEvidenceOnChain({ provider: w.provider, account: w.account, caseId: liveCaseId, evidence: text });
      setTxHash(hash);
      setEvidenceInput("");
      setEvidenceUrl("");
      setEvidenceFail(null);
      if (liveCaseId) saveEvidenceFail(liveCaseId, null);
      await refreshLiveCase(liveCaseId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Evidence submission failed.";
      setLiveErr(msg);
      // After a failure the chain decides: re-read (the write path cache-busted)
      // and tag the card only when evidence genuinely never landed — e.g. the
      // GenVM "Contract Error" case. A transport error that still got the write
      // through must not produce a tag.
      try {
        const c = await readCase(liveCaseId);
        if (c) {
          const a = w.account.toLowerCase();
          const side: "claimant" | "respondent" | null =
            a === c.claimant.toLowerCase() ? "claimant" : a === c.respondent.toLowerCase() ? "respondent" : null;
          if (side && !(side === "claimant" ? c.claimant_evidence : c.respondent_evidence)) {
            const fail = { side, tx: txHashOf(err) ?? txHashOf(msg) ?? "" };
            if (fail.tx) {
              setEvidenceFail(fail);
              saveEvidenceFail(liveCaseId, fail);
            } else {
              setEvidenceFail(null);
            }
          }
        }
      } catch {
        /* verification read failed — liveErr already explains the attempt */
      }
    } finally {
      setBusy(null);
    }
  };

  const runVerdict = async () => {
    const w = walletOf();
    if (!w || !liveCaseId) return;
    setBusy("verdict");
    setLiveErr(null);
    try {
      const res = await requestVerdictOnChain({ provider: w.provider, account: w.account, caseId: liveCaseId });
      setTxHash(res.txHash);
      await refreshLiveCase(liveCaseId);
      setStage("verdict");
      setTab("verdict");
    } catch (err) {
      setLiveErr(err instanceof Error ? err.message : "Verdict request failed.");
    } finally {
      setBusy(null);
    }
  };

  const runApprove = async () => {
    const w = walletOf();
    if (!w || !liveCaseId) return;
    setBusy("approve");
    setLiveErr(null);
    try {
      const res = await approveEvidenceOnChain({ provider: w.provider, account: w.account, caseId: liveCaseId });
      setTxHash(res.txHash);
      await refreshLiveCase(liveCaseId);
    } catch (err) {
      setLiveErr(err instanceof Error ? err.message : "Evidence approval failed.");
    } finally {
      setBusy(null);
    }
  };

  const runAccept = async () => {
    const w = walletOf();
    if (!w || !liveCaseId) return;
    // accept_dispute is payable and the contract reverts unless the attached
    // value equals the claimant's staked_amount exactly — read the stake from
    // the case blob and escrow the same amount (named matchStake; the outer
    // `stakeWei` is the claimant's filing input).
    let matchStake: bigint | null = null;
    try {
      if (liveCase?.staked_amount) matchStake = BigInt(liveCase.staked_amount);
    } catch {
      /* non-numeric blob — guarded below */
    }
    if (!matchStake || matchStake <= 0n) {
      setLiveErr("Could not read the claimant's stake to match — refresh and retry.");
      return;
    }
    setBusy("accept");
    setLiveErr(null);
    try {
      const hash = await acceptDisputeOnChain({ provider: w.provider, account: w.account, caseId: liveCaseId, stakeWei: matchStake });
      setTxHash(hash);
      await refreshLiveCase(liveCaseId);
    } catch (err) {
      setLiveErr(err instanceof Error ? err.message : "Acceptance failed.");
    } finally {
      setBusy(null);
    }
  };

  const runReclaim = async () => {
    const w = walletOf();
    if (!w || !liveCaseId) return;
    setBusy("reclaim");
    setLiveErr(null);
    try {
      const hash = await reclaimUnacceptedStakeOnChain({ provider: w.provider, account: w.account, caseId: liveCaseId });
      setTxHash(hash);
      await refreshLiveCase(liveCaseId);
    } catch (err) {
      setLiveErr(err instanceof Error ? err.message : "Reclaim failed.");
    } finally {
      setBusy(null);
    }
  };

  const runSettle = async () => {
    const w = walletOf();
    if (!w || !liveCaseId) return;
    setBusy("settle");
    setLiveErr(null);
    try {
      const hash = await settleOnChain({ provider: w.provider, account: w.account, caseId: liveCaseId });
      setTxHash(hash);
      await refreshLiveCase(liveCaseId);
    } catch (err) {
      setLiveErr(err instanceof Error ? err.message : "Settlement failed.");
    } finally {
      setBusy(null);
    }
  };

  const runAcceptVerdict = async () => {
    const w = walletOf();
    if (!w || !liveCaseId) return;
    setBusy("accept_verdict");
    setLiveErr(null);
    try {
      const res = await acceptVerdictOnChain({ provider: w.provider, account: w.account, caseId: liveCaseId });
      setTxHash(res.txHash);
      await refreshLiveCase(liveCaseId);
    } catch (err) {
      setLiveErr(err instanceof Error ? err.message : "Verdict acceptance failed.");
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    if (!live) {
      startDemo(e);
      return;
    }
    e.preventDefault();
    if (!connected) {
      try {
        setLiveErr(null);
        await connect();
      } catch (err) {
        setLiveErr(err instanceof Error ? err.message : "Wallet connection failed.");
      }
      return;
    }
    await runFileLive();
  };

  // ------------------------------ derived UI ------------------------------

  const checklist = live
    ? [
        { label: "Stake escrowed at filing", done: stage !== "idle" },
        { label: "Respondent evidence on-chain", done: !!liveCase?.respondent_evidence },
        { label: "Claimant evidence on-chain", done: !!liveCase?.claimant_evidence },
        { label: "Evidence approved by both parties", done: bothApproved },
        { label: "Verdict reached by validators", done: liveCase?.status === "settled_pending" || liveCase?.status === "settled" },
        { label: "Verdict accepted by both parties", done: liveCase?.status === "settled" },
        { label: "Stake settled to the winner", done: liveCase?.status === "settled" },
      ]
    : [
        { label: "Stake escrowed at filing", done: stage !== "idle" },
        { label: "Both agents answered", done: stage !== "idle" },
        { label: "Evidence admitted & hashed in-window", done: stageIdx >= 2 },
        { label: "Validator scores inside tolerance band", done: stage === "verdict" },
        { label: "Verdict sealed · stake auto-settled", done: stage === "verdict" },
      ];

  const exChip = (status: string) =>
    status === "ADMITTED"
      ? { borderColor: "color-mix(in oklch, var(--color-success) 24%, transparent)", color: "var(--color-success)", background: "color-mix(in oklch, var(--color-success) 10%, transparent)" }
      : status === "BREACH"
        ? { borderColor: "color-mix(in oklch, var(--color-breach) 40%, transparent)", color: "var(--color-breach)", background: "color-mix(in oklch, var(--color-breach) 10%, transparent)" }
        : { borderColor: "color-mix(in oklch, var(--color-evidence) 30%, transparent)", color: "var(--color-evidence-bright)", background: "color-mix(in oklch, var(--color-evidence) 10%, transparent)" };

  return (
    <div className="grain min-h-screen" style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}>
      <SiteHeader />
      <section
        id="main"
        className="landing-section"
        style={{ "--section-photo": "url('/images/hero-bg.jpg')" } as CSSProperties}
      >
        <div className="mx-auto max-w-[1280px] px-6 sm:px-8 pt-12 sm:pt-16 pb-10">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: "var(--color-accent)" }}>File Dispute</p>
            <span
              className="rounded-full border px-2.5 py-0.5 font-mono text-[10px]"
              style={live
                ? { borderColor: "color-mix(in oklch, var(--color-success) 45%, transparent)", color: "var(--color-success)", background: "color-mix(in oklch, var(--color-success) 8%, transparent)" }
                : { borderColor: "var(--color-rule)", color: "var(--color-ink-faint)", background: "var(--color-paper-2)" }}
            >
              {live ? `LIVE · ${net.label.toLowerCase()}` : "DEMO"}
            </span>
          </div>
          <h1 className="mt-3 font-display text-[32px] min-[420px]:text-[38px] sm:text-[54px] leading-[0.9] tracking-[-0.04em]">File a test dispute. Watch the verdict land.</h1>
          <p className="mt-3 font-mono text-xs" style={{ color: "var(--color-ink-faint)" }}>
            {live
              ? <>Live on GenLayer {net.label.toLowerCase()} · real GEN stake · contract <a href={explorerAddress(contractAddress())} target="_blank" rel="noreferrer" className="underline underline-offset-4">{shortAddress(contractAddress())}</a></>
              : "Demo environment · seeded validator set · no real stake"}
          </p>
          {live && !net.writesAvailable && (
            <p className="mt-2 font-mono text-xs" style={{ color: "var(--color-breach)" }}>
              {net.status}. Contract writes are disabled on this net — switch back to Studio-Dev to file.
            </p>
          )}
        </div>
      </section>
      <main className="mx-auto max-w-[1280px] px-6 sm:px-8 pb-16">
        <div className="pt-10 flex flex-wrap items-center gap-2 sm:gap-3">
          {STAGES.map((s, i) => {
            const isActive = i <= stageIdx;
            const isCurrent = s.key === effStage;
            return (
              <div key={s.key} className="flex items-center gap-2 sm:gap-3">
                <div className={`h-7 w-7 rounded-full border flex items-center justify-center font-mono text-xs transition ${isCurrent ? "animate-pulse" : ""}`} style={{ borderColor: isActive ? "var(--color-accent)" : "var(--color-rule)", background: isActive ? "var(--color-accent)" : "var(--color-paper-2)", color: isActive ? "var(--color-paper)" : "var(--color-ink-faint)" }}>
                  {i + 1}
                </div>
                <span className="hidden sm:inline font-mono text-xs" style={{ color: isActive ? "var(--color-ink)" : "var(--color-ink-faint)" }}>{s.label}</span>
                {i < STAGES.length - 1 && <span className="hidden sm:block h-px w-6" style={{ background: isActive ? "var(--color-accent)" : "var(--color-rule)" }} />}
              </div>
            );
          })}
        </div>
        {live && busy && (
          <p className="mt-4 font-mono text-xs" style={{ color: "var(--color-evidence-bright)" }}>
            Waiting for validator consensus{txHash ? <> · tx <a href={explorerTx(txHash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">{shortAddress(txHash)}</a></> : null}
          </p>
        )}
        {live && liveErr && (
          <p role="alert" className="mt-4 rounded-[14px] border px-4 py-3 font-mono text-xs leading-relaxed" style={{ borderColor: "color-mix(in oklch, var(--color-breach) 40%, transparent)", background: "color-mix(in oklch, var(--color-breach) 8%, transparent)", color: "var(--color-breach)" }}>
            {liveErr}
          </p>
        )}

        <div className="mt-8 grid grid-cols-12 items-start gap-8">
          <div className="col-span-12 space-y-6 lg:sticky lg:top-[84px] lg:col-span-4">
            <div className="rounded-[20px] border p-6" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
              <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>What a verdict needs</p>
              <ul className="mt-4 space-y-3">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]" style={{ borderColor: c.done ? "var(--color-success)" : "var(--color-rule)", color: c.done ? "var(--color-success)" : "var(--color-ink-fainter)" }}>
                      {c.done ? "✓" : "○"}
                    </span>
                    <span className="text-sm leading-snug" style={{ color: c.done ? "var(--color-ink)" : "var(--color-ink-dim)" }}>{c.label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--color-ink-fainter)" }}>
                {live
                  ? "Every box must close before a verdict seals. The contract enforces the order — validators only run once both evidences are on-chain."
                  : "Every box must close before a verdict seals. Azure checks them in order — no skipping."}
              </p>
            </div>
            <div className="rounded-[16px] border p-5" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
              <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Stated honestly</p>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                {live
                  ? `Filing sends a real transaction to the deployed Azure contract on GenLayer ${net.label.toLowerCase()}. The GEN you stake is held by the contract until a verdict settles it.`
                  : "Browser demo with seeded validators. Nothing touches the chain until the contract read goes live."}
              </p>
              {live && (
                <p className="mt-3 break-all font-mono text-[10px]" style={{ color: "var(--color-ink-fainter)" }}>
                  <a href={explorerAddress(contractAddress())} target="_blank" rel="noreferrer" className="underline underline-offset-4">{contractAddress()}</a>
                </p>
              )}
            </div>
          </div>

          <div className="col-span-12 lg:col-span-8">
            {stage === "idle" && live && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void resumeCase(resumeId);
                }}
                className="mb-4 rounded-[16px] border p-5"
                style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Already filed?</p>
                  <p className="font-mono text-[10px]" style={{ color: "var(--color-ink-fainter)" }}>resume an open case by its ID</p>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={resumeId}
                    onChange={(e) => setResumeId(e.target.value)}
                    placeholder="AZ-0142"
                    className="w-full rounded-full border bg-transparent px-4 py-2.5 font-mono text-sm outline-none focus:border-[var(--color-accent)] sm:max-w-[200px]"
                    style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}
                  />
                  <button
                    type="submit"
                    disabled={resumeBusy}
                    className="rounded-full border px-5 py-2.5 text-sm font-medium transition hover:bg-[var(--color-paper-3)] disabled:opacity-50"
                    style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}
                  >
                    {resumeBusy ? "Loading case…" : "Resume case"}
                  </button>
                </div>
                {resumeErr ? (
                  <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--color-breach)" }}>{resumeErr}</p>
                ) : (
                  <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>
                    Left mid-flow? The evidence window stays open on-chain — jump back in without re-filing.
                  </p>
                )}
              </form>
            )}
            {stage === "idle" ? (
              <form onSubmit={onSubmit} className="rounded-[20px] border p-6 sm:p-8" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
                      Claimant {live ? "(connected wallet)" : "Agent ID"}
                    </label>
                    {live ? (
                      <div className="w-full rounded-[12px] border px-4 py-3 font-mono text-sm" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-3)", color: connected ? "var(--color-ink)" : "var(--color-ink-fainter)" }}>
                        {connected ? shortAddress(account || "") : "not connected"}
                      </div>
                    ) : (
                      <input value={claimant} onChange={(e) => setClaimant(e.target.value)} placeholder="DLV-11" className="w-full rounded-[12px] border bg-transparent px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }} />
                    )}
                  </div>
                  <div>
                    <label className="mb-2 block font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>
                      Respondent {live ? "address" : "Agent ID"}
                    </label>
                    <input value={respondent} onChange={(e) => setRespondent(e.target.value)} placeholder={live ? "0x… respondent address" : "ESC-04"} className="w-full rounded-[12px] border bg-transparent px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }} />
                    {live && respondent.trim().length > 0 && !ADDRESS_RE.test(respondent.trim()) && (
                      <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--color-breach)" }}>
                        Must be a 0x wallet address — the respondent files evidence from their own wallet.
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-6">
                  <label className="mb-2 block font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Stake</label>
                  <div className="relative">
                    <input value={stake} onChange={(e) => setStake(e.target.value)} placeholder="2.0" inputMode="decimal" className="w-full rounded-[12px] border bg-transparent px-4 py-3 pr-14 text-sm outline-none focus:border-[var(--color-accent)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }} />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs" style={{ color: "var(--color-ink-faint)" }}>GEN</span>
                  </div>
                  <p className="mt-2 font-mono text-[11px]" style={{ color: stake && !stakeWei ? "var(--color-breach)" : "var(--color-ink-fainter)" }}>
                    {stake && !stakeWei
                      ? "Enter a valid GEN amount (e.g. 2 or 0.5)."
                      : live
                        ? "Sent with the filing transaction and held in escrow by the contract."
                        : "Demo units — nothing is sent."}
                  </p>
                </div>

                <div className="mt-6">
                  <label className="mb-2 block font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Contract Terms (evidence standard)</label>
                  <textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Delivery must be confirmed before 14:00 UTC with signed payload hash..." rows={3} className="w-full resize-none rounded-[12px] border bg-transparent px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }} />
                </div>
                <button
                  type="submit"
                  disabled={live && connected && (busy !== null || !liveFormValid)}
                  className="mt-8 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-medium transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                  style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}
                >
                  {live
                    ? connected
                      ? busy === "file"
                        ? "Filing on-chain…"
                        : `Stake ${formatGen(stakeWei ?? 0n)} GEN · open case →`
                      : busy
                        ? "Connecting…"
                        : "Connect wallet to file →"
                    : "Open Case →"}
                </button>
                <p className="mt-3 text-center font-mono text-xs" style={{ color: "var(--color-ink-fainter)" }}>
                  {live
                    ? "Your wallet opens to sign · the stake travels with the transaction"
                    : "No wallet needed · seeded demo validators · instant reset"}
                </p>
              </form>
            ) : (
              <>
                <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-full border p-1" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>
                  {TABS.map((t) => {
                    const unlocked = stageIdx >= t.min;
                    const active = tab === t.key;
                    return (
                      <button key={t.key} onClick={() => unlocked && setTab(t.key)} className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-sm transition sm:flex-1 sm:px-4 ${unlocked ? "" : "cursor-not-allowed opacity-40"}`} style={active ? { background: "var(--color-accent)", color: "var(--color-paper)" } : { color: "var(--color-ink-dim)" }}>
                        {t.label}
                        {t.key === "evidence" && (bothApproved ? " ✓" : bothEvidence ? " 🔒" : "")}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-[20px] border p-6 sm:p-8" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper-2)" }}>

                  {tab === "case" && !live && (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Case {caseId}</p>
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)", background: "var(--color-paper-3)" }}>demo</span>
                      </div>
                      <div className="mt-4">
                        {[
                          { k: "Claimant", v: claimant },
                          { k: "Respondent", v: respondent },
                          { k: "Stake", v: `${stake || "0"} GEN` },
                          { k: "Escrow status", v: "ESCROWED", ok: true },
                          { k: "Evidence window", v: stageIdx >= 3 ? "CLOSED" : "OPEN" },
                          { k: "Breach alleged", v: "Delivery confirmation outside window" },
                        ].map((r) => (
                          <div key={r.k} className="flex items-baseline justify-between gap-4 border-b border-dashed py-2 last:border-b-0" style={{ borderColor: "var(--color-rule)" }}>
                            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>{r.k}</span>
                            <span className="min-w-0 break-words text-right font-mono text-xs" style={r.ok ? { color: "var(--color-success)" } : undefined}>{r.v}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 rounded-[14px] border p-4" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
                        <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Contract terms (evidence standard)</p>
                        <p className="mt-1.5 min-w-0 break-words text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{terms || "Delivery must be confirmed before 14:00 UTC with a signed payload hash."}</p>
                      </div>
                      <p className="mt-4 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>file_dispute({caseId}) → escrow held by contract · demo</p>
                    </div>
                  )}

                  {tab === "case" && live && (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Case {liveCase?.case_id ?? caseId}</p>
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px]" style={{ borderColor: "color-mix(in oklch, var(--color-success) 45%, transparent)", color: "var(--color-success)", background: "color-mix(in oklch, var(--color-success) 8%, transparent)" }}>
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--color-success)" }} /> On-chain · studio-dev
                        </span>
                      </div>
                      <div className="mt-4">
                        {[
                          { k: "Claimant", v: liveCase?.claimant || account || "—", addr: liveCase?.claimant || account || "" },
                          { k: "Respondent", v: liveCase?.respondent || respondent || "—", addr: liveCase?.respondent || respondent || "" },
                          { k: "Stake", v: `${formatGen(liveCase?.staked_amount ?? stakeWei ?? 0n)} GEN` },
                          { k: "Status", v: liveCase ? (STATUS_LABEL[liveCase.status] ?? liveCase.status) : "…" },
                          ...(liveCase?.status === "pending_acceptance" && liveCase?.acceptance_deadline
                            ? [{ k: "Acceptance deadline", v: `${liveCase?.acceptance_deadline ?? ""}${accLeft && accLeft !== "passed" ? ` · ${accLeft}` : " · passed"}` }]
                            : []),
                          { k: "Evidence window", v: liveCase?.status === "evidence_open" ? (evLeft && evLeft !== "passed" ? `OPEN · ${evLeft}` : "OPEN · deadline passed") : "CLOSED" },
                          ...(liveCase?.status === "evidence_open" && bothEvidence
                            ? [{ k: "Evidence approvals", v: `${(liveCase.claimant_evidence_approved ? 1 : 0) + (liveCase.respondent_evidence_approved ? 1 : 0)} of 2 approved` }]
                            : []),
                          ...(liveCase?.status === "settled_pending"
                            ? [{ k: "Verdict acceptance", v: bothAccepted ? "both parties accepted" : vaLeft && vaLeft !== "passed" ? `OPEN · ${vaLeft}` : "deadline passed" }]
                            : []),
                          ...(txHash ? [{ k: "Filed tx", v: shortAddress(txHash), addr: txHash }] : []),
                        ].map((r) => (
                          <div key={r.k} className="flex items-baseline justify-between gap-4 border-b border-dashed py-2 last:border-b-0" style={{ borderColor: "var(--color-rule)" }}>
                            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>{r.k}</span>
                            {r.addr && (r.addr.length === 42 || TX_HASH_RE.test(r.addr)) ? (
                              <a href={r.addr.length === 42 ? explorerAddress(r.addr) : explorerTx(r.addr)} target="_blank" rel="noreferrer" className="font-mono text-xs underline underline-offset-4">{r.v}</a>
                            ) : (
                              <span className="font-mono text-xs">{r.v}</span>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 rounded-[14px] border p-4" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
                        <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Contract terms (evidence standard)</p>
                        <p className="mt-1.5 min-w-0 break-words text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{liveCase?.terms || terms || "—"}</p>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-3">
                        {liveCase?.status === "pending_acceptance" && isRespondent && (
                          <button onClick={runAccept} disabled={busy !== null} className="rounded-full px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50" style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}>
                            {busy === "accept" ? "Accepting…" : `Accept dispute → escrow ${formatGen(liveCase.staked_amount)} GEN`}
                          </button>
                        )}
                        {liveCase?.status === "pending_acceptance" && isClaimant && (
                          <button onClick={runReclaim} disabled={busy !== null} className="rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-[var(--color-paper-3)] disabled:opacity-50" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}>
                            {busy === "reclaim" ? "Reclaiming…" : "Reclaim stake"}
                          </button>
                        )}
                        {liveCase?.status === "pending_acceptance" && !isRespondent && !isClaimant && (
                          <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)" }}>
                            ⏳ Awaiting acceptance — the respondent accepts from their wallet{accLeft && accLeft !== "passed" ? ` · ${accLeft}` : ""}.
                          </span>
                        )}
                        {liveCase?.status === "evidence_open" && (isClaimant || isRespondent) && bothEvidence && bothApproved && (
                          <button onClick={runVerdict} disabled={busy !== null} className="rounded-full px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50" style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}>
                            {busy === "verdict" ? "Requesting verdict…" : "Request verdict →"}
                          </button>
                        )}
                        {liveCase?.status === "evidence_open" && (isClaimant || isRespondent) && bothEvidence && !bothApproved && (
                          <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-dim)" }}>
                            🔒 Evidence awaiting approval — {awaitingApprovalFrom} must approve the record before the verdict can be requested.
                          </span>
                        )}
                        {liveCase?.status === "evidence_open" && (isClaimant || isRespondent) && !bothEvidence && evPassed && (
                          <button onClick={runVerdict} disabled={busy !== null} className="rounded-full px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50" style={{ background: "var(--color-breach)", color: "var(--color-paper)" }}>
                            {busy === "verdict" ? "Requesting verdict…" : "Request default judgment →"}
                          </button>
                        )}
                        {liveCase?.status === "evidence_open" && (isClaimant || isRespondent) && !bothEvidence && !evPassed && (
                          <span className="w-full font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>
                            Both parties can request the verdict — the contract releases it once both sides lock evidence, or after the deadline as a default judgment.
                          </span>
                        )}
                        {liveCase?.status === "evidence_open" && !isClaimant && !isRespondent && (
                          bothEvidence && bothApproved ? (
                            <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)" }}>
                              Either party can request the verdict from their own wallet.
                            </span>
                          ) : bothEvidence ? (
                            <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)" }}>
                              🔒 Evidence awaiting approval — {awaitingApprovalFrom} must approve before the verdict can be requested.
                            </span>
                          ) : evPassed ? (
                            <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)" }}>
                              Default judgment is available — either party can request it from their own wallet.
                            </span>
                          ) : (
                            <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)" }}>
                              🔒 Evidence lock pending — both parties must submit before the verdict can be requested{evLeft ? ` · closes in ${evLeft}` : ""}.
                            </span>
                          )
                        )}
                        {liveCase?.status === "evidence_open" && (isClaimant || isRespondent) && bothEvidence && !myApproval && (
                          <button onClick={runApprove} disabled={busy !== null} className="rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-[var(--color-paper-3)] disabled:opacity-50" style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}>
                            {busy === "approve" ? "Approving…" : "Approve evidence record ✓"}
                          </button>
                        )}
                        {liveCase?.status === "evidence_open" && (isClaimant || isRespondent) && bothEvidence && myApproval && !bothApproved && (
                          <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "color-mix(in oklch, var(--color-success) 45%, transparent)", color: "var(--color-success)" }}>
                            ✓ You approved the record — waiting for {awaitingApprovalFrom}.
                          </span>
                        )}
                        {liveCase?.status === "settled_pending" && (
                          <>
                            {(isClaimant || isRespondent) && !myAccepted && (
                              <button onClick={runAcceptVerdict} disabled={busy !== null} className="rounded-full px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50" style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}>
                                {busy === "accept_verdict" ? "Accepting…" : "Accept verdict (blind) →"}
                              </button>
                            )}
                            {(isClaimant || isRespondent) && myAccepted && !bothAccepted && (
                              <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "color-mix(in oklch, var(--color-success) 45%, transparent)", color: "var(--color-success)" }}>
                                ✓ You accepted the verdict — waiting for {isClaimant ? "the respondent" : "the claimant"} to accept.
                              </span>
                            )}
                            {bothAccepted && (
                              <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "color-mix(in oklch, var(--color-success) 45%, transparent)", color: "var(--color-success)" }}>
                                ✓ Both parties accepted — settling…
                              </span>
                            )}
                            {!isClaimant && !isRespondent && !valveOpen && (
                              <span className="rounded-full border px-4 py-2.5 font-mono text-xs" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)" }}>
                                ⏳ Verdict delivered — awaiting both parties&apos; blind acceptance{vaLeft && vaLeft !== "passed" ? ` · ${vaLeft}` : ""}.
                              </span>
                            )}
                            {valveOpen && !bothAccepted && (
                              <button onClick={runSettle} disabled={busy !== null} className="rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-[var(--color-paper-3)] disabled:opacity-50" style={{ borderColor: "var(--color-breach)", color: "var(--color-breach)" }}>
                                {busy === "settle" ? "Settling…" : "Settle after acceptance deadline →"}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {liveCase?.status === "pending_acceptance" && isRespondent && (
                        <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>
                          accept_dispute escrows {formatGen(liveCase.staked_amount)} GEN — exactly the claimant&apos;s stake, attached automatically. Your wallet will show the same amount for approval.
                        </p>
                      )}
                      {liveCase?.status === "settled_pending" && (isClaimant || isRespondent) && !myAccepted && (
                        <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>
                          Accepting binds you to a judgment you haven&apos;t seen — the reasoning stays sealed until both parties accept{vaLeft && vaLeft !== "passed" ? ` · acceptance window ${vaLeft}` : ""}. Both acceptances settle and pay the winner in the same transaction.
                        </p>
                      )}
                      <p className="mt-4 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>file_dispute({liveCase?.case_id ?? caseId}) → escrow held by contract</p>
                    </div>
                  )}

                  {tab === "evidence" && !live && (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Exhibit ledger · {caseId}</p>
                        <span className="font-mono text-[10px]" style={{ color: "var(--color-ink-fainter)" }}>{exhibits.length} entries · sha256 truncated · demo</span>
                      </div>
                      <ul className="mt-4">
                        {exhibits.map((x) => (
                          <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b py-3 last:border-b-0" style={{ borderColor: "var(--color-rule)" }}>
                            <span className="font-mono text-xs">{x.id}</span>
                            <span className="font-mono text-[11px]" style={{ color: "var(--color-ink-faint)" }}>{x.by}</span>
                            <span className="min-w-0 basis-full truncate text-xs sm:basis-40 sm:grow" style={{ color: "var(--color-ink-dim)" }}>{x.name}</span>
                            <code className="font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>{x.hash}</code>
                            <span className="font-mono text-[10px]" style={{ color: "var(--color-ink-fainter)" }}>{x.ts}</span>
                            <span className="ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px]" style={exChip(x.status)}>{x.status}</span>
                          </li>
                        ))}
                      </ul>
                      <form onSubmit={addExhibit} className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <input value={exhibitName} onChange={(e) => setExhibitName(e.target.value)} placeholder="Add an exhibit — logs, receipts, payloads…" className="flex-1 rounded-full border bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-evidence)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }} />
                        <button className="rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-[var(--color-paper-3)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}>+ Log it</button>
                      </form>
                      <button onClick={() => setChainOpen(!chainOpen)} className="mt-3 font-mono text-xs underline underline-offset-4" style={{ color: "var(--color-ink-faint)" }}>
                        {chainOpen ? "Hide" : "Show"} exhibit chain integrity
                      </button>
                      {chainOpen && (
                        <div className="mt-3 break-all rounded-[14px] border px-4 py-3 font-mono text-xs" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
                          <span style={{ color: "var(--color-ink-faint)" }}>chain root (fold)</span> <code style={{ color: "var(--color-evidence-bright)" }}>{chainHash}</code>
                          <span className="ml-1" style={{ color: "var(--color-ink-fainter)" }}>· demo fold · full verification lands on-chain</span>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "evidence" && live && (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Evidence on record · {liveCase?.case_id ?? caseId}</p>
                        <span className="font-mono text-[10px]" style={{ color: "var(--color-ink-fainter)" }}>read from the contract</span>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Claimant evidence{liveCase?.claimant_evidence && <span className="rounded-full border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}>🔒 Locked · on-chain</span>}{liveCase?.claimant_evidence && (liveCase.claimant_evidence_approved ? <span className="rounded-full border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}>✓ Approved</span> : <span className="rounded-full border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)" }}>○ awaiting approval</span>)}</p>
                          <p className="mt-1.5 min-w-0 break-words text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                            {evidenceDisplay(liveCase?.claimant_evidence ?? null) ??
                              (liveCase?.claimant_evidence == null && evidenceFail?.side === "claimant" ? (
                                <>
                                  <span className="mr-2 inline-block rounded-full border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: "color-mix(in oklch, var(--color-breach) 45%, transparent)", color: "var(--color-breach)", background: "color-mix(in oklch, var(--color-breach) 8%, transparent)" }}>⚠ Submission didn&apos;t land</span>
                                  {evidenceFail.tx && (
                                    <a href={explorerTx(evidenceFail.tx)} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline underline-offset-2" style={{ color: "var(--color-breach)" }}>tx {shortAddress(evidenceFail.tx)}</a>
                                  )}
                                  <span className="mt-1 block font-mono text-[11px] leading-relaxed" style={{ color: "var(--color-breach)" }}>
                                    Nothing stored, nothing lost — your stake is untouched. Nothing was recorded on-chain, so you can simply paste it again from the form below. (Common cause: the optional URL wasn&apos;t publicly fetchable — the contract can&apos;t get past logins or bot walls like ResearchGate.)
                                  </span>
                                </>
                              ) : (
                                "Awaiting — the claimant submits from their wallet."
                              ))}
                          </p>
                        </div>
                        <div className="rounded-[14px] border p-4" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Respondent evidence{liveCase?.respondent_evidence && <span className="rounded-full border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}>🔒 Locked · on-chain</span>}{liveCase?.respondent_evidence && (liveCase.respondent_evidence_approved ? <span className="rounded-full border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}>✓ Approved</span> : <span className="rounded-full border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink-faint)" }}>○ awaiting approval</span>)}</p>
                          <p className="mt-1.5 min-w-0 break-words text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                            {evidenceDisplay(liveCase?.respondent_evidence ?? null) ??
                              (liveCase?.respondent_evidence == null && evidenceFail?.side === "respondent" ? (
                                <>
                                  <span className="mr-2 inline-block rounded-full border px-2 py-0.5 font-mono text-[9px]" style={{ borderColor: "color-mix(in oklch, var(--color-breach) 45%, transparent)", color: "var(--color-breach)", background: "color-mix(in oklch, var(--color-breach) 8%, transparent)" }}>⚠ Submission didn&apos;t land</span>
                                  {evidenceFail.tx && (
                                    <a href={explorerTx(evidenceFail.tx)} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline underline-offset-2" style={{ color: "var(--color-breach)" }}>tx {shortAddress(evidenceFail.tx)}</a>
                                  )}
                                  <span className="mt-1 block font-mono text-[11px] leading-relaxed" style={{ color: "var(--color-breach)" }}>
                                    Nothing stored, nothing lost — your stake is untouched. Nothing was recorded on-chain, so you can simply paste it again from the form below. (Common cause: the optional URL wasn&apos;t publicly fetchable — the contract can&apos;t get past logins or bot walls like ResearchGate.)
                                  </span>
                                </>
                              ) : (
                                "Awaiting — the respondent submits from their own wallet."
                              ))}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--color-ink-faint)" }}>
                        {liveCase?.claimant_evidence && liveCase?.respondent_evidence
                          ? bothApproved
                            ? "✓ Both parties approved the evidence record — the verdict can be requested from the Case tab."
                            : `🔒 Evidence awaiting approval — ${awaitingApprovalFrom} must approve the record before the verdict can be requested.`
                          : `${(liveCase?.claimant_evidence ? 1 : 0) + (liveCase?.respondent_evidence ? 1 : 0)} of 2 evidence locks in place — no verdict can be requested until both sides lock. Submitted evidence is permanent.`}
                      </p>
                      {liveCase?.status === "evidence_open" && (isClaimant || isRespondent) && bothEvidence && !myApproval && (
                        <button onClick={runApprove} disabled={busy !== null} className="mt-3 rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-[var(--color-paper-3)] disabled:opacity-50" style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}>
                          {busy === "approve" ? "Approving…" : "Approve evidence record ✓"}
                        </button>
                      )}
                      {liveCase?.status === "evidence_open" && (isClaimant || isRespondent) && bothEvidence && myApproval && !bothApproved && (
                        <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--color-success)" }}>
                          ✓ You approved the record — waiting for {awaitingApprovalFrom} to approve.
                        </p>
                      )}
                      {liveCase?.status === "evidence_open" && connected ? (
                        <>
                          <form onSubmit={runEvidence} className="mt-4 flex flex-col gap-2">
                            <input value={evidenceInput} onChange={(e) => setEvidenceInput(e.target.value)} placeholder="Add claimant evidence — logs, receipts, measurements…" className="w-full rounded-full border bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-evidence)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }} />
                            <input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="Optional evidence URL — must be publicly accessible: the contract fetches it itself (no logins or bot walls)" className="w-full rounded-full border bg-transparent px-4 py-2.5 text-sm outline-none focus:border-[var(--color-evidence)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }} />
                            <button disabled={busy !== null} className="self-start rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-[var(--color-paper-3)] disabled:opacity-50" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}>
                              {busy === "evidence" ? "Submitting…" : "Submit on-chain"}
                            </button>
                          </form>
                          <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>
                            The connected wallet is the claimant — evidence lands on-chain under its address. With a URL, the contract itself fetches the page via GenLayer Web Access and stores the snapshot on-chain; a party can&apos;t write into that block, so it reads as authenticated retrieval at verdict time. Pages behind logins or bot walls can&apos;t be fetched — the submission then fails without recording anything, and you can simply retry with text or another URL.
                          </p>
                          {bothEvidence && (
                            <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--color-breach)" }}>
                              ⚠ Both sides have locked evidence — re-submitting either side&apos;s evidence resets BOTH approvals, and both parties must approve the new record before a verdict can be requested.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>
                          {liveCase && liveCase.status !== "evidence_open"
                            ? "Evidence window is closed for this case."
                            : "Connect the claimant's wallet to submit evidence on-chain."}
                        </p>
                      )}
                    </div>
                  )}

                  {tab === "validators" && !live && (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Validator scores — {caseId}</p>
                        <span className="font-mono text-xs" style={{ color: "var(--color-accent)" }}>Band {BAND[0]}–{BAND[1]}</span>
                      </div>
                      <div className="mt-5 space-y-3">
                        {SCORES.map((s, idx) => (
                          <div key={idx} className="flex items-center gap-4">
                            <span className="w-10 font-mono text-xs" style={{ color: "var(--color-ink-faint)" }}>V-0{idx + 1}</span>
                            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--color-paper-4)" }}>
                              <div className="absolute inset-y-0" style={{ left: `${BAND[0]}%`, right: `${100 - BAND[1]}%`, borderLeft: "1px dashed color-mix(in oklch, var(--color-evidence) 60%, transparent)", borderRight: "1px dashed color-mix(in oklch, var(--color-evidence) 60%, transparent)", background: "color-mix(in oklch, var(--color-evidence) 14%, transparent)" }} />
                              <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${s}%`, background: inBand(s) ? "var(--color-accent)" : "var(--color-breach)" }} />
                            </div>
                            <span className="w-8 text-right font-mono text-sm" style={{ color: inBand(s) ? "var(--color-ink)" : "var(--color-breach)" }}>{s}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 flex items-center gap-2 font-mono text-xs" style={{ color: "var(--color-ink-faint)" }}>
                        <span className="h-2 w-8 rounded-full" style={{ background: "color-mix(in oklch, var(--color-evidence) 24%, transparent)", border: "1px dashed var(--color-evidence)" }} /> tolerance band
                        <span className="ml-2 h-2 w-8 rounded-full" style={{ background: "var(--color-accent)" }} /> inside
                      </div>
                      <p className="mt-4 rounded-[14px] border px-4 py-3 text-xs leading-relaxed" style={{ borderColor: "color-mix(in oklch, var(--color-success) 26%, transparent)", background: "color-mix(in oklch, var(--color-success) 8%, transparent)", color: "var(--color-ink-dim)" }}>
                        All four scores land inside the band while none match exactly — consensus reached with tolerance, not unanimity.
                      </p>
                      <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>demo validator set — not on-chain</p>
                    </div>
                  )}

                  {tab === "validators" && live && (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--color-ink-faint)" }}>Consensus — {liveCase?.case_id ?? caseId}</p>
                        <span className="font-mono text-xs" style={{ color: "var(--color-accent)" }}>{liveCase ? (STATUS_LABEL[liveCase.status] ?? liveCase.status) : "…"}</span>
                      </div>
                      <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                        Validators independently analyze both evidences against the contract terms under GenLayer&apos;s comparative
                        equivalence principle: each writes its own reasoning, and consensus requires the conclusions to agree on the
                        winner in substance — not on identical wording.
                      </p>
                      <div className="mt-5 space-y-3">
                        {[
                          { label: "Evidence window closed — both sides on-chain", done: liveCase?.status !== "evidence_open" },
                          { label: "Validators reached consensus on a winner", done: liveCase?.status === "settled_pending" || liveCase?.status === "settled" },
                          { label: "Both parties accepted the verdict", done: liveCase?.status === "settled" },
                          { label: "Stake settled to the winner", done: liveCase?.status === "settled" },
                        ].map((s) => (
                          <div key={s.label} className="flex items-center gap-3">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]" style={{ borderColor: s.done ? "var(--color-success)" : "var(--color-rule)", color: s.done ? "var(--color-success)" : "var(--color-ink-fainter)" }}>
                              {s.done ? "✓" : "○"}
                            </span>
                            <span className="text-sm" style={{ color: s.done ? "var(--color-ink)" : "var(--color-ink-dim)" }}>{s.label}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-5 rounded-[14px] border px-4 py-3 text-xs leading-relaxed" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)", color: "var(--color-ink-fainter)" }}>
                        The deployed contract does not expose per-validator score bars — this panel shows only what the chain actually reports.
                      </p>
                    </div>
                  )}

                  {tab === "verdict" && !live && (
                    <div>
                      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                        <div className="seal flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-full border-2 text-center" style={{ borderColor: "var(--color-accent)", background: "var(--color-paper)", animation: "stampIn 700ms var(--ease-out) 400ms both" }}>
                          <AzureLogo size={22} className="text-[var(--color-accent-bright)]" bright />
                          <p className="font-display text-[8px] uppercase leading-none tracking-widest" style={{ color: "var(--color-accent)" }}>Verdict</p>
                        </div>
                        <div className="text-center sm:text-left">
                          <p className="font-display text-[26px] leading-tight">For {claimant}</p>
                          <p className="mt-1 font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>Against {respondent} · {caseId}</p>
                          <div className="mt-4">
                            <div className="flex items-center justify-between font-mono text-[11px]" style={{ color: "var(--color-ink-faint)" }}>
                              <span>STAKE SETTLEMENT</span>
                              <span style={{ color: "var(--color-success)" }}>{stake || "0"} GEN → {claimant}</span>
                            </div>
                            <div className="mt-1 h-2.5 overflow-hidden rounded-full" style={{ background: "var(--color-paper-4)" }}>
                              <div className="h-full" style={{ width: "100%", background: "var(--color-success)" }} />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-6 rounded-[16px] border p-5" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
                        <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Written reasoning</p>
                        <p className="mt-2 min-w-0 break-words text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                          The challenge from {respondent} arrived after the evidence window closed and carries no signature. The manifest payload hash matches the escrow terms — the record favors {claimant}. Stake settles automatically; no agent needs to sign off.
                        </p>
                        <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--color-ink-fainter)" }}>demo reasoning — not from the chain</p>
                      </div>
                      <div className="mt-6 flex flex-wrap gap-3">
                        <Link href="/dockets" className="rounded-full px-5 py-2.5 text-sm font-medium hover:opacity-90" style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}>
                          Read it on the docket →
                        </Link>
                        <button onClick={resetAll} className="rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-[var(--color-paper-3)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}>
                          File another dispute
                        </button>
                      </div>
                    </div>
                  )}

                  {tab === "verdict" && live && (
                    <div>
                      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                        <div className="seal flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-full border-2 text-center" style={{ borderColor: revealed ? "var(--color-accent)" : "var(--color-rule)", background: "var(--color-paper)", animation: revealed ? "stampIn 700ms var(--ease-out) 400ms both" : undefined }}>
                          <AzureLogo size={22} className="text-[var(--color-accent-bright)]" bright />
                          <p className="font-display text-[8px] uppercase leading-none tracking-widest" style={{ color: "var(--color-accent)" }}>Verdict</p>
                        </div>
                        <div className="text-center sm:text-left">
                          <p className="font-display text-[26px] leading-tight">
                            {revealed && liveCase?.winner
                              ? `For ${shortAddress(liveCase.winner)}`
                              : liveCase?.status === "settled_pending"
                                ? "Verdict sealed"
                                : "Awaiting verdict"}
                          </p>
                          <p className="mt-1 font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>Case {liveCase?.case_id ?? caseId} · GenLayer {net.label}</p>
                          <div className="mt-4">
                            <div className="flex items-center justify-between font-mono text-[11px]" style={{ color: "var(--color-ink-faint)" }}>
                              <span>STAKE {formatGen(liveCase?.staked_amount ?? stakeWei ?? 0n)} GEN</span>
                              <span style={{ color: revealed ? "var(--color-success)" : "var(--color-ink-faint)" }}>
                                {revealed && liveCase?.winner
                                  ? `settled → ${shortAddress(liveCase.winner)}`
                                  : liveCase?.status === "settled_pending"
                                    ? "verdict in · blind acceptance pending"
                                    : "held in escrow"}
                              </span>
                            </div>
                            <div className="mt-1 h-2.5 overflow-hidden rounded-full" style={{ background: "var(--color-paper-4)" }}>
                              <div className="h-full transition-all duration-500" style={{ width: revealed ? "100%" : "0%", background: "var(--color-success)" }} />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-6 rounded-[16px] border p-5" style={{ borderColor: "var(--color-rule)", background: "var(--color-paper)" }}>
                        <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-fainter)" }}>Written reasoning{revealed && liveCase?.verdict ? " — validator consensus, on-chain" : ""}</p>
                        <p className="mt-2 min-w-0 break-words text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                          {revealed
                            ? liveCase?.verdict ?? "The verdict appears here once the request lands — from the Case tab when both evidences are on-chain, or after the deadline as a default judgment."
                            : liveCase?.status === "settled_pending"
                              ? "🔒 Sealed — the reasoning stays hidden until both parties accept the verdict. Accepting binds you to a judgment you haven't seen; the acceptance window closes on its deadline even if one party never accepts."
                              : "The verdict appears here once the request lands — from the Case tab when both evidences are on-chain, or after the deadline as a default judgment."}
                        </p>
                      </div>
                      {liveErr && (
                        <p role="alert" className="mt-4 rounded-[14px] border px-4 py-3 font-mono text-xs leading-relaxed" style={{ borderColor: "color-mix(in oklch, var(--color-breach) 40%, transparent)", background: "color-mix(in oklch, var(--color-breach) 8%, transparent)", color: "var(--color-breach)" }}>
                          {liveErr}
                        </p>
                      )}
                      <div className="mt-6 flex flex-wrap gap-3">
                        <Link href="/dockets" className="rounded-full px-5 py-2.5 text-sm font-medium hover:opacity-90" style={{ background: "var(--color-accent)", color: "var(--color-paper)" }}>
                          Read it on the docket →
                        </Link>
                        <button onClick={resetAll} className="rounded-full border px-5 py-2.5 text-sm font-medium hover:bg-[var(--color-paper-3)]" style={{ borderColor: "var(--color-rule)", color: "var(--color-ink)" }}>
                          File another dispute
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
      <SiteFooter
        photo="/images/hero-bg.jpg"
        copy={{
          headline: "Evidence first. Escrow from the moment you file.",
          badge: "AZ-FILE-2026",
          footnote: "© 2026 Azure. Your stake sits on-chain until a verdict lands.",
        }}
      />
    </div>
  );
}
