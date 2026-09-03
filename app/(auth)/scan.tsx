import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Button, colors, Screen } from '@/components/ui';
import { parseInviteToken } from '@/lib/invite';

export default function Scan() {
  const { t } = useTranslation();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <Screen>
        <Body>{t('scan.permission')}</Body>
        <Button title={t('scan.allow')} onPress={() => void requestPermission()} />
        <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={s.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done) return;
          const token = parseInviteToken(data);
          if (!token) {
            setMessage(t('scan.notAnInvite'));
            return;
          }
          setDone(true);
          router.replace(`/claim?token=${token}`);
        }}
      />
      <View style={s.overlay}>
        <Text style={s.hint}>{message ?? t('scan.hint')}</Text>
        <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlay: { position: 'absolute', left: 20, right: 20, bottom: 40, gap: 14 },
  hint: {
    color: colors.text,
    fontSize: 18,
    textAlign: 'center',
    backgroundColor: '#00000099',
    padding: 12,
    borderRadius: 12,
  },
});
