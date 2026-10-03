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

import {IDBKeyRange, indexedDB} from 'fake-indexeddb';
import JSZip from 'jszip';
import {Blob} from 'node:buffer';
import {expect, vi} from 'vitest';
import {Application} from '../ext/js/application.js';
import {API} from '../ext/js/comm/api.js';
import {CrossFrameAPI} from '../ext/js/comm/cross-frame-api.js';
import {OptionsUtil} from '../ext/js/data/options-util.js';
import {DictionaryDatabase} from '../ext/js/dictionary/dictionary-database.js';
import {DictionaryImporter} from '../ext/js/dictionary/dictionary-importer.js';
import {DisplayAudio} from '../ext/js/display/display-audio.js';
import {Display} from '../ext/js/display/display.js';
import {SearchDisplayController} from '../ext/js/display/search-display-controller.js';
import {SearchPersistentStateController} from '../ext/js/display/search-persistent-state-controller.js';
import {DocumentFocusController} from '../ext/js/dom/document-focus-controller.js';
import {querySelectorNotNull} from '../ext/js/dom/query-selector.js';
import {WebExtension} from '../ext/js/extension/web-extension.js';
import {HotkeyHandler} from '../ext/js/input/hotkey-handler.js';
import {Translator} from '../ext/js/language/translator.js';
import {createDomTest} from './fixtures/dom-test.js';
import {chrome, fetch} from './mocks/common.js';
import {DictionaryImporterMediaLoader} from './mocks/dictionary-importer-media-loader.js';
import {setupStubs} from './utilities/database.js';
import {createFindTermsOptions} from './utilities/translator.js';

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
 * @param {boolean} [monitor]
 * @param {import('display').DisplayPageType} [pageType]
 * @returns {Promise<{display: Display, api: API, options: import('settings').ProfileOptions, clipboard: {text: string}, copy: ReturnType<typeof vi.fn>, render: (entries: import('dictionary').DictionaryEntry[]) => Promise<void>}>}
 */
async function setupSearch(monitor = false, pageType = 'search') {
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('chrome', {...chrome, runtime: {...chrome.runtime, onMessage: {addListener: vi.fn()}}});
    window.matchMedia = vi.fn().mockReturnValue({matches: false, addEventListener: vi.fn()});
    window.HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn().mockReturnValue({});
    const optionsUtil = new OptionsUtil();
    await optionsUtil.prepare();
    const optionsFull = optionsUtil.getDefault();
    const options = optionsFull.profiles[0].options;
    options.scanning.enableOnSearchPage = false;
    options.general.enableWanakana = false;
    options.parsing.enableScanningParser = false;
    options.clipboard.enableSearchPageMonitor = monitor;
    options.dictionaries = [{name: 'Dictionary A', alias: '', enabled: true, allowSecondarySearches: false, definitionsCollapsible: 'collapsed', partsOfSpeechFilter: true, useDeinflections: true}];
    const api = new API(new WebExtension());
    vi.spyOn(api, 'optionsGet').mockResolvedValue(options);
    vi.spyOn(api, 'optionsGetFull').mockResolvedValue(optionsFull);
    vi.spyOn(api, 'getEnvironmentInfo').mockResolvedValue({browser: 'firefox', platform: {os: 'linux'}});
    vi.spyOn(api, 'getLanguageSummaries').mockResolvedValue([]);
    vi.spyOn(api, 'getDictionaryInfo').mockResolvedValue([]);
    vi.spyOn(api, 'parseText').mockResolvedValue([]);
    vi.spyOn(api, 'drawMedia').mockImplementation(() => {});
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
    const display = new Display(application, pageType, new DocumentFocusController(), new HotkeyHandler());
    await display.prepare();
    if (pageType === 'search') {
        const controller = new SearchDisplayController(display, new DisplayAudio(display), new SearchPersistentStateController());
        await controller.prepare();
    } else {
        await display.updateOptions();
    }
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
    return {display, api, options, clipboard, copy, render};
}

test('Copy targets the clicked result, includes collapsed text, and reports success', async ({window}) => {
    const {document} = window;
    const {copy, render} = await setupSearch();
    await render([createEntry('neighbor', ['Do not copy this']), createEntry('言葉', ['word\nExample: 言葉を使う'])]);
    window.getSelection()?.selectAllChildren(querySelectorNotNull(document, '.entry[data-index="0"]'));
    const entry = querySelectorNotNull(document, '.entry[data-index="1"]');
    const button = /** @type {HTMLButtonElement} */ (querySelectorNotNull(entry, 'button[data-action="copy-entry"]'));
    button.focus();
    expect(document.activeElement).toBe(button);
    let copiedText = '';
    copy.mockImplementation(() => {
        copiedText = /** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, 'body > textarea')).value;
        return true;
    });
    button.click();
    expect(copiedText).toContain('言葉 (ことば)');
    expect(copiedText).toContain('Dictionary A');
    expect(copiedText).toContain('word\nExample: 言葉を使う');
    expect(copiedText).not.toContain('neighbor');
    expect(copiedText).not.toContain('Copy');
    expect(querySelectorNotNull(entry, '[role="status"]').textContent).toBe('Copied.');
    expect(document.activeElement).toBe(button);
});

test('Kanji results on the search page have no Copy control', async ({window}) => {
    const {render} = await setupSearch();
    await render([{
        type: 'kanji',
        character: '字',
        dictionary: 'Dictionary A',
        dictionaryIndex: 0,
        dictionaryAlias: 'Dictionary A',
        onyomi: ['ジ'],
        kunyomi: ['あざ'],
        tags: [],
        stats: {},
        definitions: ['character'],
        frequencies: [],
    }]);
    expect(window.document.querySelector('.entry[data-type="kanji"]')).not.toBeNull();
    expect(window.document.querySelector('button[data-action="copy-entry"]')).toBeNull();
});

test('Popup word results have no Copy control', async ({window}) => {
    const {render} = await setupSearch(false, 'popup');
    await render([createEntry('言葉', ['word'])]);
    expect(window.document.querySelector('.entry[data-type="term"]')).not.toBeNull();
    expect(window.document.querySelector('button[data-action="copy-entry"]')).toBeNull();
});

test('Copy omits image assets, silently skips explicit illustrations, and counts unresolved occurrences', async ({window}) => {
    const {document} = window;
    const {clipboard, render} = await setupSearch();
    await render([createEntry('言葉', [{type: 'structured-content',
        content: [
            'before ',
            {tag: 'img', path: 'label.svg', title: '表記'},
            ' after',
            {tag: 'img', path: 'photo.png', data: {role: 'illustration'}},
            {tag: 'img', path: 'unknown.png'},
            {tag: 'img', path: 'unknown.png'},
        ]}, {type: 'image', path: 'standalone.png'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, 'button[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('before  after');
    expect(clipboard.text).not.toMatch(/\.svg|\.png|表記|Image|<img/);
    expect(querySelectorNotNull(document, '[role="status"]').textContent).toBe('Copied. 4 unresolved image(s) omitted.');
});

test('Copy recognizes an explicit illustration after dictionary import and lookup', async ({window}) => {
    const {document} = window;
    const {clipboard, render} = await setupSearch();
    setupStubs();
    vi.stubGlobal('indexedDB', indexedDB);
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    vi.stubGlobal('Blob', Blob);
    const archive = new JSZip();
    archive.file('index.json', JSON.stringify({title: 'Dictionary A', format: 3, revision: 'test'}));
    archive.file('term_bank_1.json', JSON.stringify([['言葉', 'ことば', '', '', 0, [{
        type: 'structured-content',
        content: [
            'word',
            {tag: 'img', path: 'image.svg', data: {role: 'illustration'}},
            {tag: 'img', path: 'image.svg'},
        ],
    }], 1, '']]));
    archive.file('image.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const database = new DictionaryDatabase();
    await database.prepare();
    try {
        const importer = new DictionaryImporter(new DictionaryImporterMediaLoader());
        const {errors} = await importer.importDictionary(database, await archive.generateAsync({type: 'arraybuffer'}), {prefixWildcardsSupported: true, yomitanVersion: '0.0.0.0'});
        expect(errors).toEqual([]);
        const translator = new Translator(database);
        translator.prepare();
        const options = createFindTermsOptions('Dictionary A', {}, [{
            type: 'terms', enabledDictionaryMap: [['Dictionary A', {index: 0, allowSecondarySearches: true, alias: '', partsOfSpeechFilter: true, useDeinflections: true}]],
        }]);
        const {dictionaryEntries} = await translator.findTerms('group', '言葉', options);
        await render(dictionaryEntries);
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, 'button[data-action="copy-entry"]')).click();
        expect(clipboard.text).toContain('word');
        expect(querySelectorNotNull(document, '[role="status"]').textContent).toBe('Copied. 1 unresolved image(s) omitted.');
    } finally {
        await database.close();
    }
});

test('Copy preserves the clipboard when dictionaries have no copyable text', async ({window}) => {
    const {document} = window;
    const {copy, clipboard, render} = await setupSearch();
    await render([createEntry('言葉', ['  ', {type: 'image', path: 'unknown.svg'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, 'button[data-action="copy-entry"]')).click();
    expect(copy).not.toHaveBeenCalled();
    expect(clipboard.text).toBe('previous clipboard');
    expect(querySelectorNotNull(document, '[role="status"]').textContent).toBe('No dictionary content to copy.');
});

for (const failure of ['returns false', 'throws']) {
    test(`Copy reports failure when the clipboard write ${failure}`, async ({window}) => {
        const {document} = window;
        const {copy, clipboard, render} = await setupSearch();
        await render([createEntry('言葉', ['word'])]);
        copy.mockImplementation(() => {
            if (failure === 'throws') { throw new Error('Clipboard unavailable'); }
            return false;
        });
        const button = /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, 'button[data-action="copy-entry"]'));
        button.focus();
        button.click();
        expect(clipboard.text).toBe('previous clipboard');
        expect(querySelectorNotNull(document, '[role="status"]').textContent).toBe('Could not copy this result. Please try again.');
        expect(document.querySelector('body > textarea')).toBeNull();
        expect(document.activeElement).toBe(button);
    });
}

test('Copy with clipboard monitoring enabled keeps the current search', async ({window}) => {
    const {document} = window;
    const {api, display, options, clipboard, render} = await setupSearch(true);
    const lookup = vi.spyOn(api, 'isTextLookupWorthy').mockResolvedValue(true);
    try {
        await render([createEntry('言葉', ['word'])]);
        await new Promise((resolve) => { setTimeout(resolve, 300); });
        const button = /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, 'button[data-action="copy-entry"]'));
        button.focus();
        button.click();
        await new Promise((resolve) => { setTimeout(resolve, 600); });
        expect(clipboard.text).toContain('word');
        expect(lookup).not.toHaveBeenCalled();
        expect(/** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '#search-textbox')).value).toBe('言葉');
    } finally {
        options.clipboard.enableSearchPageMonitor = false;
        await display.updateOptions();
    }
});

test('Copy includes all variants, dictionary text, tags, frequencies, and structured pronunciations', async ({window}) => {
    const {document} = window;
    const {copy, render} = await setupSearch();
    const entry = createEntry('言葉', ['word', {type: 'text', text: 'A second meaning'}]);
    const tag = {name: 'noun', category: 'partOfSpeech', order: 0, score: 0, content: ['a noun'], dictionaries: ['Dictionary A'], redundant: true};
    entry.headwords[0].tags = [tag];
    entry.headwords.push({...entry.headwords[0], index: 1, headwordIndex: 1, term: '詞', reading: 'コトバ', tags: []});
    entry.definitions[0].headwordIndices = [0, 1];
    entry.definitions[0].tags = [tag];
    entry.definitions.push({...entry.definitions[0],
        dictionary: 'Dictionary B',
        dictionaryAlias: 'Dictionary B',
        tags: [],
        entries: [{
            type: 'structured-content',
            content: {tag: 'details',
                content: [
                    {tag: 'summary', content: 'Usage'},
                    {tag: 'ol',
                        content: [
                            {tag: 'li', content: ['Example: ', {tag: 'ruby', content: ['言葉', {tag: 'rt', content: 'ことば'}]}, 'を使う']},
                            {tag: 'li', content: [{tag: 'a', href: 'https://example.com', content: 'A note'}, {tag: 'br'}, 'Another line']},
                        ]},
                    {tag: 'table', content: {tag: 'tbody', content: {tag: 'tr', content: [{tag: 'td', content: 'formal'}, {tag: 'td', content: 'informal'}]}}},
                ]},
        }]});
    entry.frequencies = [{
        index: 0,
        headwordIndex: 1,
        dictionary: 'Frequency Dictionary',
        dictionaryIndex: 2,
        dictionaryAlias: 'Frequency Dictionary',
        hasReading: true,
        frequencyMode: 'rank-based',
        frequency: 123,
        displayValue: '123 (common)',
        displayValueParsed: true,
    }];
    entry.pronunciations = [{
        index: 0,
        headwordIndex: 0,
        dictionary: 'Pronunciation Dictionary',
        dictionaryIndex: 3,
        dictionaryAlias: 'Pronunciation Dictionary',
        pronunciations: [
            {type: 'pitch-accent', positions: 0, nasalPositions: [2], devoicePositions: [1], tags: []},
            {type: 'pitch-accent', positions: '1,2', nasalPositions: [], devoicePositions: [], tags: []},
            {type: 'phonetic-transcription', ipa: 'kotoba', tags: []},
        ],
    }];
    const original = structuredClone(entry);
    await render([entry]);
    let copiedText = '';
    copy.mockImplementation(() => {
        copiedText = /** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, 'body > textarea')).value;
        return true;
    });
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, 'button[data-action="copy-entry"]')).click();
    expect(copiedText).toContain('言葉 (ことば)\n詞 (コトバ)');
    expect(copiedText).toContain('noun: a noun');
    expect(copiedText).toContain('word\nA second meaning');
    expect(copiedText).toContain('Dictionary B');
    expect(copiedText).toContain('Usage\n');
    expect(copiedText).toContain('Example: 言葉(ことば)を使う');
    expect(copiedText).toContain('A note\nAnother line');
    expect(copiedText).toContain('formal\tinformal');
    expect(copiedText).toContain('Frequency Dictionary\nFrequency: 詞 (コトバ): 123 (common)');
    expect(copiedText).toContain('Pronunciation Dictionary\nPitch accent: 言葉 (ことば): downstep 0; nasal morae 2; devoiced morae 1');
    expect(copiedText).toContain('downstep 1,2');
    expect(copiedText).toContain('IPA: 言葉 (ことば): kotoba');
    expect(copiedText).not.toMatch(/https:|<\/?(?:details|li|ruby|table)>|Play audio/);
    expect(entry).toEqual(original);
});
