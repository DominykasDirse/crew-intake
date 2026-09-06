import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {
  assignToTour,
  getPerson,
  inviteState,
  listAssignments,
  listTours,
  mintInvite,
  removeAssignment,
  revokeInvite,
} from '@/api/admin';
import { Body, Button, colors, ErrorText, Screen, Title } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { inviteUrl } from '@/lib/invite';
import { fonts } from '@/theme';

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
  const tours = useQuery({ queryKey: ['tours'], queryFn: listTours });
  const assignments = useQuery({
    queryKey: ['admin', 'assignments', id],
    queryFn: () => listAssignments(id),
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
      setError(errorMessage(e));
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
      setError(errorMessage(e));
    }
  };

  const assign = async (tourId: string) => {
    setError(null);
    try {
      await assignToTour(id, tourId);
      await qc.invalidateQueries({ queryKey: ['admin', 'assignments', id] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const unassign = async (assignmentId: string) => {
    setError(null);
    try {
      await removeAssignment(assignmentId);
      await qc.invalidateQueries({ queryKey: ['admin', 'assignments', id] });
    } catch (e) {
      setError(errorMessage(e));
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
      <View style={s.box}>
        <Text style={s.label}>{t('admin.person.tours')}</Text>
        {(assignments.data ?? []).map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[s.link, { flex: 1 }]}>
              {a.tour?.code} · {a.starts_on} → {a.ends_on}
            </Text>
            <Button
              title={t('admin.person.unassign')}
              variant="secondary"
              onPress={() => void unassign(a.id)}
            />
          </View>
        ))}
        {(tours.data ?? [])
          .filter((tr) => !(assignments.data ?? []).some((a) => a.tour?.id === tr.id))
          .map((tr) => (
            <Button
              key={tr.id}
              title={t('admin.person.assignTo', { tour: `${tr.code} ${tr.name}` })}
              variant="secondary"
              onPress={() => void assign(tr.id)}
            />
          ))}
      </View>

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
  label: { fontFamily: fonts.sans400, color: colors.muted, fontSize: 15 },
  link: { fontFamily: fonts.sans400, color: colors.text, fontSize: 15 },
  qr: { alignSelf: 'center', padding: 12, backgroundColor: '#ffffff', borderRadius: 12 },
});
