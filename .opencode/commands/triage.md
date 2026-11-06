---
description: Run hunt and verify, then report; stop before fixing
agent: build
---

Run the bug pipeline for: $ARGUMENTS

1. Hunt: follow the `/hunt` instructions for that scope.
2. Verify: when the hunters finish, verify every candidate they produced.
3. Report confirmed findings by severity with their evidence, and list the
   rejected ones briefly.

Stop there. Do not fix anything until I approve.
