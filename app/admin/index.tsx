import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Screen, Title } from '@/components/ui';

export default function AdminHome() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <Title>{t('admin.title')}</Title>
      <Button title={t('admin.people')} onPress={() => router.push('/admin/people')} />
      <Button
        title={t('admin.newPerson')}
        variant="secondary"
        onPress={() => router.push('/admin/people/new')}
      />
      <Button
        title={t('common.back')}
        variant="secondary"
        onPress={() => router.replace('/today')}
      />
    </Screen>
  );
}
