import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
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
  // Mirrors `verified` for evaluate() to read without going stale — evaluate
  // is a useCallback with only `mode` in its deps, so referencing `verified`
  // directly inside it would close over whatever value existed when this
  // particular evaluate() instance was created, not the current one.
  const verifiedRef = useRef(verified);
  useEffect(() => {
    verifiedRef.current = verified;
  }, [verified]);

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
      // A network failure here doesn't mean the rider actually failed
      // verification — it just means this particular check couldn't
      // complete. Only treat it as a lockout if we've never actually
      // confirmed this rider is verified: a transient blip (common right
      // when the app resumes/reconnects, which the AppState-triggered
      // re-check below now runs on every single time) shouldn't bounce an
      // already-verified rider out to /pending-verification just because
      // one connectivity hiccup happened to coincide with a re-check.
      if (mode === "require-verified" && !verifiedRef.current) {
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

  // The cache seeded above (peekRiderVerification) only proves the rider was
  // verified as of the last check — potentially made stale by an admin
  // suspending them, or a document getting invalidated, while this screen
  // sat in the background. `checking`/`verified` alone don't catch that: both
  // are seeded from the same stale cache, so the screen would otherwise
  // render real content on the very first frame after foregrounding, before
  // evaluate()'s background re-check has a chance to redirect it away.
  // Foregrounding the app doesn't fire useFocusEffect on its own (the screen
  // was never blurred by React Navigation), so it needs its own listener,
  // same pattern as home.tsx's AppState-driven location handoff. This
  // deliberately re-blocks on every foreground rather than trusting the
  // cache indefinitely — the ordinary in-session screen-to-screen bounce
  // (Details → Status → Documents) never triggers an AppState transition, so
  // that fast-paint case this cache exists for is untouched.
  const evaluateRef = useRef(evaluate);
  evaluateRef.current = evaluate;
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== "active") return;
      // Only show the blocking spinner (which unmounts the whole
      // `(tabs)` tree, including home.tsx — see _layout.tsx's `checking ||
      // !verified` guard) when we don't already have a confirmed verified
      // state. Previously fired unconditionally on *every* foreground
      // transition, including ones the app itself causes — e.g. the OS
      // Settings round-trip for granting "Allow all the time" location
      // permission backgrounds the app and immediately re-foregrounds it.
      // That unmounted/remounted home.tsx mid-permission-request, letting
      // its mount effect call Location.request*PermissionsAsync() a second
      // time while the original call was still in flight — expo-location
      // rejects the overlapping request ("Different authorization request
      // is already in progress"), and with no try/catch anywhere in that
      // chain it surfaced as a crash/refresh loop right after granting
      // background location. evaluate() below still runs every time and
      // still redirects immediately via its own router.replace if
      // verification status genuinely changed — this only skips the extra
      // blank-spinner interruption (and the unmount it causes) for the
      // common case of re-confirming a rider who was already verified.
      if (!verifiedRef.current) setChecking(true);
      void evaluateRef.current().finally(() => setChecking(false));
    };
    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  }, []);

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
