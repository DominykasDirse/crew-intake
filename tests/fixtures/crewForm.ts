// The crew/daily v1 questions exactly as seeded (forms.seed.json), as `questions` rows.
import type { Question } from '@/forms/types';

let i = 0;
export function q(p: Partial<Question> & { key: string; type: Question['type'] }): Question {
  return {
    id: `q-${p.key}`,
    form_id: 'f-crew',
    order_index: i++,
    label_en: p.key,
    label_lt: p.key,
    help_text: null,
    is_required: false,
    options: null,
    validation: null,
    visible_if: null,
    opens_issue: false,
    created_at: '2026-09-02T00:00:00Z',
    ...p,
  } as Question;
}

const when = (question: string, equals: boolean) => ({ question, equals });

export const crewQuestions: Question[] = [
  q({ key: 'worked_today', type: 'yes_no', is_required: true, label_en: 'Did you work today?' }),
  q({
    key: 'absence_reason',
    type: 'short_text',
    visible_if: when('worked_today', false),
    label_en: 'Why not?',
  }),
  q({
    key: 'overall',
    type: 'rating',
    is_required: true,
    visible_if: when('worked_today', true),
    label_en: 'How would you rate today?',
  }),
  q({ key: 'setup_ok', type: 'yes_no', is_required: true, visible_if: when('worked_today', true) }),
  q({ key: 'setup_note', type: 'short_text', visible_if: when('setup_ok', false) }),
  q({
    key: 'local_crew',
    type: 'rating',
    is_required: true,
    visible_if: when('worked_today', true),
  }),
  q({
    key: 'fault',
    type: 'yes_no',
    is_required: true,
    opens_issue: true,
    visible_if: when('worked_today', true),
  }),
  q({ key: 'fault_note', type: 'short_text', visible_if: when('fault', true) }),
  q({ key: 'fault_photo', type: 'photo', visible_if: when('fault', true) }),
  q({
    key: 'missing',
    type: 'yes_no',
    is_required: true,
    opens_issue: true,
    visible_if: when('worked_today', true),
  }),
  q({ key: 'missing_note', type: 'short_text', visible_if: when('missing', true) }),
  q({
    key: 'catering_ok',
    type: 'yes_no',
    is_required: true,
    label_en: 'Was catering provided for you today?',
  }),
  q({ key: 'notes', type: 'long_text', visible_if: when('worked_today', true) }),
];
