import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radii } from '../../lib/theme';
import { CARE_TYPES } from './FilterChips';

export type HostResult = {
  id: string;
  name: string;
  city: string | null;
  care_types: string[] | null;
  hourly_rate_note: string | null;
  shared_count: number;
};

function careLabel(key: string) {
  return CARE_TYPES.find((t) => t.key === key)?.label ?? key;
}

export default function HostCard({ host, onRequest }: { host: HostResult; onRequest: (id: string) => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{host.name}</Text>
          <Text style={styles.city}>
            {host.city ?? 'Nearby'} · ★ New to 2.0
          </Text>
        </View>
      </View>
      {host.care_types && host.care_types.length > 0 && (
        <View style={styles.chipRow}>
          {host.care_types.map((c) => (
            <View key={c} style={styles.chip}>
              <Text style={styles.chipText}>{careLabel(c)}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.shared}>
        {host.shared_count > 0
          ? `${host.shared_count} thing${host.shared_count === 1 ? '' : 's'} she chose to share`
          : 'Ask her what she’d like to share'}
      </Text>
      {host.hourly_rate_note ? <Text style={styles.rate}>{host.hourly_rate_note}</Text> : null}
      <Pressable onPress={() => onRequest(host.id)} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
        <Text style={styles.btnText}>Request a Link</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.lavender,
    borderRadius: radii.card,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  name: { fontFamily: fonts.display, fontSize: 16, color: colors.ink },
  city: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    backgroundColor: colors.tealSoft,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.tealDeep },
  shared: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.purple, marginTop: 10 },
  rate: { fontFamily: fonts.body, fontSize: 13, color: colors.ink, marginTop: 4 },
  btn: {
    backgroundColor: colors.algae,
    borderRadius: radii.pill,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  btnText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
});
