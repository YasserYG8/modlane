#!/usr/bin/env python3
"""Evaluate the escalation hypothesis from two Aider benchmark runs.

Inputs: two CSVs, each with columns `exercise,passed,cost_usd` (passed = 0/1).
  - cheap    = Haiku run  (arm B)
  - powerful = Opus run   (arm A)

Arm C (escalation) is computed, not run:
  if cheap passed  -> C passes, cost = cheap cost
  else             -> C = powerful result, cost = cheap cost + powerful cost
  (conservative: models escalation as a restart, not a continued session)

Usage:
  python escalation-eval.py cheap=haiku.csv powerful=opus.csv
Run with no args for a self-check on synthetic data.

Decision thresholds are pre-registered in escalation-hypothesis.md.
"""
import csv
import sys

GO_SUCCESS_RATIO = 0.90   # success(C) >= 0.90 * success(A)
GO_COST_RATIO = 0.60      # cost(C)    <= 0.60 * cost(A)
KILL_COST_RATIO = 0.90    # cost(C)    >= 0.90 * cost(A)  -> just A with overhead
KILL_SUCCESS_MARGIN = 1.02  # success(C) <= success(B)*1.02 -> escalation didn't recover


def load(path):
    """Return {exercise: (passed: bool, cost: float)}."""
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            out[row["exercise"]] = (int(row["passed"]) == 1, float(row["cost_usd"]))
    return out


def evaluate(cheap, powerful):
    exercises = sorted(set(cheap) & set(powerful))
    if not exercises:
        raise SystemExit("No overlapping exercises between the two runs.")

    a_pass = a_cost = 0.0
    b_pass = b_cost = 0.0
    c_pass = c_cost = 0.0
    escalations = 0

    for ex in exercises:
        cp, cc = cheap[ex]
        pp, pc = powerful[ex]
        # Arm A (powerful) and B (cheap)
        a_pass += pp; a_cost += pc
        b_pass += cp; b_cost += cc
        # Arm C (escalation)
        if cp:
            c_pass += 1; c_cost += cc
        else:
            escalations += 1
            c_cost += cc + pc
            if pp:
                c_pass += 1

    n = len(exercises)
    return {
        "n": n,
        "A": {"success": a_pass / n, "cost": a_cost},
        "B": {"success": b_pass / n, "cost": b_cost},
        "C": {"success": c_pass / n, "cost": c_cost, "escalations": escalations},
    }


def verdict(m):
    a, b, c = m["A"], m["B"], m["C"]
    go = c["success"] >= GO_SUCCESS_RATIO * a["success"] and c["cost"] <= GO_COST_RATIO * a["cost"]
    kill = c["cost"] >= KILL_COST_RATIO * a["cost"] or c["success"] <= b["success"] * KILL_SUCCESS_MARGIN
    if go:
        return "GO — escalation matches quality at meaningfully lower cost."
    if kill:
        return "KILL/PIVOT — escalation doesn't recover cheap's misses, or costs ~ always-powerful."
    return "INCONCLUSIVE — widen N or add seeds before deciding."


def report(m):
    print(f"N = {m['n']} exercises\n")
    print(f"{'arm':<24}{'success':>10}{'cost($)':>12}")
    for k, label in [("A", "A always-powerful"), ("B", "B always-cheap"), ("C", "C escalation")]:
        r = m[k]
        print(f"{label:<24}{r['success']*100:>9.1f}%{r['cost']:>12.2f}")
    print(f"\nescalations (C): {m['C']['escalations']}/{m['n']}")
    print(f"cost(C)/cost(A):    {m['C']['cost']/m['A']['cost']:.2f}")
    print(f"success(C)/(A):     {m['C']['success']/m['A']['success']:.2f}" if m["A"]["success"] else "")
    print(f"\nVERDICT: {verdict(m)}")


def _demo():
    # 4 exercises. cheap passes 2 (free); of the 2 it fails, powerful saves both.
    # Escalation should match powerful's success (all 4) at less than full cost.
    cheap = {"e1": (True, 0.01), "e2": (True, 0.01), "e3": (False, 0.01), "e4": (False, 0.01)}
    powerful = {"e1": (True, 0.20), "e2": (True, 0.20), "e3": (True, 0.20), "e4": (True, 0.20)}
    m = evaluate(cheap, powerful)
    assert m["A"]["success"] == 1.0
    assert m["B"]["success"] == 0.5
    assert m["C"]["success"] == 1.0                       # escalation recovers both misses
    assert m["C"]["escalations"] == 2
    # cost(C) = 4*0.01 (all cheap) + 2*0.20 (opus on 2 failures) = 0.44 ; cost(A)=0.80
    assert abs(m["C"]["cost"] - 0.44) < 1e-9
    assert abs(m["A"]["cost"] - 0.80) < 1e-9
    assert verdict(m).startswith("GO")                    # 1.0>=0.9*1.0 and 0.44<=0.6*0.80=0.48
    print("self-check passed\n")
    report(m)


def main(argv):
    if not argv:
        _demo()
        return
    args = dict(a.split("=", 1) for a in argv)
    m = evaluate(load(args["cheap"]), load(args["powerful"]))
    report(m)


if __name__ == "__main__":
    main(sys.argv[1:])
