---
name: review-code
description: Review current changes for correctness, risk, and missing tests
---

Review the current git diff for:
- Correctness: logic errors, off-by-ones, null handling
- Safety: injection, secrets, missing auth checks
- Tests: coverage gaps for changed behavior
- Rollback: can this be reverted cleanly?

Be specific. Reference file:line. Skip praise.
