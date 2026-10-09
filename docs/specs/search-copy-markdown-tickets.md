# Search Copy Markdown implementation tickets

Parent spec: https://github.com/NVL4826/yomitan/issues/9

Design: [search-copy-markdown.md](search-copy-markdown.md)

Integration branch: `feat/search-copy-markdown`.

All implementation tickets are complete on the integration branch. [PR #13](https://github.com/NVL4826/yomitan/pull/13) closes #9, #10, #11, and #12 when merged.

## Task graph

- [#10: Content conversion](https://github.com/NVL4826/yomitan/issues/10): Markdown headings/lists/tables, numbered sections in both formats, literal-text escaping, verified empty-symbol title recovery, and preserved image behavior. No blockers.
- [#11: Profile format selection](https://github.com/NVL4826/yomitan/issues/11): accessible Copy options selector, per-profile persistence, Markdown defaults/migration, and format wiring. No blockers.
- [#12: Integration and verification](https://github.com/NVL4826/yomitan/issues/12): blocked by #10 and #11; integrate, run checks, review Standards and Spec, fix findings, and ready the PR.

## Shared boundary

The converter accepts a fifth parameter, `format`, with values `markdown` and `text`; the default is `markdown`. The controller passes the selected profile format for Copy. Image inspection retains readable plain-text context.

Tests exercise the already confirmed result-entry Copy and Copy options seams. Each implementation ticket uses its own worktree and TDD. A single integration PR closes #9, #10, #11, and #12 on merge.
