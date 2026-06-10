// Circle page — events with RSVP, member-only post feed, leader pinning.
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';
import ReportSheet from '../../components/shared/ReportSheet';
import { hasProfanity, KINDNESS_NOTE } from '../../components/shared/profanity';

type Circle = { id: string; name: string; city: string | null; schedule: string; leader_id: string | null };
type CircleEvent = { id: string; title: string; starts_at: string; location: string };
type Post = { id: string; author_id: string; body: string; pinned: boolean; created_at: string; author: { name: string } | null };

export default function CircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [circle, setCircle] = useState<Circle | null>(null);
  const [events, setEvents] = useState<CircleEvent[]>([]);
  const [myRsvps, setMyRsvps] = useState<Set<string>>(new Set());
  const [posts, setPosts] = useState<Post[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [draft, setDraft] = useState('');
  const [kindNote, setKindNote] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    setMe(uid);

    const { data: c } = await supabase
      .from('circles')
      .select('id, name, city, schedule, leader_id')
      .eq('id', id)
      .single();
    setCircle((c as Circle) ?? null);

    const { data: ev } = await supabase
      .from('circle_events')
      .select('id, title, starts_at, location')
      .eq('circle_id', id)
      .order('starts_at');
    setEvents((ev as CircleEvent[]) ?? []);

    if (uid) {
      const { data: rs } = await supabase.from('event_rsvps').select('event_id').eq('profile_id', uid);
      setMyRsvps(new Set((rs ?? []).map((r: { event_id: string }) => r.event_id)));
      const { data: mem } = await supabase
        .from('circle_members')
        .select('circle_id')
        .eq('circle_id', id)
        .eq('profile_id', uid);
      setIsMember((mem ?? []).length > 0);
    }

    // RLS hides posts from non-members; pinned first.
    const { data: ps } = await supabase
      .from('circle_posts')
      .select('id, author_id, body, pinned, created_at, author:profiles(name)')
      .eq('circle_id', id)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });
    setPosts((ps as unknown as Post[]) ?? []);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleRsvp = async (eventId: string) => {
    if (!me) return;
    if (myRsvps.has(eventId)) {
      await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('profile_id', me);
    } else {
      await supabase.from('event_rsvps').insert({ event_id: eventId, profile_id: me });
    }
    load();
  };

  const post = async () => {
    const text = draft.trim();
    if (!text || !me || !id) return;
    if (hasProfanity(text)) {
      setKindNote(true);
      return;
    }
    setKindNote(false);
    setDraft('');
    await supabase.from('circle_posts').insert({ circle_id: id, author_id: me, body: text });
    load();
  };

  const togglePin = async (postId: string, pinned: boolean) => {
    await supabase.from('circle_posts').update({ pinned: !pinned }).eq('id', postId);
    load();
  };

  const isLeader = !!me && circle?.leader_id === me;

  const header = (
    <View>
      <View style={styles.hero}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Circles</Text>
        </Pressable>
        <Text style={styles.heading}>{circle?.name ?? ''}</Text>
        <Text style={styles.meta}>
          {circle?.city ?? ''}{circle?.city && circle?.schedule ? ' · ' : ''}{circle?.schedule ?? ''}
        </Text>
      </View>

      <Text style={styles.section}>Gatherings</Text>
      {events.length === 0 && <Text style={styles.emptySmall}>Nothing on the calendar yet.</Text>}
      {events.map((ev) => {
        const going = myRsvps.has(ev.id);
        return (
          <View key={ev.id} style={styles.eventCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eventTitle}>{ev.title}</Text>
              <Text style={styles.eventMeta}>
                {new Date(ev.starts_at).toLocaleString()} {ev.location ? `· ${ev.location}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => toggleRsvp(ev.id)}
              style={[styles.rsvpBtn, going && { backgroundColor: colors.teal }]}
            >
              <Text style={[styles.rsvpText, going && { color: colors.white }]}>
                {going ? "I'm in!" : 'RSVP'}
              </Text>
            </Pressable>
          </View>
        );
      })}

      <Text style={styles.section}>The conversation</Text>
      {!isMember && (
        <Text style={styles.emptySmall}>Join this Circle to see and share posts with the mamas.</Text>
      )}
      {isMember && (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              if (kindNote) setKindNote(false);
            }}
            placeholder="Share with your Circle…"
            placeholderTextColor={colors.muted}
            multiline
            style={styles.input}
          />
          <Pressable onPress={post} style={styles.postBtn} disabled={!draft.trim()}>
            <Text style={styles.postBtnText}>Post</Text>
          </Pressable>
        </View>
      )}
      {kindNote && <Text style={styles.kindNote}>{KINDNESS_NOTE}</Text>}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={isMember ? posts : []}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.purple} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <View style={[styles.postCard, item.pinned && styles.pinnedCard]}>
            {item.pinned && <Text style={styles.pinnedTag}>📌 Pinned</Text>}
            <Text style={styles.postAuthor}>{item.author?.name ?? 'A mama'}</Text>
            <Text style={styles.postBody}>{item.body}</Text>
            <View style={styles.postActions}>
              <Text style={styles.postDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                {isLeader && (
                  <Pressable onPress={() => togglePin(item.id, item.pinned)} hitSlop={6}>
                    <Text style={styles.actionLink}>{item.pinned ? 'Unpin' : 'Pin'}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setReportPostId(item.id)} hitSlop={6}>
                  <Text style={[styles.actionLink, { color: colors.muted }]}>Report</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      />
      <ReportSheet
        visible={!!reportPostId}
        onClose={() => setReportPostId(null)}
        subjectType="post"
        subjectId={reportPostId ?? ''}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  hero: {
    backgroundColor: colors.lavender,
    borderRadius: radii.card,
    padding: 18,
    marginTop: 60,
    marginBottom: 8,
  },
  back: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.purple, marginBottom: 10 },
  heading: { fontFamily: fonts.displayHeavy, fontSize: 24, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginTop: 4 },
  section: { fontFamily: fonts.display, fontSize: 17, color: colors.ink, marginTop: 20, marginBottom: 10 },
  emptySmall: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginBottom: 8 },
  eventCard: {
    backgroundColor: colors.tealSoft,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventTitle: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  eventMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 3 },
  rsvpBtn: {
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.teal,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rsvpText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.teal },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  input: {
    flex: 1,
    backgroundColor: colors.lavender,
    borderRadius: radii.input,
    padding: 12,
    minHeight: 48,
    maxHeight: 110,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  postBtn: {
    backgroundColor: colors.algae,
    borderRadius: radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  postBtnText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
  kindNote: { fontFamily: fonts.script, fontSize: 18, color: colors.tealDeep, marginBottom: 10 },
  postCard: { backgroundColor: colors.lavender, borderRadius: radii.card, padding: 14, marginBottom: 10 },
  pinnedCard: { borderWidth: 1.5, borderColor: colors.purple },
  pinnedTag: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.purple, marginBottom: 4 },
  postAuthor: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.purple },
  postBody: { fontFamily: fonts.body, fontSize: 15, color: colors.ink, marginTop: 4 },
  postActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  postDate: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  actionLink: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.teal },
});
