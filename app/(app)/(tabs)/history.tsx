// History: the person's own figures and their own days — nobody else's, ever.
// Missed days inside the 7-day window can be filed from here (late, but filed).
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCalendar, usePublishedForm } from '@/api/reports';
import { supabase } from '@/api/supabase';
import { ChevronRight } from '@/components/icons';
import { Chip, type ChipKind } from '@/components/report/chrome';
import { addDays, fileableDates, longDate, shortDateUpper } from '@/lib/dates';
import { localReportDate } from '@/lib/reportDate';
import { useOutbox } from '@/offline/outboxStore';
import { useSession } from '@/store/session';
import { colors, fonts, radius, type } from '@/theme';

const DAYS = 31;

export default function History() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const tz = profile?.timezone ?? 'Europe/Vilnius';
  const today = localReportDate(new Date(), tz);
  const from = addDays(today, -(DAYS - 1));
  const cal = useCalendar(profile?.user_id, from, today);
  const form = usePublishedForm(profile?.group_id);
  const outbox = useOutbox((s) => s.outbox.items);
  const summary = useQuery({
    queryKey: ['summary', profile?.user_id, from, today],
    enabled: !!profile?.user_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('compliance_summary', {
        p_user_id: profile!.user_id,
        p_from: from,
        p_to: today,
      });
      if (error) throw error;
      return data as unknown as {
        expected_days: number;
        filed: number;
        late: number;
        excused: number;
        missed: number;
        pending: number;
        last_filed: string | null;
      };
    },
  });
  const fileable = new Set(fileableDates(tz));
  const sum = summary.data;

  const rows = [...(cal.data ?? [])].sort((a, b) => (a.report_date < b.report_date ? 1 : -1));
  const chipFor = (status: string, date: string): { kind: ChipKind; label: string } | null => {
    const ob = form.data ? outbox[`${form.data.form.id}|${date}`] : undefined;
    if (ob && (ob.status === 'queued' || ob.status === 'sending'))
      return { kind: 'syncing', label: t('sent.chip.queued') };
    if (ob && ob.status === 'failed') return { kind: 'failed', label: t('sent.chip.failed') };
    switch (status) {
      case 'filed':
        return { kind: 'filed', label: t('sent.chip.filed') };
      case 'late':
        return { kind: 'late', label: t('sent.chip.late') };
      case 'excused':
        return { kind: 'dayoff', label: t('sent.chip.dayOff') };
      case 'missed':
        return { kind: 'missed', label: t('sent.chip.missed') };
      case 'pending':
        return { kind: 'due', label: t('home.due') };
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={cal.isRefetching}
            onRefresh={() => void Promise.all([cal.refetch(), summary.refetch()])}
            tintColor={colors.accent}
          />
        }
      >
        <Text style={s.title}>{t('tabs.history')}</Text>

        <View style={s.card}>
          <Text style={s.kicker}>{t('history.lastDays', { n: DAYS })}</Text>
          {sum ? (
            <>
              <Text style={s.figure}>
                <Text style={{ fontFamily: fonts.mono600, color: colors.accent }}>
                  {sum.filed + sum.excused}
                </Text>{' '}
                {t('history.ofFiled', { n: sum.expected_days })}
              </Text>
              <Text style={s.figureSub}>
                {t('history.breakdown', {
                  onTime: sum.filed - sum.late,
                  late: sum.late,
                  dayOff: sum.excused,
                  missed: sum.missed,
                })}
              </Text>
              <Text style={s.figureSub}>
                {sum.last_filed
                  ? t('history.lastFiled', { date: longDate(sum.last_filed, i18n.language, tz) })
                  : t('history.neverFiled')}
              </Text>
            </>
          ) : (
            <Text style={s.figureSub}>
              {summary.error ? String(summary.error) : t('common.loading')}
            </Text>
          )}
          <Text style={s.fine}>{t('history.ownOnly')}</Text>
        </View>

        <View style={{ gap: 8 }}>
          {rows.map((r) => {
            const chip = chipFor(r.status, r.report_date);
            const canFile = r.status === 'missed' && fileable.has(r.report_date);
            const canOpen =
              ['filed', 'late', 'excused'].includes(r.status) ||
              !!outbox[`${form.data?.form.id}|${r.report_date}`];
            const onPress = canFile
              ? () => router.push(`/report/${r.report_date}`)
              : canOpen
                ? () => router.push(`/report/${r.report_date}/review`)
                : undefined;
            return (
              <Pressable
                key={r.report_date}
                accessibilityRole={onPress ? 'button' : undefined}
                disabled={!onPress}
                onPress={onPress}
                style={({ pressed }) => [
                  s.row,
                  !r.expected && { opacity: 0.45 },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={s.rowDate}>{shortDateUpper(r.report_date, i18n.language, tz)}</Text>
                <View style={{ flex: 1 }} />
                {chip ? (
                  <Chip kind={chip.kind} label={chip.label} />
                ) : (
                  <Text style={s.rowMuted}>{t('history.notAssigned')}</Text>
                )}
                {canFile ? <Text style={s.fileNow}>{t('history.fileNow')}</Text> : null}
                {onPress ? <ChevronRight size={16} /> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 20 },
  title: { ...type.display, color: colors.text },
  card: {
    gap: 8,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.control,
  },
  kicker: { ...type.kicker, color: colors.muted },
  figure: { fontFamily: fonts.sans600, fontSize: 22, color: colors.text, marginTop: 4 },
  figureSub: { fontFamily: fonts.sans400, fontSize: 14, color: colors.text2, lineHeight: 20 },
  fine: { fontFamily: fonts.sans400, fontSize: 12, color: colors.muted, marginTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.card,
    borderRadius: radius.control,
  },
  rowDate: { fontFamily: fonts.mono400, fontSize: 12, color: colors.text2 },
  rowMuted: { fontFamily: fonts.sans400, fontSize: 12, color: colors.dim },
  fileNow: { fontFamily: fonts.sans600, fontSize: 13, color: colors.accent },
});
