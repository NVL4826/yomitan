# Search result copy: Markdown, tables, and symbols

Status: complete design confirmed by the user; implementation authorized.

## Purpose

Improve result-entry Copy on the search page with Markdown output, preserved tables, numbered dictionary sections, and textual equivalents for content-bearing symbols without text.

## Confirmed decisions

- Keep the existing Copy button and interaction. Markdown is the default output format. Add a Markdown/plain-text choice inside the existing Copy options.
- Persist the selected output format per profile using the existing settings mechanisms. Fresh installations and upgrades default to Markdown. Reopening the search page restores the selected profile's choice.
- Markdown preserves headings, lists, and tables. Bold, italic, and Markdown links are outside the requested formatting scope; their textual content remains available.
- Use a level-one heading for the headword and reading, and level-two headings for numbered dictionary sections. Preserve all variants of the copied result entry.
- Number dictionary sections only in copied output, using their existing section order. Start at 1 for each copied result entry and number included sections consecutively. Search-page dictionary labels remain unchanged.
- Both output formats retain table content and recovered symbol descriptions. Plain text uses numbered dictionary labels without Markdown heading markers, tabs between table cells, and line breaks between rows.
- Markdown tables preserve the row/column relationships. Expand merged cells into a rectangular grid, repeating the spanning cell's content in the covered cells. Separate multiple lines inside a cell with semicolons. Preserve empty cells, including the sample's empty top-left header. Add an empty header row when a table has no header.
- Represent nested tables as text with row/column boundaries inside a fenced code block, rather than emitting HTML. Escape literal Markdown characters where needed to preserve dictionary text and table boundaries.
- Recover the original, untranslated title for empty symbols positively identified as content-bearing, including other Jitendex symbols with titles. Do not treat arbitrary dictionary tooltips as content.
- Identify such symbols through verified contexts and original dictionary metadata, starting with Jitendex form tables. Retain other non-empty titles in the same verified symbol context. Outside verified contexts, do not automatically add titles from empty spans. Verify the source metadata during implementation; rendered HTML alone is not the recognition rule.
- Preserve the existing result-entry boundary, dictionary exclusions, collapsed content, image copy rules, and clipboard feedback behavior.

## Current implementation

- Copy reads the selected result entry's underlying dictionary data through `getResultEntryText`.
- Table cells currently become tab-separated text, with row boundaries preserved as line breaks. Markdown table syntax is absent.
- Structured-content elements without textual children currently produce no text, even when an empty span has a title describing a symbol.
- Structured dictionary content retains titles, custom data, table row spans, and column spans. The supplied rendered HTML alone does not establish the source metadata of every Jitendex symbol.

## Representative Markdown output

The supplied Jitendex table contributes the following structure; actual entries retain their additional variants, definitions, and other included dictionary sections.

```markdown
# 日本語 (にほんご)

## 1. Jitendex

| | 日本語 |
| --- | --- |
| にほんご | high priority form |
| にっぽんご | valid form/reading combination |
```

## Acceptance and verification

Use the existing result-entry Copy interaction tests, stubbing the clipboard boundary. Exercise the Copy options controls and settings persistence through their existing public behavior.

- Check Markdown defaults for fresh settings and migrated settings, persistence after reopening, and independent choices across profiles.
- Check headings, lists, full headword/reading variants, and consecutive dictionary numbering in both formats. Excluding a dictionary must leave no gap and no content from that dictionary.
- Check the supplied Jitendex table and other titled symbols in verified contexts. Unrelated tooltips and empty spans outside those contexts must not contribute titles. Preserve the original English descriptions without translation or invented glyphs.
- Check ordinary tables, empty cells, headerless tables, merged cells, multiline cells, nested-table fallback, and literal pipe/Markdown characters. Compare the resulting clipboard text with the agreed representations.
- Preserve collapsed content, image replacement/omission behavior, unresolved-image feedback, no-content clipboard preservation, clipboard-failure feedback, and protection against clipboard-monitor search feedback.
- Run the existing relevant tests and repository-required checks appropriate to the changes. Browser verification covers keyboard access to the format selector and actual paste in both formats; explicitly report any unavailable checks.

## Implementation scope

- Extend the existing result text conversion and search-page Copy options, rather than adding a second copy interface or a dependency.
- Include the format setting's types, defaults, migration, and persistence, plus representative fixtures and interaction tests.
- Keep image inspection context readable when adapting the converter shared with the inspector.
- Do not add user-configurable symbol rules, global tooltip conversion, CSS appearance reproduction, HTML clipboard payloads, or additional formatting beyond headings, lists, and tables.
- The choices are reversible extensions of existing copy behavior; no architecture decision record is warranted.

## Relationship to existing specs

This extends `copy-search-result.md`: its plain-text-only output decision will be superseded when this design is confirmed. Markdown is still a textual clipboard payload. Existing image rules described in `editable-copy-image-rules.md` remain applicable.
