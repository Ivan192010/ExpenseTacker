import Constants from "expo-constants";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { Avatar, Button, Card, SectionTitle } from "@/components/ui";
import { useDevices, usePeople, useRevokeDevice } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { prettyDate } from "@/lib/dates";
import { useSession } from "@/store/session";

export default function SettingsScreen() {
  const { me, partner, color } = usePeople();
  const lock = useSession((s) => s.lock);
  const signOut = useSession((s) => s.signOut);
  const devices = useDevices();
  const revoke = useRevokeDevice();

  const confirmRevoke = (id: number, name: string | null, isCurrent: boolean) =>
    Alert.alert(
      isCurrent ? "Unlink this phone?" : "Unlink device?",
      `${name ?? "This device"} will be signed out${isCurrent ? ", including right now" : ""}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            try {
              await revoke.mutateAsync(id);
              if (isCurrent) await signOut();
            } catch (e) {
              Alert.alert("Couldn't unlink", apiErrorMessage(e));
            }
          },
        },
      ],
    );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Card>
        <View className="flex-row items-center">
          {me ? <Avatar name={me.name} color={color(me.id)} size={44} /> : null}
          <View className="ml-3">
            <Text className="text-lg font-bold text-ink">{me?.name}</Text>
            <Text className="text-sm text-ink-muted">{me?.email}</Text>
          </View>
        </View>
        {partner ? <Text className="mt-3 text-sm text-ink-muted">Sharing with {partner.name} 💞</Text> : null}
        <Text className="mt-1 text-xs text-ink-faint">New expenses default to "Paid by You" on this phone.</Text>
      </Card>

      <SectionTitle>Security</SectionTitle>
      <Button title="🔒 Lock now" variant="secondary" onPress={lock} />
      <Text className="mt-2 px-1 text-xs text-ink-muted">
        The app always asks for your fingerprint when it opens or comes back from the background.
      </Text>

      <SectionTitle>Linked phones</SectionTitle>
      <Card className="p-0">
        {(devices.data ?? [])
          .filter((d) => !d.revoked_at)
          .map((d, i) => (
            <View key={d.id} className={`flex-row items-center px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
              <Text className="mr-3 text-xl">📱</Text>
              <View className="flex-1">
                <Text className="text-base text-ink">
                  {d.device_name ?? "Phone"} {d.is_current ? "(this phone)" : ""}
                </Text>
                <Text className="text-xs text-ink-muted">
                  Linked {prettyDate(d.created_at.slice(0, 10))}
                  {d.last_seen_at ? ` · active ${prettyDate(d.last_seen_at.slice(0, 10))}` : ""}
                </Text>
              </View>
              <Pressable hitSlop={8} onPress={() => confirmRevoke(d.id, d.device_name, d.is_current)}>
                <Text className="text-sm font-semibold text-negative">Unlink</Text>
              </Pressable>
            </View>
          ))}
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card>
        <Text className="text-xs text-ink-muted">Server: {API_URL}</Text>
        <Text className="text-xs text-ink-muted">Version {Constants.expoConfig?.version ?? "?"}</Text>
      </Card>

      <Button
        title="Sign out"
        variant="danger"
        className="mt-6"
        onPress={() =>
          Alert.alert("Sign out?", "You'll need your password to sign back in on this phone.", [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: () => signOut() },
          ])
        }
      />
    </ScrollView>
  );
}
