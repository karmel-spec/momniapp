import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';
import CareTile, { ChipRow } from '../../components/home/CareTile';
import PulsingDot from '../../components/home/PulsingDot';
import RebookRow, { RebookHost } from '../../components/home/RebookRow';

export default function HomeScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('mama');
  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [rebookHosts, setRebookHosts] = useState<RebookHost[]>([]);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;

    const { count } = await supabase
      .from('profiles_public')
      .select('id', { count: 'exact', head: true })
      .eq('available_now', true);
    setAvailableCount(count ?? 0);

    if (!userId) return;

    const { data: profile } = await supabase.from('profiles').select('name').eq('id', userId).single();
    if (profile?.name) setFirstName(profile.name.split(' ')[0]);

    const { data: conns } = await supabase
      .from('connections')
      .select('host_id, profiles!connections_host_id_fkey(id, name)')
      .eq('guest_id', userId)
      .in('status', ['accepted', 'completed'])
      .order('created_at', { ascending: false });

    const seen = new Set<string>();
    const hosts: RebookHost[] = [];
    (conns ?? []).forEach((c: any) => {
      const p = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        hosts.push({ id: p.id, name: p.name });
      }
    });
    setRebookHosts(hosts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const goSearch = (careType: string) => router.push(`/(tabs)/search?care_type=${careType}`);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.greeting}>Good morning, {firstName}</Text>
        <Text style={styles.tagline}>Moms trust moms. What do you need today?</Text>

        <CareTile
          title="Right Now"
          subtitle="Care today, from a mama nearby"
          background={colors.teal}
          onPress={() => goSearch('right-now')}
          style={styles.fullTile}
        >
          <View style={styles.liveRow}>
            <PulsingDot />
            <Text style={styles.liveText}>
              {availableCount === null ? 'Checking who’s around…' : `${availableCount} mamas available now`}
            </Text>
          </View>
        </CareTile>

        <View style={styles.sideBySide}>
          <CareTile
            title="Date Night"
            subtitle="An evening out"
            background={colors.purple}
            onPress={() => goSearch('date-night')}
            style={styles.halfTile}
          />
          <CareTile
            title="My Regulars"
            subtitle="A weekly rhythm"
            background={colors.purpleDeep}
            onPress={() => goSearch('my-regulars')}
            style={styles.halfTile}
          />
        </View>

        <CareTile
          title="Overnights"
          subtitle="Longer stretches, deeper trust"
          background={colors.tealDeep}
          onPress={() => goSearch('night-shift')}
          style={styles.fullTile}
        >
          <View style={styles.overnightChips}>
            <Pressable onPress={() => goSearch('night-shift')}>
              <ChipRow chips={['Night Shift']} color={colors.tealDeep} />
            </Pressable>
            <Pressable onPress={() => goSearch('weekend-getaway')}>
              <ChipRow chips={['Weekend Getaway']} color={colors.tealDeep} />
            </Pressable>
            <Pressable onPress={() => goSearch('extended-trip')}>
              <ChipRow chips={['Extended Trip']} color={colors.tealDeep} />
            </Pressable>
          </View>
        </CareTile>

        <Pressable
          onPress={() => Linking.openURL('https://childcarelicensing.utah.gov/')}
          style={({ pressed }) => [styles.daycareBar, pressed && { opacity: 0.88 }]}
        >
          <Text style={styles.daycareTitle}>Find a Daycare</Text>
          <Text style={styles.daycareMicro}>Momni doesn’t vet or endorse — here’s what’s licensed near you</Text>
        </Pressable>

        <RebookRow hosts={rebookHosts} onRebook={(hostId) => router.push(`/request/${hostId}`)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  content: { padding: 20, paddingBottom: 40 },
  greeting: { fontFamily: fonts.displayHeavy, fontSize: 26, color: colors.ink },
  tagline: { fontFamily: fonts.script, fontSize: 20, color: colors.purple, marginTop: 2, marginBottom: 18 },
  fullTile: { marginBottom: 12 },
  sideBySide: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  halfTile: { flex: 1 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  liveText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.white },
  overnightChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  daycareBar: {
    backgroundColor: colors.purple,
    borderRadius: radii.card,
    padding: 16,
  },
  daycareTitle: { fontFamily: fonts.display, fontSize: 16, color: colors.white },
  daycareMicro: { fontFamily: fonts.body, fontSize: 12, color: colors.lavender, marginTop: 4 },
});
