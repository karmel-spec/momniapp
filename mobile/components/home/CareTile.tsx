import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, fonts, radii } from '../../lib/theme';

type Props = {
  title: string;
  subtitle?: string;
  background: string;
  textColor?: string;
  onPress: () => void;
  style?: ViewStyle;
  children?: ReactNode;
};

export default function CareTile({ title, subtitle, background, textColor = colors.white, onPress, style, children }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: background, opacity: pressed ? 0.88 : 1 }, style]}
    >
      <Text style={[styles.title, { color: textColor }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: textColor }]}>{subtitle}</Text> : null}
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radii.card,
    padding: 18,
    minHeight: 108,
    justifyContent: 'flex-end',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    marginTop: 4,
    opacity: 0.9,
  },
});

export function ChipRow({ chips, color }: { chips: string[]; color: string }) {
  return (
    <View style={chipStyles.row}>
      {chips.map((c) => (
        <View key={c} style={chipStyles.chip}>
          <Text style={[chipStyles.chipText, { color }]}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    backgroundColor: colors.white,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 12 },
});
