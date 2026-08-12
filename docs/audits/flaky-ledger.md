# Flaky Test Ledger

## 2026-08-13 full shuffle probe

**Command:** `pnpm --filter @dental/v2 exec vitest run --sequence.shuffle`

**Result:** 75 tests failed across 36 files. The same suite passes with default file parallelism and with `--sequence.shuffle.files`.

**Classification:** TEST (high confidence) - shared mutable database state and order-dependent setup.

**Evidence:**

- Many failures were duplicate-seed or rate-limit errors such as `Duplicate fieldName: isInsurance`, `429` responses, and wrong aggregate counts.
- Failures disappeared when only files were shuffled while preserving within-file test order.
- Several files create one shared SQLite database in `beforeAll` and mutate it across tests, so within-file shuffle breaks assumptions about prior rows and login rate-limit state.

**Current containment:**

- `test:flaky` and `v2-flaky.yml` use `--sequence.shuffle.files`, which still detects file-order dependencies without shuffling tests inside a file.

**Follow-up work:**

- Refactor suites with shared `beforeAll` databases to use per-test fixtures or idempotent setup.
- Add unique IDs per test for seed data and reset in-memory rate-limit state between tests.
- After refactoring, re-run `--sequence.shuffle` and move it into the flaky gate.
