# Experiment — does execution-aware escalation actually pay off?

**Pre-registered.** Thresholds and method are fixed *before* running so results can't be rationalized after the fact. This validates Modlane's one defensible claim before any product code is written.

## Hypothesis

> Starting on a cheap model and escalating to a powerful one **only when failure signals fire** (tests still failing after retries) achieves success comparable to always-powerful, at meaningfully lower cost.

If false → Modlane has no defensible core (the rest is commodity gateway work LiteLLM already does). If true → there is a product.

## Arms

| Arm | Behavior | Role |
|---|---|---|
| **A · always-powerful** | Sonnet 5 on every task | baseline everyone uses |
| **B · always-cheap** | Haiku 4.5 on every task | floor |
| **C · escalation** | Haiku first; if still failing, Sonnet | the hypothesis |

> **Why Sonnet, not Opus, as the "powerful" arm:** the hypothesis needs a real
> cheap↔powerful *gap*, not the absolute strongest model. Haiku↔Sonnet is a
> clean gap, ~5× cheaper to run than Haiku↔Opus, and more representative of real
> routing (FAST→Haiku, POWERFUL→Sonnet is the common case). It also fits a $5
> API budget; Opus×30 alone would blow it.

## Harness & models

- **Harness:** Aider polyglot benchmark (turnkey: real tasks with tests, reports pass/fail + cost per exercise).
- **Cheap:** `anthropic/claude-haiku-4-5-20251001`
- **Powerful:** `anthropic/claude-sonnet-5`
- **Tasks:** N sized to the budget cap (§Budget) — a directional signal, ~15–30 exercises.
- **Retries:** Aider `--tries 2` (feeds test failures back between tries) — this IS the "retry before escalating" loop.

## The cheap trick: arm C is free post-processing

Escalation needs **no code and no Aider patching**. Run two benchmarks (which double as arms A and B), then compute C per exercise:

```
if cheap.passed:   C uses cheap result,  cost = cheap.cost
else:              C uses powerful result, cost = cheap.cost + powerful.cost
```

So: `success(C) = haiku_pass ∪ sonnet_pass`, and `cost(C) = total_haiku_cost + Σ sonnet_cost over haiku failures`.

**Caveat (honest):** this models escalation as *restart on the powerful model*, not *continue the session*. Real escalation would hand the powerful model the cheap model's partial work — likely **cheaper and more successful** than this estimate. So arm C here is a **conservative** proxy: if it clears the bar even as a restart, real escalation clears it by more. If it fails even the conservative bar, the idea is weak.

## Metrics (per task, then aggregated over N)

- **success** — tests pass (binary)
- **cost** — USD (tokens × real price, from Aider)
- **#escalations** = count of cheap failures (arm C)

## Decision criteria (fixed now)

- **GO** if `success(C) ≥ 0.9 × success(A)` **and** `cost(C) ≤ 0.6 × cost(A)`.
- **KILL / pivot** if `success(C) ≲ success(B)` (escalation doesn't recover cheap's misses) **or** `cost(C) ≥ 0.9 × cost(A)` (escalates so often it's just A with overhead).
- Otherwise **INCONCLUSIVE** → widen N or revisit thresholds.

## Run

> Verify exact flags against Aider's current `benchmark/README.md` — the CLI evolves.

```bash
# 1. Aider + benchmark harness (needs Docker + ANTHROPIC_API_KEY)
git clone https://github.com/Aider-AI/aider.git && cd aider
git clone https://github.com/Aider-AI/polyglot-benchmark.git tmp.benchmarks/polyglot-benchmark
./benchmark/docker_build.sh
export ANTHROPIC_API_KEY=...   # not stored in repo

# 2. PILOT (3 exercises each) to measure real cost before committing (§Budget)
./benchmark/docker.sh
./benchmark/benchmark.py son-pilot --model anthropic/claude-sonnet-5              --new --tries 2 --num-tests 3 --threads 3 --exercises-dir polyglot-benchmark
./benchmark/benchmark.py hai-pilot --model anthropic/claude-haiku-4-5-20251001    --new --tries 2 --num-tests 3 --threads 3 --exercises-dir polyglot-benchmark
exit
./benchmark/benchmark.py --stats tmp.benchmarks/*son-pilot   # read total_cost
./benchmark/benchmark.py --stats tmp.benchmarks/*hai-pilot
#   N_max = floor((5 - spent - 1_buffer) / (sonnet_cost_per_task + haiku_cost_per_task))

# 3. Full runs at N = N_max, same exercises, tries=2
./benchmark/docker.sh
./benchmark/benchmark.py haiku  --model anthropic/claude-haiku-4-5-20251001 --new --tries 2 --num-tests <N_max> --threads 4 --exercises-dir polyglot-benchmark
./benchmark/benchmark.py sonnet --model anthropic/claude-sonnet-5           --new --tries 2 --num-tests <N_max> --threads 4 --exercises-dir polyglot-benchmark
exit

# 4. Flatten each run to CSV, then evaluate all three arms + verdict:
python ../experiments/aider-results-to-csv.py tmp.benchmarks/*--haiku  > haiku.csv
python ../experiments/aider-results-to-csv.py tmp.benchmarks/*--sonnet > sonnet.csv
python ../experiments/escalation-eval.py cheap=haiku.csv powerful=sonnet.csv
```

Each Aider run writes per-exercise results (pass/fail + cost) under `tmp.benchmarks/<run>/`. Flatten those to two CSVs with columns `exercise,passed,cost_usd` and feed them to the evaluator.

## Confounds controlled

- Same exercises across arms; same agent/prompts; only the model differs.
- Deterministic-ish: temperature 0 where the harness allows.
- LLM variance is real — if a result sits near a threshold, re-run with 2–3 seeds before deciding.
- Cost from provider usage at real prices, not estimates.

## Budget — hard cap $5

There is no per-run spend limit in the API, so the guardrail is **measure-then-cap**:

1. Run the **3-exercise pilot** for both models. Read `total_cost` from `--stats`.
2. Compute per-task cost: `sonnet_cost/3` and `haiku_cost/3`.
3. `N_max = floor((5 − spent_so_far − 1_buffer) / (sonnet_per_task + haiku_per_task))`.
4. Run the full arms at `--num-tests N_max`. Always keep a **$1 buffer**.

Ballpark (estimates; the pilot is the source of truth): Haiku ≈ $0.01–0.03/task, Sonnet ≈ $0.05–0.15/task. So each task pair ≈ $0.06–0.18 → roughly **20–30 tasks** fit $5 with the buffer. Arm C costs nothing extra (post-processing of the two runs). This is a throwaway validation spend, not product.

## Results (2026-07-10) — VERDICT: KILL (naive escalation), PIVOT

N=14, seeded identical exercise set, Haiku 4.5 vs Sonnet 5, polyglot, tries=2.

| Arm | Success | Cost |
|---|---|---|
| A · always-Sonnet | 64.3% (9/14) | $0.79 |
| B · always-Haiku | 14.3% (2/14) | $0.35 |
| C · escalation | 78.6% (11/14) | $1.04 |

- `cost(C)/cost(A) = 1.31` → escalation costs **31% more** than always-powerful → KILL trigger.
- `success(C)/(A) = 1.22` → escalation was *more* accurate (model-diversity: Haiku solved `bottle-song` and `dominoes`, which Sonnet failed).

**Why it failed:** Haiku fails 86% of these hard tasks → escalation degenerates into "pay Haiku as pure overhead, then pay Sonnet anyway." Escalation only pays when the cheap model clears a meaningful fraction.

**Critical caveat — the benchmark doesn't match Modlane's thesis:** polyglot is 100% hard implementation tasks, 0% trivial. Modlane's value is routing *trivial* steps (reads, search, commits) to cheap models — untested here. So this KILLs "naive failure-escalation on hard tasks," not the whole idea.

**Decision:** pivot, don't abandon. See `../openspec/project.md` → "Pivot — post-validation". Build a classification-first router on LiteLLM that (1) never sends hard tasks to a too-weak model, (2) escalates only the uncertain middle band, (3) measures per-tier success in real sessions so the trivial-task-distribution question gets answered by usage, not assumption.

## What a GO unlocks

Only *then* does the Modlane product plan make sense — and even then, revisit whether the value lives in a **proxy** (current plan) or a **thinner escalation wrapper / agent integration** (§structural weakness). The experiment also reveals if a ~30-line wrapper already captures most of the value, in which case *that* is the MVP.
