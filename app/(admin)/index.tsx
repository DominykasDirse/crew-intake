import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Body, Button, Screen, Title } from '@/components/ui';

export default function AdminHome() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <Title>{t('admin.title')}</Title>
      <Body muted>{t('admin.placeholder')}</Body>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
