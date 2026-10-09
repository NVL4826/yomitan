# Editable content copy rules implementation tickets

Spec: [editable-content-copy-rules.md](editable-content-copy-rules.md), [#14](https://github.com/NVL4826/yomitan/issues/14).

Integration branch: `feat/search-copy-markdown`. Existing [PR #13](https://github.com/NVL4826/yomitan/pull/13) remains the single integration PR for the complete Copy improvements.

## Task graph

- [#15: Matching and conversion](https://github.com/NVL4826/yomitan/issues/15). No blockers. Validate versioned metadata rules, apply contextual first-match operations, separate adjacent labels, preserve list/table and image behavior, and reduce only duplicate generated headword lines.
- [#16: Inspector and persistent controls](https://github.com/NVL4826/yomitan/issues/16). Independent implementation against the agreed interface; integrated verification needs #15. Add source metadata inspection, draft preview/save/delete/order, Import/Export, one-time editable seeds, and the per-profile reduction option.
- [#17: Integration and verification](https://github.com/NVL4826/yomitan/issues/17). Blocked by #15 and #16. Merge, validate original Jitendex examples and public controls, run required checks and separate Standards/Spec reviews, fix findings, update PR #13, and clean worktrees.

## Test scenarios

- Original Jitendex labels copy as `5-dan · transitive`; the following ordered senses remain a list.
- Verified form symbols copy their original titles only through saved mappings. A titled span outside the selected ancestry, a different dictionary, or a different revision does not match.
- A user-created rule for another dictionary works without changing converter code. Its literal replacement/prefix/suffix/separator is escaped in Markdown and preserved in plain text.
- Overlapping rules apply only the first match. Reordering changes the preview and the subsequent Copy. An unmatched, omitted, or empty sibling breaks a label run.
- Table cells and list items can be mapped without losing their row/column or list relationships. An omitted/replaced parent does not report images from skipped descendants as unresolved.
- Inspector drafts preview the complete result before saving. Invalid JSON and failed persistence preserve the existing collection and draft. Export retains inactive and uninstalled-dictionary rules; an empty successful import clears mappings permanently.
- The reduction checkbox starts unchecked on new and upgraded profiles. Changing profiles restores its value. It affects both formats, preserves original dictionary text, and retains different variant subsets and frequency/pronunciation identities.

Tests use the agreed copied-result, Copy options, inspector, and JSON document interfaces. Implementation tickets use separate worktrees and TDD; no dependencies are added.
