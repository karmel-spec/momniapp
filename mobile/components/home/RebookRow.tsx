import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radii } from '../../lib/theme';

export type RebookHost = {
  id: string;
  name: string;
};

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export default function RebookRow({ hosts, onRebook }: { hosts: RebookHost[]; onRebook: (hostId: string) => void }) {
  if (hosts.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Your Momnis</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {hosts.map((h) => (
          <View key={h.id} style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(h.name)}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {h.name}
            </Text>
            <Pressable
              onPress={() => onRebook(h.id)}
              style={({ pressed }) => [styles.rebookBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.rebookText}>Rebook</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 22 },
  heading: { fontFamily: fonts.display, fontSize: 17, color: colors.ink, marginBottom: 10 },
  row: { gap: 12 },
  card: {
    backgroundColor: colors.lavender,
    borderRadius: radii.card,
    padding: 14,
    alignItems: 'center',
    width: 120,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display, fontSize: 16, color: colors.white },
  name: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink, marginTop: 8 },
  rebookBtn: {
    marginTop: 8,
    backgroundColor: colors.algae,
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  rebookText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink },
});
