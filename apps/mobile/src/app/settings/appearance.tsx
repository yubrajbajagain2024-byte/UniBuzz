import { Platform } from "react-native";
import { SettingsCheckRow, SettingsPage, SettingsSection } from "@/components/settings/settings-ui";
import { hapticSelect } from "@/lib/haptics";
import { DEFAULT_THEME_PREFERENCE, THEME_PREFERENCES } from "@/lib/palette";
import { useAppTheme } from "@/lib/theme-provider";

const SYSTEM_HINT = Platform.OS === "ios" ? "Follows your iPhone's appearance" : "Follows your phone's appearance";

/**
 * Settings → Appearance: Light, Dark (the default, marked so) or System. A tap repaints the app at once and is
 * remembered on this phone, so there is nothing to save.
 */
export default function AppearanceSettingsScreen() {
  const { preference, setPreference } = useAppTheme();
  return (
    <SettingsPage>
      <SettingsSection footer="Your choice is remembered on this phone.">
        {THEME_PREFERENCES.map((option) => (
          <SettingsCheckRow
            key={option.value}
            title={option.label}
            subtitle={option.value === "system" ? SYSTEM_HINT : option.value === DEFAULT_THEME_PREFERENCE ? "The default" : undefined}
            checked={option.value === preference}
            onPress={() => {
              if (option.value === preference) return;
              hapticSelect();
              setPreference(option.value);
            }}
          />
        ))}
      </SettingsSection>
    </SettingsPage>
  );
}
