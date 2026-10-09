/*
 * Copyright (C) 2023-2026  Yomitan Authors
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

import {expect, test} from 'vitest';
import {getResultEntryText} from '../ext/js/display/result-entry-text.js';

/**
 * @param {import('structured-content').Content} content
 * @returns {import('dictionary').TermDictionaryEntry}
 */
function createEntry(content) {
    return {
        type: 'term',
        isPrimary: true,
        textProcessorRuleChainCandidates: [],
        inflectionRuleChainCandidates: [],
        score: 0,
        frequencyOrder: 0,
        dictionaryIndex: 0,
        dictionaryAlias: 'Dictionary',
        sourceTermExactMatchCount: 1,
        matchPrimaryReading: false,
        maxOriginalTextLength: 2,
        headwords: [{index: 0, headwordIndex: 0, term: '飲む', reading: 'のむ', tags: [], sources: [], wordClasses: []}],
        definitions: [{index: 0, id: 1, dictionary: 'Dictionary', dictionaryAlias: 'Dictionary', dictionaryIndex: 0, headwordIndices: [0], tags: [], entries: [{type: 'structured-content', content}], score: 0, frequencyOrder: 0, sequences: [-1], isPrimary: true}],
        frequencies: [],
        pronunciations: [],
    };
}

/** @type {import('settings').CopyContentRule} */
const labels = {id: 'labels', dictionary: 'Dictionary', revision: '1', match: {tag: 'span', data: {class: 'tag'}}, action: 'content', separator: ' · '};

test('Copied grammatical labels join without swallowing the following sense list', () => {
    const entry = createEntry([{tag: 'span', data: {class: 'tag'}, content: '5-dan'}, {tag: 'span', data: {class: 'tag'}, content: 'transitive'}, {tag: 'ol', content: {tag: 'li', content: 'to drink'}}]);
    const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'markdown', {contentRules: [labels]});
    expect(result.text).toBe('# 飲む (のむ)\n\n## 1. Dictionary\n飲む (のむ)\n5-dan · transitive\n\n1. to drink');
});

test('Import accepts complete documents and rejects unknown fields, duplicate ids and invalid actions', async () => {
    const {validateCopyContentRuleDocument} = await import('../ext/js/display/copy-content-rules.js');
    expect(validateCopyContentRuleDocument({version: 1, rules: [labels]})).toEqual([labels]);
    expect(validateCopyContentRuleDocument({version: 1, rules: []})).toEqual([]);
    for (const document of [
        {version: 2, rules: []},
        {version: 1, rules: [], extra: true},
        {version: 1, rules: [labels, labels]},
        ...[{}, {tag: 2}, {data: {class: 2}}, {ancestors: [{}]}, {tag: 'span', unknown: true}].map((match) => ({version: 1, rules: [{...labels, match}]})),
        ...[{action: 'replace'}, {action: 'replace', text: ''}, {action: 'title', text: 'x'}, {action: 'omit', prefix: 'x'}, {revision: ''}, {separator: 2}, {extra: true}].map((change) => ({version: 1, rules: [{...labels, ...change}]})),
    ]) { expect(() => validateCopyContentRuleDocument(document)).toThrow(); }
});

test('Inspector candidates retain original nodes, nearest-first context and active first rule', async () => {
    const {getCopyContentCandidates} = await import('../ext/js/display/copy-content-rules.js');
    const node = /** @type {import('structured-content').StyledElement} */ ({tag: 'span', data: {class: 'tag'}, title: 'Label', content: {tag: 'img', path: 'unresolved.svg'}});
    const middle = /** @type {import('structured-content').StyledElement} */ ({tag: 'div', content: node});
    const parent = /** @type {import('structured-content').StyledElement} */ ({tag: 'div', data: {scope: 'forms'}, content: middle});
    const scoped = {...labels, match: {title: 'Label', empty: true, ancestors: [{data: {scope: 'forms'}}]}};
    const entry = createEntry(parent);
    const candidates = getCopyContentCandidates(entry, new Set(), [scoped, {...labels, id: 'later'}], new Map([['Dictionary', '1']]));
    expect(candidates).toHaveLength(3);
    expect(candidates[2]).toEqual({node, ancestors: [middle, parent], dictionary: 'Dictionary', revision: '1', ruleId: 'labels'});
    expect(candidates[2].node).toBe(node);
    expect(getCopyContentCandidates(entry, new Set(['Dictionary']), [labels], new Map())).toEqual([]);
    expect(getCopyContentCandidates(entry, new Set(), [labels], new Map())[2].ruleId).toBeUndefined();
    expect(getCopyContentCandidates(entry, new Set(), [labels], new Map([['Dictionary', '2']]))[2].ruleId).toBeUndefined();
});

for (const format of /** @type {const} */ (['markdown', 'text'])) {
    test(`Reduction removes only generated complete headword sets in ${format}`, () => {
        const entry = createEntry('飲む (のむ) original dictionary text');
        entry.headwords.push({...entry.headwords[0]}, {...entry.headwords[0], term: '呑む'});
        entry.definitions[0].headwordIndices = [2, 0, 0];
        entry.definitions.push({...entry.definitions[0], headwordIndices: [0, 1], entries: ['subset']});
        const reduced = getResultEntryText(entry, new Set(), [], new Map(), format, {reduceHeadwordRepetition: true}).text;
        expect(reduced).toContain('1. Dictionary\n飲む (のむ) original dictionary text\n\n飲む (のむ), 飲む (のむ)\nsubset');
        expect(reduced).not.toContain('呑む (のむ), 飲む (のむ), 飲む (のむ)');
        expect(getResultEntryText(entry, new Set(), [], new Map(), format).text).toContain('呑む (のむ), 飲む (のむ), 飲む (のむ)');
    });
}

for (const format of /** @type {const} */ (['markdown', 'text'])) {
    test(`Rules reach list items, table cells and table groups in ${format}`, () => {
        const entry = createEntry([
            {tag: 'ol', content: [{tag: 'li', data: {role: 'mapped'}, content: 'old'}, {tag: 'li', data: {role: 'omit'}, content: {tag: 'img', path: 'gone.svg'}}, {tag: 'li', content: 'second'}]},
            {tag: 'table', content: {tag: 'tbody', content: {tag: 'tr', content: [{tag: 'td', data: {role: 'mapped'}, content: 'old cell'}, {tag: 'td', content: 'kept'}]}}},
            {tag: 'table', content: {tag: 'tbody', data: {role: 'omit'}, content: {tag: 'tr', content: {tag: 'td', content: {tag: 'img', path: 'gone-too.svg'}}}}},
        ]);
        const rules = [
            {...labels, match: {data: {role: 'mapped'}, ancestors: [{tag: 'ol'}]}, action: /** @type {const} */ ('replace'), text: 'new item'},
            {...labels, match: {data: {role: 'mapped'}, ancestors: [{tag: 'tr'}, {tag: 'table'}]}, action: /** @type {const} */ ('replace'), text: 'new cell'},
            {...labels, match: {data: {role: 'omit'}}, action: /** @type {const} */ ('omit')},
        ];
        const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), format, {contentRules: rules});
        expect(result.text).toContain('1. new item\n2. second');
        expect(result.text).toContain(format === 'markdown' ? '| new cell | kept |' : 'new cell\tkept');
        expect(result.unresolvedImages).toBe(0);
        expect(result.images).toEqual([]);
        expect(result.text).not.toContain('old');
    });
}

test('Sibling separators respect omission, unmatched and empty boundaries and escape literals', () => {
    const label = (/** @type {string} */ content) => /** @type {import('structured-content').StyledElement} */ ({tag: 'span', data: {class: 'tag'}, content});
    const entry = createEntry([label('A'), label('B'), {tag: 'span', data: {role: 'omit'}, content: 'gone'}, label('C'), ' gap ', label('D'), label(''), label('E'), {tag: 'span', data: {class: 'tag'}, title: '[Title]', content: {tag: 'img', path: 'skip.svg'}}]);
    const rules = [
        {...labels, match: {title: '[Title]'}, action: /** @type {const} */ ('title'), prefix: '*', suffix: '_'},
        {id: 'omit', dictionary: 'Dictionary', revision: '1', match: {data: {role: 'omit'}}, action: /** @type {const} */ ('omit')},
        {...labels, separator: '|'},
    ];
    const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'markdown', {contentRules: rules});
    expect(result.text).toContain('A\\|BC gap DE\\*\\[Title\\]\\_');
    expect(result.unresolvedImages).toBe(0);
    expect(result.images).toEqual([]);
});

test('List item content rules preserve structure and sibling separators', () => {
    const entry = createEntry({tag: 'ol', content: [{tag: 'li', content: 'one'}, {tag: 'li', content: 'two'}]});
    const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'markdown', {contentRules: [{...labels, match: {tag: 'li'}, separator: ' · '}]});
    expect(result.text).toContain('1. one ·\n2. two');
});

for (const action of /** @type {const} */ (['omit', 'replace', 'title'])) {
    test(`Ancestor ${action} wins over descendant rules and unresolved images`, () => {
        const entry = createEntry({tag: 'div', title: 'group title', data: {role: 'group'}, content: [{tag: 'span', data: {class: 'tag'}, content: 'child'}, {tag: 'img', path: 'missing.svg'}]});
        const base = {id: 'group', dictionary: 'Dictionary', revision: '1', match: {data: {role: 'group'}}};
        const rule = action === 'replace' ? {...base, action, text: 'replacement'} : {...base, action};
        const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'text', {contentRules: [rule, labels]});
        expect(result.text).not.toContain('child');
        expect(result.unresolvedImages).toBe(0);
        expect(result.images).toEqual([]);
        if (action === 'omit') {
            expect(result.text).toBe('');
        } else {
            expect(result.text).toContain(action === 'title' ? 'group title' : 'replacement');
        }
    });
}

test('Rule order, revision changes and missing revisions affect copied output', () => {
    const entry = createEntry({tag: 'span', data: {class: 'tag'}, content: 'original'});
    const rules = [{...labels, action: /** @type {const} */ ('replace'), text: 'first'}, {...labels, id: 'later', action: /** @type {const} */ ('replace'), text: 'later'}];
    expect(getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'text', {contentRules: rules}).text).toContain('first');
    for (const revisions of [new Map(), new Map([['Dictionary', '2']])]) {
        expect(getResultEntryText(entry, new Set(), [], revisions, 'text', {contentRules: rules}).text).toContain('original');
    }
});

for (const format of /** @type {const} */ (['markdown', 'text'])) {
    test(`Editable title rules recover fixture form indicators in ${format}`, async () => {
        const {readFileSync} = await import('node:fs');
        const {parseJson} = await import('../ext/js/core/json.js');
        const forms = /** @type {import('structured-content').Content} */ (parseJson(readFileSync(new URL('data/copy-jitendex-forms.json', import.meta.url), 'utf8')));
        const entry = createEntry(forms);
        /** @type {import('settings').CopyContentRule[]} */
        const rules = ['pri', 'valid'].map(/**
                                            * @param {string} name
                                            * @returns {import('settings').CopyContentRule}
                                            */ (name) => ({id: name, dictionary: 'Dictionary', revision: '1', match: {tag: 'span', empty: true, ancestors: [{tag: 'td', data: {class: `form-${name}`}}, {data: {content: 'forms'}}]}, action: /** @type {const} */ ('title')}),
        );
        const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), format, {contentRules: rules});
        expect(result.text).toContain('high priority form');
        expect(result.text).toContain('valid form/reading combination');
        expect(result.text).not.toContain('spelling and reading variants');
        expect(getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), format).text).not.toContain('high priority form');
    });
}

test('Content mappings on table groups keep Markdown cells and literal decorations', () => {
    const entry = createEntry({tag: 'table', content: {tag: 'tbody', content: {tag: 'tr', content: [{tag: 'td', content: 'one'}, {tag: 'td', content: 'two'}]}}});
    const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'markdown', {contentRules: [{...labels, match: {tag: 'tbody'}, prefix: '*group*', suffix: '_end_'}]});
    expect(result.text).toContain('| one | two |');
    expect(result.text).toContain('\\*group\\*');
    expect(result.text).toContain('\\_end\\_');
});

test('Table cell separators escape literal text and omission breaks adjacent runs', () => {
    const entry = createEntry({tag: 'table', content: {tag: 'tr', content: [{tag: 'td', content: 'one'}, {tag: 'td', content: 'two'}, {tag: 'td', data: {role: 'omit'}, content: 'hidden'}, {tag: 'td', content: 'three'}]}});
    const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'markdown', {contentRules: [
        {id: 'omit', dictionary: 'Dictionary', revision: '1', match: {data: {role: 'omit'}}, action: 'omit'},
        {...labels, match: {tag: 'td'}, separator: '|'},
    ]});
    expect(result.text).toContain('| one\\| | two |  | three |');
});

test('Whitespace-only rendered content does not join sibling runs', () => {
    const entry = createEntry([{tag: 'span', content: 'one'}, {tag: 'span', content: {tag: 'div'}}, {tag: 'span', content: 'two'}]);
    const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'text', {contentRules: [{...labels, match: {tag: 'span'}, separator: '|'}]});
    expect(result.text).not.toContain('|');
});

test('Oversized table fallback retains cell mappings, separators and one image outcome', () => {
    const entry = createEntry({tag: 'table', content: {tag: 'tr', content: [{tag: 'td', colSpan: 10001, content: ['one', {tag: 'br'}, 'line']}, {tag: 'td', content: 'two'}, {tag: 'td', content: {tag: 'img', path: 'missing.svg'}}]}});
    const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'markdown', {contentRules: [{...labels, match: {tag: 'td'}, separator: '|'}]});
    expect(result.text).toContain('one\nline|\ttwo\t');
    expect(result.unresolvedImages).toBe(1);
    expect(result.images).toHaveLength(1);
});

for (const mappedWrapper of [false, true]) {
    test(`Table fallback terminates with a mapped row and ${mappedWrapper ? 'mapped' : 'unmapped'} wrapper`, () => {
        const entry = createEntry({tag: 'table',
            content: {tag: 'tbody',
                content: [
                    {tag: 'tr', data: {role: 'mapped'}, content: [{tag: 'td', content: 'one'}, {tag: 'td', content: 'two'}]},
                    {tag: 'tr', content: [{tag: 'td', content: 'three'}, {tag: 'td', content: 'four'}]},
                ]}});
        /** @type {import('settings').CopyContentRule[]} */
        const rules = [{...labels, match: {tag: 'tr', data: {role: 'mapped'}}, prefix: '*row*'}];
        if (mappedWrapper) { rules.unshift({...labels, id: 'wrapper', match: {tag: 'tbody'}, prefix: '*wrapper*'}); }
        const result = getResultEntryText(entry, new Set(), [], new Map([['Dictionary', '1']]), 'markdown', {contentRules: rules});
        expect(result.text).toContain('| one | two |');
        expect(result.text).toContain('| three | four |');
        expect(result.text.match(/\\\*row\\\*/g)).toHaveLength(1);
        if (mappedWrapper) { expect(result.text.match(/\\\*wrapper\\\*/g)).toHaveLength(1); }
    });
}
