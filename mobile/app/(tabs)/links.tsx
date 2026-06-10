// Links — the user's connections. A "booking" in beta = a confirmed connection.
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii, PAYMENT_LINE } from '../../lib/theme';
import ReviewForm from '../../components/shared/ReviewForm';

type ConnectionRow = {
  id: string;
  guest_id: string;
  host_id: string;
  status: 'requested' | 'accepted' | 'declined' | 'completed' | 'cancelled';
  created_at: string;
  request: { care_type: string; details: Record<string, unknown> } | null;
  guest: { name: string } | null;
  host: { name: string } | null;
};

const STATUS_STYLE: Record<ConnectionRow['status'], { bg: string; fg: string; label: string }> = {
  requested: { bg: colors.tealSoft, fg: colors.tealDeep, label: 'Requested' },
  accepted: { bg: colors.algae, fg: colors.ink, label: 'Linked!' },
  declined: { bg: '#F3E3E3', fg: colors.danger, label: 'Declined' },
  completed: { bg: colors.lavender, fg: colors.purple, label: 'Completed' },
  cancelled: { bg: '#EFEDEF', fg: colors.muted, label: 'Cancelled' },
};

const CARE_LABEL: Record<string, string> = {
  'right-now': 'Right Now',
  'date-night': 'Date Night',
  'my-regulars': 'My Regulars',
  'night-shift': 'Night Shift',
  'weekend-getaway': 'Weekend Getaway',
  'extended-trip': 'Extended Trip',
};

export default function LinksScreen() {
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [myReviews, setMyReviews] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    setMe(uid);
    if (!uid) return;
    const { data } = await supabase
      .from('connections')
      .select(
        'id, guest_id, host_id, status, created_at, request:care_requests(care_type, details), guest:profiles!connections_guest_id_fkey(name), host:profiles!connections_host_id_fkey(name)'
      )
      .or(`guest_id.eq.${uid},host_id.eq.${uid}`)
      .order('created_at', { ascending: false });
    setRows((data as unknown as ConnectionRow[]) ?? []);
    const { data: revs } = await supabase.from('reviews').select('connection_id').eq('author_id', uid);
    setMyReviews(new Set((revs ?? []).map((r: { connection_id: string }) => r.connection_id)));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const setStatus = async (id: string, status: ConnectionRow['status']) => {
    await supabase.from('connections').update({ status }).eq('id', id);
    load();
  };

  const renderItem = ({ item }: { item: ConnectionRow }) => {
    const iAmHost = item.host_id === me;
    const otherName = (iAmHost ? item.guest?.name : item.host?.name) ?? 'A mama';
    const chip = STATUS_STYLE[item.status];
    const careType = item.request?.care_type;
    const showReview = item.status === 'completed' && !myReviews.has(item.id);
    const subjectId = iAmHost ? item.guest_id : item.host_id;

    return (
      <Pressable
        style={styles.card}
        onPress={() => item.status === 'accepted' && router.push(`/chat/${item.id}`)}
      >
        <View style={styles.rowTop}>
          <Text style={styles.name}>{otherName}</Text>
          <View style={[styles.chip, { backgroundColor: chip.bg }]}>
            <Text style={[styles.chipText, { color: chip.fg }]}>{chip.label}</Text>
          </View>
        </View>
        <Text style={styles.meta}>
          {careType ? CARE_LABEL[careType] ?? careType : 'Care'} ·{' '}
          {new Date(item.created_at).toLocaleDateString()}
        </Text>

        {item.status === 'accepted' && (
          <>
            <Text style={styles.payment}>{PAYMENT_LINE}</Text>
            <Text style={styles.openChat}>Tap to open your chat →</Text>
          </>
        )}

        {item.status === 'requested' && iAmHost && (
          <View style={styles.actions}>
            <ActionPill label="Accept" onPress={() => setStatus(item.id, 'accepted')} primary />
            <ActionPill label="Decline" onPress={() => setStatus(item.id, 'declined')} />
          </View>
        )}
        {item.status === 'requested' && !iAmHost && (
          <View style={styles.actions}>
            <ActionPill label="Cancel request" onPress={() => setStatus(item.id, 'cancelled')} />
          </View>
        )}
        {item.status === 'accepted' && (
          <View style={styles.actions}>
            <ActionPill label="Mark completed" onPress={() => setStatus(item.id, 'completed')} primary />
          </View>
        )}

        {showReview && (
          <ReviewForm
            connectionId={item.id}
            subjectId={subjectId}
            subjectName={otherName}
            onDone={load}
          />
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Links</Text>
      <Text style={styles.sub}>Your connections with the mamas.</Text>
      <FlatList
        data={rows}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.purple} />}
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.empty}>
              No Links yet, mama. Find a Momni nearby and send your first request.
            </Text>
          )
        }
        ListFooterComponent={
          rows.length > 0 ? <Text style={styles.footerNote}>Reviews are opinions of members.</Text> : null
        }
      />
    </View>
  );
}

function ActionPill({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.action, primary ? { backgroundColor: colors.purple } : styles.actionOutline]}
    >
      <Text style={[styles.actionText, { color: primary ? colors.white : colors.purple }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white, paddingTop: 64, paddingHorizontal: 20 },
  heading: { fontFamily: fonts.displayHeavy, fontSize: 26, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginBottom: 16 },
  card: { backgroundColor: colors.lavender, borderRadius: radii.card, padding: 16, marginBottom: 12 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  chip: { borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 5 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 12 },
  meta: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.muted, marginTop: 4 },
  payment: { fontFamily: fonts.body, fontSize: 13, color: colors.tealDeep, marginTop: 10 },
  openChat: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.purple, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  action: {
    borderRadius: radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 9,
    alignItems: 'center',
  },
  actionOutline: { borderWidth: 1.5, borderColor: colors.purple, backgroundColor: colors.white },
  actionText: { fontFamily: fonts.bodySemi, fontSize: 14 },
  empty: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 60 },
  footerNote: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 8 },
});
