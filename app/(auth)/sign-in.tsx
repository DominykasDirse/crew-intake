import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '@/api/supabase';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';

export default function SignIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (e) {
      setError(/network|fetch/i.test(e.message) ? t('errors.network') : t('signIn.wrong'));
      return;
    }
    router.replace('/today');
  };

  return (
    <Screen>
      <Title>{t('signIn.title')}</Title>
      <Field
        label={t('signIn.email')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Field
        label={t('signIn.password')}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={t('signIn.button')}
        onPress={() => void submit()}
        loading={busy}
        disabled={!email || !password}
      />
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
