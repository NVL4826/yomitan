---
status: accepted
---

# Maintain warning-free Firefox builds with reproducible dependency adaptations

All Firefox variants must produce zero Mozilla extension-validator warnings and errors while preserving existing Yomitan functionality and Chromium behavior. The version 1.0.1 unlisted fork archive reproduces the eight reported warnings with web-ext 10.6.0 and addons-linter 10.10.0.

All Firefox variants now target desktop 140 and Android 142 or later and declare the same data-transmission categories as the unlisted fork. This deliberately drops Firefox 115 support to use built-in consent and supported permission APIs. Add-on identities and the development build's self-hosted update URL remain unchanged; validate that build with web-ext's self-hosted option.

Small, documented dependency adaptations during library builds are permitted. This accepts maintenance work when dependencies change in exchange for resolving the current warnings without waiting for upstream releases. Generated bundles must be reproducible from the supplied source; adaptations must fail clearly when their expected dependency source no longer matches.

The implementation plan is to import the fixed content-script path directly through runtime.getURL, keep Chromium's offscreen implementation out of Firefox packages, retain Handlebars AST rendering while removing its unused JavaScript compiler, specialize the ZIP worker for its bundled codecs, and replace LinkeDOM's three internal innerHTML assignments with its existing parsing helper. LinkeDOM's change preserves synthetic DOM parsing semantics and does not sanitize HTML. Custom Anki templates and ZIP workers remain supported.

Completion requires regenerated library bundles, rebuilt Firefox archives, regression checks for the affected behavior, and validation of every Firefox variant with warnings treated as errors. Preserve the fork identity established in ADR 0001 and existing work in progress.

Rebuild and validate with web-ext on PATH:

```sh
npm run build -- firefox firefox-unlisted firefox-dev firefox-android --manifest firefox-unlisted --version 1.0.1
npm run test:firefox
```

The validator command checks packaged files, automatically uses self-hosted mode for the development variant, and fails on warnings. Firefox staging also removes excluded files from directory builds; manifest modification values are copied to prevent one variant's identity or update URL from leaking into another.

References: [Mozilla JavaScript rule configuration](https://github.com/mozilla/addons-linter/blob/master/src/const.js) and [web-ext lint](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-lint).
