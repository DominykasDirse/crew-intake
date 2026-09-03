import { Redirect } from 'expo-router';

import { useSession } from '@/store/session';

export default function Index() {
  const session = useSession((s) => s.session);
  return <Redirect href={session ? '/today' : '/welcome'} />;
}
