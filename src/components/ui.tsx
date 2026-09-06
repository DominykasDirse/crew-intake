import type { PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, type } from '@/theme';

export { colors };

export function Screen({ children, padded = true }: PropsWithChildren<{ padded?: boolean }>) {
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={padded ? s.scroll : undefined}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const Title = ({ children }: PropsWithChildren) => <Text style={s.title}>{children}</Text>;
export const Body = ({
  children,
  muted,
  style,
}: PropsWithChildren<{ muted?: boolean; style?: TextStyle }>) => (
  <Text style={[s.body, muted && s.muted, style]}>{children}</Text>
);
export const Kicker = ({ children, accent }: PropsWithChildren<{ accent?: boolean }>) => (
  <Text style={[s.kicker, accent && { color: colors.accent }]}>{children}</Text>
);
/** JetBrains-Mono slot: times, dates, tour codes, counts. */
export const Mono = ({ children, style }: PropsWithChildren<{ style?: TextStyle }>) => (
  <Text style={[s.mono, style]}>{children}</Text>
);
export const ErrorText = ({ children }: PropsWithChildren) =>
  children ? <Text style={s.error}>{children}</Text> : null;

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.button,
        variant === 'secondary' && s.buttonSecondary,
        variant === 'danger' && s.buttonDanger,
        variant === 'ghost' && s.buttonGhost,
        off && variant === 'primary' && s.buttonDisabled,
        off && variant !== 'primary' && { opacity: 0.5 },
        pressed && !off && s.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.bg : colors.text} />
      ) : (
        <Text
          style={[
            s.buttonText,
            variant === 'secondary' && { fontFamily: fonts.sans600, color: colors.text },
            variant === 'ghost' && { fontFamily: fonts.sans500, color: colors.muted, fontSize: 14 },
            off && variant === 'primary' && { color: colors.dim },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.dim} style={s.input} {...input} />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** A row of large mutually exclusive choices, e.g. the language picker. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.choiceRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[s.choice, on && s.choiceActive]}
          >
            <Text style={[s.choiceText, on && { color: colors.bg }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, gap: 14, paddingBottom: 40 },
  title: { fontFamily: fonts.sans400, ...type.display, color: colors.text, marginBottom: 4 },
  body: { fontFamily: fonts.sans400, color: colors.text, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.muted },
  kicker: { fontFamily: fonts.sans400, ...type.kicker, color: colors.muted },
  mono: { fontFamily: fonts.mono400, fontSize: 12, color: colors.muted },
  error: { fontFamily: fonts.sans400, color: colors.red, fontSize: 14, marginTop: 4 },
  button: {
    height: 56,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.red },
  buttonGhost: { backgroundColor: 'transparent', height: 44 },
  buttonDisabled: { backgroundColor: colors.disabledBg },
  pressed: { opacity: 0.85 },
  buttonText: { fontFamily: fonts.sans700, color: colors.bg, fontSize: 16 },
  field: { gap: 6 },
  label: { fontFamily: fonts.sans400, color: colors.muted, fontSize: 14 },
  input: {
    fontFamily: fonts.sans400,
    minHeight: 56,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: 14,
  },
  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    height: 56,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  choiceText: { fontFamily: fonts.sans600, color: colors.text2, fontSize: 17 },
});
