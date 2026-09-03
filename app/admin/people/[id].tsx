import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { getPerson, inviteState, mintInvite, revokeInvite } from '@/api/admin';
import { Body, Button, colors, ErrorText, Screen, Title } from '@/components/ui';
import { inviteUrl } from '@/lib/invite';

export default function Person() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string; token?: string; url?: string }>();
  const id = params.id;

  const person = useQuery({
    queryKey: ['admin', 'person', id],
    queryFn: () => getPerson(id),
    enabled: !!id,
  });
  // A freshly minted link is shown once and held only in memory on this screen.
  const [link, setLink] = useState<string | null>(
    params.url ?? (params.token ? inviteUrl(params.token) : null),
  );
  const [showQr, setShowQr] = useState(!!params.token);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'person', id] });
    await qc.invalidateQueries({ queryKey: ['admin', 'people'] });
  };

  const mint = async () => {
    setError(null);
    try {
      const tok = await mintInvite(id);
      setLink(inviteUrl(tok));
      setShowQr(true);
      setNote(t('admin.person.minted'));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const revoke = async () => {
    setError(null);
    try {
      await revokeInvite(id);
      setLink(null);
      setShowQr(false);
      setNote(t('admin.person.revoked'));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const p = person.data;
  const group = p?.group ? (i18n.language === 'lt' ? p.group.name_lt : p.group.name_en) : '—';
  const state = p ? inviteState(p.invites) : null;

  return (
    <Screen>
      {p ? (
        <>
          <Title>
            {p.last_name} {p.first_name}
          </Title>
          <Body muted>
            {group} · {t(`admin.status.${p.status}`)} · {state ? t(`admin.invite.${state}`) : ''}
          </Body>
          <Body muted>
            {p.timezone}
            {p.notify_at ? ` · ${String(p.notify_at).slice(0, 5)}` : ''}
          </Body>
        </>
      ) : (
        <Body muted>{t('common.loading')}</Body>
      )}

      {note && <Body>{note}</Body>}
      <ErrorText>{error}</ErrorText>

      {link && (
        <View style={s.box}>
          <Text style={s.label}>{t('admin.person.linkLabel')}</Text>
          <Text selectable style={s.link}>
            {link}
          </Text>
          <Body muted>{t('admin.person.tokenOnce')}</Body>
          {showQr && (
            <View style={s.qr}>
              <QRCode value={link} size={240} backgroundColor="#ffffff" color="#000000" />
            </View>
          )}
          <Button
            title={t('admin.person.share')}
            variant="secondary"
            onPress={() => void Share.share({ message: link })}
          />
          {!showQr && (
            <Button
              title={t('admin.person.showQr')}
              variant="secondary"
              onPress={() => setShowQr(true)}
            />
          )}
        </View>
      )}

      {p?.status !== 'inactive' && (
        <Button title={t('admin.person.mint')} onPress={() => void mint()} />
      )}
      {state === 'open' && (
        <Button title={t('admin.person.revoke')} variant="danger" onPress={() => void revoke()} />
      )}
      <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const s = StyleSheet.create({
  box: {
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.muted, fontSize: 15 },
  link: { color: colors.text, fontSize: 15, fontFamily: 'monospace' },
  qr: { alignSelf: 'center', padding: 12, backgroundColor: '#ffffff', borderRadius: 12 },
});
