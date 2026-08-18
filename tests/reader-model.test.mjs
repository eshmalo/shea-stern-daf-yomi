import test from "node:test";
import assert from "node:assert/strict";
import "../dafyomi.js";
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

test("equal folio numbers in separately-paginated masechtos are never the same leaf", () => {
  // Chullin and Berachos are different printed volumes; a shared folio number
  // says nothing about the paper.
  assert.equal(samePhysicalLeaf(p("Chullin", "25a"), p("Berachos", "25b")), false);
  assert.equal(transitionFor(p("Chullin", "25a"), p("Berachos", "25b")).kind, "shift");
});

test("across the Kinnim/Tamid boundary one leaf is still one leaf", () => {
  // The Meilah volume is continuously paginated: Kinnim ends on 25a and Tamid
  // opens on 25b, so those are the front and back of a single folio even though
  // they answer to two masechtos. Turning between them must turn the page.
  assert.equal(samePhysicalLeaf(p("Kinnim", "25a"), p("Tamid", "25b")), true);
  assert.equal(transitionFor(p("Kinnim", "25a"), p("Tamid", "25b")).move, "turn-r");
  assert.equal(transitionFor(p("Tamid", "25b"), p("Kinnim", "25a")).move, "turn-l");
  // but the fold between 25b and 26a is still a fold
  assert.equal(samePhysicalLeaf(p("Tamid", "25b"), p("Tamid", "26a")), false);
});
