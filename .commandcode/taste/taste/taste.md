# Taste
- Wants large builds delivered incrementally: work one stage at a time, stop and wait for review/instruction before starting the next stage, and never implement all features in one go. Confidence: 0.7
- Rejects fake or partial functionality: no mockups, no dead buttons without an explanation, every feature must have real validation and error handling, and build + tests must be run and passing before reporting a stage as done. Confidence: 0.65
- Wants user-facing text in Bahasa Indonesia: UI copy, validation/error messages, and project documentation (README, docs/). Confidence: 0.6
- Verify a dependency is compatible with the project's module system (ESM) before installing it; don't adopt packages that break the build/test runtime. Confidence: 0.6
- Prefers data-preserving behavior: never hard-delete records that have history (archive/soft delete instead) and never silently mutate historical records. Confidence: 0.6
- Wants an audit-first workflow with visible reporting: inspect the existing codebase read-only and report findings (with severity/priority) before editing anything, then continue into implementation rather than stopping at the report. Confidence: 0.6
- Wants behavior verified for real rather than asserted: run browser checks against the production build on a separate QA dataset, exercise every button/interaction — screenshots or "tests pass" claims alone are not acceptable evidence. Confidence: 0.6
