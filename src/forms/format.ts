// Answers as people read them on the review and history screens.
import type { TFunction } from 'i18next';

import { ABSENCE_PRESETS } from './status';
import type { AnswerValue, Question } from './types';

export function questionLabel(q: Question, lang: string): string {
  return lang === 'lt' ? q.label_lt : q.label_en;
}

export function formatAnswer(q: Question, value: AnswerValue | undefined, t: TFunction): string {
  if (value === undefined || value === null || value === '') return t('review.blank');
  switch (q.type) {
    case 'yes_no':
      return value === true ? t('runner.yes') : t('runner.no');
    case 'rating': {
      const n = Number(value);
      const caption = t(`runner.rating.captions.${n}`, { defaultValue: '' });
      return caption ? `${n} — ${caption.replace(/\.$/, '').toLowerCase()}` : String(n);
    }
    case 'short_text':
    case 'long_text': {
      const s = String(value);
      if (q.key === 'absence_reason' && (ABSENCE_PRESETS as readonly string[]).includes(s)) {
        return t(`runner.dayOff.presets.${s}`);
      }
      return s;
    }
    case 'photo':
    case 'file':
      return t('review.noPhoto');
    default:
      return String(value);
  }
}
