import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';
import { Field, PillButton, ErrorNote, ProgressDots, Chip } from '../../components/auth/ui';

type Role = 'find-care' | 'host' | 'both';

const AGE_CHIPS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12+'];
const CARE_TYPES: { key: string; label: string }[] = [
  { key: 'right-now', label: 'Right Now' },
  { key: 'date-night', label: 'Date Night' },
  { key: 'my-regulars', label: 'My Regulars' },
  { key: 'night-shift', label: 'Night Shift' },
  { key: 'weekend-getaway', label: 'Weekend Getaway' },
  { key: 'extended-trip', label: 'Extended Trip' },
];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // step 1
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  // step 2
  const [ages, setAges] = useState<string[]>([]);
  // step 3
  const [role, setRole] = useState<Role | null>(null);
  const [careTypes, setCareTypes] = useState<string[]>([]);
  const [rateNote, setRateNote] = useState('');

  const getUserId = async () => {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  };

  const updateProfile = async (fields: Record<string, unknown>) => {
    const userId = await getUserId();
    if (!userId) throw new Error('Looks like you got signed out — sign back in, mama.');
    const { error: err } = await supabase.from('profiles').update(fields).eq('id', userId);
    if (err) throw err;
  };

  const pickPhoto = async () => {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch {
      setError("Couldn't open your photos. You can add a photo later, too.");
    }
  };

  const uploadPhoto = async (userId: string): Promise<string | null> => {
    if (!photoUri) return null;
    const response = await fetch(photoUri);
    const arrayBuffer = await response.arrayBuffer();
    const path = `${userId}/avatar-${Date.now()}.jpg`;
    const { error: err } = await supabase.storage
      .from('avatars')
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
    if (err) throw err;
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return data.publicUrl;
  };

  const saveStep1 = async () => {
    setError(null);
    setSaving(true);
    try {
      const userId = await getUserId();
      if (!userId) throw new Error('Looks like you got signed out — sign back in, mama.');
      const photo_url = await uploadPhoto(userId);
      await updateProfile({
        neighborhood: neighborhood.trim(),
        ...(photo_url ? { photo_url } : {}),
      });
      setStep(1);
    } catch (e: any) {
      setError(e?.message ?? "That didn't save. Mind trying again?");
    } finally {
      setSaving(false);
    }
  };

  const saveStep2 = async () => {
    setError(null);
    setSaving(true);
    try {
      const kids_ages = ages.map((a) => (a === '12+' ? 12 : parseInt(a, 10)));
      await updateProfile({ kids_ages });
      setStep(2);
    } catch (e: any) {
      setError(e?.message ?? "That didn't save. Mind trying again?");
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    setError(null);
    if (!role) {
      setError('Pick the one that sounds like you — you can always change it.');
      return;
    }
    setSaving(true);
    try {
      const isHost = role === 'host' || role === 'both';
      await updateProfile({
        role,
        care_types: isHost ? careTypes : [],
        hourly_rate_note: isHost ? rateNote.trim() : '',
      });
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message ?? "That didn't save. Mind trying again?");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const isHostRole = role === 'host' || role === 'both';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.white }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.script}>Tell the mamas a little about you</Text>
        <ProgressDots step={step} total={3} />
        <ErrorNote message={error} />

        {step === 0 && (
          <View>
            <Text style={styles.heading}>Your photo & neighborhood</Text>
            <Text style={styles.sub}>
              A friendly face goes a long way. Add a photo the mamas will recognize at the park.
            </Text>
            <Pressable onPress={pickPhoto} style={styles.photoCircle}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photo} />
              ) : (
                <Text style={styles.photoHint}>Add a{'\n'}photo</Text>
              )}
            </Pressable>
            <Field
              label="Your neighborhood"
              value={neighborhood}
              onChangeText={setNeighborhood}
              placeholder="e.g. Cherry Hill, Orem"
            />
            <PillButton title="Next" onPress={saveStep1} loading={saving} />
          </View>
        )}

        {step === 1 && (
          <View>
            <Text style={styles.heading}>Your kiddos' ages</Text>
            <Text style={styles.sub}>
              Tap every age at your house. It helps the mamas match playmates and plan care.
            </Text>
            <View style={styles.chipWrap}>
              {AGE_CHIPS.map((a) => (
                <Chip
                  key={a}
                  label={a}
                  selected={ages.includes(a)}
                  onPress={() => toggle(ages, setAges, a)}
                />
              ))}
            </View>
            <PillButton title="Next" onPress={saveStep2} loading={saving} />
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={styles.heading}>How will you Momni?</Text>
            <Text style={styles.sub}>Most mamas end up doing a bit of both.</Text>
            {(
              [
                { key: 'find-care', title: 'Find care', desc: 'I need a mama I can call on.' },
                { key: 'host', title: 'Be a Momni (host)', desc: "I'll host kiddos at my place — and set my own rate." },
                { key: 'both', title: 'Both', desc: 'Some days I host, some days I need a hand.' },
              ] as { key: Role; title: string; desc: string }[]
            ).map((r) => (
              <Pressable
                key={r.key}
                onPress={() => setRole(r.key)}
                style={[styles.roleCard, role === r.key && styles.roleCardSelected]}
              >
                <Text style={[styles.roleTitle, role === r.key && { color: colors.purpleDeep }]}>
                  {r.title}
                </Text>
                <Text style={styles.roleDesc}>{r.desc}</Text>
              </Pressable>
            ))}

            {isHostRole && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.label}>What kinds of care will you offer?</Text>
                <View style={styles.chipWrap}>
                  {CARE_TYPES.map((c) => (
                    <Chip
                      key={c.key}
                      label={c.label}
                      selected={careTypes.includes(c.key)}
                      onPress={() => toggle(careTypes, setCareTypes, c.key)}
                    />
                  ))}
                </View>
                <Field
                  label="Your rate, in your words"
                  value={rateNote}
                  onChangeText={setRateNote}
                  placeholder="$8/hr — paid directly to me"
                />
                <Text style={styles.rateNote}>
                  You set it, the mamas pay you directly. Momni never takes a penny of it.
                </Text>
              </View>
            )}

            <PillButton title="Step into the Circle" onPress={finish} loading={saving} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 28,
    paddingTop: 72,
  },
  script: {
    fontFamily: fonts.script,
    fontSize: 26,
    color: colors.teal,
    textAlign: 'center',
    marginBottom: 16,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 8,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
    lineHeight: 21,
    marginBottom: 20,
  },
  photoCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: colors.lavender,
    borderWidth: 2,
    borderColor: colors.purple,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  photoHint: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.purple,
    textAlign: 'center',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  roleCard: {
    backgroundColor: colors.lavender,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: 18,
    marginBottom: 12,
  },
  roleCardSelected: {
    borderColor: colors.purple,
    backgroundColor: colors.tealSoft,
  },
  roleTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink,
    marginBottom: 4,
  },
  roleDesc: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.ink,
    marginBottom: 10,
  },
  rateNote: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginBottom: 20,
    marginTop: -4,
  },
});
