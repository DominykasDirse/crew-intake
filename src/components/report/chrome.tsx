// Runner and home chrome: progress header, next bar, status chip, seven-day strip, tab bar.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarIcon, ChevronLeft, HistoryIcon, SettingsIcon } from '@/components/icons';
import { Button } from '@/components/ui';
import { colors, fonts, radius } from '@/theme';

export function ProgressHeader({
  index,
  total,
  onBack,
}: {
  index: number;
  total: number;
  onBack: () => void;
}) {
  const pct = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  return (
    <View style={s.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        hitSlop={8}
        style={s.back}
      >
        <ChevronLeft size={22} />
      </Pressable>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={s.count}>
        {index + 1}/{total}
      </Text>
    </View>
  );
}

export function NextBar({
  label,
  onNext,
  enabled,
  skipLabel,
  onSkip,
}: {
  label: string;
  onNext: () => void;
  enabled: boolean;
  skipLabel?: string;
  onSkip?: () => void;
}) {
  return (
    <View style={s.nextBar}>
      <Button title={label} onPress={onNext} disabled={!enabled} />
      {onSkip && skipLabel ? (
        <Button title={skipLabel} variant="ghost" onPress={onSkip} />
      ) : (
        <View style={{ height: 0 }} />
      )}
    </View>
  );
}

export type ChipKind = 'due' | 'filed' | 'late' | 'dayoff' | 'missed' | 'syncing' | 'failed';
const chipStyles: Record<ChipKind, { bg: string; fg: string; border?: string; dashed?: boolean }> =
  {
    due: { bg: colors.bg, fg: colors.accent },
    filed: { bg: colors.filedBg, fg: colors.green, border: colors.filedBorder },
    late: { bg: colors.lateBg, fg: colors.amber, border: colors.lateBorder },
    dayoff: { bg: colors.panel, fg: colors.muted, border: colors.dashed, dashed: true },
    missed: { bg: colors.missedBg, fg: colors.red, border: colors.missedBorder },
    syncing: { bg: colors.disabledBg, fg: colors.text2, border: colors.border },
    failed: { bg: colors.missedBg, fg: colors.red, border: colors.red },
  };
export function Chip({ kind, label }: { kind: ChipKind; label: string }) {
  const c = chipStyles[kind];
  return (
    <View
      style={[
        s.chip,
        { backgroundColor: c.bg },
        c.border
          ? { borderWidth: 1, borderColor: c.border, borderStyle: c.dashed ? 'dashed' : 'solid' }
          : null,
      ]}
    >
      <Text style={[s.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/** Home only ever shows filed and day off; late reads as filed and missed as empty (never red at 23:40). */
export type StripStatus =
  'filed' | 'late' | 'excused' | 'missed' | 'pending' | 'not_assigned' | 'unknown';
export function SevenDayStrip({
  days,
  height = 38,
  panel,
}: {
  days: StripStatus[];
  height?: number;
  panel?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {days.map((d, i) => {
        const filed = d === 'filed' || d === 'late';
        const dayOff = d === 'excused';
        return (
          <View
            key={i}
            style={[
              { flex: 1, height, borderRadius: radius.chip },
              filed && { backgroundColor: colors.accent },
              dayOff && {
                backgroundColor: panel ? colors.panel : colors.card,
                borderWidth: 1,
                borderColor: colors.dashed,
                borderStyle: 'dashed',
              },
              !filed &&
                !dayOff && {
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border2,
                },
            ]}
          />
        );
      })}
    </View>
  );
}

export function StripLegend({ filed, dayOff }: { filed: string; dayOff: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 16 }}>
      <View style={s.legendItem}>
        <View style={{ width: 9, height: 9, backgroundColor: colors.accent }} />
        <Text style={s.legendText}>{filed}</Text>
      </View>
      <View style={s.legendItem}>
        <View
          style={{
            width: 9,
            height: 9,
            borderWidth: 1,
            borderColor: colors.dashed,
            borderStyle: 'dashed',
          }}
        />
        <Text style={s.legendText}>{dayOff}</Text>
      </View>
    </View>
  );
}

const TAB_ICONS = { today: CalendarIcon, history: HistoryIcon, settings: SettingsIcon } as const;
/** Only what we read from expo-router's tab bar props; avoids depending on the navigation types package directly. */
type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: { navigate: (name: string) => void };
};
export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.tabBar, { paddingBottom: Math.max(insets.bottom, 14) + 12 }]}>
      {state.routes.map((route, i) => {
        const on = state.index === i;
        const Icon = TAB_ICONS[route.name as keyof typeof TAB_ICONS] ?? CalendarIcon;
        const label = descriptors[route.key]?.options.title ?? route.name;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => navigation.navigate(route.name)}
            style={s.tab}
          >
            <Icon size={20} color={on ? colors.accent : colors.muted} />
            <Text style={[s.tabLabel, on && { color: colors.accent }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  back: { width: 44, height: 44, marginLeft: -11, alignItems: 'center', justifyContent: 'center' },
  track: {
    flex: 1,
    height: 4,
    backgroundColor: colors.disabledBg,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  count: { fontFamily: fonts.mono, fontSize: 12, color: colors.muted },
  nextBar: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.chip,
    alignSelf: 'flex-start',
  },
  chipText: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '600', letterSpacing: 0.9 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 11, color: colors.muted },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.panel,
    paddingTop: 10,
  },
  tab: { flex: 1, alignItems: 'center', gap: 5, minHeight: 44 },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
  },
});
