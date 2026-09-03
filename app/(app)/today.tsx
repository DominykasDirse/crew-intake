import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { supabase } from '@/api/supabase';
import { Body, Button, Screen, Title } from '@/components/ui';
import { localReportDate } from '@/lib/reportDate';
import { useSession } from '@/store/session';

export default function Today() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const isAdmin = useSession((s) => s.isAdmin);

  const group = useQuery({
    queryKey: ['group', profile?.group_id],
    enabled: !!profile?.group_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('groups')
        .select('name_en,name_lt')
        .eq('id', profile!.group_id!)
        .single();
      return data;
    },
  });
  const groupName = group.data
    ? i18n.language === 'lt'
      ? group.data.name_lt
      : group.data.name_en
    : '—';

  return (
    <Screen>
      <Title>{t('today.title')}</Title>
      <Body>{t('today.hello', { name: profile?.first_name ?? '' })}</Body>
      <Body muted>
        {t('today.date', { date: localReportDate(new Date(), profile?.timezone ?? 'UTC') })}
      </Body>
      <Body muted>{t('today.group', { group: groupName })}</Body>
      <Body muted>{t('today.placeholder')}</Body>
      <Button
        title={t('today.settings')}
        variant="secondary"
        onPress={() => router.push('/settings')}
      />
      {isAdmin && (
        <Button
          title={t('today.admin')}
          variant="secondary"
          onPress={() => router.push('/admin')}
        />
      )}
    </Screen>
  );
}
