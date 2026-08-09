/* Pure physical-sefer helpers shared by the reader and its regression tests. */
(function exposeDafReaderModel(root) {
  const amudLeaf = key => parseInt(String(key), 10);
  const amudSide = key => /b$/.test(String(key)) ? "right" : "left";

  function samePhysicalLeaf(from, to) {
    return !!from && !!to
      && from.masechta === to.masechta
      && amudLeaf(from.amud) === amudLeaf(to.amud)
      && amudSide(from.amud) !== amudSide(to.amud);
  }

  function transitionFor(from, to) {
    const side = amudSide(from.amud);
    const turn = samePhysicalLeaf(from, to);
    return {
      kind: turn ? "turn" : "shift",
      move: turn
        ? (side === "left" ? "turn-r" : "turn-l")
        : (side === "left" ? "spine-left" : "spine-right"),
      outSide: side,
    };
  }

  root.DafReaderModel = Object.freeze({ amudLeaf, amudSide, samePhysicalLeaf, transitionFor });
})(globalThis);
