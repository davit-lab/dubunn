import { create } from 'zustand';
import { ASSETS, TRANSLATIONS, TRANSLATIONS_VERSION } from '@/constants';
import type { Language } from '@/types';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';

const ROW_ID = 'main';

export interface ContentStore {
  assets: typeof ASSETS;
  translations: Record<Language, any>;
  isAdmin: boolean;
  passwordRecovery: boolean;
  user: any | null;
  isLoaded: boolean;
  loadError: string | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  retrySave: () => void;
  init: () => void;
  setAuth: (user: any | null, isAdmin: boolean) => void;
  signOut: () => Promise<boolean>;
  updateAssets: (a: Partial<typeof ASSETS>) => void;
  updateTranslation: (lang: Language, path: string, value: any) => void;
  resetToDefault: () => void;
}

function setNested(obj: any, path: string, value: any) {
  const keys = path.split('.');
  const result = JSON.parse(JSON.stringify(obj));
  let cur = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const k: any = isNaN(Number(keys[i])) ? keys[i] : Number(keys[i]);
    if (cur[k] === undefined) cur[k] = {};
    cur = cur[k];
  }
  const last: any = isNaN(Number(keys[keys.length - 1])) ? keys[keys.length - 1] : Number(keys[keys.length - 1]);
  cur[last] = value;
  return result;
}

type Patch = { assets: Record<string, any>; translations: Record<string, any>; reset?: boolean };
let pending: Patch | null = null;
let inFlight = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastApplied = 0;
let latestRemote: any = null;

function normalize(row: any) {
  const translations: any = {};
  for (const lang of ['ka', 'en'] as Language[]) {
    const defaults = TRANSLATIONS[lang];
    const remote = row.translations?.[lang] || {};
    translations[lang] = {
      ...defaults, ...remote,
      ui: { ...defaults.ui, ...remote.ui },
      animators: remote.animators ?? [], hosts: remote.hosts ?? [],
      programs: remote.programs ?? [], services: remote.services ?? [],
    };
  }
  return { assets: { ...ASSETS, ...row.assets }, translations, isLoaded: true, loadError: null };
}

function applyRemote(row: any) {
  if (!row || row.id !== ROW_ID) return;
  if (Date.parse(row.updated_at) < lastApplied) return;
  if (pending || inFlight) {
    if (!latestRemote || Date.parse(row.updated_at) >= Date.parse(latestRemote.updated_at)) latestRemote = row;
    return;
  }
  lastApplied = Date.parse(row.updated_at) || lastApplied;
  useContentStore.setState(normalize(row));
}

function mergePatch(base: any, patch: any): any {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = { ...base };
  for (const key of Object.keys(patch)) result[key] = mergePatch(result[key], patch[key]);
  return result;
}

function translationPatch(updated: any, path: string) {
  const keys = path.split('.');
  const patch: any = {};
  let source = updated, target = patch;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (i === keys.length - 1 || Array.isArray(source[key])) { target[key] = source[key]; break; }
    target[key] = {};
    target = target[key]; source = source[key];
  }
  return patch;
}

function combine(first: Patch | null, second: Patch): Patch {
  if (!first || second.reset) return second;
  return { assets: mergePatch(first.assets, second.assets), translations: mergePatch(first.translations, second.translations), reset: first.reset };
}

async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (inFlight || !pending) return;
  inFlight = true;
  useContentStore.setState({ saveStatus: 'saving', saveError: null });
  const patch = pending;
  pending = null;
  let failed = false;
  try {
    const { data, error } = await (supabase.rpc as any)('patch_site_content', {
      _assets: patch.assets, _translations: patch.translations, _reset: !!patch.reset,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) throw new Error('The database did not confirm this save.');
    if (!latestRemote || Date.parse(row.updated_at) >= Date.parse(latestRemote.updated_at)) latestRemote = row;
  } catch (error: any) {
    pending = pending ? combine(patch, pending) : patch;
    failed = true;
    useContentStore.setState({ saveStatus: 'error', saveError: error?.message || 'Could not save changes. Please retry.' });
  } finally {
    inFlight = false;
  }
  if (failed) return;
  if (pending) { await flushSave(); return; }
  if (latestRemote) { const row = latestRemote; latestRemote = null; applyRemote(row); }
  useContentStore.setState({ saveStatus: 'saved', saveError: null });
}

function queueSave(patch: Patch) {
  pending = combine(pending, patch);
  useContentStore.setState({ saveStatus: 'saving', saveError: null });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flushSave(); }, 350);
}

export const useContentStore = create<ContentStore>((set, get) => ({
  assets: { ...ASSETS },
  translations: JSON.parse(JSON.stringify(TRANSLATIONS)),
  isAdmin: false, passwordRecovery: false, user: null, isLoaded: false, loadError: null,
  saveStatus: 'idle', saveError: null,
  retrySave: () => { void flushSave(); },
  init: () => {
    if (!isSupabaseConfigured) { set({ isLoaded: true }); return; }
    void (async () => {
      try {
        const { data, error } = await supabase.from('site_content').select('id, assets, translations, updated_at').eq('id', ROW_ID).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Site content is missing.');
        applyRemote(data);
      } catch (error: any) {
        set({ loadError: error?.message || 'Could not load site content.' });
      }
    })();
    supabase.channel('site_content_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_content', filter: 'id=eq.main' }, payload => applyRemote(payload.new))
      .subscribe();
    // Auth bootstrap — skip redundant updates that can cause UI flicker
    const applySession = (u: { id: string } | null) => {
      const prev = get().user;
      if (prev?.id === u?.id) return;
      set({ user: u });
      if (u) {
        setTimeout(async () => {
          const { data } = await supabase.from('user_roles').select('role').eq('user_id', u.id).eq('role', 'admin').maybeSingle();
          set({ isAdmin: !!data });
        }, 0);
      } else {
        set({ isAdmin: false });
      }
    };

    supabase.auth.onAuthStateChange((_e, session) => {
      if (_e === 'PASSWORD_RECOVERY') set({ passwordRecovery: true });
      if (_e === 'SIGNED_OUT') set({ passwordRecovery: false });
      applySession(session?.user ?? null);
    });
    supabase.auth.getSession().then(async ({ data }) => {
      applySession(data.session?.user ?? null);
    });
  },
  setAuth: (user, isAdmin) => set({ user, isAdmin }),
  signOut: async () => {
    if (pending || inFlight) {
      await flushSave();
      if (pending || inFlight) return false;
    }
    const { error } = await supabase.auth.signOut();
    if (error) return false;
    set({ user: null, isAdmin: false });
    return true;
  },
  updateAssets: (newA) => {
    if (!get().isAdmin || !get().isLoaded) return;
    set({ assets: { ...get().assets, ...newA } });
    queueSave({ assets: newA, translations: {} });
  },
  updateTranslation: (lang, path, value) => {
    if (!get().isAdmin || !get().isLoaded) return;
    const updated = setNested(get().translations[lang], path, value);
    set({ translations: { ...get().translations, [lang]: updated } });
    queueSave({ assets: {}, translations: { [lang]: translationPatch(updated, path) } });
  },
  resetToDefault: () => {
    if (!get().isAdmin || !get().isLoaded) return;
    const assets = structuredClone(ASSETS);
    const translations = structuredClone(TRANSLATIONS);
    set({ assets, translations });
    queueSave({ assets, translations: { ...translations, _version: TRANSLATIONS_VERSION }, reset: true });
  },
}));

let contentStoreInitialized = false;
if (typeof window !== 'undefined' && !contentStoreInitialized) {
  contentStoreInitialized = true;
  useContentStore.getState().init();
  window.addEventListener('beforeunload', event => {
    if (pending || inFlight) { event.preventDefault(); event.returnValue = ''; }
  });
}
