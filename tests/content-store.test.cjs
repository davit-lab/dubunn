const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { create } = require('zustand');

const copy = value => structuredClone(value);
const defaults = { ka: { ui: { title: 'Default' }, animators: [{ id: 'sample', image: 'sample.jpg' }], hosts: [], programs: [], services: [] }, en: { ui: { title: 'Default' }, animators: [{ id: 'sample', image: 'sample.jpg' }], hosts: [], programs: [], services: [] } };
const merge = (base, patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return copy(patch);
  const result = { ...base };
  for (const key of Object.keys(patch)) result[key] = merge(result[key], patch[key]);
  return result;
};
const tick = () => new Promise(resolve => setImmediate(resolve));

async function setup(overrides = {}) {
  let row = { id: 'main', assets: { logo: 'custom.png' }, translations: copy(defaults), updated_at: '2026-10-19T00:00:00Z', ...overrides };
  let revision = 0;
  const calls = [];
  let rpcHandler;
  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: copy(row) }) }) }) }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }) },
    rpc: async (_, args) => {
      calls.push(copy(args));
      if (rpcHandler) { const result = await rpcHandler(args); if (result) return result; }
      if (args._reset) row = { ...row, assets: copy(args._assets), translations: copy(args._translations) };
      else {
        row = { ...row, assets: merge(row.assets, args._assets), translations: copy(row.translations) };
        for (const [lang, patch] of Object.entries(args._translations)) row.translations[lang] = merge(row.translations[lang], patch);
      }
      row.updated_at = new Date(Date.parse('2026-10-19T00:00:00Z') + ++revision * 1000).toISOString();
      return { data: copy(row), error: null };
    },
  };
  const exports = {};
  const source = fs.readFileSync('src/store/contentStore.ts', 'utf8') + '\nexport { applyRemote };';
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, {
    exports, structuredClone, console, Date,
    setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === 'zustand') return { create };
      if (name === '@/constants') return { ASSETS: { logo: 'default.png' }, TRANSLATIONS: copy(defaults), TRANSLATIONS_VERSION: 2 };
      if (name === '@/integrations/supabase/client') return { supabase, isSupabaseConfigured: true };
      throw new Error('Unexpected import: ' + name);
    },
  });
  const store = exports.useContentStore;
  store.getState().init(); await tick();
  store.getState().setAuth({ id: 'admin' }, true);
  return { store, calls, applyRemote: exports.applyRemote, getRow: () => copy(row), handler: fn => { rpcHandler = fn; } };
}

test('loading never writes defaults and keeps database lists authoritative', async () => {
  const translations = copy(defaults);
  translations.en.animators = [{ id: 'sample', name: 'Custom' }];
  translations.ka.animators = [];
  const h = await setup({ translations });
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.store.getState().translations.ka.animators, []);
  assert.equal(h.store.getState().translations.en.animators[0].image, undefined);
  h.applyRemote({ ...h.getRow(), translations: { en: { animators: [] }, ka: {} }, updated_at: '2026-10-20T00:00:00Z' });
  assert.deepEqual(h.store.getState().translations.en.animators, []);
});

test('edits save only changed collections and retain unrelated database data', async () => {
  const h = await setup();
  h.store.getState().updateTranslation('en', 'animators', []);
  h.store.getState().retrySave(); await tick();
  assert.equal(h.store.getState().saveStatus, 'saved');
  assert.deepEqual(h.calls[0]._assets, {});
  assert.deepEqual(h.calls[0]._translations, { en: { animators: [] } });
  assert.equal(h.getRow().assets.logo, 'custom.png');
  assert.equal(h.getRow().translations.ka.ui.title, 'Default');
  assert.deepEqual(h.getRow().translations.en.animators, []);
});

test('delayed saves and realtime echoes cannot replace newer unsaved edits', async () => {
  const h = await setup();
  let release;
  h.handler(() => new Promise(resolve => { release = resolve; }));
  h.store.getState().updateTranslation('en', 'ui.title', 'First');
  h.store.getState().retrySave();
  h.store.getState().updateTranslation('en', 'ui.title', 'Latest');
  h.applyRemote(h.getRow());
  assert.equal(h.store.getState().translations.en.ui.title, 'Latest');
  h.handler(null); release(); await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.getRow().translations.en.ui.title, 'Latest');
  assert.equal(h.store.getState().translations.en.ui.title, 'Latest');
  assert.equal(h.store.getState().saveStatus, 'saved');
  h.applyRemote({ ...h.getRow(), translations: copy(defaults), updated_at: '2026-10-19T00:00:00Z' });
  assert.equal(h.store.getState().translations.en.ui.title, 'Latest');
});

test('failed saves remain unsaved and retry keeps the latest changes', async () => {
  const h = await setup();
  h.handler(async () => ({ error: { message: 'Offline' } }));
  h.store.getState().updateAssets({ logo: 'new.png' });
  h.store.getState().retrySave(); await tick();
  assert.equal(h.store.getState().saveStatus, 'error');
  assert.equal(h.store.getState().saveError, 'Offline');
  assert.equal(h.store.getState().assets.logo, 'new.png');
  h.store.getState().updateTranslation('en', 'ui.title', 'Pending');
  h.handler(null); h.store.getState().retrySave(); await tick();
  assert.equal(h.store.getState().saveStatus, 'saved');
  assert.equal(h.getRow().assets.logo, 'new.png');
  assert.equal(h.getRow().translations.en.ui.title, 'Pending');
});


test('multiple text edits send only those fields without restoring default text', async () => {
  const h = await setup();
  h.store.getState().updateTranslation('en', 'ui.first', 'First');
  h.store.getState().updateTranslation('en', 'ui.second', 'Second');
  h.store.getState().retrySave(); await tick();
  assert.deepEqual(h.calls[0]._translations, { en: { ui: { first: 'First', second: 'Second' } } });
  assert.equal(h.getRow().translations.en.ui.title, 'Default');
});
