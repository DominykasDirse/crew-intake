// One day, as a fact: why it counts the way it does, the edit fact if any, the person's
// notes on it, and a way to add one. Same numbers the admin sees, from the same function.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NOTE_MAX, useAddDayNote, useDayNotes } from '@/api/notes';
import { useCalendar, usePublishedForm } from '@/api/reports';
import { Chip, type ChipKind } from '@/components/report/chrome';
import { Button } from '@/components/ui';
import { fileableDates, formatMinutes, localStamp, longDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { editSentence, reasonSentence } from '@/lib/reasons';
import { useOutbox } from '@/offline/outboxStore';
import { useSession } from '@/store/session';
import { colors, fonts, radius, type } from '@/theme';

export default function Day() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date: string }>();
  const profile = useSession((s) => s.profile);
  const tz = profile?.timezone ?? 'Europe/Vilnius';
  const cal = useCalendar(profile?.user_id, date ?? '', date ?? '');
  const form = usePublishedForm(profile?.group_id);
  const outbox = useOutbox((s) =>
    form.data && date ? s.outbox.items[`${form.data.form.id}|${date}`] : undefined,
  );
  const notes = useDayNotes(profile?.user_id, date ?? '');
  const add = useAddDayNote(profile?.user_id, date ?? '');
  const [text, setText] = useState('');
  if (!date) return null;

  const row = cal.data?.[0];
  const canFile = row?.status === 'missed' && fileableDates(tz).includes(date);
  const canOpen = !!row && (['filed', 'late', 'excused'].includes(row.status) || !!outbox);

  const chip: { kind: ChipKind; label: string } | null = (() => {
    if (outbox && (outbox.status === 'queued' || outbox.status === 'sending'))
      return { kind: 'syncing', label: t('sent.chip.queued') };
    if (outbox && outbox.status === 'failed')
      return { kind: 'failed', label: t('sent.chip.failed') };
    switch (row?.status) {
      case 'filed':
        return { kind: 'filed', label: t('sent.chip.filed') };
      case 'late':
        return {
          kind: 'late',
          label:
            row.late_minutes != null
              ? `${t('sent.chip.late')} · ${formatMinutes(row.late_minutes)}`
              : t('sent.chip.late'),
        };
      case 'excused':
        return { kind: 'dayoff', label: t('sent.chip.dayOff') };
      case 'missed':
        return { kind: 'missed', label: t('sent.chip.missed') };
      case 'pending':
        return { kind: 'due', label: t('home.due') };
      default:
        return null;
    }
  })();
  const edit = row ? editSentence(row, t, i18n.language, tz) : null;
  const editedLate = row?.edited_late_minutes != null;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.kicker}>{t('day.title')}</Text>
        <Text style={s.date}>{longDate(date, i18n.language, tz)}</Text>

        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {chip ? (
              <Chip kind={chip.kind} label={chip.label} />
            ) : (
              <Text style={s.muted}>
                {row?.status === 'before_join' ? t('history.beforeJoin') : t('history.notAssigned')}
              </Text>
            )}
            {editedLate ? <Chip kind="syncing" label={t('day.editedChip')} /> : null}
          </View>
          {row ? (
            <Text style={s.reason}>{reasonSentence(row, t, i18n.language, tz)}</Text>
          ) : (
            <Text style={s.muted}>{cal.error ? errorMessage(cal.error) : t('common.loading')}</Text>
          )}
          {edit ? (
            <Text style={[s.reason, editedLate && { color: colors.amber }]}>{edit}</Text>
          ) : null}
          <Text style={s.fine}>{t('day.sameFunction')}</Text>
        </View>

        {canFile ? (
          <Button title={t('history.fileNow')} onPress={() => router.push(`/report/${date}`)} />
        ) : null}
        {canOpen ? (
          <Button
            title={t('home.seeSent')}
            variant="secondary"
            onPress={() => router.push(`/report/${date}/review`)}
          />
        ) : null}

        <View style={{ gap: 10, marginTop: 8 }}>
          <Text style={s.kicker}>{t('day.notes')}</Text>
          {(notes.data ?? []).map((n) => (
            <View key={n.id} style={s.note}>
              <Text style={s.noteStamp}>
                {localStamp(new Date(n.created_at), i18n.language, tz)}
              </Text>
              <Text style={s.noteText}>{n.note}</Text>
              {n.resolved_at ? (
                <View style={s.resolution}>
                  <Text style={s.noteStamp}>
                    {t('day.resolvedAt', {
                      when: localStamp(new Date(n.resolved_at), i18n.language, tz),
                    })}
                  </Text>
                  <Text style={s.noteText}>{n.resolution}</Text>
                </View>
              ) : null}
            </View>
          ))}
          {notes.data && notes.data.length === 0 ? (
            <Text style={s.muted}>{t('day.noNotes')}</Text>
          ) : null}
          {notes.error ? (
            <Text style={[s.fine, { color: colors.red }]}>{errorMessage(notes.error)}</Text>
          ) : null}

          <Text style={s.fine}>{t('day.noteExplain')}</Text>
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.slice(0, NOTE_MAX))}
            placeholder={t('day.notePlaceholder')}
            placeholderTextColor={colors.dim}
            multiline
            textAlignVertical="top"
            accessibilityLabel={t('day.notes')}
            style={s.input}
          />
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={s.fine}>
              {text.trim().length}/{NOTE_MAX}
            </Text>
            <Text style={[s.fine, { color: colors.red }]}>
              {add.error ? errorMessage(add.error) : ''}
            </Text>
          </View>
          <Button
            title={t('day.addNote')}
            variant="secondary"
            disabled={text.trim().length === 0}
            loading={add.isPending}
            onPress={() => add.mutate(text, { onSuccess: () => setText('') })}
          />
        </View>

        <Button title={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 30, gap: 14 },
  kicker: { ...type.kicker, color: colors.muted },
  date: { fontFamily: fonts.sans700, fontSize: 25, letterSpacing: -0.5, color: colors.text },
  card: {
    gap: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.control,
  },
  reason: { fontFamily: fonts.sans400, fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { fontFamily: fonts.sans400, fontSize: 14, color: colors.muted },
  fine: { fontFamily: fonts.sans400, fontSize: 12, lineHeight: 18, color: colors.muted },
  note: {
    gap: 6,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.panel,
    borderRadius: radius.control,
  },
  noteStamp: { fontFamily: fonts.mono400, fontSize: 11, color: colors.muted },
  noteText: { fontFamily: fonts.sans400, fontSize: 15, lineHeight: 21, color: colors.text },
  resolution: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border2 },
  input: {
    minHeight: 96,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
    fontSize: 16,
    padding: 14,
    fontFamily: fonts.sans400,
  },
});
