import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { getSession } from "../session";
import {
  checkRiderVerification,
  isRiderVerified,
  type RiderVerificationProfile,
} from "./riderVerification";
import type { VerificationDocument } from "./riderVerificationDocuments";
import { peekRiderVerification, setRiderVerificationCache } from "./riderVerificationCache";

type GateMode = "require-verified" | "require-pending";

const POLL_INTERVAL_MS = 30_000;

/**
 * require-verified → blocks riders missing docs or admin approval from tabs / main app.
 * require-pending  → tracks status on pending-verification without auto-navigating.
 */
export function useRiderVerificationGate(mode: GateMode) {
  const cached = peekRiderVerification();
  // Seed from cache when available so a screen the rider already visited
  // this session (via the verification nav bar) renders real content
  // immediately instead of a blank spinner — `evaluate()` below still runs
  // and refreshes it in the background regardless.
  const [checking, setChecking] = useState(!cached);
  const [profile, setProfile] = useState<RiderVerificationProfile | null>(cached?.profile ?? null);
  const [documents, setDocuments] = useState<VerificationDocument[]>(cached?.documents ?? []);
  const [documentsUploaded, setDocumentsUploaded] = useState(cached?.documentsUploaded ?? false);
  const [verified, setVerified] = useState(cached?.verified ?? false);

  const evaluate = useCallback(async () => {
    const session = await getSession();
    if (!session?.token) {
      router.replace("/phone");
      return null;
    }

    let result;
    try {
      result = await checkRiderVerification(session.token);
    } catch {
      // Network failure while entering the main app: keep rider locked out.
      if (mode === "require-verified") {
        router.replace("/pending-verification");
      }
      return null;
    }

    setProfile(result.profile);
    setDocuments(result.documents);
    setDocumentsUploaded(result.documentsUploaded);
    setVerified(result.verified);
    setRiderVerificationCache(result);

    if (mode === "require-verified" && !result.verified) {
      router.replace(result.documentsUploaded ? "/pending-verification" : "/documents");
      return result;
    }

    return result;
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await evaluate();
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [evaluate]);

  useFocusEffect(
    useCallback(() => {
      void evaluate();
    }, [evaluate])
  );

  useEffect(() => {
    const id = setInterval(() => {
      void evaluate();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [evaluate]);

  return {
    checking,
    profile,
    documents,
    documentsUploaded,
    verified,
    isVerified: isRiderVerified(profile, documentsUploaded),
    refresh: evaluate,
  };
}
