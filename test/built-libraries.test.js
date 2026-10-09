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
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {deflateRawSync} from 'node:zlib';
import {parseHTML as referenceParseHTML} from 'linkedom';
import {test} from 'vitest';
import {Handlebars} from '../ext/lib/handlebars.js';
import {parseHTML} from '../ext/lib/linkedom.js';

/** @typedef {{registerHelper: (name: string, helper: (value: string) => string) => void, registerPartial: (name: string, partial: string) => void, compileAST: (input: string) => (data: unknown) => string}} AstEnvironment */

/**
 * Execute the generated worker with the same streams and messages used by zip.js.
 * @param {string[]} scripts
 * @param {Uint8Array} input
 * @returns {Promise<{message: Record<string, unknown>, output: Buffer}>}
 */
async function runZipWorker(scripts, input) {
    /** @type {Buffer[]} */
    const output = [];
    /** @type {(event: {data: Record<string, unknown>}) => void} */
    let handleMessage = (_event) => { throw new Error('Worker did not register its message handler'); };
    /** @type {Promise<Record<string, unknown>>} */
    const result = new Promise((resolve) => {
        vm.runInNewContext(readFileSync(new URL('../ext/lib/z-worker.js', import.meta.url), 'utf8'), {
            self: {},
            /**
             * @param {string} type
             * @param {(event: {data: Record<string, unknown>}) => void} handler
             */
            addEventListener(type, handler) {
                assert.equal(type, 'message');
                handleMessage = handler;
            },
            postMessage: resolve,
            ReadableStream,
            WritableStream,
            TransformStream,
            AbortController,
        });
        handleMessage({data: {
            type: 'start',
            scripts,
            config: {chunkSize: 64},
            options: {codecType: 'inflate', compressed: true, useCompressionStream: false},
            readable: new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array(deflateRawSync(input)));
                    controller.close();
                },
            }),
            writable: new WritableStream({
                /** @param {Uint8Array} chunk */
                write(chunk) { output.push(Buffer.from(chunk)); },
            }),
        }});
    });
    return {message: await result, output: Buffer.concat(output)};
}

test('generated ZIP worker decompresses with its bundled codec', async ({expect}) => {
    const input = Buffer.from('Dictionary worker regression '.repeat(100));
    const {message, output} = await runZipWorker([], input);
    expect(message).toMatchObject({type: 'close', result: {outputSize: input.length}});
    expect(output).toEqual(input);
});

test('generated ZIP worker rejects additional codec scripts', async ({expect}) => {
    const {message} = await runZipWorker(['unexpected-codec.js'], new Uint8Array());
    expect(message).toMatchObject({error: {message: 'Additional ZIP codec scripts are not supported'}});
});

test('AST template environments preserve helpers and string partials', ({expect}) => {
    /** @type {unknown} */
    const firstInstance = Handlebars.create();
    /** @type {unknown} */
    const secondInstance = Handlebars.create();
    const first = /** @type {AstEnvironment} */ (firstInstance);
    const second = /** @type {AstEnvironment} */ (secondInstance);
    first.registerHelper('label', (/** @type {string} */ value) => `first:${value}`);
    second.registerHelper('label', (/** @type {string} */ value) => `second:${value}`);
    first.registerPartial('item', '{{label name}}');
    second.registerPartial('item', '{{label name}}');
    const template = '{{#each items}}{{> item}};{{/each}}';
    const data = {items: [{name: 'A'}, {name: 'B'}]};
    expect(first.compileAST(template)(data)).toBe('first:A;first:B;');
    expect(second.compileAST(template)(data)).toBe('second:A;second:B;');
});

/**
 * Exercise all three adapted internal HTML parsing paths and node ownership.
 * @param {typeof parseHTML} parse
 * @returns {{html: string, fragment: string}}
 */
function parseFragments(parse) {
    const window = parse('<html><body><main><i>start</i></main></body></html>');
    assert.ok(window !== null);
    const {document} = window;
    const main = document.querySelector('main');
    assert.ok(main !== null && main.firstElementChild !== null);
    main.firstElementChild.outerHTML = '<b title="&amp;">replacement &lt;text&gt;</b>';
    main.insertAdjacentHTML('beforeend', '<span>inserted</span>');
    const range = document.createRange();
    range.selectNode(main);
    const fragment = range.createContextualFragment('<svg><path d="M0 0"/></svg><em>fragment</em>');
    for (const node of [...main.childNodes, ...fragment.childNodes]) {
        assert.equal(node.ownerDocument, document);
    }
    const container = document.createElement('div');
    container.appendChild(fragment);
    return {html: main.outerHTML, fragment: container.innerHTML};
}

test('generated LinkeDOM preserves upstream fragment parsing', ({expect}) => {
    expect(parseFragments(parseHTML)).toEqual(parseFragments(referenceParseHTML));
});
