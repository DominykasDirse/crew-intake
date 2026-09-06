// Part 2 of phase 5 replaces this with the Review screen (design/Review.dc.html).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Body, Button, Screen, Title } from '@/components/ui';

export default function ReviewPlaceholder() {
  const { t } = useTranslation();
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date: string }>();
  return (
    <Screen>
      <Title>{t('review.title')}</Title>
      <Body muted>{t('review.placeholder', { date })}</Body>
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
