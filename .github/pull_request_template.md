## Summary

Describe the change and why it is needed.

## Related Issue

Closes #

## Test Plan

- [ ] `pnpm --filter @dental/v2 typecheck`
- [ ] `pnpm --filter @dental/v2 test`
- [ ] `pnpm --filter @dental/v2 build`
- [ ] `pnpm --filter @dental/v2 electron:compile`
- [ ] `pnpm --filter @dental/v2 run verify:package`
- [ ] `pnpm --filter @dental/v2 smoke:api`
- [ ] `pnpm --filter @dental/v2 smoke:ui`
- [ ] `pnpm --filter @dental/v2 test:load`

## Quality Checklist

- [ ] No production `any`
- [ ] SQL is parameterized
- [ ] Sensitive data is masked
- [ ] Failure paths return structured errors
- [ ] No unintended files or generated artifacts are committed
