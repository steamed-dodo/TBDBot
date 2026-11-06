---
description: Implement and verify the fix for one confirmed finding
agent: bug-fixer
subagent: false
---

Fix $1.

If no ID is given, pick the highest-severity `confirmed` finding and say which
one you chose.

Read `findings/$1.md`, follow its reproduction, apply the smallest correct fix,
add a regression test, run typecheck and tests, update the finding, and show me
the diff. Do not commit or push.
