// Home. Two states from the canvas: Main (report due) and HomeDone (report filed).
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  streakFrom,
  useCalendar,
  useDayContext,
  usePublishedForm,
  useSubmission,
} from '@/api/reports';
import { Check, ChevronRight, Clock, FileIcon } from '@/components/icons';
import { Chip, SevenDayStrip, type StripStatus, StripLegend } from '@/components/report/chrome';
import { workingDayScreenCount } from '@/forms/screens';
import { addDays, localHHmm, longDate, timeLeft } from '@/lib/dates';
import { localReportDate } from '@/lib/reportDate';
import { draftKey, useLocal } from '@/store/local';
import { useSession } from '@/store/session';
import { colors, fonts, radius, type } from '@/theme';

export default function Today() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const profile = useSession((s) => s.profile);
  const tz = profile?.timezone ?? 'Europe/Vilnius';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const today = localReportDate(now, tz);

  const form = usePublishedForm(profile?.group_id);
  const ctx = useDayContext(profile?.user_id, today);
  const sub = useSubmission(profile?.user_id, form.data?.form.id, today);
  const cal = useCalendar(profile?.user_id, addDays(today, -60), today);
  const draft = useLocal((s) =>
    form.data ? s.drafts[draftKey(form.data.form.id, today)] : undefined,
  );

  const groupName = useGroupName(profile?.group_id);
  const kicker = [ctx.data?.tour?.code, ctx.data?.tour?.name, groupName]
    .filter(Boolean)
    .join(' · ')
    .toUpperCase();
  const show = ctx.data?.show;
  const showLine = show
    ? [show.city, show.venue].filter(Boolean).join(' · ') +
      (show.show_at ? ` · ${t('home.show')} ${localHHmm(new Date(show.show_at), tz)}` : '')
    : ctx.isLoading
      ? ''
      : t('home.noShow');

  const rows = cal.data ?? [];
  const status = (d: string): StripStatus =>
    (rows.find((r) => r.report_date === d)?.status as StripStatus | undefined) ?? 'unknown';
  const filed = !!sub.data;
  const stripDays = Array.from({ length: 7 }, (_, i) => addDays(today, filed ? i - 6 : i - 7));
  const strip = stripDays.map(status);
  const filedCount = strip.filter((x) => x === 'filed' || x === 'late' || x === 'excused').length;
  const streak = streakFrom(rows, today);
  const left = timeLeft(today, tz, now);
  const nQuestions = form.data ? workingDayScreenCount(form.data.questions) : null;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.body}>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 18, height: 3, backgroundColor: colors.accent }} />
            <Text style={s.kicker}>{kicker || t('home.noTour')}</Text>
          </View>
          <Text style={s.date}>{longDate(today, i18n.language, tz)}</Text>
          <Text style={s.showLine}>{showLine}</Text>
        </View>

        <View style={{ gap: 12 }}>
          {!filed ? (
            <Pressable
              accessibilityRole="button"
              disabled={!form.data}
              onPress={() => router.push(`/report/${today}`)}
              style={({ pressed }) => [
                s.dueCard,
                pressed && { opacity: 0.9 },
                !form.data && { opacity: 0.6 },
              ]}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <Text style={s.dueTitle}>{t('home.reportToday')}</Text>
                <Chip kind="due" label={t('home.due')} />
              </View>
              <Text style={s.dueSub}>
                {draft
                  ? t('home.resume')
                  : nQuestions
                    ? t('home.questions', { n: nQuestions })
                    : form.error
                      ? t('home.noForm')
                      : t('common.loading')}
              </Text>
              {left ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Clock size={16} color={colors.bg} />
                  <Text style={s.dueLeft}>{t('home.left', { time: left })}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : (
            <View style={s.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Check size={20} color={colors.green} />
                <Text style={s.filedTitle}>
                  {sub.data?.status === 'excused'
                    ? t('home.dayOffRecorded')
                    : t('home.reportFiled')}
                </Text>
              </View>
              <Text style={s.mono}>
                {localHHmm(new Date(sub.data!.submitted_at), tz)} ·{' '}
                {sub.data?.status === 'excused'
                  ? t('home.dayOff')
                  : sub.data?.is_late
                    ? t('home.late')
                    : t('home.onTime')}
              </Text>
              <View style={s.divider} />
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/report/${today}/review`)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: 44,
                  marginVertical: -10,
                }}
              >
                <Text style={{ fontSize: 14, color: colors.text2 }}>{t('home.seeSent')}</Text>
                <ChevronRight size={18} />
              </Pressable>
            </View>
          )}

          <View style={[s.card, s.row, { opacity: 0.55 }]}>
            <FileIcon size={22} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
                {t('home.invoice')}
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{t('home.invoiceSoon')}</Text>
            </View>
            <ChevronRight size={18} />
          </View>
        </View>

        {!filed ? (
          <View style={{ gap: 10, marginTop: 4 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
              }}
            >
              <Text style={s.sectionKicker}>{t('home.lastSeven')}</Text>
              <Text style={[s.mono, { color: colors.text2 }]}>
                {t('home.ofSeven', { n: filedCount })}
              </Text>
            </View>
            <SevenDayStrip days={strip} />
            <StripLegend filed={t('home.legendFiled')} dayOff={t('home.legendDayOff')} />
          </View>
        ) : (
          <View style={[s.card, { gap: 14, marginTop: 4 }]}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
              }}
            >
              <Text style={s.sectionKicker}>{t('home.streak')}</Text>
              <Text style={s.streakNum}>{streak}</Text>
            </View>
            <SevenDayStrip days={strip} panel />
            <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>
              {t('home.streakCaption')}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function useGroupName(groupId: string | null | undefined) {
  const { i18n } = useTranslation();
  const cached = useLocal((s) => (groupId ? s.formCache[groupId] : undefined));
  const [name, setName] = useState<string>('');
  useEffect(() => {
    if (!groupId) return;
    void import('@/api/supabase').then(({ supabase }) =>
      supabase
        .from('groups')
        .select('name_en,name_lt')
        .eq('id', groupId)
        .single()
        .then(({ data }) => {
          if (data) setName(i18n.language === 'lt' ? data.name_lt : data.name_en);
        }),
    );
  }, [groupId, i18n.language, cached]);
  return name;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 24, gap: 24 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.3, color: colors.muted },
  date: { ...type.display, color: colors.text, fontFamily: fonts.sans },
  showLine: { fontSize: 14, color: colors.text2 },
  dueCard: {
    backgroundColor: colors.accent,
    borderRadius: radius.control,
    paddingVertical: 26,
    paddingHorizontal: 22,
    gap: 10,
  },
  dueTitle: {
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.bg,
    fontFamily: fonts.sans,
  },
  dueSub: { fontSize: 13, lineHeight: 19, color: colors.bg, opacity: 0.78 },
  dueLeft: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '600', color: colors.bg },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.control,
    padding: 20,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 },
  filedTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text,
    fontFamily: fonts.sans,
  },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.border },
  sectionKicker: { ...type.kicker, color: colors.muted },
  streakNum: {
    fontFamily: fonts.mono,
    fontSize: 28,
    fontWeight: '600',
    color: colors.accent,
    lineHeight: 30,
  },
});
