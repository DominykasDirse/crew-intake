import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Body, Button, Screen, Title } from '@/components/ui';

export default function Welcome() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 14, minHeight: 500 }}>
        <Title>{t('welcome.title')}</Title>
        <Body muted>{t('welcome.subtitle')}</Body>
        <View style={{ height: 24 }} />
        <Button title={t('welcome.scan')} onPress={() => router.push('/scan')} />
        <Button
          title={t('welcome.enterLink')}
          variant="secondary"
          onPress={() => router.push('/claim')}
        />
        <View style={{ height: 24 }} />
        <Button
          title={t('welcome.signIn')}
          variant="secondary"
          onPress={() => router.push('/sign-in')}
        />
      </View>
    </Screen>
  );
}
