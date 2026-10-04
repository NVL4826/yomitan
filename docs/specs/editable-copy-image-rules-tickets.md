# Editable image copy rules tickets

Spec: [editable-copy-image-rules.md](editable-copy-image-rules.md).

Tracker parent: https://github.com/NVL4826/yomitan/issues/5.

Integration branch: `feat/editable-copy-image-rules`.

## Task graph

- [#6: Persist editable image copy rules and import/export JSON](https://github.com/NVL4826/yomitan/issues/6) is implemented and integrated. It delivers shared persistent rules, revision-scoped Copy recovery, one-time JSON seeding, and mapping-only Import/Export.
- [#7: Inspect result-entry images and edit copy rules](https://github.com/NVL4826/yomitan/issues/7) depends on #6 and is implemented and integrated. It delivers viewing, per-image save/edit/delete, inactive revision review, and selected-entry inspector behavior using the shared resolution flow.

The [implementation PR #8](https://github.com/NVL4826/yomitan/pull/8) closes #5, #6, and #7 when merged into the default branch. Keep the existing issue #4 implementation as the integration baseline.
