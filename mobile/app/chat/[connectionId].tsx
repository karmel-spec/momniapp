// 1:1 chat per connection — Supabase Realtime, photo sharing, report/block.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';
import ReportSheet from '../../components/shared/ReportSheet';
import { hasProfanity, KINDNESS_NOTE } from '../../components/shared/profanity';

type Message = {
  id: string;
  connection_id: string;
  sender_id: string;
  body: string;
  photo_path: string | null;
  created_at: string;
};

export default function ChatScreen() {
  const { connectionId } = useLocalSearchParams<{ connectionId: string }>();
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [otherId, setOtherId] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [kindNote, setKindNote] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const meRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!connectionId) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    setMe(uid);
    meRef.current = uid;

    const { data: conn } = await supabase
      .from('connections')
      .select('guest_id, host_id')
      .eq('id', connectionId)
      .single();
    if (conn && uid) {
      const other = conn.guest_id === uid ? conn.host_id : conn.guest_id;
      setOtherId(other);
      const { data: prof } = await supabase.from('profiles').select('name').eq('id', other).single();
      setOtherName(prof?.name ?? 'Mama');
    }

    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('connection_id', connectionId)
      .order('created_at', { ascending: false });
    setMessages((msgs as Message[]) ?? []);
  }, [connectionId]);

  useEffect(() => {
    load();
    if (!connectionId) return;
    const channel = supabase
      .channel(`chat-${connectionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `connection_id=eq.${connectionId}` },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [connectionId, load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !me || !connectionId) return;
    if (hasProfanity(text)) {
      setKindNote(true);
      return;
    }
    setKindNote(false);
    setDraft('');
    const { data } = await supabase
      .from('messages')
      .insert({ connection_id: connectionId, sender_id: me, body: text })
      .select()
      .single();
    if (data) {
      const msg = data as Message;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
    }
  };

  const sendPhoto = async () => {
    if (!me || !connectionId) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() ?? 'jpg';
    const path = `${connectionId}/${Date.now()}.${ext}`;
    const file = await fetch(asset.uri);
    const blob = await file.arrayBuffer();
    const { error } = await supabase.storage
      .from('chat-photos')
      .upload(path, blob, { contentType: asset.mimeType ?? 'image/jpeg' });
    if (error) return;
    const { data } = await supabase
      .from('messages')
      .insert({ connection_id: connectionId, sender_id: me, body: '', photo_path: path })
      .select()
      .single();
    if (data) {
      const msg = data as Message;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]));
    }
  };

  const blockHer = async () => {
    if (!me || !otherId) return;
    await supabase.from('blocks').insert({ blocker_id: me, blocked_id: otherId });
    setMenuOpen(false);
    router.back();
  };

  const photoUrl = (path: string) =>
    supabase.storage.from('chat-photos').getPublicUrl(path).data.publicUrl;

  const renderItem = ({ item }: { item: Message }) => {
    const mine = item.sender_id === me;
    return (
      <View style={[styles.bubbleRow, mine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleHers]}>
          {item.photo_path ? (
            <Image source={{ uri: photoUrl(item.photo_path) }} style={styles.photo} resizeMode="cover" />
          ) : null}
          {item.body ? (
            <Text style={[styles.bubbleText, mine ? { color: colors.white } : { color: colors.ink }]}>
              {item.body}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerName}>{otherName}</Text>
        <Pressable onPress={() => setMenuOpen((v) => !v)} hitSlop={10}>
          <Text style={styles.menuDots}>⋯</Text>
        </Pressable>
      </View>

      {menuOpen && (
        <View style={styles.menu}>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          >
            <Text style={styles.menuText}>Report</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={blockHer}>
            <Text style={[styles.menuText, { color: colors.danger }]}>Block</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={messages}
        inverted
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
      />

      {kindNote && <Text style={styles.kindNote}>{KINDNESS_NOTE}</Text>}

      <View style={styles.composer}>
        <Pressable onPress={sendPhoto} hitSlop={8} style={styles.photoBtn}>
          <Text style={{ fontSize: 20 }}>📷</Text>
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (kindNote) setKindNote(false);
          }}
          placeholder="Message…"
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />
        <Pressable onPress={send} style={styles.sendBtn} disabled={!draft.trim()}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>

      {otherId && (
        <ReportSheet
          visible={reportOpen}
          onClose={() => setReportOpen(false)}
          subjectType="user"
          subjectId={otherId}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  header: {
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.lavender,
  },
  back: { fontSize: 30, color: colors.purple, marginTop: -4 },
  headerName: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  menuDots: { fontSize: 24, color: colors.ink },
  menu: {
    position: 'absolute',
    top: 100,
    right: 16,
    backgroundColor: colors.white,
    borderRadius: radii.input,
    paddingVertical: 4,
    shadowColor: colors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 10,
  },
  menuItem: { paddingHorizontal: 22, paddingVertical: 11 },
  menuText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  bubbleRow: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '78%', borderRadius: radii.card, padding: 12 },
  bubbleMine: { backgroundColor: colors.purple, borderBottomRightRadius: 4 },
  bubbleHers: { backgroundColor: colors.lavender, borderBottomLeftRadius: 4 },
  bubbleText: { fontFamily: fonts.body, fontSize: 15 },
  photo: { width: 200, height: 200, borderRadius: 10, marginBottom: 4 },
  kindNote: {
    fontFamily: fonts.script,
    fontSize: 18,
    color: colors.tealDeep,
    textAlign: 'center',
    marginBottom: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: 32,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.lavender,
  },
  photoBtn: { padding: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.lavender,
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    maxHeight: 110,
  },
  sendBtn: {
    backgroundColor: colors.algae,
    borderRadius: radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  sendText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
});
