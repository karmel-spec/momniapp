import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii, CONNECTION_ACKNOWLEDGMENT, PAYMENT_LINE } from '../../lib/theme';
import { CARE_TYPES, CareTypeKey } from '../../components/map/FilterChips';

type Host = {
  id: string;
  name: string;
  city: string | null;
  hourly_rate_note: string | null;
  care_types: string[] | null;
};

export default function RequestScreen() {
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const [host, setHost] = useState<Host | null>(null);
  const [careType, setCareType] = useState<CareTypeKey | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [details, setDetails] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostId) return;
    supabase
      .from('profiles_public')
      .select('id, name, city, hourly_rate_note, care_types')
      .eq('id', hostId)
      .single()
      .then(({ data }) => setHost(data as Host | null));
  }, [hostId]);

  const canSend = !!careType && acknowledged && !sending;

  const send = async () => {
    if (!canSend || !careType || !hostId) return;
    setSending(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) {
      setError('Please sign in again.');
      setSending(false);
      return;
    }
    const { data: request, error: reqError } = await supabase
      .from('care_requests')
      .insert({ requester_id: userId, care_type: careType, details: { date, time, notes: details } })
      .select('id')
      .single();
    if (reqError || !request) {
      setError('Something hiccuped sending your request. Try again?');
      setSending(false);
      return;
    }
    const { error: connError } = await supabase.from('connections').insert({
      request_id: request.id,
      guest_id: userId,
      host_id: hostId,
      acknowledgment_text: CONNECTION_ACKNOWLEDGMENT,
      acknowledged_at: new Date().toISOString(),
      status: 'requested',
    });
    if (connError) {
      setError('Something hiccuped sending your request. Try again?');
      setSending(false);
      return;
    }
    setSending(false);
    setSent(true);
  };

  if (sent) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successWrap}>
          <Ionicons name="link" size={48} color={colors.teal} />
          <Text style={styles.successTitle}>Link request sent to {host?.name ?? 'her'} — watch your Links tab.</Text>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.sendBtnText}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.purple} />
          </Pressable>
          <Text style={styles.title}>Request a Link{host ? ` with ${host.name}` : ''}</Text>
          {host?.city ? <Text style={styles.subtitle}>{host.city}</Text> : null}
          {host?.hourly_rate_note ? <Text style={styles.rate}>{host.hourly_rate_note}</Text> : null}

          <Text style={styles.label}>What kind of care?</Text>
          <View style={styles.typeGrid}>
            {CARE_TYPES.map((t) => {
              const active = careType === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setCareType(t.key)}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                >
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Date</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="e.g. Friday June 12"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.label}>Time</Text>
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="e.g. 6–10pm"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.label}>Details</Text>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Kids' ages, what they love, anything she should know"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.multiline]}
            multiline
          />

          <View style={styles.paymentCard}>
            <Text style={styles.paymentText}>{PAYMENT_LINE}</Text>
          </View>

          <View style={styles.ackCard}>
            <Pressable onPress={() => setAcknowledged((a) => !a)} style={styles.ackRow} hitSlop={8}>
              <View style={[styles.checkbox, acknowledged && styles.checkboxChecked]}>
                {acknowledged && <Ionicons name="checkmark" size={16} color={colors.white} />}
              </View>
              <Text style={styles.ackText}>{CONNECTION_ACKNOWLEDGMENT}</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={send}
            disabled={!canSend}
            style={({ pressed }) => [styles.sendBtn, (!canSend || pressed) && { opacity: canSend ? 0.85 : 0.45 }]}
          >
            <Text style={styles.sendBtnText}>{sending ? 'Sending…' : 'Send Link request'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 18 },
  successTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 27,
  },
  content: { padding: 20, paddingBottom: 40 },
  backBtn: { marginBottom: 8, alignSelf: 'flex-start' },
  title: { fontFamily: fonts.displayHeavy, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginTop: 2 },
  rate: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.teal, marginTop: 4 },
  label: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink, marginTop: 18, marginBottom: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    backgroundColor: colors.lavender,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  typeChipActive: { backgroundColor: colors.purple },
  typeChipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  typeChipTextActive: { color: colors.white },
  input: {
    backgroundColor: colors.lavender,
    borderRadius: radii.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  paymentCard: {
    backgroundColor: colors.tealSoft,
    borderRadius: radii.card,
    padding: 16,
    marginTop: 22,
  },
  paymentText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.tealDeep, textAlign: 'center' },
  ackCard: {
    backgroundColor: colors.lavender,
    borderColor: colors.purple,
    borderWidth: 1.5,
    borderRadius: radii.card,
    padding: 16,
    marginTop: 14,
  },
  ackRow: { flexDirection: 'row', gap: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  checkboxChecked: { backgroundColor: colors.purple },
  ackText: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger, marginTop: 12 },
  sendBtn: {
    backgroundColor: colors.algae,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  sendBtnText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
});
