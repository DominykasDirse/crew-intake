import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '@/api/supabase';
import { Body, Button, Choice, Screen, Title } from '@/components/ui';
import { setLocale } from '@/i18n';
import { isLocale, type Locale } from '@/lib/locale';
import { useSession } from '@/store/session';

export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const signOut = useSession((s) => s.signOut);
  const refreshProfile = useSession((s) => s.refreshProfile);
  const [saved, setSaved] = useState(false);

  const current: Locale = isLocale(profile?.locale) ? profile.locale : 'en';

  const changeLocale = async (l: Locale) => {
    if (!profile) return;
    void setLocale(l);
    await supabase.from('profiles').update({ locale: l }).eq('user_id', profile.user_id);
    await refreshProfile();
    setSaved(true);
  };

  return (
    <Screen>
      <Title>{t('settings.title')}</Title>
      <Body muted>{t('common.language')}</Body>
      <Choice
        value={current}
        onChange={(l) => void changeLocale(l)}
        options={[
          { value: 'en', label: t('common.english') },
          { value: 'lt', label: t('common.lithuanian') },
        ]}
      />
      {saved && <Body muted>{t('settings.saved')}</Body>}
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      <Button title={t('settings.signOut')} variant="danger" onPress={() => void signOut()} />
    </Screen>
  );
}
