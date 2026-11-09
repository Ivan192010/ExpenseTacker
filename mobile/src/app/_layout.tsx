import "../../global.css";

import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BiometricAuthGate } from "@/components/BiometricAuthGate";
import { Loading } from "@/components/ui";
import { useSession } from "@/store/session";

// Refetch when the app comes back to the foreground.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (s) => handleFocus(s === "active"));
  return () => sub.remove();
});

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Drop cached finances when someone signs out.
  useEffect(() => {
    if (status === "signedOut") queryClient.clear();
  }, [status, queryClient]);

  if (status === "loading") return <Loading />;
  const signedIn = status === "signedIn";

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <BiometricAuthGate>
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: "#F5F6FA" },
              headerTitleStyle: { fontWeight: "700" },
              contentStyle: { backgroundColor: "#F5F6FA" },
            }}
          >
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="expense/new" options={{ presentation: "modal", title: "New entry" }} />
              <Stack.Screen name="expense/[id]" options={{ presentation: "modal", title: "Edit entry" }} />
              <Stack.Screen name="income" options={{ presentation: "modal", title: "Monthly income" }} />
              <Stack.Screen name="ledgers" options={{ presentation: "modal", title: "Ledgers" }} />
              <Stack.Screen name="installments/[id]" options={{ title: "Installment plan" }} />
            </Stack.Protected>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
        </BiometricAuthGate>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
