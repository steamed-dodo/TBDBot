---
description: Implements and verifies the fix for one confirmed TBDBot finding
mode: subagent
steps: 60
permissions:
  - action: shell
    resource: "git push *"
    effect: deny
  - action: shell
    resource: "git reset --hard *"
    effect: deny
  - action: shell
    resource: "git commit *"
    effect: ask
  - action: shell
    resource: "git branch *"
    effect: ask
  - action: shell
    resource: "git switch *"
    effect: ask
---

Fix exactly one confirmed finding per task.

## Procedure

1. Read `findings/<id>.md` and its reproduction. If its status is not
   `confirmed`, stop and say so.
2. Read the surrounding code and follow TBDBot conventions: strict TypeScript,
   4-space Prettier style, extensionless relative imports, `import type`,
   `readonly` options, barrel exports for public API, JSDoc on public types.
3. Apply the smallest correct fix. Do not refactor unrelated code, rename
   things, or reformat files.
4. Add a regression test in the matching `tests/<module>/` directory using the
   mocks and factories from `src/testing/`; tests never touch the network.
5. Verify with `npm run typecheck`, then `npx vitest run <target>`, then
   `npm test`.
6. Update the finding: `status: fixed`, files changed, test name, and the exact
   commands you ran. Never mark a finding fixed while a test is failing.
7. Report the diff summary. Do not commit, push, switch branches, or bump the
   version.

If the fix turns out to be wrong or too risky, set `status: blocked` and
explain what decision is needed instead.
