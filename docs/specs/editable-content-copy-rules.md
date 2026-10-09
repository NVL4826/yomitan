# Editable content copy rules and reduced headword repetition

Status: implemented and verified locally; included in [PR #13](https://github.com/NVL4826/yomitan/pull/13). The user confirmed all five design choices, including first-match precedence and editable seed mappings.

## Problem

Content-bearing symbols and dictionary labels can lose meaning or boundaries during textual conversion. The supplied 飲む result copies two separate Jitendex grammatical labels as `5-dantransitive`; recovered image labels also run directly into following prose. Adding dictionary-specific converter branches for each new example does not let users adapt copying to their own dictionaries.

## Confirmed direction

- Give users editable copy mappings for dictionary content, following the established image-mapping workflow rather than adding hardcoded fixes for individual dictionary examples.
- Add an option for reducing repeated headword lines in copied output.
- Preserve the existing Markdown/plain-text choice and the complete result-entry Copy interaction.
- Match original element/group metadata. Support selecting content or title, replacement, deliberate omission, label separators, and prefixes/suffixes.
- Provide an inspector for the selected result, including rule previews and saving, together with JSON Import/Export.
- Store mappings globally across profiles, scoped to the exact dictionary name and revision, following image rules.
- Save the reduce-repetition option per profile, apply it to both Markdown and plain text, and default it to off.
- When reduction is enabled, omit only generated definition headword lines whose complete variant set equals the top-level heading. Preserve original dictionary headword text, distinct variant groups, frequency identities, and pronunciation identities.

## Existing capabilities to reuse

- Image copy rules already support versioned JSON Import/Export, persistent global storage, exact dictionary/revision identity, validation, replacement and omission, and an inspector for the selected result entry.
- Original structured content exposes element tags, custom metadata, textual children, and titles. The confirmed Jitendex example uses separate spans with `data.class = "tag"` and `data.content = "part-of-speech-info"`.
- The converter itself adds a headword/reading line before each definition. That generated line can be controlled independently from the dictionary's original headword text, variant-specific definitions, frequencies, and pronunciation data.

## Matching and operations

Rules match original tags, a subset of custom metadata, optional exact title and empty-content conditions, and optional ancestor metadata. Matching ignores visual CSS classes synthesized by Yomitan. No script execution, HTML output, or automatic promotion of unrelated tooltips is required.

A rule selects converted content, the original title, a literal replacement, or omission. Prefixes and suffixes apply to its selected output. User-entered text is escaped in Markdown. Selecting converted content preserves existing list and table structure. Row and section prefixes/suffixes decorate the first/last applicable grid cells after merged-cell expansion; surviving rows retain their column positions.

Separators join adjacent sibling labels matched by the same rule. An unmatched sibling ends the run. In the original Jitendex grammatical group, two spans precede an ordered list of senses: only the spans join, preserving the sense list. A group replacement or omission deliberately affects the complete selected group; the inspector must preview that scope before saving. Reordering and deletion also stage a complete-result preview and require Save changes before persistence.

Example mapping:

```json
{
  "version": 1,
  "rules": [
    {
      "id": "jitendex-grammar-labels",
      "dictionary": "Jitendex.org [2026-10-03]",
      "revision": "2026.10.03.0",
      "match": {
        "tag": "span",
        "data": {"class": "tag", "content": "part-of-speech-info"}
      },
      "action": "content",
      "separator": " · "
    }
  ]
}
```

This changes `5-dantransitive` to `5-dan · transitive`, without rewriting the dictionary's sense list.

## Confirmed precedence and initialization

1. Apply the first matching rule in the saved order. The inspector shows the active rule and allows order changes. Do not silently combine overlapping replacements.
2. Move verified Jitendex symbol handling into editable seed mappings, initialized once for new installations and upgrades. Include a grammatical-label separator seed. Deleted mappings stay deleted; dictionary revision changes leave old mappings inactive until the user reviews them.

## JSON interface

- The document is `{version: 1, rules: [...]}`. Each rule has a nonempty unique `id`, `dictionary`, `revision`, `match`, and `action`.
- `match` supports `tag`, `data` (an exact subset of original string metadata), `title` (exact), `empty` (original textual content is empty), and `ancestors` (node matchers ordered nearest to farthest, allowing intervening ancestors). Each node matcher must include at least one condition. Unknown fields and invalid types are rejected.
- Actions are `content`, `title`, `replace`, and `omit`. `replace` requires nonempty literal `text`; other actions cannot carry `text`. Optional literal `prefix`, `suffix`, and `separator` apply to non-omission rules. An omitted node breaks a separator run.
- A missing revision pauses matching. Match against untouched dictionary nodes. An ancestor replacement/omission wins over descendant handling; omitted images must not be reported as unresolved.
- Import replaces the whole collection only after full validation and successful persistence. Empty import deliberately clears it. Export includes inactive and uninstalled-dictionary rules. Failed writes preserve existing rules and the unsaved inspector draft.
- Inspector lists elements/groups from included structured definitions, exposes original metadata and ancestor context, lets users edit the matcher and operation, and previews the complete copied entry before saving. Existing image controls remain available for image-specific mappings.

## Shared implementation interface

Global setting: `global.copyContentRules`. Profile setting: `general.copyReduceHeadwordRepetition` (boolean, default false). Existing image collection and document format stay unchanged.

`getResultEntryText` retains its first five parameters and adds a sixth optional object `{contentRules, reduceHeadwordRepetition}`. It uses the same conversion for Copy and previews.

New `copy-content-rules.js` exports `validateCopyContentRuleDocument(document)`, `findCopyContentRule(node, ancestors, dictionary, revision, rules)`, and `getCopyContentCandidates(entry, excludedDictionaries, rules, revisions)`. Candidates contain the original `node`, nearest-first `ancestors`, `dictionary`, `revision`, and optional `ruleId` for the active match. Images use the existing image inspector; their containing structured elements remain eligible for content mappings.

## Acceptance and verification

- Cover Copy, inspector preview/save/delete, JSON Import/Export validation and persistence failures, revision changes, overlapping matches, adjacent labels, and preserved list/table structure.
- Verify original Jitendex form indicators through editable rules, without a dictionary-name or symbol-class whitelist in converter code.
- Verify the reduction option against identical full variant sets, different subsets, unchanged source text, profile changes, and both formats.
