// Submitted (design/Submitted.dc.html). Shown the moment the report enters the outbox;
// the title follows the outbox item live: queued → sending → sent (or failed, with retry).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCalendar, usePublishedForm } from '@/api/reports';
import { Check } from '@/components/icons';
import { SevenDayStrip, type StripStatus } from '@/components/report/chrome';
import { Button } from '@/components/ui';
import { addDays, formatMinutes, localHHmm, shortDateUpper } from '@/lib/dates';
import { useOutbox, useOutboxItem } from '@/offline/outboxStore';
import { unfinishedCount } from '@/offline/uploads';
import { useUploads } from '@/offline/uploadsStore';
import { useSession } from '@/store/session';
import { colors, fonts, radius, type } from '@/theme';

export default function Sent() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date: string }>();
  const [openedAt] = useState(() => Date.now());
  const profile = useSession((s) => s.profile);
  const tz = profile?.timezone ?? 'Europe/Vilnius';
  const form = usePublishedForm(profile?.group_id);
  const item = useOutboxItem(form.data?.form.id, date ?? '');
  const retryNow = useOutbox((s) => s.retryNow);
  const pendingPhotos = useUploads((s) =>
    form.data ? unfinishedCount(s.uploads, form.data.form.id, date ?? '') : 0,
  );
  const cal = useCalendar(profile?.user_id, addDays(date ?? '', -60), date ?? '');
  if (!date) return null;

  const rows = cal.data ?? [];
  const strip: StripStatus[] = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map((d) =>
    d === date
      ? 'filed'
      : ((rows.find((r) => r.report_date === d)?.status as StripStatus | undefined) ?? 'unknown'),
  );

  const status = item?.status ?? 'sent';
  const title =
    status === 'sent'
      ? t('sent.title')
      : status === 'failed'
        ? t('sent.failedTitle')
        : t('sent.queuedTitle');
  const when = item?.submittedAt
    ? Date.parse(item.submittedAt)
    : (item?.sentAt ?? item?.createdAt ?? openedAt);
  const outcome =
    item?.serverStatus === 'excused'
      ? t('sent.dayOff')
      : item?.isLate
        ? t('sent.lateBy', { late: formatMinutes(item.lateMinutes ?? 0) })
        : item?.serverStatus
          ? t('sent.onTime')
          : t('sent.pending');

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.body}>
        <View
          style={[
            s.circle,
            status === 'failed' && { backgroundColor: colors.red },
            status !== 'sent' && status !== 'failed' && { backgroundColor: colors.disabledBg },
          ]}
        >
          <Check
            size={46}
            color={status === 'sent' || status === 'failed' ? colors.bg : colors.muted}
            strokeWidth={2.6}
          />
        </View>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Text style={s.title}>{title}</Text>
          <Text style={[s.mono, item?.isLate && { color: colors.amber }]}>
            {shortDateUpper(date, i18n.language, tz)} · {localHHmm(new Date(when), tz)} ·{' '}
            {outcome.toUpperCase()}
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.kicker}>{t('home.lastSeven')}</Text>
          <SevenDayStrip days={strip} height={30} panel />
        </View>

        <Text style={s.note}>
          {status === 'sent'
            ? pendingPhotos > 0
              ? t('sent.notePhotos', { count: pendingPhotos })
              : t('sent.noteSent')
            : status === 'failed'
              ? t('sent.noteFailed', { reason: item?.lastError ?? '' })
              : t('sent.noteQueued')}
        </Text>
        {status === 'failed' && item ? (
          <Button title={t('review.retry')} onPress={() => retryNow(item.key)} />
        ) : null}
      </View>

      <View style={s.footer}>
        <Button
          title={t('sent.backToToday')}
          variant="secondary"
          onPress={() => router.replace('/today')}
        />
        <Text style={s.caption}>{t('sent.changeWindow')}</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26, paddingHorizontal: 28 },
  circle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.sans700,
    fontSize: 28,
    letterSpacing: -0.5,
    color: colors.text,
    textAlign: 'center',
  },
  mono: { fontFamily: fonts.mono400, fontSize: 13, color: colors.muted, textAlign: 'center' },
  card: {
    width: '100%',
    gap: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: radius.control,
  },
  kicker: { ...type.kicker, color: colors.muted },
  note: {
    fontFamily: fonts.sans400,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text2,
    width: '100%',
  },
  footer: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  caption: { fontFamily: fonts.sans400, fontSize: 12, color: colors.muted, textAlign: 'center' },
});
