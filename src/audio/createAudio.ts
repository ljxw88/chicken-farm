export type AudioState = 'locked' | 'on' | 'muted' | 'unavailable';

type AudioContextHandle = Pick<AudioContext, 'state' | 'resume' | 'close'>;
type AudioContextConstructor = new () => AudioContextHandle;

interface AudioOptions {
  // null explicitly represents an unsupported browser; injection also keeps
  // the state machine independent of a real audio device in tests.
  contextConstructor?: AudioContextConstructor | null;
}

function browserAudioContext(): AudioContextConstructor | undefined {
  const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor };
  const constructor = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
  return typeof constructor === 'function' ? constructor : undefined;
}

export function createAudio({ contextConstructor = browserAudioContext() }: AudioOptions = {}) {
  let state: AudioState = contextConstructor ? 'locked' : 'unavailable';
  let context: AudioContextHandle | undefined;
  let wantsOn = false;
  let revision = 0;
  let disposed = false;
  const listeners = new Set<(state: AudioState) => void>();

  function setState(next: AudioState) {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener(state);
  }

  function subscribe(listener: (state: AudioState) => void) {
    if (!disposed) listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  // Call directly from a user gesture: constructing/resuming before the first
  // await lets browsers apply their autoplay policy to that gesture.
  async function toggle() {
    if (!contextConstructor || disposed) return;
    if (wantsOn) {
      wantsOn = false;
      revision++;
      setState('muted');
      return;
    }

    wantsOn = true;
    const attempt = ++revision;
    try {
      if (!context || context.state === 'closed') context = new contextConstructor();
      const current = context;
      if (current.state !== 'running') await current.resume();
      if (attempt !== revision || disposed) return;
      if (current.state === 'running') setState('on');
      else {
        wantsOn = false;
        setState('locked');
      }
    } catch {
      // A blocked or failed device is retryable and never logs to the console.
      if (attempt === revision && !disposed) {
        wantsOn = false;
        setState('locked');
      }
    }
  }

  // Reserved hooks: there are no bundled assets or playback/network requests.
  // In particular, an absent or nonexistent asset is always a silent no-op.
  function playNature(_asset?: string) {}
  function playMusic(_asset?: string) {}

  function dispose() {
    if (disposed) return;
    disposed = true;
    wantsOn = false;
    revision++;
    setState('unavailable');
    listeners.clear();
    if (context && context.state !== 'closed') {
      try { void context.close().catch(() => {}); } catch { /* already unavailable */ }
    }
    context = undefined;
  }

  return { getState: () => state, subscribe, toggle, playNature, playMusic, dispose };
}

export type AudioController = ReturnType<typeof createAudio>;
