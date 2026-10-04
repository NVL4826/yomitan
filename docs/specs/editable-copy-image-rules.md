# Editable image copy rules

Status: confirmed by the user; implementation authorized.

## Purpose

Replace the SMK8-specific hardcoded fallback with editable image copy rules usable for additional dictionaries. Let the user inspect unresolved images and define their handling without changing extension code.

## Confirmed decisions

- The user maintains a separate JSON file and loads it through Import. Export produces a mapping file that can be edited, saved, and shared. The extension does not continuously watch that file.
- Image discovery is limited to the currently viewed result entry. The inspector shows unresolved images with the original image, dictionary name, asset path, and surrounding dictionary text.
- Rules support both replacement with equivalent text and deliberate omission without an unresolved-image warning.
- Dictionary-wide image enumeration is outside the initial scope.
- A valid import replaces the entire rule collection. Removing a rule from the JSON file and importing that file removes the stored rule. Invalid imports preserve the existing collection.
- Explicit user rules have priority 1, meaningful dictionary metadata has priority 2, and remaining unresolved images have priority 3 and produce partial-success warnings. An explicit omission rule suppresses the image even when it has metadata.
- The rule collection is shared by all profiles.
- Rule identity is the original dictionary name, dictionary revision, and exact asset path. Display aliases are not dictionary identity.
- When a dictionary revision changes, rules for the old revision remain stored but stop applying. The user must inspect and update them before they can apply to the new revision.
- The inspector lets the user enter replacement text or choose deliberate omission and save directly in Yomitan. Saving there updates persistent extension storage. The separate JSON file changes only when the user exports and saves it.
- Preserve the existing 15 verified SMK8 mappings as JSON seed data for the editable collection. Initialize them once on fresh installation or migration from the hardcoded implementation. Seed identity includes the verified dictionary title, revision `smk8;2023-07-09`, and exact asset paths. Do not restore seed rules after the user deletes them or imports a replacement collection, including an empty collection.
- The inspector defaults to unresolved images and provides an option to show all images in the selected result entry. The user can edit and delete rules there. Removing a rule returns that image to metadata-based handling or, when unresolved, warning behavior.
- After a revision change, inspect and save each image individually in the UI. Saving creates a rule for the current revision while retaining the old rule. Do not automatically migrate the dictionary's entire rule collection. The user can still edit revisions in the external JSON file and import the result after reviewing those images independently.

## Repository capabilities

- Result definitions and stored media already identify images by dictionary identity and exact asset path.
- The display already supports opening original dictionary media in a new tab.
- Existing options storage and JSON backup handling provide patterns for persistence and selected-file import/export. A mapping-only import/export surface will be new.
- The current Copy flow recovers dictionary metadata before its fixed-label fallback and filters excluded dictionaries before processing their images.

## Confirmed design

- Place mapping Import/Export in the search page's existing Copy options, and the inspector action next to the result-entry Copy control.
- Use a versioned JSON document containing a rule list with explicit replacement and omission actions. Export includes both active and inactive rules, without image payloads.
- Validate the complete import before persisting it, including supported document version, required identifiers, valid actions, replacement text, and duplicate identities.
- Require non-empty dictionary, revision, and path identifiers. Replacement rules require non-empty plain text. Omission rules carry no replacement text. Reject malformed rules or duplicate dictionary/revision/path identities as a whole, with an actionable error identifying the invalid rule.
- An imported collection becomes active only after successful persistence. A failed import or save leaves the previously saved collection effective and reports failure. An empty valid collection intentionally clears all stored rules.
- Retain imported rules for dictionaries not currently installed so shared files can be imported before their dictionaries.
- Inspect only images from dictionaries currently included by the copy dictionary filter, including images in collapsed content. Deduplicate displayed assets while preserving the unresolved occurrence count used by Copy.
- Show original dictionary name, current revision, exact image path, preview/open-original control, and surrounding glossary text. Explain the current handling: user replacement, user omission, metadata, known illustration, or unresolved. When available, show a rule from an older revision as inactive so the user can review its text against the current image before saving.
- Editing and deleting a rule affects its exact dictionary/revision/path identity. Saving for the same identity replaces that rule; saving for a newer revision leaves the old identity intact.
- Missing or unreadable media produces a visible error in the inspector; available dictionary text remains copyable.
- Saving a rule changes subsequent Copy operations. It does not replace clipboard content until the user activates Copy again.
- Persist rules in global options using existing extension settings mechanisms, so they survive reload and participate in the existing full-settings backup. Mapping-only Import/Export affects only the rule collection.
- Scope recovery and manual rules to result-entry Copy on the search page. Search rendering, dictionary lookup, popup results, and Anki output remain outside this change.

## JSON format

The following document illustrates the proposed external format. `version` is the mapping document's format version; `revision` is the original dictionary's revision. The second rule is an example of a user choosing to omit an illustrative asset, not a supplied SMK8 mapping.

```json
{
  "version": 1,
  "rules": [
    {
      "dictionary": "新明解国語辞典　第八版",
      "revision": "smk8;2023-07-09",
      "path": "smk8/表記-redfill.svg",
      "action": "replace",
      "text": "表記"
    },
    {
      "dictionary": "Example Dictionary",
      "revision": "2026-01",
      "path": "images/illustration.svg",
      "action": "omit"
    }
  ]
}
```

The file is a portable snapshot. Import replaces the persistent collection; later UI edits change the collection inside Yomitan. Export downloads the latest collection, and the user chooses where to save that file.

## Resolution order

1. Apply an explicit rule matching the original dictionary name, current revision, and exact asset path. Replace with its text or omit it silently according to its action.
2. Without an active rule, preserve existing meaningful metadata recovery and silent omission of positively identified illustrations. Arbitrary hover titles do not establish equivalent content.
3. Count remaining unresolved image occurrences and copy the available text with partial-success feedback.

There is no separate SMK8-specific runtime fallback after the editable rules. Deleting a SMK8 rule removes its fallback; valid metadata can still recover the image. An explicit omission rule also overrides metadata and suppresses warnings.

## User interaction examples

- The user opens the inspector for a result, sees an unresolved label, enters its equivalent text, and saves. Activating Copy again includes that text at the image's original position and no longer counts that image occurrence as unresolved.
- The user chooses omission for a photo and saves. Copy silently omits it, including any alternative text that would otherwise have been recovered.
- The user shows all images, edits or deletes a saved rule, and copies again to observe the updated behavior.
- The user exports, edits the JSON externally, and imports it. The imported collection exactly replaces the previous one, and the chosen rules remain effective after reopening the search page or switching profiles.
- A dictionary update changes its revision. Old rules appear as inactive and contribute no replacement or omission for the new revision. The user views a current image and saves a new rule; its old-revision rule is retained.

## Acceptance and testing

Confirmed primary seams: result-entry Copy, its image inspector controls, and mapping-only Import/Export. Exercise the real controls and persistent settings flow using the installed DOM test tooling; stub external clipboard/file boundaries.

- Cover user replacement and omission taking precedence over metadata, meaningful metadata when there is no active rule, and unresolved partial success.
- Cover inline position, collapsed content, repeated occurrences, and excluded dictionaries contributing neither inspector images nor Copy warnings.
- Cover preview/open-original behavior, save/edit/delete, default unresolved filtering, and the show-all option for one selected entry. Neighboring entries are excluded.
- Cover valid replacement import, deletion via import, empty import, malformed JSON, unsupported format versions, invalid rules, duplicate identities, and persistence failures. Failed operations preserve the previous collection.
- Cover export/import round trips, retention of inactive and not-yet-installed dictionary rules, settings reload, shared-profile behavior, and full-settings backup compatibility.
- Cover exact dictionary/revision/path matching; similar filenames in other dictionaries or paths must not match. Revision changes disable old rules until per-image review and save for the new revision.
- Cover one-time seeding of all 15 verified SMK8 labels, including migration from the existing implementation. Deleted or replaced seed rules must not reappear after reload.
- Use compact committed dictionary and media fixtures with no runtime dependency on the user's sample directory. Add no OCR, recognition service, or general image-conversion framework.
- Browser verification covers keyboard access, image viewing, file selection/download, and actual plain-text paste; report any unavailable verification explicitly.

## Existing behavior to preserve

- Copy acts on one complete result entry and includes collapsed content.
- Dictionary exclusions apply before image processing.
- Available text is copied even when some included images remain unresolved, with accurate partial-success feedback.
- Image payloads, asset URLs, raw SVG, and placeholder text are absent from copied output.
- No OCR, external recognition service, or automatic interpretation of arbitrary images is required.
