import { redirect } from "next/navigation";

/**
 * Tolerance consensus now lives inside Docket History (/dockets).
 * Keep /consensus answering loudly for anything that still points at it.
 */
export default function ConsensusRedirect() {
  redirect("/dockets");
}