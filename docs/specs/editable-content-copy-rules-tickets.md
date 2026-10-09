# Editable content copy rules implementation tickets

Spec: [editable-content-copy-rules.md](editable-content-copy-rules.md), [#14](https://github.com/NVL4826/yomitan/issues/14).

Integration branch: `feat/search-copy-markdown`. Existing [PR #13](https://github.com/NVL4826/yomitan/pull/13) remains the single integration PR for the complete Copy improvements.

## Task graph

- [#15: Matching and conversion](https://github.com/NVL4826/yomitan/issues/15). No blockers. Validate versioned metadata rules, apply contextual first-match operations, separate adjacent labels, preserve list/table and image behavior, and reduce only duplicate generated headword lines.
- [#16: Inspector and persistent controls](https://github.com/NVL4826/yomitan/issues/16). Independent implementation against the agreed interface; integrated verification needs #15. Add source metadata inspection, draft preview/save/delete/order, Import/Export, one-time editable seeds, and the per-profile reduction option.
- [#17: Integration and verification](https://github.com/NVL4826/yomitan/issues/17). Dependencies #15 and #16 are integrated. Validate original Jitendex examples and public controls, run required checks and separate Standards/Spec reviews, fix findings, update PR #13, and clean worktrees.

## Test scenarios

- Original Jitendex labels copy as `5-dan · transitive`; the following ordered senses remain a list.
- Verified form symbols copy their original titles only through saved mappings. A titled span outside the selected ancestry, a different dictionary, or a different revision does not match.
- A user-created rule for another dictionary works without changing converter code. Its literal replacement/prefix/suffix/separator is escaped in Markdown and preserved in plain text.
- Overlapping rules apply only the first match. Reordering changes the preview and the subsequent Copy. An unmatched, omitted, or empty sibling breaks a label run.
- Table cells and list items can be mapped without losing their row/column or list relationships. An omitted/replaced parent does not report images from skipped descendants as unresolved.
- Inspector drafts preview the complete result before saving. Invalid JSON and failed persistence preserve the existing collection and draft. Export retains inactive and uninstalled-dictionary rules; an empty successful import clears mappings permanently.
- The reduction checkbox starts unchecked on new and upgraded profiles. Changing profiles restores its value. It affects both formats, preserves original dictionary text, and retains different variant subsets and frequency/pronunciation identities.

Tests use the agreed copied-result, Copy options, inspector, and JSON document interfaces. Implementation tickets use separate worktrees and TDD; no dependencies are added.

## Completion and verification

Matching/conversion (#15) and inspector/controls (#16) are implemented and integrated. Integration checks (#17) passed on the final code:

- Unit tests: 51 files, 4,948 passed and 46 skipped.
- JSON TypeScript validation: 144 passed; JSON formatting passed.
- Static analysis passed, including JavaScript, TypeScript, CSS, HTML, and Markdown checks. Scoped lint and TypeScript checks were repeated after the final converter fixes.
- Build dry run passed for all targets.
- Original Jitendex examples were checked for separated grammatical labels, intact ordered senses, recovered form-symbol titles, and inactive/deleted mappings. Both output formats preserve the original source and distinct headword variants.
- Standards review: no actionable findings. Spec review: four findings corrected, with regression tests demonstrating failure before each fix. Corrections preserve merged-cell table positions, escape list markers assembled across fragments, stage reorder/delete previews before persistence, and omit empty metadata from suggested matchers.

Browser clipboard/paste was not verified in a real browser: Chromium installation stalled during extraction. DOM tests exercise the public controls and clipboard stub. The PR remains unmerged pending user review.

## Using the controls

Choose **Inspect content** on a result, select an original element or group, edit its matcher/action, and preview the complete copied result. **Save changes** persists the draft; reordering and deleting rules also require this step. The first matching rule wins.

**Copy options** provides JSON Import/Export for the global content rules. Import replaces the complete collection; editable starter rules are seeded once, and deleted rules stay deleted. Rules remain scoped to the exact dictionary name and revision.

Enable **Reduce repeated headword lines** in Copy options to omit only generated definition lines duplicating the complete top-level variant set. This option is saved per profile and starts off; source dictionary text and differing variant groups remain intact.
