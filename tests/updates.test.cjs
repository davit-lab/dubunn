const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ enabled = true, refresh = async () => {} } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const channels = [];
  const removed = [];
  let calls = 0;
  let timerId = 0;
  const events = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const document = { ...events, visibilityState: 'visible' };
  const navigator = { onLine: true };
  const supabase = {
    channel(name) {
      const channel = { name, filters: [], on(_, filter, callback) { this.filters.push(filter); this.change = callback; return this; }, subscribe(callback) { this.status = callback; return this; } };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { removed.push(channel); channel.status('CLOSED'); },
  };
  const source = fs.readFileSync('src/integrations/supabase/updates.ts', 'utf8').replaceAll('import.meta', 'importMeta');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console, document, navigator,
    importMeta: { env: { VITE_SUPABASE_REALTIME_ENABLED: String(enabled) } },
    window: { ...events, setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval(id) { timers.delete(id); } },
    require(name) { assert.equal(name, './client'); return { supabase }; },
  });
  const stop = exports.watchUpdates('test', [{ table: 'site_content', filter: 'id=eq.main' }], async () => { calls++; await refresh(); });
  return { channels, removed, document, navigator, listeners, timers, stop, calls: () => calls, poll: () => { for (const fn of timers.values()) fn(); }, emit: name => listeners.get(name)?.() };
}

test('failed socket stops retries and HTTP keeps refreshing until online reconnects', async () => {
  const h = setup(); await tick();
  assert.equal(h.calls(), 1);
  h.channels[0].status('CHANNEL_ERROR'); await tick();
  assert.equal(h.removed.length, 1);
  assert.equal(h.calls(), 2);
  h.poll(); await tick();
  assert.equal(h.calls(), 3);
  assert.equal(h.channels.length, 1);
  h.emit('online'); await tick();
  assert.equal(h.channels.length, 2);
  h.channels[1].status('SUBSCRIBED'); await tick();
  const calls = h.calls();
  h.poll(); await tick();
  assert.equal(h.calls(), calls);
  h.channels[1].change(); await tick();
  assert.equal(h.calls(), calls + 1);
  h.stop();
});

test('HTTP-only setting opens no socket and skips hidden or offline polls', async () => {
  const h = setup({ enabled: false }); await tick();
  assert.equal(h.channels.length, 0);
  h.document.visibilityState = 'hidden'; h.poll(); await tick();
  assert.equal(h.calls(), 1);
  h.document.visibilityState = 'visible'; h.emit('visibilitychange'); await tick();
  assert.equal(h.calls(), 2);
  h.navigator.onLine = false; h.poll(); await tick();
  assert.equal(h.calls(), 2);
  h.navigator.onLine = true; h.emit('online'); await tick();
  assert.equal(h.calls(), 3);
  assert.equal(h.channels.length, 0);
  h.stop();
});

test('cleanup removes listeners and timers and ignores late channel events', async () => {
  const h = setup(); await tick();
  h.stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.removed.length, 1);
  h.channels[0].status('SUBSCRIBED'); h.channels[0].change(); await tick();
  assert.equal(h.calls(), 1);
});

test('events during a pending read coalesce into one follow-up read', async () => {
  let release;
  const h = setup({ refresh: () => new Promise(resolve => { release = resolve; }) });
  h.channels[0].change(); h.channels[0].change(); h.emit('focus');
  assert.equal(h.calls(), 1);
  release(); await tick();
  assert.equal(h.calls(), 2);
  h.stop(); release(); await tick();
  assert.equal(h.calls(), 2);
});

for (const status of ['TIMED_OUT', 'CLOSED']) {
  test(`${status} uses HTTP fallback`, async () => {
    const h = setup(); await tick();
    h.channels[0].status(status); await tick();
    assert.equal(h.removed.length, 1);
    h.poll(); await tick();
    assert.equal(h.calls(), 3);
    h.stop();
  });
}
