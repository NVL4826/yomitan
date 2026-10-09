/*
 * Copyright (C) 2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/**
 * Fail on dependency changes rather than silently shipping an incomplete adaptation.
 * @param {string} source
 * @param {RegExp} pattern
 * @param {string} replacement
 * @param {number} [expectedCount]
 * @returns {string}
 */
function replaceSource(source, pattern, replacement, expectedCount = 1) {
    assert.equal([...source.matchAll(pattern)].length, expectedCount, `Source adaptation no longer matches ${pattern}`);
    return source.replace(pattern, replacement);
}

/**
 * Firefox uses the backend's direct implementations, never an offscreen document.
 * Keep the imported proxy exports, but omit Chromium document creation from its package.
 * @param {string} source
 * @returns {string}
 */
export function adaptFirefoxOffscreen(source) {
    return replaceSource(
        source,
        / {4}async prepare\(\) \{[\s\S]*?\n {4}}\n\n {4}\/\*\*[\s\S]*? {4}async _hasOffscreenDocument\(\) \{[\s\S]*?\n {4}}/g,
        "    async prepare() {\n        throw new Error('Offscreen documents are unavailable in Firefox');\n    }",
    );
}

/** @type {import('esbuild').Plugin} */
export const sourceAdaptations = {
    name: 'yomitan-source-adaptations',
    setup(build) {
        // Yomitan uses compileAST. Keep the parser, visitor and runtime, removing
        // the unused compiler that generates JavaScript with Function constructors.
        build.onLoad({filter: /[/\\]handlebars[/\\]dist[/\\]cjs[/\\]handlebars\.js$/}, async ({path}) => {
            let contents = await fs.readFile(path, 'utf8');
            contents = replaceSource(contents, /var _handlebarsCompilerCompiler = require\('\.\/handlebars\/compiler\/compiler'\);\n/g, '');
            contents = replaceSource(contents, /var _handlebarsCompilerJavascriptCompiler = require\('\.\/handlebars\/compiler\/javascript-compiler'\);\n\nvar _handlebarsCompilerJavascriptCompiler2 = _interopRequireDefault\(_handlebarsCompilerJavascriptCompiler\);\n/g, '');
            contents = replaceSource(contents, / {2}hb\.compile = function \(input, options\) \{[\s\S]*?\n {2}};\n {2}hb\.precompile = function \(input, options\) \{[\s\S]*?\n {2}};\n/g, '');
            contents = replaceSource(contents, / {2}hb\.Compiler = _handlebarsCompilerCompiler\.Compiler;\n {2}hb\.JavaScriptCompiler = _handlebarsCompilerJavascriptCompiler2\['default'\];\n/g, '');
            return {contents, loader: 'js'};
        });

        // Dictionary import supplies only z-worker.js, which already bundles both
        // codecs. Reject extra scripts explicitly instead of loading code dynamically.
        build.onLoad({filter: /[/\\]zip\.js[/\\]lib[/\\]core[/\\]z-worker-core\.js$/}, async ({path}) => {
            let contents = await fs.readFile(path, 'utf8');
            contents = replaceSource(contents, /\t\tif \(scripts && scripts\.length\) \{[\s\S]*?\n\t\t}\n/g, '\t\tif (scripts && scripts.length) {\n\t\t\tthrow new Error("Additional ZIP codec scripts are not supported");\n\t\t}\n');
            contents = replaceSource(contents, /async function imporModuleScripts\(scripts\) \{\n\tfor \(const script of scripts\) \{\n\t\tawait import\(script\);\n\t}\n}\n/g, '');
            // The classic-script fallback is unused as well.
            contents = replaceSource(contents, /, importScriptSupported = true;/g, ';');
            return {contents, loader: 'js'};
        });

        // These are synthetic LinkeDOM nodes. Call the exact helper used by their
        // innerHTML setter, preserving parsing semantics without claiming sanitization.
        build.onLoad({filter: /[/\\]linkedom[/\\]esm[/\\]interface[/\\](element|range)\.js$/}, async ({path}) => {
            let contents = await fs.readFile(path, 'utf8');
            const isRange = /[/\\]range\.js$/.test(path);
            contents = replaceSource(contents, /template\.innerHTML = html;/g, 'setInnerHtml(template, html);', isRange ? 1 : 2);
            if (isRange) {
                contents = "import {setInnerHtml} from '../mixin/inner-html.js';\n" + contents;
            }
            return {contents, loader: 'js'};
        });
    },
};
