import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors, fonts, radii } from '../../lib/theme';

export const CARE_TYPES = [
  { key: 'right-now', label: 'Right Now' },
  { key: 'date-night', label: 'Date Night' },
  { key: 'my-regulars', label: 'My Regulars' },
  { key: 'night-shift', label: 'Night Shift' },
  { key: 'weekend-getaway', label: 'Weekend Getaway' },
  { key: 'extended-trip', label: 'Extended Trip' },
] as const;

export type CareTypeKey = (typeof CARE_TYPES)[number]['key'];

export default function FilterChips({
  selected,
  onSelect,
}: {
  selected: CareTypeKey | null;
  onSelect: (key: CareTypeKey | null) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {CARE_TYPES.map((t) => {
        const active = selected === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => onSelect(active ? null : t.key)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: {
    backgroundColor: colors.lavender,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: colors.purple },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  chipTextActive: { color: colors.white },
});
