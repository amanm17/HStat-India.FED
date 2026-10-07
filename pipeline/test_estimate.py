#!/usr/bin/env python3
"""
Tests for the estimation engine.

Run:  python3 pipeline/test_estimate.py

Deliberately dependency-free and synthetic. These assert the rules in the
method, especially the three that must never bend: a filed value is never
replaced, a never-filed reporter is never invented, and nothing is clamped.
"""

from __future__ import annotations

import sys

from estimate import ANOMALY_BAND, Estimate, cagr, estimate_for, fill, merge

PASS = 0
FAIL: list[str] = []


def ok(name: str, condition: bool, detail: str = "") -> None:
    global PASS

    if condition:
        PASS += 1
        print(f"PASS  {name}")
    else:
        FAIL.append(name)
        print(f"FAIL  {name}{'  — ' + detail if detail else ''}")


def close(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol * max(1.0, abs(b))


# ---------------------------------------------------------------- cagr

ok("cagr doubling over one year is 100%", close(cagr(2000, 100, 2001, 200), 1.0))
ok("cagr flat is zero", close(cagr(2000, 100, 2005, 100), 0.0))
ok("cagr halving over one year is -50%", close(cagr(2000, 200, 2001, 100), -0.5))
ok("cagr refuses a zero start", cagr(2000, 0, 2005, 100) is None)
ok("cagr refuses a negative end", cagr(2000, 100, 2005, -5) is None)
ok("cagr refuses a zero span", cagr(2000, 100, 2000, 200) is None)
# Floating point can round a collapse of eighteen orders of magnitude to
# exactly -100%. The rate is allowed to say that; `estimate_for` is the one
# that must not then raise 0 to a negative power.
ok("a collapse can round to exactly -100%", cagr(2000, 1e9, 2001, 1e-9) == -1.0)
ok(
    "a degenerate rate falls back to flat rather than dying",
    estimate_for({2000: 1e9, 2001: 1e-9}, 1999).method == "flat",
)

# --------------------------------------------------- rule 1: filed wins

history = {2020: 100.0, 2021: 110.0}
ok("a filed year is never estimated", estimate_for(history, 2021) is None)

# ------------------------------------------- rule 3: never-filed refused

ok("an empty history estimates nothing", estimate_for({}, 2020) is None)

# ------------------------------------------------- the forward ladder

steady = {y: 100.0 * (1.1 ** (y - 2016)) for y in range(2016, 2021)}
est = estimate_for(steady, 2021)
ok("a steady 10% series projects forward at 10%", close(est.value, steady[2020] * 1.1, 1e-9), str(est.value))
ok("the five-year window is used first", est.method == "cagr5", est.method)
ok("it is anchored on the last filed year", est.anchor_year == 2020)
ok("it runs forward", est.direction == "forward")
ok("a 10% step is not flagged", not est.flagged)

# Two years out compounds twice, with no cap applied.
far = estimate_for(steady, 2023)
ok("three years out compounds three times", close(far.value, steady[2020] * (1.1 ** 3), 1e-9))
ok("a long extension is not clamped", far.value > steady[2020])

# --------------------------------------------------- the ten-year rung

# Two observations, nine years apart: nothing inside a five-year window.
sparse = {2010: 100.0, 2019: 200.0}
est = estimate_for(sparse, 2020)
ok("a sparse series falls back to the ten-year window", est.method == "cagr10", est.method)
ok("the sparse projection uses both points", est.observations == 2)

# --------------------------------------------------- the all-points rung

# Twenty years apart: outside both windows, so the whole series is used.
wide = {1996: 50.0, 2016: 100.0}
est = estimate_for(wide, 2020)
ok("a very wide series still estimates", est is not None)
ok("it falls through to the whole series", est.method == "cagr-all", est.method if est else "")

# ------------------------------------------------------- rule 4: flat

single = {2015: 42.0}
est = estimate_for(single, 2020)
ok("one observation holds flat", close(est.value, 42.0))
ok("flat records no growth", est.growth is None)
ok("flat is not flagged", not est.flagged)
ok("flat counts one observation", est.observations == 1)

# A series whose endpoints cannot produce a ratio also lands on flat.
zeroed = {2018: 0.0, 2019: 0.0, 2020: 0.0}
est = estimate_for(zeroed, 2021)
ok("an all-zero series holds flat at zero", close(est.value, 0.0))

# ----------------------------------------------------- backward fill

rising = {y: 100.0 * (1.1 ** (y - 2010)) for y in range(2010, 2015)}
back = estimate_for(rising, 2008)
ok("a year before the series runs backward", back.direction == "backward")
ok("backward is anchored on the earliest filing", back.anchor_year == 2010)
ok("backward of a rising series is smaller", back.value < rising[2010], str(back.value))
ok("backward applies the rate in reverse", close(back.value, 100.0 * (1.1 ** -2), 1e-9))

# ------------------------------------------------------ anomaly flag

# A 60% single-year jump is outside the band and must be flagged, not clamped.
steep = {2018: 100.0, 2019: 160.0}
est = estimate_for(steep, 2020)
ok("a steep projection is flagged", est.flagged)
ok("a flagged estimate still has its value", est.value > 160.0)
ok("the flag band is 50%", ANOMALY_BAND == 0.50)

# Exactly at the band edge is not flagged: the band is exclusive, so a
# series growing at a steady 50% does not flag every year of itself.
edge = {2018: 100.0, 2019: 150.0}
est = estimate_for(edge, 2020)
ok("a move of exactly 50% is not flagged", not est.flagged, f"{est.value / 150:.3f}")

# ------------------------------------------------------------- fill

tables = {
    "2018": {"699": ("India", 100.0), "842": ("USA", 500.0)},
    "2019": {"699": ("India", 110.0), "842": ("USA", 550.0)},
    "2020": {"699": ("India", 121.0)},  # USA did not file
}

filled = fill(tables, ["2018", "2019", "2020"])

ok("fill leaves filed years alone", "2018" not in filled and "2019" not in filled)
ok("fill estimates the missing reporter", "842" in filled.get("2020", {}))
ok("fill does not estimate a reporter that filed", "699" not in filled.get("2020", {}))
ok(
    "the estimate follows that reporter's own trend",
    close(filled["2020"]["842"].value, 605.0, 1e-9),
    str(filled["2020"]["842"].value),
)

# A reporter that never filed this code is never conjured.
ok("fill invents no new reporters", set(filled.get("2020", {})) <= {"842"})

# ------------------------------------------------------------ merge

merged, meta = merge(
    tables["2020"],
    filled["2020"],
    {"842": "USA"},
)

ok("merge keeps the filed value exactly", close(merged["699"][1], 121.0))
ok("merge adds the estimated reporter", "842" in merged)
ok("merge counts the estimated reporters", meta["estimatedReporters"] == 1)
ok("merge counts the filed reporters", meta["filedReporters"] == 1)
ok("merge reports the estimated share", close(meta["estimatedShare"], 605.0 / 726.0, 1e-6))

# Rule 1 as code: merging an estimate over a filed reporter is a crash, not a
# silent overwrite.
try:
    merge(tables["2019"], {"699": filled["2020"]["842"]}, {"699": "India"})
    ok("merge refuses to overwrite a filed value", False, "no assertion raised")
except AssertionError:
    ok("merge refuses to overwrite a filed value", True)

# ------------------------------------------- the pre-existence floor

from estimate import first_filed_year

born2022 = {
    "2021": {},
    "2022": {"344": ("Hong Kong", 100.0)},
    "2023": {"344": ("Hong Kong", 400.0)},
}

ok("the floor is the first year anyone filed", first_filed_year(born2022) == 2022)

filled = fill(born2022, ["2021", "2022", "2023"])
ok(
    "no year before the code existed is estimated",
    "2021" not in filled,
    str(sorted(filled)),
)

# Inside the code's own lifetime nothing is limited: a 4x year-on-year series
# still projects, flagged, uncapped.
onward = fill(born2022, ["2024"])
ok("inside its lifetime the series still projects", "2024" in onward)
ok("and is not capped", onward["2024"]["344"].value > 400.0)
ok("and is flagged", onward["2024"]["344"].flagged)

ok("an empty table set has no floor", first_filed_year({}) is None)

# -------------------------------------------------------- determinism

first = estimate_for(steady, 2024)
second = estimate_for(steady, 2024)
ok("estimation is deterministic", first == second)

print(f"\n{PASS}/{PASS + len(FAIL)} passed")

if FAIL:
    print("FAILED:\n  " + "\n  ".join(FAIL))
    sys.exit(1)
