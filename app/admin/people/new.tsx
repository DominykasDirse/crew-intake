import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { createPerson } from '@/api/admin';
import { supabase } from '@/api/supabase';
import { Body, Button, colors, ErrorText, Field, Screen, Title } from '@/components/ui';
import { deviceTimezone } from '@/i18n';
import { fonts } from '@/theme';

function Pick<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.wrap}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: o.value === value }}
            onPress={() => onChange(o.value)}
            style={[s.chip, o.value === value && s.chipActive]}
          >
            <Text style={s.chipText}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function NewPerson() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: async () =>
      (
        await supabase
          .from('groups')
          .select('id,key,name_en,name_lt')
          .eq('is_active', true)
          .order('sort_order')
      ).data ?? [],
  });
  const tours = useQuery({
    queryKey: ['tours'],
    queryFn: async () =>
      (await supabase.from('tours').select('id,code,name').eq('is_active', true).order('starts_on'))
        .data ?? [],
  });

  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [tourId, setTourId] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(deviceTimezone());
  const [notifyAt, setNotifyAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    first.trim() && last.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && groupId;

  const submit = async () => {
    if (!groupId) return;
    setBusy(true);
    setError(null);
    const r = await createPerson({
      email: email.trim(),
      first_name: first.trim(),
      last_name: last.trim(),
      group_id: groupId,
      tour_id: tourId,
      timezone: timezone.trim() || 'Europe/Vilnius',
      notify_at: /^\d{2}:\d{2}$/.test(notifyAt.trim()) ? notifyAt.trim() : null,
      locale: i18n.language,
    });
    setBusy(false);
    if (!r.ok) {
      setError(
        t(`admin.errors.${r.code}`, {
          defaultValue: t(`errors.${r.code}`, { defaultValue: t('errors.unknown') }),
        }),
      );
      return;
    }
    await qc.invalidateQueries({ queryKey: ['admin', 'people'] });
    router.replace({
      pathname: '/admin/people/[id]',
      params: { id: r.data.user_id, token: r.data.token, url: r.data.invite_url },
    });
  };

  return (
    <Screen>
      <Title>{t('admin.newPerson')}</Title>
      <Field
        label={t('admin.form.firstName')}
        value={first}
        onChangeText={setFirst}
        autoCapitalize="words"
      />
      <Field
        label={t('admin.form.lastName')}
        value={last}
        onChangeText={setLast}
        autoCapitalize="words"
      />
      <Field
        label={t('admin.form.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <Pick
        label={t('admin.form.group')}
        value={groupId}
        onChange={setGroupId}
        options={(groups.data ?? []).map((g) => ({
          value: g.id,
          label: i18n.language === 'lt' ? g.name_lt : g.name_en,
        }))}
      />
      <Pick
        label={t('admin.form.tour')}
        value={tourId ?? 'none'}
        onChange={(v) => setTourId(v === 'none' ? null : v)}
        options={[
          ...(tours.data ?? []).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` })),
          { value: 'none', label: t('admin.noTour') },
        ]}
      />
      <Field
        label={t('admin.form.timezone')}
        value={timezone}
        onChangeText={setTimezone}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label={t('admin.form.notifyAt')}
        value={notifyAt}
        onChangeText={setNotifyAt}
        placeholder="23:30"
        keyboardType="numbers-and-punctuation"
      />
      <ErrorText>{error}</ErrorText>
      <Body muted>{groups.isLoading || tours.isLoading ? t('common.loading') : ''}</Body>
      <Button
        title={busy ? t('admin.form.working') : t('admin.form.create')}
        onPress={() => void submit()}
        disabled={!canSubmit}
        loading={busy}
      />
      <Button title={t('common.cancel')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const s = StyleSheet.create({
  label: { fontFamily: fonts.sans400, color: colors.muted, fontSize: 15 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  chipActive: { borderColor: colors.accent, backgroundColor: '#1e3a8a' },
  chipText: { fontFamily: fonts.sans600, color: colors.text, fontSize: 17 },
});
