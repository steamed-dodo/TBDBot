---
description: Verify candidate findings independently and record verdicts
agent: build
---

Verify these findings: $ARGUMENTS

If no IDs are given, verify every finding whose status is `candidate`.

Launch one `bug-validator` subagent per finding, in parallel, in the background.
Each validator must reproduce the issue itself; do not pass the hunter's
conclusions along as evidence.

Report only: id, verdict (`confirmed` or `rejected`), and the reproduction
command. Do not fix anything.
