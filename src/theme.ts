// Design tokens from design/Components.dc.html. Hi-vis is the only accent; green, amber
// and red mean state, never decoration. #1B1D16 is a card or control; #16180F a recessed
// panel behind one.
import { Platform } from 'react-native';

export const colors = {
  bg: '#131410',
  card: '#1B1D16',
  panel: '#16180F',
  border: '#2C3025',
  border2: '#22251C',
  dashed: '#3E4333',
  accent: '#C7DB1E',
  accentHover: '#DCEF3B',
  text: '#EDEEE1',
  text2: '#C2C5B3',
  muted: '#8C907F',
  dim: '#5E6252',
  disabledBg: '#22251C',
  green: '#63BC88',
  amber: '#DAA93F',
  red: '#E3765F',
  // status chip backgrounds / borders
  filedBg: '#1E3327',
  filedBorder: '#2C4A38',
  lateBg: '#33290E',
  lateBorder: '#4A3B14',
  missedBg: '#331C18',
  missedBorder: '#4A2822',
  // aliases used by the auth/admin screens
  danger: '#E3765F',
} as const;

// Archivo + JetBrains Mono in the canvas. The app ships the system faces until the
// font packages are approved; swapping is these two lines.
export const fonts = {
  sans: undefined as string | undefined,
  mono: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' }) as string,
};

export const radius = { control: 3, chip: 2, card: 4 } as const;

export const type = {
  display: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.6, lineHeight: 32 },
  question: { fontSize: 27, fontWeight: '600' as const, letterSpacing: -0.5, lineHeight: 32 },
  questionSm: { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.3, lineHeight: 25 },
  answer: { fontSize: 15, fontWeight: '500' as const },
  support: { fontSize: 12, color: colors.muted },
  kicker: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 1.3,
    textTransform: 'uppercase' as const,
  },
};
