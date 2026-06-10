import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii } from '../../lib/theme';

export default function LegacyBanner() {
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');

  const bringMomni = async () => {
    if (state !== 'idle') return;
    setState('saving');
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    let city = 'My city';
    if (userId) {
      const { data: profile } = await supabase.from('profiles').select('city').eq('id', userId).single();
      if (profile?.city) city = profile.city;
    }
    const { error } = await supabase.from('waitlist_pins').insert({ profile_id: userId, city });
    setState(error ? 'idle' : 'done');
  };

  return (
    <View style={styles.banner}>
      <Text style={styles.script}>Your pin is still on the map. Come light it up.</Text>
      <Pressable onPress={bringMomni} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
        <Text style={styles.btnText}>
          {state === 'done' ? 'Pin dropped — we’ll circle up soon' : state === 'saving' ? 'Dropping your pin…' : 'Bring Momni to my city'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.tealSoft,
    borderRadius: radii.card,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  script: { fontFamily: fonts.script, fontSize: 22, color: colors.teal, textAlign: 'center' },
  btn: {
    backgroundColor: colors.teal,
    borderRadius: radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginTop: 10,
  },
  btnText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.white },
});
