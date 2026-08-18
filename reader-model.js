/* Pure physical-sefer helpers shared by the reader and its regression tests. */
(function exposeDafReaderModel(root) {
  const amudLeaf = key => parseInt(String(key), 10);
  const amudSide = key => /b$/.test(String(key)) ? "right" : "left";

  // Two amudim are the same physical leaf when they are the front and back of
  // one numbered folio. Usually that means the same masechta — but the Meilah
  // volume is continuously paginated across four of them, so Kinnim 25a and
  // Tamid 25b are the two sides of ONE leaf and turning between them is a page
  // turn, not a shift across the fold. Compare the printed volume (`hb`) when
  // the Shas table is loaded; fall back to the masechta name when it is not,
  // which is the right answer for every separately-paginated masechta.
  const volumeOf = masechta => {
    const e = root.DafYomi && root.DafYomi.BYEN && root.DafYomi.BYEN[masechta];
    return e && e.hb != null ? "hb:" + e.hb : "m:" + masechta;
  };

  function samePhysicalLeaf(from, to) {
    return !!from && !!to
      && volumeOf(from.masechta) === volumeOf(to.masechta)
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
