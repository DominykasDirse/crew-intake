// Photo tiles for a question (design/PhotoQuestion.dc.html): each photo shows its state
// honestly — queued on the phone, uploading, sent to Storage, on Drive, or failed with a
// retry — plus the dashed Add tile and a no-signal banner.
import { useNetInfo } from '@react-native-community/netinfo';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAttachmentStates } from '@/api/attachments';
import { CameraIcon, Check, PlusIcon, WarningIcon } from '@/components/icons';
import { Button } from '@/components/ui';
import type { UploadItem } from '@/offline/uploads';
import { usePhotosFor, useUploads } from '@/offline/uploadsStore';
import { pickPhoto, takePhoto } from '@/photos/capture';
import { colors, fonts, radius } from '@/theme';

type Props = {
  formId: string;
  reportDate: string;
  questionKey: string;
  questionId: string;
  submissionId?: string | null;
  readOnly?: boolean;
};

export function PhotoGrid({
  formId,
  reportDate,
  questionKey,
  questionId,
  submissionId,
  readOnly,
}: Props) {
  const { t } = useTranslation();
  const net = useNetInfo();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const items = usePhotosFor(formId, reportDate, questionKey);
  const addPhoto = useUploads((s) => s.addPhoto);
  const removePhoto = useUploads((s) => s.removePhoto);
  const retry = useUploads((s) => s.retry);
  const drive = useAttachmentStates(submissionId);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const capture = async (how: 'camera' | 'gallery') => {
    setPicker(false);
    setBusy(true);
    const r = how === 'camera' ? await takePhoto() : await pickPhoto();
    setBusy(false);
    if (r.ok) addPhoto(formId, reportDate, questionKey, questionId, r.photo);
    else if (r.reason === 'permission')
      Alert.alert(t('photo.permissionTitle'), t('photo.permissionBody'));
    else if (r.reason === 'error') Alert.alert(t('errors.unknown'), r.message ?? '');
  };

  const stateOf = (
    it: UploadItem,
  ): {
    kind: 'queued' | 'uploading' | 'stored' | 'drive' | 'driveFailed' | 'failed';
    label: string;
  } => {
    if (it.status === 'failed') return { kind: 'failed', label: t('photo.retry') };
    if (it.status === 'uploading') return { kind: 'uploading', label: t('photo.uploading') };
    if (it.status === 'queued')
      return { kind: 'queued', label: submissionId ? t('photo.queued') : t('photo.waitingReport') };
    const d = it.attachmentId ? drive.data?.[it.attachmentId] : undefined;
    if (d?.sync_status === 'synced') return { kind: 'drive', label: t('photo.onDrive') };
    if (d?.sync_status === 'failed')
      return { kind: 'driveFailed', label: t('photo.driveRetrying') };
    return { kind: 'stored', label: t('photo.sent') };
  };

  return (
    <View style={{ gap: 22 }}>
      <View style={s.grid}>
        {items.map((it) => {
          const st = stateOf(it);
          return (
            <Pressable
              key={it.id}
              accessibilityRole="button"
              accessibilityLabel={`${t('photo.photo')} · ${st.label}`}
              onPress={() => (st.kind === 'failed' ? retry(it.id) : undefined)}
              onLongPress={() =>
                readOnly || it.status === 'stored'
                  ? undefined
                  : Alert.alert(t('photo.removeTitle'), '', [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('photo.remove'),
                        style: 'destructive',
                        onPress: () => removePhoto(it.id),
                      },
                    ])
              }
              style={[s.tile, st.kind === 'failed' && { borderColor: colors.red }]}
            >
              <Image
                source={{ uri: it.localUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
              {st.kind === 'drive' && (
                <View style={s.badgeGreen}>
                  <Check size={13} color={colors.bg} strokeWidth={3.2} />
                </View>
              )}
              {st.kind === 'uploading' && (
                <View style={s.foot}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={s.footMono}>{st.label}</Text>
                </View>
              )}
              {(st.kind === 'queued' || st.kind === 'stored' || st.kind === 'driveFailed') && (
                <View style={s.foot}>
                  <Text style={[s.footMono, st.kind === 'driveFailed' && { color: colors.amber }]}>
                    {st.label}
                  </Text>
                </View>
              )}
              {st.kind === 'failed' && (
                <View style={[s.foot, { backgroundColor: 'rgba(19,20,16,0.85)' }]}>
                  <WarningIcon size={16} color={colors.red} />
                  <Text style={[s.footMono, { color: colors.red }]}>{st.label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
        {!readOnly && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('photo.add')}
            onPress={() => setPicker(true)}
            disabled={busy}
            style={s.addTile}
          >
            {busy ? (
              <ActivityIndicator color={colors.muted} />
            ) : (
              <PlusIcon size={22} color={colors.muted} />
            )}
            <Text style={{ fontFamily: fonts.sans400, fontSize: 11, color: colors.muted }}>
              {t('photo.add')}
            </Text>
          </Pressable>
        )}
      </View>

      {offline && items.some((it) => it.status !== 'stored') && (
        <View style={s.banner}>
          <WarningIcon size={20} color={colors.amber} />
          <Text style={s.bannerText}>{t('photo.noSignal')}</Text>
        </View>
      )}
      <Text style={s.privacy}>{t('runner.photo.privacy')}</Text>

      <Modal
        visible={picker}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setPicker(false)}>
          <View style={s.sheet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <CameraIcon size={20} color={colors.accent} />
              <Text style={s.sheetTitle}>{t('photo.addTitle')}</Text>
            </View>
            <Button title={t('photo.takePhoto')} onPress={() => void capture('camera')} />
            <Button
              title={t('photo.fromGallery')}
              variant="secondary"
              onPress={() => void capture('gallery')}
            />
            <Button title={t('common.cancel')} variant="ghost" onPress={() => setPicker(false)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '31%',
    height: 106,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  addTile: {
    width: '31%',
    height: 106,
    borderRadius: radius.control,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  badgeGreen: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    backgroundColor: 'rgba(19,20,16,0.72)',
  },
  footMono: { fontFamily: fonts.mono400, fontSize: 10, color: colors.accent, letterSpacing: 0.5 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: radius.control,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.sans400,
    fontSize: 13,
    lineHeight: 19,
    color: colors.text2,
  },
  privacy: { fontFamily: fonts.sans400, fontSize: 12, lineHeight: 18, color: colors.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 20,
    paddingBottom: 34,
    gap: 12,
  },
  sheetTitle: { fontFamily: fonts.sans600, fontSize: 17, color: colors.text },
});
