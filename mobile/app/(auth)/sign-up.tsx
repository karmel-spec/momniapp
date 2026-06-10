import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radii, SIGNUP_ACKNOWLEDGMENT } from '../../lib/theme';
import { Field, PillButton, ErrorNote, Checkbox } from '../../components/auth/ui';

export default function SignUp() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signUp = async () => {
    setError(null);
    if (!name.trim() || !email.trim() || !password || !city.trim()) {
      setError('Fill in every field so the mamas know who you are.');
      return;
    }
    if (password.length < 8) {
      setError('Pick a password with at least 8 characters.');
      return;
    }
    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (signUpError || !data.user) {
      setLoading(false);
      setError(signUpError?.message ?? "Something didn't work. Mind trying again?");
      return;
    }
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      name: name.trim(),
      city: city.trim(),
      signup_acknowledged_at: new Date().toISOString(),
      signup_acknowledgment_text: SIGNUP_ACKNOWLEDGMENT,
    });
    setLoading(false);
    if (profileError) {
      setError(profileError.message);
      return;
    }
    router.replace('/(auth)/onboarding');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.white }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Join the Circle</Text>
        <Text style={styles.sub}>
          Moms finding moms — that's the whole idea. Tell us a little about you.
        </Text>

        <ErrorNote message={error} />

        <Field label="Your name" value={name} onChangeText={setName} placeholder="First name (or full — your call)" />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
        <Field label="City" value={city} onChangeText={setCity} placeholder="e.g. Orem, UT" />

        <View style={styles.ackCard}>
          <Text style={styles.ackTitle}>One honest thing before you join</Text>
          <Text style={styles.ackText}>{SIGNUP_ACKNOWLEDGMENT}</Text>
          <View style={styles.ackRow}>
            <Checkbox checked={acknowledged} onToggle={() => setAcknowledged(!acknowledged)} />
            <Text style={styles.ackLabel}>I understand and agree</Text>
          </View>
        </View>

        <PillButton
          title="Join the Circle"
          onPress={signUp}
          disabled={!acknowledged}
          loading={loading}
        />

        <Link href="/(auth)/sign-in" style={styles.link}>
          Already one of the mamas? <Text style={styles.linkBold}>Sign in</Text>
        </Link>
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
  heading: {
    fontFamily: fonts.displayHeavy,
    fontSize: 28,
    color: colors.ink,
    marginBottom: 8,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
    marginBottom: 20,
    lineHeight: 21,
  },
  ackCard: {
    backgroundColor: colors.lavender,
    borderWidth: 1.5,
    borderColor: colors.purple,
    borderRadius: radii.card,
    padding: 18,
    marginTop: 8,
    marginBottom: 20,
  },
  ackTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.purpleDeep,
    marginBottom: 8,
  },
  ackText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    lineHeight: 21,
  },
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  ackLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.ink,
  },
  link: {
    marginTop: 22,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
  linkBold: {
    fontFamily: fonts.bodySemi,
    color: colors.purple,
  },
});
