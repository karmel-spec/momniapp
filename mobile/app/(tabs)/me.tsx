// Me — profile editor, "What I've chosen to share", pin claim, Links balance, settings.
import React, { useCallback, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';
import { Chip, Checkbox, Field, PillButton } from '../../components/auth/ui';

const CARE_TYPES = [
  { value: 'right-now', label: 'Right Now' },
  { value: 'date-night', label: 'Date Night' },
  { value: 'my-regulars', label: 'My Regulars' },
  { value: 'night-shift', label: 'Night Shift' },
  { value: 'weekend-getaway', label: 'Weekend Getaway' },
  { value: 'extended-trip', label: 'Extended Trip' },
];

const KID_AGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ROLES: { value: string; label: string }[] = [
  { value: 'find-care', label: 'Finding care' },
  { value: 'host', label: 'Hosting' },
  { value: 'both', label: 'Both' },
];

type SharedItem = { id: string; type: string; label: string; obtained_date: string | null };

export default function MeScreen() {
  const [me, setMe] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [bio, setBio] = useState('');
  const [kidsAges, setKidsAges] = useState<number[]>([]);
  const [role, setRole] = useState('find-care');
  const [careTypes, setCareTypes] = useState<string[]>([]);
  const [availableNow, setAvailableNow] = useState(false);
  const [rateNote, setRateNote] = useState('');
  const [linksBalance, setLinksBalance] = useState(0);
  const [gives, setGives] = useState(false);
  const [shared, setShared] = useState<SharedItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Pin claim form
  const [claimCity, setClaimCity] = useState('');
  const [claimEvidence, setClaimEvidence] = useState('');
  const [freshOptIn, setFreshOptIn] = useState(false);
  const [claimSent, setClaimSent] = useState(false);
  const [showClaim, setShowClaim] = useState(false);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id ?? null;
    setMe(uid);
    if (!uid) return;
    const { data: p } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (p) {
      setPhotoUrl(p.photo_url);
      setName(p.name ?? '');
      setNeighborhood(p.neighborhood ?? '');
      setBio(p.bio ?? '');
      setKidsAges(p.kids_ages ?? []);
      setRole(p.role ?? 'find-care');
      setCareTypes(p.care_types ?? []);
      setAvailableNow(!!p.available_now);
      setRateNote(p.hourly_rate_note ?? '');
      setLinksBalance(p.links_balance ?? 0);
      setGives(!!p.gives_toggle);
    }
    const { data: items } = await supabase
      .from('shared_items')
      .select('id, type, label, obtained_date')
      .eq('profile_id', uid)
      .order('created_at', { ascending: false });
    setShared((items as SharedItem[]) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleAge = (age: number) =>
    setKidsAges((prev) => (prev.includes(age) ? prev.filter((a) => a !== age) : [...prev, age].sort((a, b) => a - b)));
  const toggleCare = (t: string) =>
    setCareTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const pickAvatar = async () => {
    if (!me) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() ?? 'jpg';
    const path = `${me}/avatar-${Date.now()}.${ext}`;
    const buf = await (await fetch(asset.uri)).arrayBuffer();
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, buf, { contentType: asset.mimeType ?? 'image/jpeg' });
    if (error) return;
    const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    setPhotoUrl(url);
    await supabase.from('profiles').update({ photo_url: url }).eq('id', me);
  };

  const save = async () => {
    if (!me) return;
    setSaving(true);
    await supabase
      .from('profiles')
      .update({
        name: name.trim(),
        neighborhood: neighborhood.trim(),
        bio: bio.trim(),
        kids_ages: kidsAges,
        role,
        care_types: careTypes,
        available_now: availableNow,
        hourly_rate_note: rateNote.trim(),
      })
      .eq('id', me);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const addBackgroundCheck = async () => {
    if (!me) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() ?? 'jpg';
    const path = `${me}/bgcheck-${Date.now()}.${ext}`;
    const buf = await (await fetch(asset.uri)).arrayBuffer();
    const { error } = await supabase.storage
      .from('shared-docs')
      .upload(path, buf, { contentType: asset.mimeType ?? 'image/jpeg' });
    if (error) return;
    const firstName = name.trim().split(' ')[0] || 'me';
    await supabase.from('shared_items').insert({
      profile_id: me,
      type: 'background_check',
      label: `Background check — purchased and shared by ${firstName}`,
      file_path: path,
      obtained_date: new Date().toISOString().slice(0, 10),
    });
    load();
  };

  const toggleGives = async (value: boolean) => {
    if (!me) return;
    setGives(value);
    await supabase.from('profiles').update({ gives_toggle: value }).eq('id', me);
  };

  const submitClaim = async () => {
    if (!me || !claimCity.trim() || !freshOptIn) return;
    await supabase.from('pin_claims').insert({
      profile_id: me,
      claimed_city: claimCity.trim(),
      evidence: claimEvidence.trim(),
      fresh_opt_in: true,
    });
    setClaimSent(true);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 60 }}>
      <Text style={styles.heading}>Me</Text>

      {/* Avatar + basics */}
      <Pressable onPress={pickAvatar} style={styles.avatarWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <Text style={styles.avatarHint}>Add a photo</Text>
          </View>
        )}
      </Pressable>

      <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" />
      <Field label="Neighborhood" value={neighborhood} onChangeText={setNeighborhood} placeholder="e.g. Northeast Orem" />
      <Field label="Bio" value={bio} onChangeText={setBio} placeholder="Tell the mamas about you" multiline />

      <Text style={styles.label}>Kids' ages</Text>
      <View style={styles.chipRow}>
        {KID_AGES.map((a) => (
          <Chip key={a} label={a === 0 ? 'Baby' : `${a}`} selected={kidsAges.includes(a)} onPress={() => toggleAge(a)} />
        ))}
      </View>

      <Text style={styles.label}>I'm here for…</Text>
      <View style={styles.chipRow}>
        {ROLES.map((r) => (
          <Chip key={r.value} label={r.label} selected={role === r.value} onPress={() => setRole(r.value)} />
        ))}
      </View>

      {role !== 'find-care' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Hosting details</Text>
          <Text style={styles.label}>Care I offer</Text>
          <View style={styles.chipRow}>
            {CARE_TYPES.map((c) => (
              <Chip key={c.value} label={c.label} selected={careTypes.includes(c.value)} onPress={() => toggleCare(c.value)} />
            ))}
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Available right now</Text>
            <Switch value={availableNow} onValueChange={setAvailableNow} trackColor={{ true: colors.teal }} />
          </View>
          <Field
            label="My rate (you set it, paid directly to you)"
            value={rateNote}
            onChangeText={setRateNote}
            placeholder="e.g. $8/hr per kiddo, Venmo or cash"
          />
        </View>
      )}

      <PillButton title={saved ? 'Saved!' : 'Save my profile'} onPress={save} loading={saving} style={{ marginTop: 6 }} />

      {/* What I've chosen to share */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>What I've chosen to share</Text>
        {shared.length === 0 && <Text style={styles.mutedText}>Nothing shared yet — totally your call, mama.</Text>}
        {shared.map((item) => (
          <View key={item.id} style={styles.sharedItem}>
            <Text style={styles.sharedLabel}>{item.label}</Text>
            {item.obtained_date ? <Text style={styles.mutedText}>Obtained {item.obtained_date}</Text> : null}
          </View>
        ))}
        <PillButton title="Add a background check I purchased" onPress={addBackgroundCheck} variant="outline" style={{ marginTop: 12 }} />
        <Text style={styles.disclaimer}>
          Displayed as this mama's own content. Momni does not review or endorse it.
        </Text>
      </View>

      {/* Claim my 1.0 pin */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Claim my 1.0 pin</Text>
        <Text style={styles.mutedText}>
          Were you a Momni mama the first time around? Your pin is still on the map. Come light it up.
        </Text>
        {claimSent ? (
          <Text style={styles.claimDone}>Claim sent! Karmel personally reviews every claim.</Text>
        ) : showClaim ? (
          <View style={{ marginTop: 12 }}>
            <Field label="City where you hosted or found care" value={claimCity} onChangeText={setClaimCity} placeholder="e.g. Houston" />
            <Field
              label="Help Karmel remember you (optional)"
              value={claimEvidence}
              onChangeText={setClaimEvidence}
              placeholder='e.g. "I hosted in Houston 2018–2019"'
              multiline
            />
            <View style={styles.optInRow}>
              <Checkbox checked={freshOptIn} onToggle={() => setFreshOptIn(!freshOptIn)} />
              <Text style={styles.optInText}>
                I'm freshly opting in to Momni 2.0 and want my pin lit up with my name.
              </Text>
            </View>
            <PillButton title="Claim my pin" onPress={submitClaim} disabled={!claimCity.trim() || !freshOptIn} />
            <Text style={styles.disclaimer}>Karmel personally reviews every claim.</Text>
          </View>
        ) : (
          <PillButton title="Start my claim" onPress={() => setShowClaim(true)} variant="purple" style={{ marginTop: 12 }} />
        )}
      </View>

      {/* Links + Momni Gives */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>My Links</Text>
        <Text style={styles.linksBalance}>{linksBalance} Links left this month</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Momni Gives ($1)</Text>
          <Switch value={gives} onValueChange={toggleGives} trackColor={{ true: colors.teal }} />
        </View>
        <Text style={styles.mutedText}>
          Goes to the Momni Foundation, a separate 501(c)(3) — via web, not in-app.
        </Text>
      </View>

      {/* Settings */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Settings</Text>
        <Pressable onPress={() => Linking.openURL('mailto:support@momni.com')} style={styles.settingRow}>
          <Text style={styles.settingLink}>Contact us — support@momni.com</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL('https://momni.com/terms/')} style={styles.settingRow}>
          <Text style={styles.settingLink}>Terms of Service</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL('https://momni.com/privacy/')} style={styles.settingRow}>
          <Text style={styles.settingLink}>Privacy Policy</Text>
        </Pressable>
        <Text style={styles.mutedText}>
          Momni has zero tolerance for objectionable content or abusive members.
        </Text>
        <PillButton title="Sign out" onPress={() => supabase.auth.signOut()} variant="outline" style={{ marginTop: 14 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white, paddingTop: 64, paddingHorizontal: 20 },
  heading: { fontFamily: fonts.displayHeavy, fontSize: 26, color: colors.ink, marginBottom: 16 },
  avatarWrap: { alignSelf: 'center', marginBottom: 18 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarEmpty: { backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },
  avatarHint: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.purple },
  label: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  card: { backgroundColor: colors.lavender, borderRadius: radii.card, padding: 16, marginTop: 20 },
  cardTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.ink, marginBottom: 10 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10 },
  switchLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  mutedText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 4 },
  sharedItem: { backgroundColor: colors.white, borderRadius: radii.input, padding: 12, marginTop: 8 },
  sharedLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  disclaimer: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 10, fontStyle: 'italic' },
  claimDone: { fontFamily: fonts.script, fontSize: 19, color: colors.tealDeep, marginTop: 12 },
  optInRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  optInText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  linksBalance: { fontFamily: fonts.display, fontSize: 20, color: colors.purple, marginBottom: 4 },
  settingRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.white },
  settingLink: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.teal },
});
