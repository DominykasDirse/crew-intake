import type { PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = {
  bg: '#111111',
  card: '#1c1c1e',
  text: '#f5f5f5',
  muted: '#a1a1aa',
  accent: '#3B82F6',
  danger: '#ef4444',
  border: '#3f3f46',
};

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const Title = ({ children }: PropsWithChildren) => <Text style={s.title}>{children}</Text>;
export const Body = ({ children, muted }: PropsWithChildren<{ muted?: boolean }>) => (
  <Text style={[s.body, muted && s.muted]}>{children}</Text>
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
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.button,
        variant === 'secondary' && s.buttonSecondary,
        variant === 'danger' && s.buttonDanger,
        (disabled || loading) && s.buttonDisabled,
        pressed && s.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={s.buttonText}>{title}</Text>
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
      <TextInput placeholderTextColor={colors.muted} style={s.input} {...input} />
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
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => onChange(o.value)}
          style={[s.choice, o.value === value && s.choiceActive]}
        >
          <Text style={s.choiceText}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, gap: 14, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', marginBottom: 4 },
  body: { color: colors.text, fontSize: 17, lineHeight: 24 },
  muted: { color: colors.muted },
  error: { color: colors.danger, fontSize: 15, marginTop: 4 },
  button: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.danger },
  buttonDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.text, fontSize: 18, fontWeight: '600' },
  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 15 },
  input: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: 14,
  },
  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceActive: { borderColor: colors.accent, backgroundColor: '#1e3a8a' },
  choiceText: { color: colors.text, fontSize: 18, fontWeight: '600' },
});
