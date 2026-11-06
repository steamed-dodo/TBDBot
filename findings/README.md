# Findings

Bug ledger for TBDBot. One file per finding, named `F-<id>.md`, managed by the
project agents in `.opencode/agents/`:

- `bug-hunter` finds defects and writes candidates.
- `bug-validator` independently reproduces them and confirms or rejects.
- `bug-fixer` fixes confirmed findings only.

## Status

| Status | Meaning | Set by |
| --- | --- | --- |
| `candidate` | Reported, not yet verified | bug-hunter |
| `confirmed` | Reproduced independently | bug-validator |
| `rejected` | Not a bug, not reproducible, or intentional | bug-validator |
| `fixed` | Fix landed and tests pass | bug-fixer |
| `blocked` | Confirmed, but the fix needs a decision | bug-fixer |

Only `bug-validator` may set `confirmed` or `rejected`. `bug-fixer` only picks up
`confirmed` findings. Nothing is fixed on the strength of a candidate alone.

## Severity

- `critical` — data loss, security issue, or a broken core flow.
- `high` — wrong behavior on a realistic path.
- `medium` — wrong behavior on an edge case.
- `low` — minor inconsistency with a documented contract.

## Template

````md
---
id: F-001
status: candidate
severity: medium
area: cache
found_by: bug-hunter
verified_by:
fix_commit:
---

## Symptom

What goes wrong, in one or two sentences.

## Evidence

`file:line` and the mechanism that produces the wrong behavior.

## Reproduction

Exact inputs and the command that demonstrates it, with expected vs actual.

## Verdict

Validator only: `confirmed` or `rejected`, with the command and observed output,
or the reason for rejection.

## Fix

Fixer only: files changed, regression test, and the commands that were run.
````

## Workflow

```sh
/hunt src/ui src/cache     # parallel hunters, disjoint ID ranges
/verify F-001 F-002        # parallel validators
/fix F-001                 # one fixer, in the current session
/triage src/cache          # hunt + verify, stop before fixing
```

IDs are allocated in blocks by the controller before hunters run, so two
hunters never write the same file. Continue from the highest existing number.

## Concurrency

- Hunters and validators run in parallel; both are read-only outside `findings/`.
- One fixer per working tree. For parallel fixes, use one `git worktree` per
  finding and merge back one at a time.
- A finding may be fixed while another is being verified, but no two agents may
  write the same file.

## Commits

Agents do not commit. When committing the results:

- findings only: `docs(findings): add F-001..F-004 candidates`
- a fix: `fix(<area>): <what changed>`, including the finding status update and
  its regression test.
