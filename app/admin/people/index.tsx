import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { inviteState, listPeople, PAGE } from '@/api/admin';
import { Body, Button, colors, Screen, Title } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { fonts } from '@/theme';

export default function People() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const q = useInfiniteQuery({
    queryKey: ['admin', 'people'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listPeople(pageParam),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];

  return (
    <Screen>
      <Title>{t('admin.people')}</Title>
      <Button title={t('admin.newPerson')} onPress={() => router.push('/admin/people/new')} />
      {q.isLoading && <Body muted>{t('common.loading')}</Body>}
      {q.error && (
        <>
          <Body style={{ color: colors.red }}>{errorMessage(q.error)}</Body>
          <Button title={t('common.retry')} variant="secondary" onPress={() => void q.refetch()} />
        </>
      )}
      {rows.map((p) => {
        const group = p.group ? (i18n.language === 'lt' ? p.group.name_lt : p.group.name_en) : '—';
        return (
          <Pressable
            key={p.user_id}
            accessibilityRole="button"
            onPress={() => router.push(`/admin/people/${p.user_id}`)}
            style={({ pressed }) => [s.row, pressed && s.pressed]}
          >
            <Text style={s.name}>
              {p.last_name} {p.first_name}
            </Text>
            <Text style={s.meta}>
              {group} · {t(`admin.status.${p.status}`)} ·{' '}
              {t(`admin.invite.${inviteState(p.invites)}`)}
            </Text>
          </Pressable>
        );
      })}
      {q.hasNextPage && (
        <Button
          title={t('admin.loadMore')}
          variant="secondary"
          onPress={() => void q.fetchNextPage()}
        />
      )}
      <View style={{ height: 8 }} />
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const s = StyleSheet.create({
  row: {
    minHeight: 64,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  pressed: { opacity: 0.8 },
  name: { fontFamily: fonts.sans600, color: colors.text, fontSize: 18 },
  meta: { fontFamily: fonts.sans400, color: colors.muted, fontSize: 15 },
});
