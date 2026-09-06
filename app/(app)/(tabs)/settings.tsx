import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Body, Button, Screen, Title } from '@/components/ui';
import { useSession } from '@/store/session';

export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const isAdmin = useSession((s) => s.isAdmin);
  const signOut = useSession((s) => s.signOut);

  return (
    <Screen>
      <Title>{t('settings.title')}</Title>
      <Body muted>{profile?.full_name ?? ''}</Body>
      {isAdmin && (
        <Button
          title={t('today.admin')}
          variant="secondary"
          onPress={() => router.push('/admin')}
        />
      )}
      <Button title={t('settings.signOut')} variant="danger" onPress={() => void signOut()} />
    </Screen>
  );
}
