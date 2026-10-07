/* Stall watchdog for the shiur player (open item P4C-10).

   Every fetch already has a deadline (fetchT), but a media stream is a different
   failure: it connects, plays for a while, and then the bytes simply stop. The
   element sits in `waiting` forever — no `error`, no message — and the listener
   sees a frozen clock. This decides WHEN that has gone on long enough to treat
   the connection as dead, and how many times to reconnect before saying so.

   Pure: no DOM, no app state, injectable timers. app.js feeds it the media
   element's events and carries out the actions; tests/stall-model.test.mjs
   drives it with a fake clock.

     starve(pos)   playback is wanted but starved (`waiting` / `stalled`)
     data()        bytes are still arriving (`progress`): slow, not dead
     advance(pos)  the playhead moved (`timeupdate`)
     resume()      playback picked up on its own (`playing`)
     idle()        paused / ended / failed outright — nothing to watch
     reset()       a new shiur, or the listener asked to try again

   When a starve outlasts `stallMs` with no data and no movement, `onStall` is
   called with { action, attempt, at }: "reload" for the first `maxReloads`
   attempts (reconnect at the same spot), then "exhausted" (reloading is not
   working — fall back or stop). Attempts are only forgiven once playback has
   run `clearAfterSec` past the point it first stalled at, so a connection that
   reconnects and immediately dies again cannot loop forever.

   "Movement" means a playback-sized step of the playhead (0 < step <= stepSec).
   A seek is a jump, not progress: the reconnect itself seeks back to where the
   listener was, and that must not read as the stream having recovered. An
   optional isStarved() is consulted when the window ends, so a `stalled` event
   that fired while playback carried on from its buffer is never acted on. */
(function exposeDafStallWatch(root) {
  // 20s with no playhead movement AND no bytes arriving. Ordinary buffering on a
  // phone is a few seconds; a slow-but-working link keeps firing `progress`, which
  // pushes the deadline out, so this only fires on a connection that has gone silent.
  const DEFAULTS = Object.freeze({ stallMs: 20000, maxReloads: 2, clearAfterSec: 10, stepSec: 3 });

  function create(onStall, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const st = o.setTimeout || ((f, ms) => setTimeout(f, ms));
    const ct = o.clearTimeout || (h => clearTimeout(h));
    let timer = null, mark = 0, last = 0, tries = 0, stalledAt = -1;
    const num = v => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0);
    const stop = () => { if (timer !== null) { ct(timer); timer = null; } };
    const start = () => { stop(); timer = st(fire, o.stallMs); };

    function fire() {
      timer = null;
      if (typeof o.isStarved === "function" && !o.isStarved()) return;   // it carried on without telling us — nothing to fix
      tries += 1;
      if (tries === 1) stalledAt = mark;                                   // forgiveness is measured from where the trouble began
      const exhausted = tries > o.maxReloads;
      const ev = { action: exhausted ? "exhausted" : "reload", attempt: tries, at: mark };
      if (exhausted) { tries = 0; stalledAt = -1; }   // whatever the app does next (fallback source, or a listener's ▶) starts fresh
      if (typeof onStall === "function") onStall(ev);
    }

    return {
      starve(pos) {
        pos = num(pos); last = pos;
        if (timer !== null) return;                 // `stalled` repeats every few seconds — it must not restart the window
        if (pos > 0 || !tries) mark = pos;          // a reconnect starts at 0 before it seeks back; keep the episode's spot
        start();
      },
      data() { if (timer !== null) start(); },
      advance(pos) {
        pos = num(pos);
        const step = pos - last; last = pos;
        if (!(step > 0 && step <= o.stepSec)) return;   // a seek, or no movement at all
        if (timer !== null) stop();
        if (tries && stalledAt >= 0 && pos >= stalledAt + o.clearAfterSec) { tries = 0; stalledAt = -1; }
      },
      resume() { stop(); },
      idle() { stop(); },
      reset() { stop(); tries = 0; stalledAt = -1; mark = 0; last = 0; },
      get armed() { return timer !== null; },
      get attempts() { return tries; },
    };
  }

  root.DafStallWatch = Object.freeze({ create, DEFAULTS });
})(typeof window !== "undefined" ? window : globalThis);
