// The runner. One screen per decision, built from the published form's questions rows —
// never hardcoded. visible_if drives every reveal; answers persist locally on every change;
// reopening lands on the same screen.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePublishedForm } from '@/api/reports';
import { WarningIcon } from '@/components/icons';
import { NextBar, ProgressHeader } from '@/components/report/chrome';
import { PhotoGrid } from '@/components/report/PhotoGrid';
import {
  ChipChoice,
  NumberField,
  RatingBlocks,
  TextArea,
  YesNo,
} from '@/components/report/controls';
import { buildScreens, type ReportScreen, screenQuestions } from '@/forms/screens';
import { ABSENCE_PRESETS, type AbsencePreset } from '@/forms/status';
import type { Answers, AnswerValue, Question } from '@/forms/types';
import { parseNumber, validateAll, type ValidationError } from '@/forms/validation';
import { byKeyMap, isVisible, visibleQuestions } from '@/forms/visibility';
import { useUploads } from '@/offline/uploadsStore';
import { useLocal } from '@/store/local';
import { useSession } from '@/store/session';
import { colors, fonts, radius, type } from '@/theme';

const ADVANCE_MS = 220;

export default function Runner() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { date, screen: screenParam } = useLocalSearchParams<{ date: string; screen?: string }>();
  const profile = useSession((s) => s.profile);
  const form = usePublishedForm(profile?.group_id);
  const hydrated = useLocal((s) => s.hydrated);

  if (!date) return null;
  if (!hydrated || !form.data) {
    return (
      <SafeAreaView style={s.safe}>
        <Text style={s.muted}>
          {form.error && !form.data ? t('home.noForm') : t('common.loading')}
        </Text>
      </SafeAreaView>
    );
  }
  return (
    <RunnerBody
      jumpTo={screenParam !== undefined ? Number(screenParam) : undefined}
      date={date}
      formId={form.data.form.id}
      questions={form.data.questions}
      lang={i18n.language}
      onExit={() => router.back()}
      onDone={() => router.push(`/report/${date}/review`)}
    />
  );
}

function RunnerBody({
  jumpTo,
  date,
  formId,
  questions,
  lang,
  onExit,
  onDone,
}: {
  jumpTo?: number;
  date: string;
  formId: string;
  questions: Question[];
  lang: string;
  onExit: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const startDraft = useLocal((s) => s.startDraft);
  const setAnswerLocal = useLocal((s) => s.setAnswer);
  const setScreenIndex = useLocal((s) => s.setScreenIndex);
  const draft = useLocal((s) => s.drafts[`${formId}|${date}`]);
  const knownSubmissionId = useUploads((s) => s.knownSubmissions[`${formId}|${date}`] ?? null);

  useEffect(() => {
    startDraft(formId, date);
    if (jumpTo !== undefined && Number.isFinite(jumpTo))
      setScreenIndex(formId, date, Math.max(0, jumpTo));
  }, [startDraft, setScreenIndex, formId, date, jumpTo]);

  const answers: Answers = useMemo(() => draft?.answers ?? {}, [draft?.answers]);
  const screens = useMemo(() => buildScreens(questions, answers), [questions, answers]);
  const byKey = useMemo(() => byKeyMap(questions), [questions]);
  const index = Math.min(draft?.screenIndex ?? 0, Math.max(screens.length - 1, 0));
  const screen = screens[index];
  const [errors, setErrors] = useState<Record<string, ValidationError>>({});
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const label = (q: Question) => (lang === 'lt' ? q.label_lt : q.label_en);
  const setAnswer = (key: string, value: AnswerValue | undefined) => {
    setErrors({});
    setAnswerLocal(formId, date, key, value);
  };

  const goTo = (i: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setErrors({});
    setScreenIndex(formId, date, i);
  };
  const next = (current: ReportScreen, currentAnswers: Answers) => {
    const vis = visibleQuestions(questions, currentAnswers);
    const errs = validateAll(screenQuestions(current, vis), currentAnswers);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    const nextScreens = buildScreens(questions, currentAnswers);
    if (index + 1 < nextScreens.length) goTo(index + 1);
    else onDone();
  };
  const back = () => (index > 0 ? goTo(index - 1) : onExit());
  /** one tap moves on (rating; yes/no when nothing unfolds) */
  const advanceSoon = (current: ReportScreen, nextAnswers: Answers) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => next(current, nextAnswers), ADVANCE_MS);
  };
  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  if (!screen) return null;

  const errText = (q: Question) => {
    const e = errors[q.key];
    if (!e) return null;
    const v = (q.validation ?? {}) as { min?: number; max?: number };
    return t(`runner.errors.${e}`, { min: v.min, max: v.max });
  };

  let content: React.ReactNode;
  let nextEnabled = true;
  let skippable = false;
  let nextLabel = t('runner.next');

  if (screen.kind === 'single') {
    const q = screen.q;
    const v = answers[q.key];
    skippable = !q.is_required;
    if (q.type === 'rating') {
      const n = typeof v === 'number' ? v : null;
      nextEnabled = n !== null;
      content = (
        <View style={s.center}>
          <QuestionHead kicker={t('runner.kind.rating')} text={label(q)} />
          <RatingBlocks
            value={n}
            lowLabel={t('runner.rating.low')}
            highLabel={t('runner.rating.high')}
            onPick={(picked) => {
              const nextAnswers = { ...answers, [q.key]: picked };
              setAnswer(q.key, picked);
              advanceSoon(screen, nextAnswers);
            }}
          />
          <Text style={s.caption}>
            {n ? t(`runner.rating.captions.${n}`) : t('runner.rating.tap')}
          </Text>
          <Text style={s.error}>{errText(q)}</Text>
        </View>
      );
    } else if (q.type === 'yes_no') {
      const b = typeof v === 'boolean' ? v : null;
      nextEnabled = b !== null;
      const shownFollowUps = screen.followUps.filter((f) => isVisible(f, answers, byKey));
      content = (
        <View style={s.top}>
          <QuestionHead kicker={t('runner.kind.yesNo')} text={label(q)} />
          <YesNo
            value={b}
            yesLabel={t('runner.yes')}
            noLabel={t('runner.no')}
            danger={q.opens_issue}
            onPick={(picked) => {
              const nextAnswers = { ...answers, [q.key]: picked };
              setAnswer(q.key, picked);
              const unfolds = screen.followUps.some((f) => isVisible(f, nextAnswers, byKey));
              if (!unfolds) advanceSoon(screen, nextAnswers);
            }}
          />
          <Text style={s.error}>{errText(q)}</Text>
          {shownFollowUps.length > 0 && (
            <View style={s.followBox}>
              {shownFollowUps.map((f) =>
                f.type === 'number' || f.type === 'money' ? (
                  <View key={f.key} style={{ gap: 8 }}>
                    <Text style={s.followLabel}>{label(f)}</Text>
                    <NumberField
                      value={String(answers[f.key] ?? '')}
                      onChange={(txt) =>
                        setAnswer(f.key, txt === '' ? undefined : (parseNumber(txt) ?? txt))
                      }
                    />
                    <Text style={s.error}>{errText(f)}</Text>
                  </View>
                ) : (
                  <View key={f.key}>
                    <TextArea
                      label={label(f)}
                      value={String(answers[f.key] ?? '')}
                      onChange={(txt) => setAnswer(f.key, txt)}
                      placeholder={t('runner.textPlaceholder')}
                    />
                    <Text style={s.error}>{errText(f)}</Text>
                  </View>
                ),
              )}
              {q.opens_issue && b === true && (
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <WarningIcon size={16} />
                  <Text style={s.note}>{t('runner.opensIssue')}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      );
    } else if (q.type === 'number' || q.type === 'money') {
      const vv = (q.validation ?? {}) as { min?: number; max?: number };
      nextEnabled = !q.is_required || (v !== undefined && v !== null && v !== '');
      content = (
        <View style={s.top}>
          <QuestionHead kicker={t('runner.kind.number')} text={label(q)} />
          <NumberField
            value={String(v ?? '')}
            onChange={(txt) => setAnswer(q.key, txt === '' ? undefined : (parseNumber(txt) ?? txt))}
          />
          {vv.min !== undefined || vv.max !== undefined ? (
            <Text style={s.note}>
              {t('runner.range', { min: vv.min ?? '–', max: vv.max ?? '–' })}
            </Text>
          ) : null}
          <Text style={s.error}>{errText(q)}</Text>
        </View>
      );
    } else {
      // short_text / long_text / single_choice / date
      nextEnabled = !q.is_required || String(v ?? '').trim().length > 0;
      content = (
        <View style={s.top}>
          <QuestionHead
            kicker={`${t('runner.kind.text')}${q.is_required ? '' : ` · ${t('runner.optional')}`}`}
            text={label(q)}
          />
          <TextArea
            value={String(v ?? '')}
            onChange={(txt) => setAnswer(q.key, txt)}
            placeholder={t('runner.textPlaceholder')}
            autoFocus
            multiline={q.type === 'long_text'}
          />
          <Text style={s.error}>{errText(q)}</Text>
        </View>
      );
    }
  } else if (screen.kind === 'photo') {
    const q = screen.q;
    skippable = !q.is_required;
    content = (
      <View style={s.top}>
        <QuestionHead
          kicker={`${t('runner.kind.photos')} · ${t('runner.optional')}`}
          text={label(q)}
        />
        <PhotoGrid
          formId={formId}
          reportDate={date}
          questionKey={q.key}
          questionId={q.id}
          submissionId={knownSubmissionId}
        />
      </View>
    );
  } else {
    // day-off: the reason and whatever else is still visible (catering), on one screen
    const reasonQ = screen.questions.find((q) => q.type === 'short_text' || q.type === 'long_text');
    const others = screen.questions.filter((q) => q !== reasonQ);
    const reason = String(answers[reasonQ?.key ?? ''] ?? '');
    const preset: AbsencePreset | null = (ABSENCE_PRESETS as readonly string[]).includes(reason)
      ? (reason as AbsencePreset)
      : reason
        ? 'other'
        : null;
    const [otherText, setOtherText] = [
      preset === 'other' ? reason : '',
      (txt: string) => reasonQ && setAnswer(reasonQ.key, txt),
    ];
    nextLabel = t('runner.submit');
    nextEnabled = others.every(
      (q) => !q.is_required || (answers[q.key] !== undefined && answers[q.key] !== null),
    );
    content = (
      <View style={[s.top, { gap: 24 }]}>
        <View style={s.banner}>
          <View
            style={{
              width: 10,
              height: 10,
              borderWidth: 1,
              borderColor: colors.muted,
              borderStyle: 'dashed',
            }}
          />
          <Text style={{ fontFamily: fonts.sans400, flex: 1, fontSize: 13, color: colors.text2 }}>
            {t('runner.dayOff.banner')}
          </Text>
        </View>
        {reasonQ && (
          <View style={{ gap: 12 }}>
            <Text style={s.questionSm}>{label(reasonQ)}</Text>
            <ChipChoice
              value={preset}
              options={ABSENCE_PRESETS.map((p) => ({
                value: p,
                label: t(`runner.dayOff.presets.${p}`),
              }))}
              onPick={(p) =>
                setAnswer(reasonQ.key, p === 'other' ? (preset === 'other' ? reason : '') : p)
              }
            />
            {preset === 'other' && (
              <TextArea
                value={otherText === 'other' ? '' : otherText}
                onChange={setOtherText}
                placeholder={t('runner.dayOff.otherPlaceholder')}
                multiline={false}
                autoFocus
              />
            )}
            <Text style={s.error}>{errText(reasonQ)}</Text>
          </View>
        )}
        {others.map((q) => (
          <View key={q.key} style={{ gap: 12 }}>
            <View style={s.hr} />
            <Text style={s.questionSm}>{label(q)}</Text>
            {q.type === 'yes_no' ? (
              <YesNo
                value={typeof answers[q.key] === 'boolean' ? (answers[q.key] as boolean) : null}
                yesLabel={t('runner.yes')}
                noLabel={t('runner.no')}
                height={68}
                onPick={(picked) => setAnswer(q.key, picked)}
              />
            ) : (
              <TextArea
                value={String(answers[q.key] ?? '')}
                onChange={(txt) => setAnswer(q.key, txt)}
              />
            )}
            <Text style={s.error}>{errText(q)}</Text>
          </View>
        ))}
        <Text style={s.note}>{t('runner.dayOff.footer')}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ProgressHeader index={index} total={screens.length} onBack={back} />
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {content}
        </ScrollView>
        <NextBar
          label={nextLabel}
          enabled={nextEnabled}
          onNext={() => next(screen, answers)}
          skipLabel={skippable ? t('runner.skip') : undefined}
          onSkip={
            skippable
              ? () => {
                  if (screen.kind === 'single') setAnswer(screen.q.key, undefined);
                  if (screen.kind === 'photo') setAnswer(screen.q.key, undefined);
                  const nextScreens = buildScreens(questions, answers);
                  if (index + 1 < nextScreens.length) goTo(index + 1);
                  else onDone();
                }
              : undefined
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function QuestionHead({ kicker, text }: { kicker: string; text: string }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.kicker}>{kicker}</Text>
      <Text style={s.question}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 20 },
  center: { flex: 1, justifyContent: 'center', gap: 30, minHeight: 420 },
  top: { paddingTop: 40, gap: 26 },
  kicker: { ...type.kicker, color: colors.accent },
  question: { fontFamily: fonts.sans400, ...type.question, color: colors.text },
  questionSm: { fontFamily: fonts.sans400, ...type.questionSm, color: colors.text },
  caption: { fontFamily: fonts.sans400, minHeight: 22, fontSize: 15, color: colors.text2 },
  error: { fontFamily: fonts.sans400, minHeight: 18, fontSize: 14, color: colors.red },
  muted: { color: colors.muted, padding: 20 },
  followBox: { gap: 16, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 22 },
  followLabel: { fontFamily: fonts.sans600, fontSize: 14, color: colors.text2 },
  note: { fontFamily: fonts.sans400, fontSize: 12, lineHeight: 18, color: colors.muted, flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: radius.control,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  hr: { height: 1, backgroundColor: colors.border },
});
