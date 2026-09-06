import { useTranslation } from 'react-i18next';

import { Body, Screen, Title } from '@/components/ui';

export default function History() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Title>{t('tabs.history')}</Title>
      <Body muted>{t('history.placeholder')}</Body>
    </Screen>
  );
}
