#!/usr/bin/env python3
"""Flatten an Aider benchmark run directory into per-exercise CSV.

The benchmark's aggregate `--stats` gives total cost + pass rate, but arm C
needs per-exercise join (which exercises the cheap model failed). Each exercise
writes a `.aider.results.json`; this walks the run dir and emits:

    exercise,passed,cost_usd

Usage:
  python aider-results-to-csv.py tmp.benchmarks/2026-...--haiku > haiku.csv
  python aider-results-to-csv.py --selfcheck        # runnable check, no Aider needed

Field names (testcase / tests_outcomes / cost) match Aider's results schema at
time of writing — if a run yields empty/odd output, print one .aider.results.json
and adjust the three .get() keys below.
"""
import csv
import json
import os
import sys
import tempfile

RESULTS_FILENAME = ".aider.results.json"


def rows_from_run(run_dir):
    rows = {}
    for dirpath, _dirs, files in os.walk(run_dir):
        if RESULTS_FILENAME not in files:
            continue
        with open(os.path.join(dirpath, RESULTS_FILENAME)) as f:
            j = json.load(f)
        name = j.get("testcase") or os.path.basename(dirpath.rstrip("/"))
        outcomes = j.get("tests_outcomes") or []       # list[bool], one per try
        passed = 1 if (outcomes and outcomes[-1]) else 0
        cost = float(j.get("cost") or 0.0)
        rows[name] = (passed, cost)                     # last write wins on dup
    return rows


def write_csv(rows, out):
    w = csv.writer(out)
    w.writerow(["exercise", "passed", "cost_usd"])
    for name in sorted(rows):
        passed, cost = rows[name]
        w.writerow([name, passed, f"{cost:.6f}"])


def _selfcheck():
    with tempfile.TemporaryDirectory() as d:
        # two fake exercises: one passed on try 2, one failed both tries
        for name, outcomes, cost in [("ex-pass", [False, True], 0.05),
                                     ("ex-fail", [False, False], 0.03)]:
            ex = os.path.join(d, "cpp", name)
            os.makedirs(ex)
            with open(os.path.join(ex, RESULTS_FILENAME), "w") as f:
                json.dump({"testcase": name, "tests_outcomes": outcomes, "cost": cost}, f)
        rows = rows_from_run(d)
        assert rows["ex-pass"] == (1, 0.05), rows
        assert rows["ex-fail"] == (0, 0.03), rows
        print("selfcheck passed", file=sys.stderr)
        write_csv(rows, sys.stdout)


def main(argv):
    if not argv or argv[0] == "--selfcheck":
        _selfcheck()
        return
    rows = rows_from_run(argv[0])
    if not rows:
        print(f"No {RESULTS_FILENAME} found under {argv[0]} — check the path.", file=sys.stderr)
        sys.exit(1)
    write_csv(rows, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
