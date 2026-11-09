/**
 * Fingerprint gate.
 *
 * - When a saved session exists, the app starts locked and asks for the fingerprint
 *   (or the phone's PIN/pattern as a fallback) before any financial data is visible.
 * - When the app goes to the background it locks at once, so the Android
 *   recent-apps preview shows the lock screen and not your balances. Coming back
 *   asks for the fingerprint again.
 * - The navigation tree stays mounted under a full-screen <Modal>, so a
 *   half-filled Add Expense form survives the lock.
 */
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, BackHandler, Modal, Text, View, type AppStateStatus } from "react-native";

import { useSession } from "@/store/session";

import { Button } from "./ui";

const ERROR_TEXT: Partial<Record<string, string>> = {
  user_cancel: "Unlock cancelled.",
  system_cancel: "Unlock was interrupted. Try again.",
  app_cancel: "Unlock was interrupted. Try again.",
  lockout: "Too many attempts. Wait a moment, or use your phone's PIN.",
  not_enrolled: "No fingerprint is enrolled on this phone.",
  passcode_not_set: "Set a screen lock (PIN, pattern or fingerprint) in Android settings to use this app.",
  not_available: "Biometric hardware isn't available right now.",
  authentication_failed: "Fingerprint not recognised. Try again.",
  timeout: "Timed out. Try again.",
};

export function BiometricAuthGate({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const locked = useSession((s) => s.locked);
  const lock = useSession((s) => s.lock);
  const unlock = useSession((s) => s.unlock);
  const signOut = useSession((s) => s.signOut);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const authenticating = useRef(false);

  const gateActive = status === "signedIn" && locked;

  const authenticate = useCallback(async () => {
    if (authenticating.current || AppState.currentState !== "active") return;
    authenticating.current = true;
    setBusy(true);
    setError(null);
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        setError(ERROR_TEXT.passcode_not_set!);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock CoupleCount",
        promptSubtitle: "Confirm it's you to see your finances",
        cancelLabel: "Cancel",
        disableDeviceFallback: false, // allow the phone PIN/pattern if the fingerprint fails
        requireConfirmation: false,
      });
      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        unlock();
      } else {
        setError(ERROR_TEXT[result.error] ?? "Couldn't verify it's you. Try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Biometric check failed.");
    } finally {
      authenticating.current = false;
      setBusy(false);
    }
  }, [unlock]);

  // Prompt automatically whenever we become locked while in the foreground.
  useEffect(() => {
    if (gateActive) authenticate();
  }, [gateActive, authenticate]);

  // Lock on background, prompt again on return.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background") {
        // Ignore the transient background some Android skins report while the
        // system biometric sheet is on screen.
        if (!authenticating.current) lock();
      } else if (next === "active" && useSession.getState().locked && useSession.getState().status === "signedIn") {
        authenticate();
      }
    });
    return () => sub.remove();
  }, [lock, authenticate]);

  return (
    <>
      {children}
      <Modal
        visible={gateActive}
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => BackHandler.exitApp()}
      >
        <View className="flex-1 items-center justify-center bg-brand px-8">
          <Text className="mb-2 text-6xl">🔒</Text>
          <Text className="mb-1 text-2xl font-bold text-white">CoupleCount is locked</Text>
          <Text className="mb-8 text-center text-base text-white/80">
            Use your fingerprint to see your shared finances.
          </Text>
          {error ? <Text className="mb-4 text-center text-sm text-white">{error}</Text> : null}
          <Button title="Unlock" variant="secondary" loading={busy} onPress={authenticate} className="w-full" />
          <Button title="Sign out" variant="ghost" onPress={() => signOut()} className="mt-2 w-full" />
        </View>
      </Modal>
    </>
  );
}
