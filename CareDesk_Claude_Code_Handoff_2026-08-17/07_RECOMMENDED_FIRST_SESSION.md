# Recommended First Claude Code Session

1. Fetch latest main and verify it.
2. Compare `origin/codex/perform-final-product-gap-closure-review` to main.
3. Inspect:
   - `apps/web/src/pages/CasePage.tsx`
   - `packages/i18n/src/resources/he.json`
   - `packages/i18n/src/resources/en.json`
   - `apps/web/src/pages/EmergencyBinderPage.test.tsx`
   - `apps/web/src/pages/case/AutomationPanel.test.tsx`
   - `apps/web/src/storage/mvp-storage.ts`
4. Do NOT blindly restore old PR #52.
5. Create a fresh branch, e.g. `claude/binder-event-wizard-closure`.
6. Cherry-pick/reapply only validated candidate behavior.
7. Run full repository gates.
8. Create a new PR linked to Issue #63.
9. After green merge, proceed to Issue #62.
