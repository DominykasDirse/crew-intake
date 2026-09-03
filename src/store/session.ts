import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase, type Tables } from '@/api/supabase';
import { setLocale } from '@/i18n';
import { isLocale } from '@/lib/locale';

export type Profile = Tables<'profiles'>;

type SessionState = {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  /** From the server (`is_admin()` RPC), never from a local flag. */
  isAdmin: boolean;
  bootstrap: () => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

let started = false;

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  session: null,
  profile: null,
  isAdmin: false,

  bootstrap: () => {
    if (started) return;
    started = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      set({ session: data.session });
      await get().refreshProfile();
      set({ ready: true });
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session });
      void get().refreshProfile();
    });
  },

  refreshProfile: async () => {
    const session = get().session;
    if (!session) {
      set({ profile: null, isAdmin: false });
      return;
    }
    const [{ data: profile }, { data: isAdmin }] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.rpc('is_admin'),
    ]);
    set({ profile: profile ?? null, isAdmin: isAdmin === true });
    if (profile && isLocale(profile.locale)) void setLocale(profile.locale);
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, profile: null, isAdmin: false });
  },
}));
