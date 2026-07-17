import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { getSession } from "../session";
import {
  checkRiderVerification,
  isRiderVerified,
  type RiderDocuments,
  type RiderVerificationProfile,
} from "./riderVerification";

type GateMode = "require-verified" | "require-pending";

const POLL_INTERVAL_MS = 30_000;

/**
 * require-verified → blocks riders missing docs or admin approval from tabs / main app.
 * require-pending  → tracks status on pending-verification without auto-navigating.
 */
export function useRiderVerificationGate(mode: GateMode) {
  const [checking, setChecking] = useState(true);
  const [profile, setProfile] = useState<RiderVerificationProfile | null>(null);
  const [documents, setDocuments] = useState<RiderDocuments | null>(null);
  const [documentsUploaded, setDocumentsUploaded] = useState(false);
  const [verified, setVerified] = useState(false);

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
