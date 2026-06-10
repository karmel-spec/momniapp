import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '../../lib/supabase';
import { colors, fonts } from '../../lib/theme';
import { Field, PillButton, ErrorNote } from '../../components/auth/ui';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Pop in your email and password, mama.');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (err) {
      setError(
        err.message.includes('Invalid login credentials')
          ? "Hmm, that email and password don't match. Try again?"
          : err.message
      );
    }
    // success: auth gate in app/_layout.tsx routes to (tabs)
  };

  const signInWithApple = async () => {
    setError(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (credential.identityToken) {
        const { error: err } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (err) setError(err.message);
      }
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        setError("Apple sign-in didn't go through. Try email instead?");
      }
    }
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
        <Image
          source={require('../../assets/momni-logo-color-horizontal.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.script}>Circle up. Link together.</Text>
        <Text style={styles.heading}>Welcome back, mama</Text>

        <ErrorNote message={error} />

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
          autoComplete="password"
          placeholder="Your password"
        />

        <PillButton title="Sign in" onPress={signIn} loading={loading} style={{ marginTop: 6 }} />

        {Platform.OS === 'ios' && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={100}
            style={styles.appleButton}
            onPress={signInWithApple}
          />
        )}

        <Link href="/(auth)/sign-up" style={styles.link}>
          New here? <Text style={styles.linkBold}>Join the Circle</Text>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 28,
  },
  logo: {
    width: 220,
    height: 64,
    alignSelf: 'center',
    marginBottom: 8,
  },
  script: {
    fontFamily: fonts.script,
    fontSize: 24,
    color: colors.teal,
    textAlign: 'center',
    marginBottom: 24,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
    marginBottom: 18,
  },
  appleButton: {
    height: 50,
    marginTop: 14,
  },
  link: {
    marginTop: 24,
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
