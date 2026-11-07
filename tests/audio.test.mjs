import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createAudio } = await vite.ssrLoadModule('/src/audio/index.ts');
after(() => vite.close());

test('audio starts off, unlocks in the gesture, and toggles without persistence', async () => {
  let created = 0, resumed = 0, closed = 0;
  class Context {
    state = 'suspended';
    constructor() { created++; }
    resume() { resumed++; this.state = 'running'; return Promise.resolve(); }
    close() { closed++; this.state = 'closed'; return Promise.resolve(); }
  }
  const audio = createAudio({ contextConstructor: Context });
  const changes = [];
  const unsubscribe = audio.subscribe((state) => changes.push(state));
  assert.equal(audio.getState(), 'locked');
  assert.equal(created, 0, 'no device is opened before a gesture');

  const activation = audio.toggle();
  assert.deepEqual([created, resumed], [1, 1], 'resume must happen synchronously in the gesture');
  await activation;
  assert.equal(audio.getState(), 'on');
  await audio.toggle();
  assert.equal(audio.getState(), 'muted');
  await audio.toggle();
  assert.equal(audio.getState(), 'on');
  assert.deepEqual(changes, ['on', 'muted', 'on']);
  assert.deepEqual([created, resumed], [1, 1]);
  unsubscribe();
  audio.dispose();
  assert.equal(closed, 1);
  assert.deepEqual(changes, ['on', 'muted', 'on']);
  assert.equal(createAudio({ contextConstructor: Context }).getState(), 'locked', 'a new session starts off');
});

test('nature and music hooks do not request or play missing assets in any state', async (t) => {
  let created = 0;
  class Context {
    state = 'running';
    constructor() { created++; }
    close() { return Promise.resolve(); }
    resume() { throw new Error('running contexts should not need a resume'); }
  }
  const oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('unexpected network request'); };
  t.after(() => { globalThis.fetch = oldFetch; });
  const audio = createAudio({ contextConstructor: Context });
  const exercise = () => {
    assert.doesNotThrow(() => audio.playNature());
    assert.doesNotThrow(() => audio.playMusic());
    assert.doesNotThrow(() => audio.playNature('/missing/nature.ogg'));
    assert.doesNotThrow(() => audio.playMusic('/missing/music.mp3'));
  };
  exercise();
  assert.equal(created, 0);
  await audio.toggle();
  exercise();
  await audio.toggle();
  exercise();
  audio.dispose();
  exercise();
  assert.equal(requests, 0);
});

test('a missing AudioContext is unavailable and every hook stays safe and silent', async (t) => {
  const descriptors = ['AudioContext', 'webkitAudioContext'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key] of descriptors) Object.defineProperty(globalThis, key, { configurable: true, value: undefined });
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const audio = createAudio();
  assert.equal(audio.getState(), 'unavailable');
  await assert.doesNotReject(audio.toggle());
  assert.doesNotThrow(() => audio.playNature('/missing.ogg'));
  assert.doesNotThrow(() => audio.playMusic('/missing.mp3'));
  audio.dispose();
  await assert.doesNotReject(audio.toggle());
  assert.equal(audio.getState(), 'unavailable');
});

test('the prefixed browser AudioContext is accepted when the standard API is absent', async (t) => {
  const descriptors = ['AudioContext', 'webkitAudioContext'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  class Context {
    state = 'running';
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'webkitAudioContext', { configurable: true, value: Context });
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const audio = createAudio();
  assert.equal(audio.getState(), 'locked');
  await audio.toggle();
  assert.equal(audio.getState(), 'on');
  audio.dispose();
});

test('a rejected or still-suspended resume remains locked and can be retried', async () => {
  let attempts = 0;
  class Context {
    state = 'suspended';
    resume() {
      attempts++;
      if (attempts === 1) return Promise.reject(new Error('blocked'));
      if (attempts === 2) return Promise.resolve();
      this.state = 'running';
      return Promise.resolve();
    }
    close() { return Promise.resolve(); }
  }
  const audio = createAudio({ contextConstructor: Context });
  await assert.doesNotReject(audio.toggle());
  assert.equal(audio.getState(), 'locked');
  await audio.toggle();
  assert.equal(audio.getState(), 'locked');
  await audio.toggle();
  assert.equal(audio.getState(), 'on');
  assert.equal(attempts, 3);
  audio.dispose();
});

test('a failed constructor is a silent, retryable failure', async () => {
  let attempts = 0;
  class Context {
    state = 'running';
    constructor() { if (++attempts === 1) throw new Error('device unavailable'); }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  const audio = createAudio({ contextConstructor: Context });
  await assert.doesNotReject(audio.toggle());
  assert.equal(audio.getState(), 'locked');
  await audio.toggle();
  assert.equal(audio.getState(), 'on');
  audio.dispose();
});

test('muting while activation is pending prevents a late resume from turning sound on', async () => {
  let finish;
  class Context {
    state = 'suspended';
    resume() { return new Promise((resolve) => { finish = () => { this.state = 'running'; resolve(); }; }); }
    close() { return Promise.resolve(); }
  }
  const audio = createAudio({ contextConstructor: Context });
  const activation = audio.toggle();
  await audio.toggle();
  assert.equal(audio.getState(), 'muted');
  finish();
  await activation;
  assert.equal(audio.getState(), 'muted');
  await audio.toggle();
  assert.equal(audio.getState(), 'on');
  audio.dispose();
});

test('disposing invalidates a pending activation and tolerates close failures', async () => {
  let finish, closes = 0;
  class Context {
    state = 'suspended';
    resume() { return new Promise((resolve) => { finish = () => { this.state = 'running'; resolve(); }; }); }
    close() { closes++; return Promise.reject(new Error('already closed')); }
  }
  const audio = createAudio({ contextConstructor: Context });
  const changes = [];
  audio.subscribe((state) => changes.push(state));
  const activation = audio.toggle();
  assert.doesNotThrow(() => audio.dispose());
  finish();
  await activation;
  await audio.toggle();
  audio.dispose();
  assert.equal(audio.getState(), 'unavailable');
  assert.equal(closes, 1);
  assert.deepEqual(changes, ['unavailable']);
});
