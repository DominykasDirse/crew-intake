// Home. Two states from the canvas: Main (report due) and HomeDone (report filed).
// The deadline is the person's notification time + 12 real hours (0011).
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useCalendar,
  useDayContext,
  useGroup,
  usePublishedForm,
  useSubmission,
} from '@/api/reports';
import { Check, ChevronRight, Clock, FileIcon } from '@/components/icons';
import { Chip, SevenDayStrip, type StripStatus, StripLegend } from '@/components/report/chrome';
import { workingDayScreenCount } from '@/forms/screens';
import {
  addDays,
  formatMinutes,
  lateMinutes,
  localHHmm,
  longDate,
  reportDeadline,
  timeLeft,
} from '@/lib/dates';
import { localReportDate } from '@/lib/reportDate';
import { useOutboxItem } from '@/offline/outboxStore';
import { unfinishedCount } from '@/offline/uploads';
import { useUploads } from '@/offline/uploadsStore';
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
  const group = useGroup(profile?.group_id);
  const ctx = useDayContext(profile?.user_id, today);
  const sub = useSubmission(profile?.user_id, form.data?.form.id, today);
  const cal = useCalendar(profile?.user_id, addDays(today, -60), today);
  const draft = useLocal((s) =>
    form.data ? s.drafts[draftKey(form.data.form.id, today)] : undefined,
  );
  const outboxItem = useOutboxItem(form.data?.form.id, today);
  const pendingPhotos = useUploads((s) =>
    form.data ? unfinishedCount(s.uploads, form.data.form.id, today) : 0,
  );

  const notifyAt = profile?.notify_at ?? group.data?.notify_at ?? null;
  const deadline = reportDeadline(today, notifyAt, tz);
  const pastDeadline = now.getTime() >= deadline.getTime();
  const left = timeLeft(today, notifyAt, tz, now);

  const groupName = group.data?.name_en ?? '';
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
  const statusOf = (d: string): StripStatus =>
    (rows.find((r) => r.report_date === d)?.status as StripStatus | undefined) ?? 'unknown';
  const filed = !!sub.data || !!outboxItem;
  const strip = Array.from({ length: 7 }, (_, i) => addDays(today, filed ? i - 6 : i - 7)).map(
    statusOf,
  );
  const filedCount = strip.filter((x) => x === 'filed' || x === 'late' || x === 'excused').length;
  const nQuestions = form.data ? workingDayScreenCount(form.data.questions) : null;

  // the filed card's record: server row first, else the outbox's copy of the server answer
  const status = sub.data?.status ?? outboxItem?.serverStatus ?? null;
  const isLate = sub.data?.is_late ?? outboxItem?.isLate ?? false;
  const filedAt = sub.data?.submitted_at ?? outboxItem?.submittedAt ?? null;
  const lateBy =
    sub.data?.submitted_at && sub.data.deadline_at
      ? lateMinutes(new Date(sub.data.submitted_at), new Date(sub.data.deadline_at))
      : (outboxItem?.lateMinutes ?? null);
  const filedLine =
    outboxItem && outboxItem.status !== 'sent'
      ? outboxItem.status === 'failed'
        ? t('home.sendFailed')
        : t('home.queued')
      : `${filedAt ? localHHmm(new Date(filedAt), tz) : '—'} · ${
          status === 'excused'
            ? t('home.dayOff')
            : isLate
              ? t('home.lateBy', { late: formatMinutes(lateBy ?? 0) })
              : t('home.onTime')
        }${pendingPhotos > 0 ? ` · ${t('home.photosUploading', { count: pendingPhotos })}` : ''}`;

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
                <Chip
                  kind={pastDeadline ? 'late' : 'due'}
                  label={pastDeadline ? t('home.lateChip') : t('home.due')}
                />
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Clock size={16} color={colors.bg} />
                <Text style={s.dueLeft}>
                  {left
                    ? t('home.leftUntil', { time: left, at: localHHmm(deadline, tz) })
                    : t('home.pastDeadline', { at: localHHmm(deadline, tz) })}
                </Text>
              </View>
            </Pressable>
          ) : (
            <View style={s.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Check
                  size={20}
                  color={
                    outboxItem && outboxItem.status === 'failed'
                      ? colors.red
                      : outboxItem && outboxItem.status !== 'sent'
                        ? colors.muted
                        : colors.green
                  }
                />
                <Text style={s.filedTitle}>
                  {status === 'excused' ? t('home.dayOffRecorded') : t('home.reportFiled')}
                </Text>
              </View>
              <Text style={[s.mono, isLate && status !== 'excused' && { color: colors.amber }]}>
                {filedLine}
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
                <Text style={s.seeSent}>{t('home.seeSent')}</Text>
                <ChevronRight size={18} />
              </Pressable>
            </View>
          )}

          <View style={[s.card, s.row, { opacity: 0.55 }]}>
            <FileIcon size={22} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.invoiceTitle}>{t('home.invoice')}</Text>
              <Text style={s.invoiceSub}>{t('home.invoiceSoon')}</Text>
            </View>
            <ChevronRight size={18} />
          </View>
        </View>

        <View style={[{ gap: 10, marginTop: 4 }, filed && s.card]}>
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
          <SevenDayStrip days={strip} panel={filed} />
          <StripLegend filed={t('home.legendFiled')} dayOff={t('home.legendDayOff')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 24, gap: 24 },
  kicker: { fontFamily: fonts.mono400, fontSize: 11, letterSpacing: 1.3, color: colors.muted },
  date: { ...type.display, color: colors.text },
  showLine: { fontFamily: fonts.sans400, fontSize: 14, color: colors.text2 },
  dueCard: {
    backgroundColor: colors.accent,
    borderRadius: radius.control,
    paddingVertical: 26,
    paddingHorizontal: 22,
    gap: 10,
  },
  dueTitle: { fontFamily: fonts.sans700, fontSize: 25, letterSpacing: -0.4, color: colors.bg },
  dueSub: {
    fontFamily: fonts.sans400,
    fontSize: 13,
    lineHeight: 19,
    color: colors.bg,
    opacity: 0.78,
  },
  dueLeft: { fontFamily: fonts.mono600, fontSize: 12, color: colors.bg },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.control,
    padding: 20,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 },
  filedTitle: { fontFamily: fonts.sans700, fontSize: 20, letterSpacing: -0.3, color: colors.text },
  mono: { fontFamily: fonts.mono400, fontSize: 12, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.border },
  seeSent: { fontFamily: fonts.sans400, fontSize: 14, color: colors.text2 },
  invoiceTitle: { fontFamily: fonts.sans600, fontSize: 16, color: colors.text },
  invoiceSub: { fontFamily: fonts.sans400, fontSize: 12, color: colors.muted },
  sectionKicker: { ...type.kicker, color: colors.muted },
});
