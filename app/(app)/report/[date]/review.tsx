// Review (design/Review.dc.html). Two modes:
//   draft    "Check and send": rows from the local draft, Edit jumps back into the runner,
//            Send hands the pruned answers to the outbox and moves on immediately.
//   sent     "What you sent": rows from the outbox item or the server submission, with its
//            state; Edit (until 06:00 local next day) seeds a new draft from those answers.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePublishedForm, useSubmission } from '@/api/reports';
import { Chip, type ChipKind } from '@/components/report/chrome';
import { Button } from '@/components/ui';
import { formatAnswer, questionLabel } from '@/forms/format';
import { buildScreens, screenQuestions } from '@/forms/screens';
import { deriveStatus } from '@/forms/status';
import type { Answers, Question } from '@/forms/types';
import { pruneAnswers, visibleQuestions } from '@/forms/visibility';
import { editDeadline, isEditable, localHHmm, longDate } from '@/lib/dates';
import { useOutbox, useOutboxItem } from '@/offline/outboxStore';
import { photosFor } from '@/offline/uploads';
import { useUploads } from '@/offline/uploadsStore';
import { useLocal } from '@/store/local';
import { useSession } from '@/store/session';
import { colors, fonts, type } from '@/theme';

export default function Review() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date: string }>();
  const profile = useSession((s) => s.profile);
  const tz = profile?.timezone ?? 'Europe/Vilnius';
  const form = usePublishedForm(profile?.group_id);
  const formId = form.data?.form.id;
  const questions = useMemo(() => form.data?.questions ?? [], [form.data]);

  const draft = useLocal((s) => (formId ? s.drafts[`${formId}|${date}`] : undefined));
  const clearDraft = useLocal((s) => s.clearDraft);
  const startDraft = useLocal((s) => s.startDraft);
  const outboxItem = useOutboxItem(formId, date ?? '');
  const enqueue = useOutbox((s) => s.enqueue);
  const retryNow = useOutbox((s) => s.retryNow);
  const uploads = useUploads((s) => s.uploads);
  const pruneHidden = useUploads((s) => s.pruneHidden);
  const photoCount = (key: string) =>
    formId ? photosFor(uploads, formId, date ?? '', key).length : 0;
  const server = useSubmission(profile?.user_id, formId, date ?? '');

  // answers to show: draft > outbox > server
  const serverAnswers = useMemo<Answers | null>(() => {
    if (!server.data) return null;
    const byId = new Map(questions.map((q) => [q.id, q]));
    const out: Answers = {};
    for (const a of server.data.answers ?? []) {
      const q = byId.get(a.question_id);
      if (!q) continue;
      out[q.key] =
        a.value_bool ??
        (a.value_number !== null ? Number(a.value_number) : null) ??
        a.value_text ??
        (a.value_json as never) ??
        null;
    }
    return out;
  }, [server.data, questions]);

  const mode: 'draft' | 'sent' | 'empty' = draft
    ? 'draft'
    : outboxItem || serverAnswers
      ? 'sent'
      : 'empty';
  const answers: Answers =
    draft?.answers ?? (outboxItem?.answers as Answers | undefined) ?? serverAnswers ?? {};
  const visible = visibleQuestions(questions, answers);
  const screens = buildScreens(questions, answers);
  const screenIndexOf = (q: Question) =>
    screens.findIndex((s) => screenQuestions(s, visible).some((x) => x.key === q.key));

  if (!date) return null;
  const editable = isEditable(date, tz);
  const deadlineLocal = localHHmm(editDeadline(date, tz), tz);
  const lateNow = !editable && mode === 'draft';

  const send = () => {
    if (!formId || !draft) return;
    const pruned = pruneAnswers(questions, draft.answers);
    // photos ride separately: record how many were attached, drop any for questions now hidden
    for (const q of visible)
      if (q.type === 'photo')
        pruned[q.key] = {
          photos: photosFor(uploads, formId, date, q.key).map((p) => p.id),
        } as never;
    pruneHidden(
      formId,
      date,
      visible.map((q) => q.key),
    );
    enqueue(formId, date, pruned); // persisted before the draft goes
    clearDraft(formId, date);
    router.replace(`/report/${date}/sent`);
  };
  const edit = () => {
    if (!formId) return;
    startDraft(formId, date, {
      answers,
      editingSubmissionId: server.data?.id ?? outboxItem?.serverId ?? null,
    });
    router.push(`/report/${date}`);
  };

  const state: { chip: ChipKind; label: string } | null = (() => {
    if (mode !== 'sent') return null;
    if (outboxItem?.status === 'failed') return { chip: 'failed', label: t('sent.chip.failed') };
    if (outboxItem && (outboxItem.status === 'queued' || outboxItem.status === 'sending'))
      return { chip: 'syncing', label: t('sent.chip.queued') };
    const st = server.data?.status ?? outboxItem?.serverStatus;
    const late = server.data?.is_late ?? outboxItem?.isLate ?? false;
    if (st === 'excused') return { chip: 'dayoff', label: t('sent.chip.dayOff') };
    return late
      ? { chip: 'late', label: t('sent.chip.late') }
      : { chip: 'filed', label: t('sent.chip.filed') };
  })();

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.header}>
        <Text style={s.kicker}>{mode === 'draft' ? t('review.title') : t('review.sentTitle')}</Text>
        <Text style={s.date}>{longDate(date, i18n.language, tz)}</Text>
        {state ? <Chip kind={state.chip} label={state.label} /> : null}
      </View>

      <ScrollView contentContainerStyle={s.list}>
        {mode === 'empty' && <Text style={s.empty}>{t('review.nothing')}</Text>}
        {visible.map((q) => (
          <View key={q.key} style={s.row}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.rowLabel}>{questionLabel(q, i18n.language)}</Text>
              <Text style={s.rowValue}>
                {q.type === 'photo'
                  ? t('review.photoCount', { count: photoCount(q.key) })
                  : formatAnswer(q, answers[q.key], t)}
              </Text>
            </View>
            {mode === 'draft' && (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push(`/report/${date}?screen=${Math.max(screenIndexOf(q), 0)}`)
                }
                style={s.editBtn}
              >
                <Text style={s.editText}>{t('review.edit')}</Text>
              </Pressable>
            )}
          </View>
        ))}

        {mode === 'draft' && deriveStatus(answers) === 'excused' && (
          <Text style={s.note}>{t('review.dayOffNote')}</Text>
        )}
        {lateNow && <Text style={[s.note, { color: colors.amber }]}>{t('review.lateNote')}</Text>}
        {outboxItem?.status === 'failed' && (
          <Text style={[s.note, { color: colors.red }]}>
            {t('review.failedNote', { reason: outboxItem.lastError ?? '' })}
          </Text>
        )}
      </ScrollView>

      <View style={s.footer}>
        {mode === 'draft' ? (
          <>
            <Button title={t('review.send')} onPress={send} />
            <Text style={s.caption}>{t('review.caption')}</Text>
          </>
        ) : (
          <>
            {outboxItem?.status === 'failed' && (
              <Button title={t('review.retry')} onPress={() => retryNow(outboxItem.key)} />
            )}
            {editable ? (
              <Button title={t('review.editReport')} variant="secondary" onPress={edit} />
            ) : (
              <Text style={s.caption}>{t('review.closed', { time: deadlineLocal })}</Text>
            )}
            <Button
              title={t('sent.backToToday')}
              variant="ghost"
              onPress={() => router.replace('/today')}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kicker: { ...type.kicker, color: colors.muted },
  date: { fontFamily: fonts.sans700, fontSize: 25, letterSpacing: -0.5, color: colors.text },
  list: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border2,
  },
  rowLabel: { fontFamily: fonts.sans400, fontSize: 12, color: colors.muted },
  rowValue: { fontFamily: fonts.sans600, fontSize: 15, color: colors.text },
  editBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  editText: { fontFamily: fonts.sans600, fontSize: 14, color: colors.accent },
  note: {
    fontFamily: fonts.sans400,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    marginTop: 18,
  },
  empty: { fontFamily: fonts.sans400, fontSize: 15, color: colors.muted, paddingVertical: 24 },
  footer: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12, gap: 12 },
  caption: { fontFamily: fonts.sans400, fontSize: 12, color: colors.muted, textAlign: 'center' },
});
