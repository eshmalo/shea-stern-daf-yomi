import test from "node:test";
import assert from "node:assert/strict";
import "../stall-model.js";

const SW = globalThis.DafStallWatch;

// A fake clock: timers fire only when the test advances time.
function clock() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
    get pending() { return timers.size; },
  };
}
const make = (opts = {}) => {
  const c = clock(), events = [];
  const w = SW.create(e => events.push(e), { setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, ...opts });
  return { c, w, events };
};

test("defaults: 20s window, two reconnects, forgiven after 10s of real playback", () => {
  assert.deepEqual({ ...SW.DEFAULTS }, { stallMs: 20000, maxReloads: 2, clearAfterSec: 10, stepSec: 3 });
});

test("ordinary buffering that recovers on its own never fires", () => {
  const { c, w, events } = make();
  w.starve(312.4);
  c.tick(4000);
  w.resume();                         // `playing`
  c.tick(60000);
  assert.equal(events.length, 0);
  assert.equal(w.armed, false);
});

test("a stream that goes silent mid-shiur asks for a reconnect at the same spot", () => {
  const { c, w, events } = make();
  w.starve(1834.2);
  c.tick(19999);
  assert.equal(events.length, 0);
  c.tick(1);
  assert.deepEqual(events, [{ action: "reload", attempt: 1, at: 1834.2 }]);
  assert.equal(w.armed, false, "the reload's own `waiting` re-arms it");
});

test("bytes still arriving push the deadline out — slow is not dead", () => {
  const { c, w, events } = make();
  w.starve(50);
  for (let i = 0; i < 10; i++) { c.tick(15000); w.data(); }   // 150s of a trickle
  assert.equal(events.length, 0);
  c.tick(20000);                                              // then silence
  assert.equal(events.length, 1);
});

test("data() and advance() do nothing when nothing is starved", () => {
  const { c, w, events } = make();
  w.data(); w.advance(10);
  c.tick(100000);
  assert.equal(c.pending, 0);
  assert.equal(events.length, 0);
});

test("the playhead moving clears a starve; a seek jump or a frozen clock does not", () => {
  const { c, w, events } = make();
  w.starve(100);
  c.tick(5000);
  w.advance(100);                     // timeupdate with no movement
  assert.equal(w.armed, true);
  w.advance(160);                     // a seek forward while starved — a jump, not playback
  assert.equal(w.armed, true);
  w.advance(160.25);                  // a playback-sized step
  assert.equal(w.armed, false);
  c.tick(60000);
  assert.equal(events.length, 0);
});

test("a reconnect's seek back to the listener's spot is not mistaken for recovery", () => {
  const { c, w, events } = make();
  w.starve(1834.2); c.tick(20000);    // attempt 1 -> the app reloads
  w.starve(0);                        // the reload's own `waiting`, before metadata (currentTime 0)
  w.advance(1834.2);                  // loadedmetadata seeks back — a jump
  assert.equal(w.armed, true, "still starved: the watch must stay on");
  c.tick(20000);
  assert.deepEqual(events[1], { action: "reload", attempt: 2, at: 1834.2 }, "the episode keeps its spot");
  assert.equal(w.attempts, 2, "the seek did not forgive anything");
});

test("isStarved() is asked when the window ends — a false alarm is dropped, not counted", () => {
  let starved = false;
  const { c, w, events } = make({ isStarved: () => starved });
  w.starve(40); c.tick(20000);        // `stalled` fired but playback carried on from its buffer
  assert.equal(events.length, 0);
  assert.equal(w.attempts, 0);
  starved = true;
  w.starve(80); c.tick(20000);
  assert.deepEqual(events, [{ action: "reload", attempt: 1, at: 80 }]);
});

test("repeated starve events do not restart the window (`stalled` fires every few seconds)", () => {
  const { c, w, events } = make();
  w.starve(10);
  for (let i = 0; i < 6; i++) { c.tick(3000); w.starve(10); }  // 18s in
  c.tick(2000);
  assert.equal(events.length, 1);
});

test("pause, end, or an outright error stops the watch", () => {
  const { c, w, events } = make();
  w.starve(10); c.tick(10000); w.idle();
  c.tick(60000);
  assert.equal(events.length, 0);
});

test("two reconnects, then exhausted — and exhausted starts the count fresh", () => {
  const { c, w, events } = make();
  for (let i = 0; i < 3; i++) { w.starve(700); c.tick(20000); }
  assert.deepEqual(events.map(e => e.action), ["reload", "reload", "exhausted"]);
  assert.deepEqual(events.map(e => e.attempt), [1, 2, 3]);
  assert.equal(w.attempts, 0, "a fallback source or the listener's ▶ gets the full two reconnects");
  w.starve(700); c.tick(20000);
  assert.equal(events[3].action, "reload");
});

test("a reconnect that plays on for a while is forgiven; one that dies at once is not", () => {
  const { c, w, events } = make();
  w.starve(700); c.tick(20000);                   // attempt 1
  w.resume(); w.advance(701); w.advance(703);     // played 3s, then stalled again
  w.starve(703); c.tick(20000);                   // attempt 2
  assert.equal(events[1].attempt, 2);
  w.resume();
  for (let p = 704; p <= 709; p++) w.advance(p);  // 9s past where the trouble began: not yet
  assert.equal(w.attempts, 2);
  w.advance(710);                                 // 10s past it
  assert.equal(w.attempts, 0);
  w.starve(900); c.tick(20000);
  assert.deepEqual(events[2], { action: "reload", attempt: 1, at: 900 });
});

test("reset() forgets attempts and any pending window (new shiur / listener retry)", () => {
  const { c, w, events } = make();
  w.starve(5); c.tick(20000);
  w.starve(5); c.tick(10000);
  w.reset();
  assert.equal(w.armed, false);
  assert.equal(w.attempts, 0);
  c.tick(60000);
  assert.equal(events.length, 1);
});

test("garbage positions are treated as the start, never NaN", () => {
  const { c, w, events } = make();
  w.starve(NaN); c.tick(20000);
  w.starve(undefined); c.tick(20000);
  w.starve(-3); c.tick(20000);
  assert.deepEqual(events.map(e => e.at), [0, 0, 0]);
});

test("options override the defaults (shorter window for a manual browser check)", () => {
  const { c, w, events } = make({ stallMs: 3000, maxReloads: 0 });
  w.starve(1); c.tick(3000);
  assert.equal(events[0].action, "exhausted");
});
