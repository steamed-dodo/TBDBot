---
description: Hunt for defects in the given areas and record candidate findings
agent: build
---

Hunt for defects in: $ARGUMENTS

If no areas are given, use the module directories under `src/`.

1. Read `findings/` and skip anything already recorded or rejected.
2. Allocate each hunter a disjoint ID range, continuing from the highest
   existing `F-###`.
3. Launch one `bug-hunter` subagent per area, in parallel, in the background.
   Give each subagent its area and its reserved ID range.
4. When they finish, report each new finding as
   `F-### [severity] area - one-line symptom`.

Do not fix anything, and do not mark anything confirmed.
