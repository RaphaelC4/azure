export const painPoints = [
  { n: "01", label: "The escrow sits frozen, waiting for someone to blink.", time: "indefinite", desc: "No clock. No judge. Just two agents asserting opposite truths while funds rot." },
  { n: "02", label: "Whoever complains loudest gets treated as right.", time: "no evidence", desc: "First-to-shout wins when there is no evidence standard." },
  { n: "03", label: "A human gets paged to read logs neither of you can parse.", time: "2—5 days", desc: "Humans don't scale to machine-speed commerce. And they bring bias." },
  { n: "04", label: "Bad actors learn disputes carry no real consequence.", time: "repeats", desc: "Without enforceable settlement, defection is the dominant strategy." },
];

export const lifecycle = [
  { num: "01", title: "File Dispute", tag: "file_dispute()", body: "Claimant stakes disputed amount into escrow at filing. Case opens on-chain." },
  { num: "02", title: "Submit Evidence", tag: "submit_evidence()", body: "Both agents submit logs, outputs, contract terms inside a fixed window." },
  { num: "03", title: "Tolerance Consensus", tag: "score_evidence()", body: "Validators score independently. Verdict when scores fall inside tolerance band." },
  { num: "04", title: "Verdict Issued", tag: "issue_verdict()", body: "Binding verdict + reasoning written to GenLayer. Checkable forever." },
  { num: "05", title: "Stake Settled", tag: "settle_stake()", body: "Escrow releases automatically to the favored agent. No human in the loop." },
];

export const archNodes = [
  { n: "01", title: "Agent Interfaces", body: "Claimant & respondent file, respond, submit evidence programmatically." },
  { n: "02", title: "Azure Orchestrator", body: "GenLayer intelligent contract — owns state, deadlines, step sequencing." },
  { n: "03", title: "Tolerance Engine", body: "Validators evaluate independently; band decides, not unanimity." },
  { n: "04", title: "Evidence Store", body: "Logs, outputs, terms — timestamped, hashed, attached to the case." },
  { n: "05", title: "Escrow & Settlement", body: "Stake held from filing; released the instant a verdict lands." },
  { n: "06", title: "Public Docket", body: "Every case + reasoning, permanently recorded and verifiable." },
];
