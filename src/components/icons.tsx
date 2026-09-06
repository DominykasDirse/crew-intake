// Line icons from the canvas (24-unit viewBox), drawn with react-native-svg.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '@/theme';

type P = { size?: number; color?: string; strokeWidth?: number };
const base = (p: P) => ({
  width: p.size ?? 20,
  height: p.size ?? 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: p.color ?? colors.muted,
  strokeWidth: p.strokeWidth ?? 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const ChevronLeft = (p: P) => (
  <Svg {...base({ strokeWidth: 2, ...p })}>
    <Path d="M15 18l-6-6 6-6" />
  </Svg>
);
export const ChevronRight = (p: P) => (
  <Svg {...base({ strokeWidth: 2, ...p })}>
    <Path d="M9 18l6-6-6-6" />
  </Svg>
);
export const Check = (p: P) => (
  <Svg {...base({ strokeWidth: 2.4, ...p })}>
    <Path d="M4 12.5l5.5 5.5L20 7" />
  </Svg>
);
export const Clock = (p: P) => (
  <Svg {...base({ strokeWidth: 2, ...p })}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 7v5l3 2" />
  </Svg>
);
export const CalendarIcon = (p: P) => (
  <Svg {...base(p)}>
    <Rect x="3" y="4" width="18" height="17" rx="1" />
    <Path d="M3 9h18M8 2v4M16 2v4" />
  </Svg>
);
export const HistoryIcon = (p: P) => (
  <Svg {...base(p)}>
    <Path d="M3 12a9 9 0 1 0 3-6.7" />
    <Path d="M3 4v5h5" />
    <Path d="M12 8v4l3 2" />
  </Svg>
);
export const SettingsIcon = (p: P) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </Svg>
);
export const CameraIcon = (p: P) => (
  <Svg {...base({ strokeWidth: 1.7, ...p })}>
    <Path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <Circle cx="12" cy="12.5" r="3.5" />
  </Svg>
);
export const WarningIcon = (p: P) => (
  <Svg {...base({ strokeWidth: 2, color: colors.amber, ...p })}>
    <Path d="M12 9v4" />
    <Path d="M12 17h.01" />
    <Path d="M10.3 3.9L2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </Svg>
);
export const FileIcon = (p: P) => (
  <Svg {...base({ strokeWidth: 1.6, ...p })}>
    <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <Path d="M14 3v5h5" />
    <Path d="M9 13h6" />
    <Path d="M9 17h4" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...base({ strokeWidth: 1.7, ...p })}>
    <Path d="M12 6v12" />
    <Path d="M6 12h12" />
  </Svg>
);
