import Constants from "expo-constants";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, Segmented } from "@/components/ui";
import { api, apiErrorMessage } from "@/lib/api";
import { API_URL, PROFILES } from "@/lib/config";
import { useSession } from "@/store/session";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const signIn = useSession((s) => s.signIn);
  const deviceId = useSession((s) => s.deviceId);

  // "Who is using this phone?" when both profiles are configured via EXPO_PUBLIC_USER_*.
  const [profile, setProfile] = useState(PROFILES[0]?.key ?? "");
  const [email, setEmail] = useState(PROFILES[0]?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pickProfile = (key: string) => {
    setProfile(key);
    setEmail(PROFILES.find((p) => p.key === key)?.email ?? "");
  };

  const submit = async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.login({
        email: email.trim(),
        password,
        device_id: deviceId,
        device_name: Constants.deviceName ?? `${Platform.OS} phone`,
      });
      // The signed-in user id is saved in SecureStore so "Paid by" defaults to this person.
      await signIn(res.access_token, res.user);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-surface">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: insets.top + 24 }}
      >
        <View className="mb-10 items-center">
          <Text className="mb-3 text-6xl">💑</Text>
          <Text className="text-3xl font-bold text-ink">CoupleCount</Text>
          <Text className="mt-1 text-base text-ink-muted">Shared money, monthly budgets, MSI.</Text>
        </View>

        {PROFILES.length === 2 ? (
          <View className="mb-4">
            <Text className="mb-2 text-sm font-medium text-ink-muted">Who is using this phone?</Text>
            <Segmented
              options={PROFILES.map((p) => ({ value: p.key, label: p.name }))}
              value={profile}
              onChange={pickProfile}
            />
          </View>
        ) : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          className="mb-3"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          onSubmitEditing={submit}
          className="mb-4"
        />

        {error ? <Text className="mb-3 text-sm text-negative">{error}</Text> : null}

        <Button title="Sign in" onPress={submit} loading={loading} disabled={!email || !password || !deviceId} />

        <Text className="mt-6 text-center text-xs text-ink-faint">
          This phone will be linked to your account. Server: {API_URL}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
