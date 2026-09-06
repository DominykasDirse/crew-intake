import { zodResolver } from '@hookform/resolvers/zod';
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { invokeFn } from '@/api/functions';
import { supabase } from '@/api/supabase';
import { Body, Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { deviceLocale, deviceTimezone } from '@/i18n';
import { parseInviteToken } from '@/lib/invite';
import { type ClaimForm, claimSchema, PASSWORD_MIN } from '@/lib/password';

const contact =
  (Constants.expoConfig?.extra?.supportContact as string | undefined) ?? 'your tour manager';

export default function Claim() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const fromLink = parseInviteToken(params.token);

  const [rawInput, setRawInput] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { control, handleSubmit, formState } = useForm<ClaimForm>({
    resolver: zodResolver(claimSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const submit = handleSubmit(async ({ password }) => {
    const token = fromLink ?? parseInviteToken(rawInput);
    if (!token) {
      setServerError(t('claim.errors.noToken'));
      return;
    }
    setServerError(null);
    setBusy(true);
    const r = await invokeFn<{ email: string }>('claim-invite', {
      token,
      password,
      locale: deviceLocale(),
      timezone: deviceTimezone(),
    });
    if (!r.ok) {
      setBusy(false);
      setServerError(t(`errors.${r.code}`, { defaultValue: t('errors.unknown') }));
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: r.data.email, password });
    setBusy(false);
    if (error) {
      setServerError(t('errors.try_again'));
      return;
    }
    router.replace('/today');
  });

  const err = (key?: string) => (key ? t(`claim.errors.${key}`, { min: PASSWORD_MIN }) : undefined);

  return (
    <Screen>
      <Title>{t('claim.title')}</Title>

      <View style={{ gap: 10, marginTop: 8 }}>
        <Body>
          <Body>{t('notice.title')}</Body>
        </Body>
        <Body muted>• {t('notice.l1')}</Body>
        <Body muted>• {t('notice.l2')}</Body>
        <Body muted>• {t('notice.l3')}</Body>
        <Body muted>• {t('notice.l4')}</Body>
        <Body muted>• {t('notice.l5', { contact })}</Body>
      </View>

      {!fromLink && (
        <Field
          label={t('claim.tokenLabel')}
          placeholder={t('claim.tokenPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          value={rawInput}
          onChangeText={setRawInput}
        />
      )}

      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <Field
            label={t('claim.password')}
            placeholder={t('claim.hint', { min: PASSWORD_MIN })}
            secureTextEntry
            autoCapitalize="none"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={err(formState.errors.password?.message)}
          />
        )}
      />
      <Controller
        control={control}
        name="confirm"
        render={({ field }) => (
          <Field
            label={t('claim.confirm')}
            secureTextEntry
            autoCapitalize="none"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={err(formState.errors.confirm?.message)}
          />
        )}
      />

      <ErrorText>{serverError}</ErrorText>
      <Button
        title={busy ? t('claim.working') : t('claim.finish')}
        onPress={() => void submit()}
        loading={busy}
      />
      <Button
        title={t('common.back')}
        variant="secondary"
        onPress={() => router.replace('/welcome')}
      />
    </Screen>
  );
}
