// Reusable report modal — flags go straight to Karmel's queue.
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';
import { PillButton } from '../auth/ui';

export type ReportSubjectType = 'user' | 'post' | 'message' | 'review' | 'profile_photo';

const REASONS: { value: string; label: string }[] = [
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'spam', label: 'Spam' },
  { value: 'dishonest_profile', label: 'Dishonest profile' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'danger_to_children', label: 'Danger to children' },
  { value: 'other', label: 'Something else' },
];

export default function ReportSheet({
  visible,
  onClose,
  subjectType,
  subjectId,
}: {
  visible: boolean;
  onClose: () => void;
  subjectType: ReportSubjectType;
  subjectId: string;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setReason(null);
    setDetails('');
    setDone(false);
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!reason) return;
    setSending(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    const { error: err } = await supabase.from('reports').insert({
      reporter_id: auth.user?.id,
      subject_type: subjectType,
      subject_id: subjectId,
      reason,
      details: details.trim(),
    });
    setSending(false);
    if (err) setError("That didn't go through — try again in a moment.");
    else setDone(true);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={reset}>
      <Pressable style={styles.backdrop} onPress={reset}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {done ? (
            <>
              <Text style={styles.title}>Thank you</Text>
              <Text style={styles.body}>Thank you — Karmel reviews every report.</Text>
              <PillButton title="Close" onPress={reset} variant="purple" style={{ marginTop: 20 }} />
            </>
          ) : (
            <>
              <Text style={styles.title}>Report this</Text>
              <Text style={styles.body}>What's going on? Karmel sees every one of these.</Text>
              <View style={styles.reasons}>
                {REASONS.map((r) => (
                  <Pressable
                    key={r.value}
                    onPress={() => setReason(r.value)}
                    style={[styles.reason, reason === r.value && styles.reasonSelected]}
                  >
                    <Text style={[styles.reasonText, reason === r.value && { color: colors.white }]}>
                      {r.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Anything else we should know? (optional)"
                placeholderTextColor={colors.muted}
                multiline
                style={styles.input}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <PillButton
                title="Send report"
                onPress={submit}
                disabled={!reason}
                loading={sending}
                variant="purple"
                style={{ marginTop: 16 }}
              />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(43,34,51,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    padding: 24,
    paddingBottom: 40,
  },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, marginBottom: 6 },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, marginBottom: 16 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.purple,
    backgroundColor: colors.white,
  },
  reasonSelected: { backgroundColor: colors.purple },
  reasonText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.purple },
  input: {
    backgroundColor: colors.lavender,
    borderRadius: radii.input,
    padding: 14,
    marginTop: 16,
    minHeight: 70,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  error: { fontFamily: fonts.bodyMedium, color: colors.danger, fontSize: 13, marginTop: 10 },
});
