import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

type IconName = ComponentProps<typeof Ionicons>["name"];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#4F6BED",
        tabBarInactiveTintColor: "#9CA3AF",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: "#F5F6FA" },
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: "#F5F6FA" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Month", tabBarIcon: icon("calendar-outline") }} />
      <Tabs.Screen name="balances" options={{ title: "Balances", tabBarIcon: icon("swap-horizontal-outline") }} />
      <Tabs.Screen name="installments" options={{ title: "Installments", tabBarIcon: icon("card-outline") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("settings-outline") }} />
    </Tabs>
  );
}
