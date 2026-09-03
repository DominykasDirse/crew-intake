import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '@/api/supabase';
import { Body, Screen } from '@/components/ui';

/**
 * Admin gate: asks the SERVER (is_admin() RPC, evaluated under RLS) every time this
 * section mounts. The value cached in the session store only decides whether to show
 * the button; it never grants access. Every admin write is additionally checked
 * server-side by RLS policies or by the Edge Function it goes through.
 */
export default function AdminLayout() {
  const { t } = useTranslation();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase.rpc('is_admin').then(({ data }) => {
      if (!alive) return;
      setAllowed(data === true);
      if (data !== true) router.replace('/today');
    });
    return () => {
      alive = false;
    };
  }, [router]);

  if (allowed !== true) {
    return (
      <Screen>
        <Body muted>{allowed === false ? t('admin.notAdmin') : t('common.loading')}</Body>
      </Screen>
    );
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
