// Circles — local gatherings of the mamas.
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';

type CircleRow = {
  id: string;
  name: string;
  city: string | null;
  schedule: string;
  circle_members: { count: number }[];
};

export default function CirclesScreen() {
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [circles, setCircles] = useState<CircleRow[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    setMe(uid);
    const { data } = await supabase
      .from('circles')
      .select('id, name, city, schedule, circle_members(count)')
      .order('name');
    setCircles((data as unknown as CircleRow[]) ?? []);
    if (uid) {
      const { data: memberships } = await supabase
        .from('circle_members')
        .select('circle_id')
        .eq('profile_id', uid);
      setMine(new Set((memberships ?? []).map((m: { circle_id: string }) => m.circle_id)));
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggle = async (circleId: string, isMember: boolean) => {
    if (!me) return;
    if (isMember) {
      await supabase.from('circle_members').delete().eq('circle_id', circleId).eq('profile_id', me);
    } else {
      await supabase.from('circle_members').insert({ circle_id: circleId, profile_id: me });
    }
    load();
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Circles</Text>
      <Text style={styles.sub}>Where the mamas gather.</Text>
      <FlatList
        data={circles}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.purple} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        renderItem={({ item }) => {
          const isMember = mine.has(item.id);
          const count = item.circle_members?.[0]?.count ?? 0;
          return (
            <Pressable style={styles.card} onPress={() => router.push(`/circle/${item.id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.city ?? ''}{item.city && item.schedule ? ' · ' : ''}{item.schedule}
                </Text>
                <Text style={styles.count}>
                  {count} {count === 1 ? 'mama' : 'mamas'}
                </Text>
              </View>
              <Pressable
                onPress={() => toggle(item.id, isMember)}
                style={[styles.joinBtn, isMember ? styles.leaveBtn : null]}
              >
                <Text style={[styles.joinText, isMember && { color: colors.purple }]}>
                  {isMember ? 'Leave' : 'Join'}
                </Text>
              </Pressable>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.empty}>No Circles nearby yet — the movement is just getting started.</Text>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white, paddingTop: 64, paddingHorizontal: 20 },
  heading: { fontFamily: fonts.displayHeavy, fontSize: 26, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginBottom: 16 },
  card: {
    backgroundColor: colors.lavender,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  name: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 3 },
  count: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.teal, marginTop: 6 },
  joinBtn: {
    backgroundColor: colors.algae,
    borderRadius: radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  leaveBtn: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.purple },
  joinText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
  empty: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 60 },
});
