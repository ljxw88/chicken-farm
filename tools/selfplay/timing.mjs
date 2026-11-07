// Test-only scheduler, installed before the app by the parity runner. It batches
// callbacks onto the browser's next rAF and forwards its timestamp unchanged.
// The real-time self-play command does not install or use this scheduler.
export function installHarnessTiming() {
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const callbacks = new Map();
  let nextId = 0, scheduled = null;
  const proof = { frames: 0, reads: 0, timestamps: [], positions: [] };

  function flush(time) {
    scheduled = null;
    const ids = [...callbacks.keys()];
    for (const id of ids) {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      if (callback) callback(time);
    }
    proof.frames++;
    proof.timestamps.push(time);
    if (window.__game) {
      const snapshot = window.__game;
      proof.reads++;
      proof.positions.push([...snapshot.player.position]);
    }
    if (callbacks.size && scheduled === null) scheduled = request(flush);
  }

  window.requestAnimationFrame = (callback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    if (scheduled === null) scheduled = request(flush);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
    if (!callbacks.size && scheduled !== null) {
      cancel(scheduled);
      scheduled = null;
    }
  };
  window.__selfplayTiming = proof;
}
