import test from "node:test";
import assert from "node:assert/strict";
import "../reader-model.js";

const { transitionFor, samePhysicalLeaf } = globalThis.DafReaderModel;
const p = (masechta, amud) => ({ masechta, amud });

test("forward and reverse transitions follow the physical sefer", () => {
  assert.equal(transitionFor(p("Chullin", "94a"), p("Chullin", "94b")).move, "turn-r");
  assert.equal(transitionFor(p("Chullin", "94b"), p("Chullin", "95a")).move, "spine-right");
  assert.equal(transitionFor(p("Chullin", "95a"), p("Chullin", "94b")).move, "spine-left");
  assert.equal(transitionFor(p("Chullin", "94b"), p("Chullin", "94a")).move, "turn-l");
});

test("Tamid opening 25b to 26a is a shift, not a turn", () => {
  assert.equal(transitionFor(p("Tamid", "25b"), p("Tamid", "26a")).kind, "shift");
});

test("equal folio numbers in different masechtos are never the same leaf", () => {
  assert.equal(samePhysicalLeaf(p("Kinnim", "25b"), p("Tamid", "25b")), false);
  assert.equal(transitionFor(p("Kinnim", "25b"), p("Tamid", "25b")).kind, "shift");
});
