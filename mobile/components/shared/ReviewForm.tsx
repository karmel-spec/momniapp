// Inline review form for completed connections — community content, not Momni endorsement.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';
import { PillButton } from '../auth/ui';

export default function ReviewForm({
  connectionId,
  subjectId,
  subjectName,
  onDone,
}: {
  connectionId: string;
  subjectId: string;
  subjectName: string;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (rating < 1) return;
    setSaving(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    const { error: err } = await supabase.from('reviews').insert({
      connection_id: connectionId,
      author_id: auth.user?.id,
      subject_id: subjectId,
      rating,
      body: body.trim(),
    });
    setSaving(false);
    if (err) setError("That didn't save — try again in a moment.");
    else onDone();
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>How was your time with {subjectName}?</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
            <Text style={[styles.star, n <= rating && { color: colors.purple }]}>★</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="Tell the mamas about it…"
        placeholderTextColor={colors.muted}
        multiline
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PillButton
        title="Share my review"
        onPress={submit}
        disabled={rating < 1}
        loading={saving}
        style={{ marginTop: 12 }}
      />
      <Text style={styles.footer}>Reviews are opinions of members.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.tealSoft,
    borderRadius: radii.card,
    padding: 16,
    marginTop: 12,
  },
  title: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  stars: { flexDirection: 'row', gap: 6, marginVertical: 10 },
  star: { fontSize: 30, color: '#C9C2D4' },
  input: {
    backgroundColor: colors.white,
    borderRadius: radii.input,
    padding: 12,
    minHeight: 60,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  error: { fontFamily: fonts.bodyMedium, color: colors.danger, fontSize: 13, marginTop: 8 },
  footer: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 10, textAlign: 'center' },
});
