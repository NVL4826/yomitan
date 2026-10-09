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

import {expect, vi} from 'vitest';
import {Application} from '../ext/js/application.js';
import {API} from '../ext/js/comm/api.js';
import {CrossFrameAPI} from '../ext/js/comm/cross-frame-api.js';
import {OptionsUtil} from '../ext/js/data/options-util.js';
import {DisplayAudio} from '../ext/js/display/display-audio.js';
import {Display} from '../ext/js/display/display.js';
import {SearchDisplayController} from '../ext/js/display/search-display-controller.js';
import {SearchPersistentStateController} from '../ext/js/display/search-persistent-state-controller.js';
import {DocumentFocusController} from '../ext/js/dom/document-focus-controller.js';
import {querySelectorNotNull} from '../ext/js/dom/query-selector.js';
import {WebExtension} from '../ext/js/extension/web-extension.js';
import {ObjectPropertyAccessor} from '../ext/js/general/object-property-accessor.js';
import {HotkeyHandler} from '../ext/js/input/hotkey-handler.js';
import {createDomTest} from './fixtures/dom-test.js';
import {chrome, fetch} from './mocks/common.js';

const test = createDomTest('ext/search.html');

/**
 * @param {string} term
 * @param {import('dictionary-data').TermGlossaryContent[]} entries
 * @returns {import('dictionary').TermDictionaryEntry}
 */
function createEntry(term, entries) {
    return {
        type: 'term',
        isPrimary: true,
        textProcessorRuleChainCandidates: [],
        inflectionRuleChainCandidates: [],
        score: 0,
        frequencyOrder: 0,
        dictionaryIndex: 0,
        dictionaryAlias: 'Dictionary A',
        sourceTermExactMatchCount: 1,
        matchPrimaryReading: false,
        maxOriginalTextLength: term.length,
        headwords: [{index: 0, headwordIndex: 0, term, reading: 'ことば', sources: [], tags: [], wordClasses: []}],
        definitions: [{
            index: 0,
            headwordIndices: [0],
            dictionary: 'Dictionary A',
            dictionaryIndex: 0,
            dictionaryAlias: 'Dictionary A',
            id: 1,
            score: 0,
            frequencyOrder: 0,
            sequences: [-1],
            isPrimary: true,
            tags: [],
            entries,
        }],
        pronunciations: [],
        frequencies: [],
    };
}

/**
 * @param {import('settings').Options} [savedOptions]
 * @returns {Promise<{display: Display, application: Application, api: API, options: import('settings').ProfileOptions, optionsFull: import('settings').Options, clipboard: {text: string}, copy: ReturnType<typeof vi.fn>, render: (entries: import('dictionary').DictionaryEntry[]) => Promise<void>}>}
 */
async function setupSearch(savedOptions) {
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('chrome', {...chrome, runtime: {...chrome.runtime, onMessage: {addListener: vi.fn()}}});
    window.matchMedia = vi.fn().mockReturnValue({matches: false, addEventListener: vi.fn()});
    window.HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn().mockReturnValue({});
    const optionsUtil = new OptionsUtil();
    await optionsUtil.prepare();
    const optionsFull = savedOptions ?? optionsUtil.getDefault();
    const options = optionsFull.profiles[optionsFull.profileCurrent].options;
    options.scanning.enableOnSearchPage = false;
    options.general.enableWanakana = false;
    options.parsing.enableScanningParser = false;
    options.clipboard.enableSearchPageMonitor = false;
    if (typeof savedOptions === 'undefined') {
        options.dictionaries = [{name: 'Dictionary A', alias: '', enabled: true, allowSecondarySearches: false, definitionsCollapsible: 'collapsed', partsOfSpeechFilter: true, useDeinflections: true}];
    }
    const api = new API(new WebExtension());
    vi.spyOn(api, 'optionsGet').mockResolvedValue(options);
    vi.spyOn(api, 'optionsGetFull').mockResolvedValue(optionsFull);
    vi.spyOn(api, 'getEnvironmentInfo').mockResolvedValue({browser: 'firefox', platform: {os: 'linux'}});
    vi.spyOn(api, 'getLanguageSummaries').mockResolvedValue([]);
    vi.spyOn(api, 'getDictionaryInfo').mockResolvedValue([
        {title: 'Dictionary A', revision: '2026-01', sequenced: true, version: 3, importDate: 0, prefixWildcardsSupported: false, styles: ''},
        {title: '新明解国語辞典　第八版', revision: 'smk8;2023-07-09', sequenced: true, version: 3, importDate: 0, prefixWildcardsSupported: false, styles: ''},
    ]);
    vi.spyOn(api, 'parseText').mockResolvedValue([]);
    vi.spyOn(api, 'drawMedia').mockImplementation(() => {});
    vi.spyOn(api, 'getMedia').mockResolvedValue([]);
    const clipboard = {text: 'previous clipboard'};
    vi.spyOn(api, 'clipboardGet').mockImplementation(async () => clipboard.text);
    const copy = vi.fn(() => {
        // Native copy fires the event before the default clipboard write.
        window.dispatchEvent(new Event('copy'));
        clipboard.text = /** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, 'body > textarea')).value;
        return true;
    });
    document.execCommand = copy;
    const application = new Application(api, new CrossFrameAPI(api, null, null));
    const display = new Display(application, 'search', new DocumentFocusController(), new HotkeyHandler());
    await display.prepare();
    const controller = new SearchDisplayController(display, new DisplayAudio(display), new SearchPersistentStateController());
    await controller.prepare();
    /** @param {import('dictionary').DictionaryEntry[]} entries */
    const render = async (entries) => {
        const completed = new Promise((resolve) => { display.on('contentUpdateComplete', resolve); });
        display.setContent({
            focus: false,
            historyMode: 'clear',
            params: {query: '言葉'},
            state: {},
            content: {dictionaryEntries: entries},
        });
        await completed;
    };
    return {display, application, api, options, optionsFull, clipboard, copy, render};
}

for (const kind of ['fresh', 'upgraded']) {
    test(`Copy options default to Markdown for ${kind} settings`, async ({window}) => {
        vi.stubGlobal('fetch', fetch);
        vi.stubGlobal('chrome', chrome);
        const util = new OptionsUtil();
        await util.prepare();
        const legacy = {version: 79, profileCurrent: 0, global: {}, profiles: [{name: 'Default', options: {general: {}}}]};
        const saved = kind === 'fresh' ? util.getDefault() : await util.update(legacy);
        await setupSearch(saved);
        const select = /** @type {HTMLSelectElement} */ (querySelectorNotNull(window.document, '#copy-format'));
        expect(select.value).toBe('markdown');
        expect(select.labels?.[0].textContent).toBe('Copy format');
        expect([...select.options].map(({textContent, value}) => [textContent, value])).toEqual([
            ['Markdown', 'markdown'], ['Plain text', 'text'],
        ]);
    });
}

test('Copy format survives reopening and remains independent across profiles', async ({window}) => {
    const {document} = window;
    const {api, application, display, optionsFull} = await setupSearch();
    optionsFull.profiles.push({...structuredClone(optionsFull.profiles[0]), name: 'Other'});
    const util = new OptionsUtil();
    await util.prepare();
    /** @type {Record<string, unknown>} */
    let storage = {};
    vi.stubGlobal('chrome', {...globalThis.chrome,
        storage: {local: {
            set: (/** @type {Record<string, unknown>} */ values, /** @type {() => void} */ callback) => { storage = values; callback(); },
            get: (/** @type {string[]} */ _keys, /** @type {(values: Record<string, unknown>) => void} */ callback) => { callback(storage); },
        }}});
    vi.spyOn(api, 'optionsGet').mockImplementation(async (context) => optionsFull.profiles[context.index ?? optionsFull.profileCurrent].options);
    vi.spyOn(api, 'modifySettings').mockImplementation(async (targets, source) => {
        for (const target of targets) {
            if (target.action !== 'set') { throw new Error('Expected a setting update'); }
            const context = target.optionsContext;
            const index = context?.index ?? optionsFull.profileCurrent;
            const options = target.scope === 'global' ? optionsFull : optionsFull.profiles[index].options;
            new ObjectPropertyAccessor(options).set(ObjectPropertyAccessor.getPathArray(target.path), target.value);
        }
        await util.save(optionsFull);
        application.trigger('optionsUpdated', {source});
        return [{result: true}];
    });
    await display.updateOptions();
    await vi.waitFor(() => { expect(document.querySelectorAll('#profile-select-option-group option')).toHaveLength(2); });
    const select = /** @type {HTMLSelectElement} */ (querySelectorNotNull(document, '#copy-format'));
    select.value = 'text';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => { expect(storage.options).toBeTypeOf('string'); });
    const profiles = /** @type {HTMLSelectElement} */ (querySelectorNotNull(document, '#profile-select'));
    profiles.value = '1';
    profiles.dispatchEvent(new Event('change'));
    await vi.waitFor(() => { expect(select.value).toBe('markdown'); });
    profiles.value = '0';
    profiles.dispatchEvent(new Event('change'));
    await vi.waitFor(() => { expect(select.value).toBe('text'); });
    const reloaded = await util.load();
    select.replaceWith(select.cloneNode(true));
    profiles.replaceWith(profiles.cloneNode(true));
    await setupSearch(reloaded);
    expect(/** @type {HTMLSelectElement} */ (querySelectorNotNull(document, '#copy-format')).value).toBe('text');
});

for (const format of ['markdown', 'text']) {
    test(`Result-entry Copy uses the selected ${format} format`, async ({window}) => {
        const {api, clipboard, render} = await setupSearch();
        vi.spyOn(api, 'modifySettings').mockResolvedValue([{result: true}]);
        const select = /** @type {HTMLSelectElement} */ (querySelectorNotNull(window.document, '#copy-format'));
        select.value = format;
        select.dispatchEvent(new Event('change'));
        await render([createEntry('言葉', ['word'])]);
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
        expect(clipboard.text).toContain(format === 'markdown' ? '# 言葉 (ことば)' : '言葉 (ことば)');
        expect(clipboard.text).toContain(format === 'markdown' ? '## 1. Dictionary A' : '1. Dictionary A');
        expect(clipboard.text).toContain('word');
        if (format === 'text') { expect(clipboard.text).not.toContain('#'); }
    });
}

for (const failure of ['throws', 'returns error']) {
    test(`Copy format reports a save that ${failure} and restores the saved choice`, async ({window}) => {
        const {api} = await setupSearch();
        vi.spyOn(api, 'modifySettings').mockImplementation(async () => {
            if (failure === 'throws') { throw new Error('Storage unavailable'); }
            return [{error: {name: 'Error', message: 'Storage unavailable', stack: ''}}];
        });
        const select = /** @type {HTMLSelectElement} */ (querySelectorNotNull(window.document, '#copy-format'));
        select.value = 'text';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => {
            expect(querySelectorNotNull(window.document, '#copy-options-status').textContent).toBe('Could not save copy options. Please try again.');
        });
        expect(select.value).toBe('markdown');
    });
}

test('Image inspector retains plain-text context when Copy uses Markdown', async ({window}) => {
    const {render} = await setupSearch();
    window.HTMLDialogElement.prototype.showModal = vi.fn();
    await render([createEntry('言葉', [{type: 'structured-content',
        content: [
            {tag: 'div', content: 'Context heading'},
            {tag: 'div', content: 'before *literal*'},
            {tag: 'img', path: 'missing.svg'},
        ]}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="inspect-copy-images"]')).click();
    const context = querySelectorNotNull(window.document, '.copy-image-context').textContent;
    expect(context).toContain('before *literal*');
    expect(context).not.toContain('#');
});
