// The controls someone touches every night. Rating and yes/no match the canvas exactly:
// 88 px blocks, one thumb, one tap moves on; 76 px yes/no, red on yes only where yes means
// a problem.
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fonts, radius } from '@/theme';

export function RatingBlocks({
  value,
  onPick,
  lowLabel,
  highLabel,
}: {
  value: number | null;
  onPick: (n: number) => void;
  lowLabel: string;
  highLabel: string;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={String(n)}
              accessibilityState={{ selected: on }}
              onPress={() => onPick(n)}
              style={[s.block, on && s.blockOn]}
            >
              <Text style={[s.blockText, on && { color: colors.bg }]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={s.small}>{lowLabel}</Text>
        <Text style={s.small}>{highLabel}</Text>
      </View>
    </View>
  );
}

export function YesNo({
  value,
  onPick,
  yesLabel,
  noLabel,
  danger,
  height = 76,
}: {
  value: boolean | null;
  onPick: (v: boolean) => void;
  yesLabel: string;
  noLabel: string;
  /** yes means a problem (opens_issue): red when picked */
  danger?: boolean;
  height?: number;
}) {
  const btn = (v: boolean, label: string) => {
    const on = value === v;
    const bg = on ? (v && danger ? colors.red : colors.accent) : colors.card;
    return (
      <Pressable
        key={String(v)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        onPress={() => onPick(v)}
        style={[s.yn, { height, backgroundColor: bg, borderColor: on ? bg : colors.border }]}
      >
        <Text style={[s.ynText, { fontSize: height >= 76 ? 19 : 18 }, on && { color: colors.bg }]}>
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {[btn(false, noLabel), btn(true, yesLabel)]}
    </View>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  multiline = true,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={s.followLabel}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        multiline={multiline}
        autoFocus={autoFocus}
        textAlignVertical="top"
        style={[s.textarea, !multiline && { minHeight: 56 }]}
      />
    </View>
  );
}

export function NumberField({
  value,
  onChange,
  unit,
}: {
  value: string;
  onChange: (t: string) => void;
  unit?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        autoFocus
        style={[s.textarea, s.number]}
        placeholder="0"
        placeholderTextColor={colors.dim}
      />
      {unit ? <Text style={s.unit}>{unit}</Text> : null}
    </View>
  );
}

export function ChipChoice<T extends string>({
  options,
  value,
  onPick,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onPick: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onPick(o.value)}
            style={[s.chip, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}
          >
            <Text style={[s.chipText, on && { color: colors.bg, fontWeight: '600' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    flex: 1,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  blockOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  blockText: { fontFamily: fonts.mono, fontSize: 22, fontWeight: '600', color: colors.muted },
  small: { fontSize: 12, color: colors.muted },
  yn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
  },
  ynText: { fontWeight: '700', color: colors.text2, fontFamily: fonts.sans },
  followLabel: { fontSize: 14, fontWeight: '600', color: colors.text2 },
  textarea: {
    minHeight: 84,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
    fontSize: 16,
    padding: 14,
    fontFamily: fonts.sans,
  },
  number: { flex: 1, minHeight: 64, fontSize: 28, fontFamily: fonts.mono, textAlign: 'center' },
  unit: { fontSize: 16, color: colors.muted },
  chip: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    minHeight: 48,
    borderRadius: radius.control,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipText: { fontSize: 15, fontWeight: '500', color: colors.text2 },
});
