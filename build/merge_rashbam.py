#!/usr/bin/env python3
"""Restore Rashbam where he occupies the traditional inner margin.

The base commentary export contains Rashi and Tosafos only. In the Vilna page,
Rashi hands the inner stream to Rashbam on Bava Basra 29a and Pesachim 99b.
This focused, deterministic build step keeps the printed transition pages,
preserves Tosafos, and fills the ensuing Rashbam pages from local KHK exports.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


TAG_RE = re.compile(r"<[^>]+>")
LINE_RE = re.compile(r"^Line \d+$")
DAF_RE = re.compile(r"(Daf \d+[ab])")
BAVA_TRANSITION_RE = re.compile(r"(\[עד כאן פירוש רש[״\"]י[^\]]*\])")
PESACHIM_TRANSITION = "פירוש רבינו שמואל הרשב״ם ז״ל"


def daf_order(amud: str) -> tuple[int, int]:
    match = re.match(r"(\d+)([ab])$", amud)
    if not match:
        raise ValueError(f"Unexpected amud key: {amud}")
    return int(match.group(1)), 0 if match.group(2) == "a" else 1


def parse_commentary(path: Path) -> dict[str, list[str]]:
    parts = DAF_RE.split(path.read_text(encoding="utf-8", errors="replace"))
    out: dict[str, list[str]] = {}
    for index in range(1, len(parts), 2):
        amud = parts[index].removeprefix("Daf ").strip()
        body = parts[index + 1] if index + 1 < len(parts) else ""
        comments = []
        for raw in body.splitlines():
            text = TAG_RE.sub("", raw).strip()
            if text and not LINE_RE.fullmatch(text):
                comments.append(text)
        if comments:
            out[amud] = comments
    return out


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, data: dict) -> None:
    ordered = dict(sorted(data.items(), key=lambda item: daf_order(item[0])))
    path.write_text(json.dumps(ordered, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def merge_bava_basra(source: Path, target: Path) -> int:
    data, rashbam = load(target), parse_commentary(source)
    coverage = [amud for amud in rashbam if daf_order(amud) >= daf_order("29a")]
    if len(coverage) != 296 or min(coverage, key=daf_order) != "29a" or max(coverage, key=daf_order) != "176b":
        raise ValueError(f"Unexpected Bava Basra Rashbam coverage: {len(coverage)} populated amudim")

    page = data.setdefault("29a", {"r": [], "t": []})
    original_rashi = [comment for comment in page.get("r", []) if comment not in rashbam["29a"]]
    split: list[str] = []
    found = False
    for comment in original_rashi:
        parts = BAVA_TRANSITION_RE.split(comment)
        found = found or len(parts) > 1
        # The source's closing colon belongs to the bracketed notice, not a
        # standalone commentary entry after it.
        split.extend(part for part in parts if part.strip(" :"))
    if not found:
        raise ValueError("Bava Basra 29a is missing its Rashi-to-Rashbam notice")
    page["r"] = split + rashbam["29a"]
    page["rl"] = "רש״י · רשב״ם"

    for amud in sorted((a for a in coverage if daf_order(a) > daf_order("29a")), key=daf_order):
        page = data.setdefault(amud, {"r": [], "t": []})
        if page.get("r") and page["r"] != rashbam[amud]:
            raise ValueError(f"Refusing to overwrite a populated Bava Basra inner stream on {amud}")
        page["r"], page["rl"] = rashbam[amud], "רשב״ם"

    write(target, data)
    return len(coverage)


def merge_pesachim(source: Path, target: Path) -> int:
    data, rashbam = load(target), parse_commentary(source)
    coverage = [amud for amud in rashbam if daf_order("99b") <= daf_order(amud) <= daf_order("121a")]
    if len(coverage) != 44 or min(coverage, key=daf_order) != "99b" or max(coverage, key=daf_order) != "121a":
        raise ValueError(f"Unexpected Pesachim Rashbam coverage: {len(coverage)} populated amudim")

    page = data.setdefault("99b", {"r": [], "t": []})
    original_rashi = [comment for comment in page.get("r", []) if comment not in rashbam["99b"] and comment != PESACHIM_TRANSITION]
    page["r"] = original_rashi + [PESACHIM_TRANSITION] + rashbam["99b"]
    page["rl"] = "רש״י · רשב״ם"

    for amud in sorted((a for a in coverage if daf_order(a) > daf_order("99b")), key=daf_order):
        page = data.setdefault(amud, {"r": [], "t": []})
        page["r"], page["rl"] = rashbam[amud], "רשב״ם"

    write(target, data)
    return len(coverage)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bava-rashbam", type=Path, required=True, help="KHK merged.txt for Rashbam on Bava Batra")
    parser.add_argument("--pesachim-rashbam", type=Path, required=True, help="KHK merged.txt for Rashbam on Pesachim")
    parser.add_argument("--bava-target", type=Path, default=Path("data/daf/Bava_Basra.comm.json"))
    parser.add_argument("--pesachim-target", type=Path, default=Path("data/daf/Pesachim.comm.json"))
    args = parser.parse_args()

    bava_count = merge_bava_basra(args.bava_rashbam, args.bava_target)
    pesachim_count = merge_pesachim(args.pesachim_rashbam, args.pesachim_target)
    print(f"Merged traditional Rashbam: Bava Basra {bava_count} amudim; Pesachim {pesachim_count} amudim")


if __name__ == "__main__":
    main()
