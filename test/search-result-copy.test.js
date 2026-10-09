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

import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import JSZip from 'jszip';
import {Blob} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {expect, vi} from 'vitest';
import {parseJson} from '../ext/js/core/json.js';
import {Backend} from '../ext/js/background/backend.js';
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
import {ObjectPropertyAccessor} from '../ext/js/general/object-property-accessor.js';
import {HotkeyHandler} from '../ext/js/input/hotkey-handler.js';
import {Translator} from '../ext/js/language/translator.js';
import {createDomTest} from './fixtures/dom-test.js';
import {chrome, fetch} from './mocks/common.js';
import {DictionaryImporterMediaLoader} from './mocks/dictionary-importer-media-loader.js';
import {setupStubs} from './utilities/database.js';
import {createFindTermsOptions} from './utilities/translator.js';

const test = createDomTest('ext/search.html');

// Trimmed from the supplied SMK8 亜 entry; label paths verified against the supplied SVG text.
const imageFixtures = /** @type {{sample: import('dictionary-data').TermGlossaryContent[], labels: import('structured-content').ImageElement[]}} */ (
    parseJson(readFileSync(new URL('data/copy-image-content.json', import.meta.url), 'utf8'))
);

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
 * @param {import('settings').Options} [savedOptions]
 * @returns {Promise<{display: Display, application: Application, api: API, options: import('settings').ProfileOptions, optionsFull: import('settings').Options, clipboard: {text: string}, copy: ReturnType<typeof vi.fn>, render: (entries: import('dictionary').DictionaryEntry[]) => Promise<void>}>}
 */
async function setupSearch(monitor = false, pageType = 'search', savedOptions) {
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
    options.clipboard.enableSearchPageMonitor = monitor;
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
    return {display, application, api, options, optionsFull, clipboard, copy, render};
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
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied. 4 unresolved image(s) omitted.');
});

test('Copy recovers image metadata inline and keeps collapsed sample definitions', async ({window}) => {
    const {document} = window;
    const {clipboard, render} = await setupSearch();
    const entry = createEntry('亜', [
        ...imageFixtures.sample,
        {type: 'structured-content',
            content: [
                'before ',
                {tag: 'img', path: 'text.svg', alt: ' Alternative ', description: 'Wrong description', title: 'Wrong title'},
                ' between ',
                {tag: 'img', path: 'description.svg', alt: '  ', description: 'Description'},
                ' after',
                {tag: 'img', path: 'title.svg', title: 'Title label', data: {role: 'label'}},
                {tag: 'img', path: 'photo.svg', alt: 'Do not copy a photo caption', data: {role: 'illustration'}},
            ]},
        {type: 'image', path: 'standalone.svg', description: 'Standalone description'},
        {type: 'image', path: 'standalone-alt.svg', alt: 'Standalone alternative'},
    ]);
    entry.definitions[0].dictionary = '新明解国語辞典　第八版';
    await render([entry]);
    expect(querySelectorNotNull(document, 'details.gloss-sc-details').hasAttribute('open')).toBe(false);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('一㊀…に次ぐ。「亜流・亜熱帯」\n二（略）アジア（亜細亜）。');
    expect(clipboard.text).toContain('before Alternative between Description afterTitle label');
    expect(clipboard.text).toContain('Standalone description\nStandalone alternative');
    expect(clipboard.text).not.toMatch(/Wrong|photo caption|\.svg|Image|<svg/);
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied.');
});

test('Copy recovers verified SMK8 labels and counts only unsupported included images', async ({window}) => {
    const {document} = window;
    const {api, display, options, clipboard, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockResolvedValue([{result: true}]);
    options.dictionaries.push({...options.dictionaries[0], name: '新明解国語辞典　第八版'});
    await display.updateOptions();
    const entry = createEntry('亜', ['Other dictionary content', {type: 'structured-content',
        content: [
            {tag: 'img', path: 'smk8/表記-redfill.svg'},
        ]}]);
    entry.definitions.push({...entry.definitions[0],
        dictionary: '新明解国語辞典　第八版',
        entries: [
            {type: 'structured-content', content: imageFixtures.labels.flatMap((image) => [image, '・'])},
            {type: 'structured-content',
                content: [
                    'Before ',
                    {tag: 'img', path: 'smk8/表記-redfill.svg', alt: 'Image', description: 'smk8/表記-redfill.svg', title: 'Open image'},
                    ' after',
                    {tag: 'img', path: 'smk8/gaiji/G655F.svg'},
                    {tag: 'img', path: 'smk8/unknown.svg', title: 'Arbitrary hover title'},
                    {tag: 'img', path: 'other/表記-redfill.svg'},
                    {tag: 'img', path: 'smk8/unknown.svg', alt: 'https://example.com/image.svg'},
                    {tag: 'img', path: 'smk8/photo.svg', title: 'A photo', data: {role: 'illustration'}},
                ]},
            {type: 'image', path: 'smk8/運用-fill.svg'},
        ]});
    const original = structuredClone(entry);
    await render([entry]);
    const button = /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]'));
    button.click();
    expect(clipboard.text).toContain('かぞえ方・一・二・三・四・五・六・他動・動・名・文法・派・自動・表記・運用・');
    expect(clipboard.text).toContain('Before 表記 after\n運用');
    expect(clipboard.text).not.toMatch(/\.svg|https:|Arbitrary|Open image|A photo|Image|<svg/);
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied. 5 unresolved image(s) omitted.');
    /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input[data-dictionary="新明解国語辞典　第八版"]')).click();
    button.click();
    expect(clipboard.text).toContain('Other dictionary content');
    expect(clipboard.text).not.toMatch(/表記|運用|かぞえ方|新明解/);
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied. 1 unresolved image(s) omitted.');
    /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input[data-dictionary="Dictionary A"]')).click();
    /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input[data-dictionary="新明解国語辞典　第八版"]')).click();
    button.click();
    expect(clipboard.text).toContain('Before 表記 after');
    expect(clipboard.text).not.toContain('Other dictionary content');
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied. 4 unresolved image(s) omitted.');
    expect(entry).toEqual(original);
});

test('Copy preserves image metadata and illustration roles after dictionary import and lookup', async ({window}) => {
    const {document} = window;
    const {clipboard, render} = await setupSearch();
    setupStubs();
    vi.stubGlobal('indexedDB', new IDBFactory());
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
            {tag: 'img', path: 'image.svg', alt: 'Structured alternative'},
            {tag: 'img', path: 'image.svg', description: 'Structured description'},
            {tag: 'img', path: 'image.svg', title: 'Structured title', data: {role: 'text'}},
        ],
    },
    {type: 'image', path: 'image.svg', alt: 'Standalone alternative'},
    {type: 'image', path: 'image.svg', description: 'Standalone description'},
    {type: 'image', path: 'image.svg', title: 'Arbitrary standalone hover title'}], 1, '']]));
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
        expect(clipboard.text).toContain('wordStructured alternativeStructured descriptionStructured title\nStandalone alternative\nStandalone description');
        expect(clipboard.text).not.toMatch(/Arbitrary|\.svg|Image/);
        expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied. 2 unresolved image(s) omitted.');
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
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('No dictionary content to copy.');
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
        expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Could not copy this result. Please try again.');
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
    expect(copiedText).toContain('# 言葉 (ことば)\n# 詞 (コトバ)');
    expect(copiedText).toContain('noun: a noun');
    expect(copiedText).toContain('word\nA second meaning');
    expect(copiedText).toContain('Dictionary B');
    expect(copiedText).toContain('Usage\n');
    expect(copiedText).toContain('Example: 言葉(ことば)を使う');
    expect(copiedText).toContain('2. A note\n   Another line');
    expect(copiedText).toContain('| formal | informal |');
    expect(copiedText).toContain('Frequency Dictionary\nFrequency: 詞 (コトバ): 123 (common)');
    expect(copiedText).toContain('Pronunciation Dictionary\nPitch accent: 言葉 (ことば): downstep 0; nasal morae 2; devoiced morae 1');
    expect(copiedText).toContain('downstep 1,2');
    expect(copiedText).toContain('IPA: 言葉 (ことば): kotoba');
    expect(copiedText).not.toMatch(/https:|<\/?(?:details|li|ruby|table)>|Play audio/);
    expect(entry).toEqual(original);
});

test('Copy checkboxes exclude dictionary content and images without changing lookup results', async ({window}) => {
    const {document} = window;
    const {api, display, options, clipboard, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockResolvedValue([{result: true}]);
    options.dictionaries.push({...options.dictionaries[0], name: 'Dictionary B', alias: 'Second dictionary'});
    await display.updateOptions();
    const entry = createEntry('言葉', ['Excluded definition', {type: 'structured-content',
        content: [
            {tag: 'div', content: 'Excluded example'},
            {tag: 'img', path: 'label.svg', title: '表記'},
            {tag: 'img', path: 'unknown.svg'},
        ]}]);
    const excludedTag = {name: 'excluded tag', category: '', order: 0, score: 0, content: [], dictionaries: ['Dictionary A'], redundant: false};
    const sharedTag = {...excludedTag, name: 'shared tag', dictionaries: ['Dictionary A', 'Dictionary B']};
    entry.headwords[0].tags = [excludedTag, sharedTag];
    entry.definitions.push({...entry.definitions[0], dictionary: 'Dictionary B', tags: [excludedTag, sharedTag], entries: ['Included definition']});
    entry.frequencies.push({index: 0, headwordIndex: 0, dictionary: 'Dictionary A', dictionaryIndex: 0, dictionaryAlias: 'Dictionary A', hasReading: true, frequencyMode: 'rank-based', frequency: 123, displayValue: null, displayValueParsed: false});
    entry.pronunciations.push({index: 0,
        headwordIndex: 0,
        dictionary: 'Dictionary A',
        dictionaryIndex: 0,
        dictionaryAlias: 'Dictionary A',
        pronunciations: [
            {type: 'pitch-accent', positions: 0, nasalPositions: [], devoicePositions: [], tags: []},
            {type: 'phonetic-transcription', ipa: 'kotoba', tags: []},
        ]});
    const original = structuredClone(entry);
    const lookupSettings = structuredClone(options.dictionaries);
    await render([entry]);
    const results = querySelectorNotNull(document, '#dictionary-entries');
    const displayedResults = results.innerHTML;
    const copyButton = /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]'));
    const checkbox = /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input[data-dictionary="Dictionary A"]'));
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    copyButton.click();
    expect(clipboard.text).toContain('Included definition');
    expect(clipboard.text).toContain('shared tag');
    expect(clipboard.text).not.toMatch(/Dictionary A|Excluded|excluded tag|123|downstep|kotoba|表記/);
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied.');
    expect(entry).toEqual(original);
    expect(options.dictionaries).toEqual(lookupSettings);
    expect(display.dictionaryEntries).toEqual([original]);
    expect(results.innerHTML.replace('Copied.', '')).toBe(displayedResults);
    checkbox.click();
    copyButton.click();
    expect(clipboard.text).toContain('Excluded definition');
    expect(clipboard.text).toContain('Excluded example');
    expect(clipboard.text).toContain('excluded tag');
    expect(clipboard.text).toContain('123');
    expect(clipboard.text).toContain('downstep 0');
    expect(clipboard.text).toContain('kotoba');
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied. 2 unresolved image(s) omitted.');
});

test('Copy exclusions survive settings reload and new dictionaries start included', async ({window}) => {
    const {document} = window;
    const {api, application, display, options, optionsFull, render} = await setupSearch();
    const optionsUtil = new OptionsUtil();
    await optionsUtil.prepare();
    /** @type {Record<string, unknown>} */
    let storage = {};
    vi.stubGlobal('chrome', {...globalThis.chrome,
        storage: {local: {
            set: (/** @type {Record<string, unknown>} */ values, /** @type {() => void} */ callback) => { storage = values; callback(); },
            get: (/** @type {string[]} */ _keys, /** @type {(values: Record<string, unknown>) => void} */ callback) => { callback(storage); },
        }}});
    vi.spyOn(api, 'modifySettings').mockImplementation(async (targets, source) => {
        for (const target of targets) {
            expect(target.scope).toBe('profile');
            if (target.action !== 'set') { throw new Error('Expected a setting update'); }
            new ObjectPropertyAccessor(options).set(ObjectPropertyAccessor.getPathArray(target.path), target.value);
        }
        await optionsUtil.save(optionsFull);
        application.trigger('optionsUpdated', {source});
        return [{result: true}];
    });
    await render([createEntry('言葉', ['word'])]);
    const search = vi.spyOn(display, 'searchLast');
    /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input')).click();
    await vi.waitFor(() => { expect(options.general.copyExcludedDictionaries).toEqual(['Dictionary A']); });
    await vi.waitFor(() => { expect(storage.options).toBeTypeOf('string'); });
    const reloaded = await optionsUtil.load();
    reloaded.profiles[0].options.dictionaries.push({...options.dictionaries[0], name: 'Dictionary B', alias: '', enabled: false});
    const reopened = await setupSearch(false, 'search', reloaded);
    expect(search).not.toHaveBeenCalled();
    expect(/** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input[data-dictionary="Dictionary A"]')).checked).toBe(false);
    expect(/** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input[data-dictionary="Dictionary B"]')).checked).toBe(true);
    const entry = createEntry('言葉', ['Excluded after reopening']);
    entry.definitions.push({...entry.definitions[0], dictionary: 'Dictionary B', entries: ['New dictionary content']});
    await reopened.render([entry]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(reopened.clipboard.text).toContain('New dictionary content');
    expect(reopened.clipboard.text).not.toContain('Excluded after reopening');
});

test('Copy leaves the clipboard unchanged when selected dictionaries have no content', async ({window}) => {
    const {document} = window;
    const {api, display, options, copy, clipboard, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockResolvedValue([{result: true}]);
    options.dictionaries.push({...options.dictionaries[0], name: 'Dictionary B'});
    await display.updateOptions();
    const entry = createEntry('言葉', ['Excluded definition']);
    entry.definitions.push({...entry.definitions[0], dictionary: 'Dictionary B', entries: [' ', {type: 'image', path: 'unknown.svg'}]});
    await render([entry]);
    const button = /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]'));
    for (const checkbox of document.querySelectorAll('#copy-dictionaries input')) {
        /** @type {HTMLInputElement} */ (checkbox).click();
        button.click();
        expect(copy).not.toHaveBeenCalled();
        expect(clipboard.text).toBe('previous clipboard');
        expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('No dictionary content to copy.');
    }
});

test('Copy options report persistence failures while applying the current selection', async ({window}) => {
    const {document} = window;
    const {api, copy, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockRejectedValue(new Error('Storage unavailable'));
    await render([createEntry('言葉', ['word'])]);
    /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input')).click();
    await vi.waitFor(() => {
        expect(querySelectorNotNull(document, '#copy-options-status').textContent).toBe('Could not save copy options. Please try again.');
    });
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(copy).not.toHaveBeenCalled();
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('No dictionary content to copy.');
});

test('Copy filters notes from dictionary tags merged during lookup', async ({window}) => {
    const {document} = window;
    const {api, display, options, clipboard, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockResolvedValue([{result: true}]);
    options.dictionaries.push({...options.dictionaries[0], name: 'Dictionary B'});
    await display.updateOptions();
    setupStubs();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    vi.stubGlobal('Blob', Blob);
    const database = new DictionaryDatabase();
    await database.prepare();
    try {
        const importer = new DictionaryImporter(new DictionaryImporterMediaLoader());
        for (const [title, note] of [['Dictionary A', 'A-only note'], ['Dictionary B', 'B-only note']]) {
            const archive = new JSZip();
            archive.file('index.json', JSON.stringify({title, format: 3, revision: 'test'}));
            archive.file('term_bank_1.json', JSON.stringify([['言葉', 'ことば', 'noun', '', 0, [`Definition from ${title}`], 1, 'noun']]));
            archive.file('tag_bank_1.json', JSON.stringify([['noun', 'partOfSpeech', 0, note, 0]]));
            const {errors} = await importer.importDictionary(database, await archive.generateAsync({type: 'arraybuffer'}), {prefixWildcardsSupported: true, yomitanVersion: '0.0.0.0'});
            expect(errors).toEqual([]);
        }
        const translator = new Translator(database);
        translator.prepare();
        const findOptions = createFindTermsOptions('Dictionary A', {}, [{type: 'terms',
            enabledDictionaryMap: [
                ['Dictionary A', {index: 0, allowSecondarySearches: true, alias: '', partsOfSpeechFilter: true, useDeinflections: true}],
                ['Dictionary B', {index: 1, allowSecondarySearches: true, alias: '', partsOfSpeechFilter: true, useDeinflections: true}],
            ]}]);
        const {dictionaryEntries} = await translator.findTerms('group', '言葉', findOptions);
        const original = structuredClone(dictionaryEntries);
        await render(dictionaryEntries);
        /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input[data-dictionary="Dictionary A"]')).click();
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
        expect(clipboard.text).toContain('noun: B-only note');
        expect(clipboard.text).not.toContain('A-only note');
        expect(dictionaryEntries).toEqual(original);
    } finally {
        await database.close();
    }
});

/**
 * @param {API} api
 * @param {import('settings').Options} optionsFull
 */
function mockRulePersistence(api, optionsFull) {
    vi.spyOn(api, 'modifySettings').mockImplementation(async (targets) => {
        for (const target of targets) {
            if (target.action !== 'set') { throw new Error('Expected rule replacement'); }
            new ObjectPropertyAccessor(optionsFull).set(ObjectPropertyAccessor.getPathArray(target.path), target.value);
        }
        return [{result: true}];
    });
}

/** @param {unknown} value */
async function importRules(value) {
    const input = /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-image-rules-file'));
    Object.defineProperty(input, 'files', {configurable: true, value: [new File([typeof value === 'string' ? value : JSON.stringify(value)], 'rules.json', {type: 'application/json'})]});
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => { expect(querySelectorNotNull(document, '#copy-options-status').textContent).not.toBe(''); });
}

test('Import replaces global rules and Copy uses exact revision rules before metadata', async ({window}) => {
    const {api, optionsFull, clipboard, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockImplementation(async (targets) => {
        for (const target of targets) {
            expect(target.scope).toBe('global');
            if (target.action !== 'set') { throw new Error('Expected rule replacement'); }
            new ObjectPropertyAccessor(optionsFull).set(ObjectPropertyAccessor.getPathArray(target.path), target.value);
        }
        return [{result: true}];
    });
    await render([createEntry('言葉', [{type: 'structured-content',
        content: [
            'Before ',
            {tag: 'img', path: 'label.svg', alt: 'Metadata'},
            ' after ',
            {tag: 'img', path: 'photo.svg', alt: 'Caption'},
        ]}])]);
    await importRules({version: 1,
        rules: [
            {dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: '<plain text>'},
            {dictionary: 'Dictionary A', revision: '2026-01', path: 'photo.svg', action: 'omit'},
        ]});
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('Before \\<plain text\\> after');
    expect(clipboard.text).not.toMatch(/Metadata|Caption/);
    expect(querySelectorNotNull(window.document, '.copy-entry-status').textContent).toBe('Copied.');
    expect(optionsFull.global).toHaveProperty('copyImageRules', [
        {dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: '<plain text>'},
        {dictionary: 'Dictionary A', revision: '2026-01', path: 'photo.svg', action: 'omit'},
    ]);
});

test('A rejected storage write preserves effective rules after importing and reloading settings', async ({window}) => {
    const {api, display, optionsFull, clipboard, render} = await setupSearch();
    const backend = new Backend(new WebExtension());
    // eslint-disable-next-line no-underscore-dangle
    await backend._optionsUtil.prepare();
    optionsFull.global.copyImageRules = [{dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: 'Saved text'}];
    // eslint-disable-next-line no-underscore-dangle
    backend._options = structuredClone(optionsFull);
    vi.spyOn(api, 'optionsGetFull').mockImplementation(async () => new Promise((resolve, reject) => {
        // eslint-disable-next-line no-underscore-dangle
        backend._onMessage({action: 'optionsGetFull', params: void 0}, {}, (response) => {
            const result = /** @type {import('core').Response<import('settings').Options>} */ (response);
            if (typeof result.error !== 'undefined') {
                reject(new Error('Could not reload settings'));
            } else {
                resolve(/** @type {import('settings').Options} */ (result.result));
            }
        });
    }));
    vi.stubGlobal('chrome', {...globalThis.chrome,
        runtime: {...globalThis.chrome.runtime,
            // eslint-disable-next-line no-underscore-dangle
            sendMessage: (/** @type {import('api').ApiMessageAny} */ message, /** @type {(response?: unknown) => void} */ callback) => { backend._onMessage(message, {}, callback); }},
        storage: {local: {
            set: (/** @type {unknown} */ _values, /** @type {() => void} */ callback) => {
                Object.defineProperty(globalThis.chrome.runtime, 'lastError', {configurable: true, value: {message: 'Storage unavailable'}});
                callback();
                Object.defineProperty(globalThis.chrome.runtime, 'lastError', {configurable: true, value: void 0});
            },
        }}});
    await display.updateOptions();
    await render([createEntry('言葉', ['word', {type: 'image', path: 'label.svg'}])]);
    await importRules({version: 1, rules: [{dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: 'Rejected text'}]});
    expect(querySelectorNotNull(window.document, '#copy-options-status').textContent).toContain('Storage unavailable');
    expect((await api.optionsGetFull()).global.copyImageRules).toEqual(optionsFull.global.copyImageRules);
    await display.updateOptions();
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('Saved text');
    expect(clipboard.text).not.toContain('Rejected text');
});

const invalidRuleDocuments = /** @type {[string, unknown][]} */ ([
    ['malformed JSON', '{'],
    ['unsupported version', {version: 2, rules: []}],
    ['non-array rules', {version: 1, rules: {}}],
    ['missing identity', {version: 1, rules: [{dictionary: 'Dictionary A', revision: '', path: 'label.svg', action: 'omit'}]}],
    ['empty replacement', {version: 1, rules: [{dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: '  '}]}],
    ['unknown action', {version: 1, rules: [{dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'guess'}]}],
    ['omission with text', {version: 1, rules: [{dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'omit', text: 'wrong'}]}],
    ['duplicate identity', {version: 1,
        rules: [
            {dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'omit'},
            {dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: 'duplicate'},
        ]}],
]);
for (const [name, document] of invalidRuleDocuments) {
    test(`Import rejects ${name} without changing the effective collection`, async ({window}) => {
        const {api, clipboard, render} = await setupSearch();
        const save = vi.spyOn(api, 'modifySettings');
        await render([createEntry('亜', ['word', {type: 'image', path: 'smk8/表記-redfill.svg'}])]);
        await importRules(document);
        expect(querySelectorNotNull(window.document, '#copy-options-status').textContent).toContain('Could not import');
        expect(save).not.toHaveBeenCalled();
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
        expect(clipboard.text).toContain('word');
        expect(querySelectorNotNull(window.document, '.copy-entry-status').textContent).toContain('1 unresolved');
    });
}

test('Export includes inactive and uninstalled rules; empty import clears seeds without resurrection', async ({window}) => {
    const {api, optionsFull, clipboard, render} = await setupSearch();
    mockRulePersistence(api, optionsFull);
    const rules = [
        {dictionary: 'Dictionary A', revision: 'old', path: 'label.svg', action: 'replace', text: 'Inactive'},
        {dictionary: 'Uninstalled dictionary', revision: 'v1', path: 'photo.png', action: 'omit'},
    ];
    await importRules({version: 1, rules});
    /** @type {Blob | null} */
    let exported = null;
    window.URL.createObjectURL = vi.fn((/** @type {Blob|MediaSource} */ blob) => {
        exported = /** @type {Blob} */ (blob);
        return 'blob:rules';
    });
    const revoke = vi.fn();
    window.URL.revokeObjectURL = revoke;
    let filename = '';
    /** @this {HTMLAnchorElement} */
    function download() { filename = this.download; }
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(download);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '#copy-image-rules-export')).click();
    expect(filename).toBe('yomitan-copy-image-rules.json');
    const text = await new Promise((/** @type {(value: string) => void} */ resolve) => {
        const reader = new FileReader();
        reader.onload = () => { resolve(/** @type {string} */ (reader.result)); };
        reader.readAsText(/** @type {Blob} */ (exported));
    });
    expect(parseJson(text)).toEqual({version: 1, rules});
    await vi.waitFor(() => { expect(revoke).toHaveBeenCalledWith('blob:rules'); }, {timeout: 2000});
    await importRules(text);
    expect(optionsFull.global.copyImageRules).toEqual(rules);
    await importRules({version: 1, rules: []});
    const util = new OptionsUtil();
    await util.prepare();
    const reloaded = await util.update(structuredClone(optionsFull));
    expect(reloaded.global.copyImageRules).toEqual([]);
    const entry = createEntry('亜', ['word', {type: 'image', path: 'smk8/表記-redfill.svg'}]);
    entry.definitions[0].dictionary = '新明解国語辞典　第八版';
    await render([entry]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).not.toContain('表記');
    expect(querySelectorNotNull(window.document, '.copy-entry-status').textContent).toContain('1 unresolved');
});

test('Dictionary updates disable old revision rules while preserving them in Export', async ({window}) => {
    const {api, application, optionsFull, clipboard, render} = await setupSearch();
    mockRulePersistence(api, optionsFull);
    const rule = {dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: 'Current rule'};
    await importRules({version: 1, rules: [rule]});
    await render([createEntry('言葉', ['word', {type: 'structured-content',
        content: [
            {tag: 'img', path: 'label.svg', alt: 'Metadata'}, {tag: 'img', path: 'other/label.svg', alt: 'Other path'},
        ]}])]);
    const copyButton = /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]'));
    copyButton.click();
    expect(clipboard.text).toContain('Current ruleOther path');
    vi.spyOn(api, 'getDictionaryInfo').mockResolvedValue([{title: 'Dictionary A', revision: '2026-02', sequenced: true, version: 3, importDate: 0, prefixWildcardsSupported: false, styles: ''}]);
    application.trigger('databaseUpdated', {type: 'dictionary', cause: 'import'});
    await vi.waitFor(() => {
        copyButton.click();
        expect(clipboard.text).toContain('MetadataOther path');
    });
    expect(optionsFull.global.copyImageRules).toEqual([rule]);
});

test('Imported global rules survive settings reload, full settings backup update, and a different active profile', async ({window}) => {
    const {api, optionsFull} = await setupSearch();
    const util = new OptionsUtil();
    await util.prepare();
    /** @type {Record<string, unknown>} */
    let storage = {};
    vi.stubGlobal('chrome', {...globalThis.chrome,
        storage: {local: {
            set: (/** @type {Record<string, unknown>} */ values, /** @type {() => void} */ callback) => { storage = values; callback(); },
            get: (/** @type {string[]} */ _keys, /** @type {(values: Record<string, unknown>) => void} */ callback) => { callback(storage); },
        }}});
    vi.spyOn(api, 'modifySettings').mockImplementation(async (targets) => {
        for (const target of targets) {
            if (target.action !== 'set') { throw new Error('Expected rule replacement'); }
            new ObjectPropertyAccessor(optionsFull).set(ObjectPropertyAccessor.getPathArray(target.path), target.value);
        }
        await util.save(optionsFull);
        return [{result: true}];
    });
    const rule = {dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: 'Shared saved rule'};
    await importRules({version: 1, rules: [rule]});
    const loaded = await util.load();
    expect(loaded.global.copyImageRules).toEqual([rule]);
    const fromFullBackup = await util.update(parseJson(/** @type {string} */ (storage.options)));
    expect(fromFullBackup.global.copyImageRules).toEqual([rule]);
    fromFullBackup.profiles.push({...structuredClone(fromFullBackup.profiles[0]), name: 'Other profile'});
    fromFullBackup.profileCurrent = 1;
    const settingsStorage = globalThis.chrome.storage;
    const previousSelect = querySelectorNotNull(window.document, '#profile-select');
    previousSelect.replaceWith(previousSelect.cloneNode(true));
    const reopened = await setupSearch(false, 'search', fromFullBackup);
    vi.stubGlobal('chrome', {...globalThis.chrome, storage: settingsStorage});
    await reopened.render([createEntry('言葉', ['word', {type: 'image', path: 'label.svg', alt: 'Metadata'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(reopened.clipboard.text).toContain('Shared saved rule');
    expect(reopened.clipboard.text).not.toContain('Metadata');
    vi.spyOn(reopened.api, 'modifySettings').mockImplementation(async (targets) => {
        for (const target of targets) {
            if (target.action !== 'set') { throw new Error('Expected profile selection'); }
            new ObjectPropertyAccessor(fromFullBackup).set(ObjectPropertyAccessor.getPathArray(target.path), target.value);
        }
        await util.save(fromFullBackup);
        return [{result: true}];
    });
    vi.spyOn(reopened.api, 'optionsGet').mockImplementation(async () => fromFullBackup.profiles[fromFullBackup.profileCurrent].options);
    const select = /** @type {HTMLSelectElement} */ (querySelectorNotNull(window.document, '#profile-select'));
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => { expect(fromFullBackup.profileCurrent).toBe(0); });
    // The backend's options notification refreshes the active profile in an extension tab.
    await reopened.display.updateOptions();
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(reopened.clipboard.text).toContain('Shared saved rule');
});

test('Pending imports publish only after storage succeeds and preserve a concurrent Copy filter save', async ({window}) => {
    const {api, optionsFull} = await setupSearch();
    const backend = new Backend(new WebExtension());
    // eslint-disable-next-line no-underscore-dangle
    await backend._optionsUtil.prepare();
    // eslint-disable-next-line no-underscore-dangle
    backend._options = structuredClone(optionsFull);
    /** @type {{options: string, complete: () => void}[]} */
    const writes = [];
    vi.stubGlobal('chrome', {...globalThis.chrome,
        runtime: {...globalThis.chrome.runtime,
            // eslint-disable-next-line no-underscore-dangle
            sendMessage: (/** @type {import('api').ApiMessageAny} */ message, /** @type {(response?: unknown) => void} */ callback) => { backend._onMessage(message, {}, callback); }},
        tabs: {query: (/** @type {unknown} */ _details, /** @type {(tabs: chrome.tabs.Tab[]) => void} */ callback) => { callback([]); }},
        storage: {local: {
            set: (/** @type {{options: string}} */ values, /** @type {() => void} */ callback) => { writes.push({options: values.options, complete: callback}); },
        }}});
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(api.optionsGetFull).mockRestore();
    const rule = {dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: 'Saved after persistence'};
    const importing = importRules({version: 1, rules: [rule]});
    await vi.waitFor(() => { expect(writes).toHaveLength(1); });
    expect((await api.optionsGetFull()).global.copyImageRules).toEqual(optionsFull.global.copyImageRules);
    /** @type {HTMLInputElement} */ (querySelectorNotNull(window.document, '#copy-dictionaries input')).click();
    writes[0].complete();
    await vi.waitFor(() => { expect(writes).toHaveLength(2); });
    expect(parseJson(writes[1].options)).toMatchObject({
        global: {copyImageRules: [rule]},
        profiles: [{options: {general: {copyExcludedDictionaries: ['Dictionary A']}}}],
    });
    writes[1].complete();
    await importing;
    await vi.waitFor(async () => {
        const saved = await api.optionsGetFull();
        expect(saved.global.copyImageRules).toEqual([rule]);
        expect(saved.profiles[0].options.general.copyExcludedDictionaries).toEqual(['Dictionary A']);
    });
});

test('Copy stops using old revision rules immediately while a dictionary refresh is pending or fails', async ({window}) => {
    const {api, application, optionsFull, clipboard, render} = await setupSearch();
    mockRulePersistence(api, optionsFull);
    await importRules({version: 1, rules: [{dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: 'Old revision text'}]});
    await render([createEntry('言葉', ['word', {type: 'image', path: 'label.svg', alt: 'Metadata'}])]);
    const button = /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]'));
    /** @type {(reason: Error) => void} */
    let fail = () => {};
    vi.spyOn(api, 'getDictionaryInfo').mockImplementation(async () => new Promise((_resolve, reject) => { fail = reject; }));
    application.trigger('databaseUpdated', {type: 'dictionary', cause: 'import'});
    button.click();
    expect(clipboard.text).toContain('Metadata');
    expect(clipboard.text).not.toContain('Old revision text');
    fail(new Error('Dictionary info unavailable'));
    await vi.waitFor(() => { expect(querySelectorNotNull(window.document, '#copy-options-status').textContent).toContain('Could not read dictionary revisions'); });
    button.click();
    expect(clipboard.text).toContain('Metadata');
    expect(clipboard.text).not.toContain('Old revision text');
});

test('An older dictionary refresh response cannot restore superseded revision rules', async ({window}) => {
    const {api, application, optionsFull, clipboard, render} = await setupSearch();
    mockRulePersistence(api, optionsFull);
    await importRules({version: 1,
        rules: [
            {dictionary: 'Dictionary A', revision: '2026-01', path: 'label.svg', action: 'replace', text: 'Old revision text'},
            {dictionary: 'Dictionary A', revision: '2026-02', path: 'label.svg', action: 'replace', text: 'Current revision text'},
        ]});
    await render([createEntry('言葉', ['word', {type: 'image', path: 'label.svg', alt: 'Metadata'}])]);
    /** @type {(summaries: import('dictionary-importer').Summary[]) => void} */
    let completeOld = () => {};
    const oldResponse = new Promise((/** @type {(value: import('dictionary-importer').Summary[]) => void} */ resolve) => { completeOld = resolve; });
    const summary = {title: 'Dictionary A', revision: '2026-02', sequenced: true, version: 3, importDate: 0, prefixWildcardsSupported: false, styles: ''};
    vi.spyOn(api, 'getDictionaryInfo').mockReturnValueOnce(oldResponse).mockResolvedValue([summary]);
    application.trigger('databaseUpdated', {type: 'dictionary', cause: 'import'});
    application.trigger('databaseUpdated', {type: 'dictionary', cause: 'import'});
    const button = /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]'));
    await vi.waitFor(() => {
        button.click();
        expect(clipboard.text).toContain('Current revision text');
    });
    completeOld([{...summary, revision: '2026-01'}]);
    await oldResponse;
    button.click();
    expect(clipboard.text).toContain('Current revision text');
    expect(clipboard.text).not.toContain('Old revision text');
});


test('Image inspector targets one entry, includes collapsed assets, and defaults to deduplicated unresolved images', async ({window}) => {
    const {document} = window;
    const {render} = await setupSearch();
    setupInspectorBoundary(window);
    const entry = createEntry('言葉', [{type: 'structured-content',
        content: {tag: 'details',
            content: [
                {tag: 'summary', content: 'Usage'},
                'Context before ',
                {tag: 'img', path: 'label.svg'},
                {tag: 'img', path: 'label.svg'},
                {tag: 'img', path: 'metadata.svg', alt: 'Metadata label'},
                ' after',
            ]}}]);
    await render([createEntry('neighbor', [{type: 'image', path: 'neighbor.svg'}]), entry]);
    const button = /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '.entry[data-index="1"] [data-action="inspect-copy-images"]'));
    button.click();
    const dialog = querySelectorNotNull(document, '#copy-image-inspector');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelectorAll('.copy-image-card')).toHaveLength(1);
    expect(dialog.textContent).toContain('Dictionary A');
    expect(dialog.textContent).toContain('2026-01');
    expect(dialog.textContent).toContain('label.svg');
    expect(dialog.textContent).toContain('Context before');
    expect(dialog.textContent).not.toContain('neighbor.svg');
    /** @type {HTMLInputElement} */ (querySelectorNotNull(dialog, '#copy-image-show-all')).click();
    expect(dialog.querySelectorAll('.copy-image-card')).toHaveLength(2);
    expect(dialog.textContent).toContain('Metadata: Metadata label');
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(dialog, '#copy-image-inspector-close')).click();
    expect(dialog.hasAttribute('open')).toBe(false);
});


/**
 * @param {import('jsdom').DOMWindow} window
 * @returns {{create: ReturnType<typeof vi.fn>, revoke: ReturnType<typeof vi.fn>}}
 */
function setupInspectorBoundary(window) {
    window.HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function close() {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
    };
    const create = vi.fn().mockReturnValue('blob:dictionary-image');
    const revoke = vi.fn();
    window.URL.createObjectURL = create;
    window.URL.revokeObjectURL = revoke;
    return {create, revoke};
}

test('Inspector shows a duplicate asset as unresolved whenever any occurrence lacks metadata', async ({window}) => {
    const {document} = window;
    setupInspectorBoundary(window);
    const {render} = await setupSearch();
    await render([createEntry('言葉', [{type: 'structured-content',
        content: [
            'word ',
            {tag: 'img', path: 'label.svg'},
            {tag: 'img', path: 'label.svg', alt: 'Label'},
            {tag: 'img', path: 'other.svg', alt: 'Other label'},
            {tag: 'img', path: 'other.svg'},
        ]}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied. 2 unresolved image(s) omitted.');
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    expect(document.querySelectorAll('.copy-image-card')).toHaveLength(2);
    expect([...document.querySelectorAll('.copy-image-handling')].map((element) => element.textContent)).toEqual(['Unresolved', 'Unresolved']);
    expect([...document.querySelectorAll('.copy-image-path')].map((element) => element.textContent)).toEqual(['label.svg', 'other.svg']);
    /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-image-show-all')).click();
    expect(document.querySelectorAll('.copy-image-card')).toHaveLength(2);
});

test('Inspector preserves native editing keys instead of running search hotkeys', async ({window}) => {
    const {document} = window;
    setupInspectorBoundary(window);
    const {display, application, render} = await setupSearch();
    display.hotkeyHandler.prepare(application.crossFrame);
    display.hotkeyHandler.setHotkeys('search', ['Escape', 'ArrowDown', 'KeyK'].map((key) => ({
        action: 'focusSearchBox', argument: '', key, modifiers: key === 'KeyK' ? ['ctrl', 'shift'] : [], scopes: ['search'], enabled: true,
    })));
    await render([createEntry('言葉', [{type: 'image', path: 'label.svg'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    const editor = /** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text'));
    editor.focus();
    for (const options of [
        {key: 'Escape', code: 'Escape'},
        {key: 'ArrowDown', code: 'ArrowDown'},
        {key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true},
        {key: 'u', code: 'KeyU', ctrlKey: true},
    ]) {
        const event = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ...options});
        editor.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(editor);
    }
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '#copy-image-inspector-close')).click();
    const outside = new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true, cancelable: true});
    document.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(querySelectorNotNull(document, '#search-textbox'));
});

test('Inspector leaves native paste in its editor instead of replacing the search query', async ({window}) => {
    const {document} = window;
    setupInspectorBoundary(window);
    const {api, render} = await setupSearch();
    vi.spyOn(api, 'termsFind').mockResolvedValue({dictionaryEntries: [], originalTextLength: 0});
    await render([createEntry('言葉', [{type: 'image', path: 'label.svg'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    const editor = /** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text'));
    editor.focus();
    const event = new Event('paste', {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'clipboardData', {value: {getData: () => 'Recovered label'}});
    editor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(/** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '#search-textbox')).value).toBe('言葉');
    expect(document.activeElement).toBe(editor);
});

test('Inspector saves replacement, edits omission, and deletes one rule without writing the clipboard', async ({window}) => {
    const {document} = window;
    setupInspectorBoundary(window);
    const {api, optionsFull, clipboard, copy, render} = await setupSearch();
    mockRulePersistence(api, optionsFull);
    await render([createEntry('言葉', [{type: 'structured-content', content: ['before ', {tag: 'img', path: 'label.svg'}, ' after']}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    /** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text')).value = 'Recovered label';
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="save-copy-image-rule"]')).click();
    await vi.waitFor(() => { expect(querySelectorNotNull(document, '#copy-image-inspector-status').textContent).toBe('Rule saved. Copy again to use it.'); });
    expect(copy).not.toHaveBeenCalled();
    expect(clipboard.text).toBe('previous clipboard');
    expect(document.querySelectorAll('.copy-image-card')).toHaveLength(0);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('before Recovered label after');
    /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-image-show-all')).click();
    expect(/** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text')).value).toBe('Recovered label');
    const action = /** @type {HTMLSelectElement} */ (querySelectorNotNull(document, '.copy-image-action'));
    action.value = 'omit';
    action.dispatchEvent(new Event('change'));
    expect(/** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text')).disabled).toBe(true);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="save-copy-image-rule"]')).click();
    await vi.waitFor(() => { expect(querySelectorNotNull(document, '.copy-image-handling').textContent).toBe('User omission'); });
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('before  after');
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied.');
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="delete-copy-image-rule"]')).click();
    await vi.waitFor(() => { expect(querySelectorNotNull(document, '#copy-image-inspector-status').textContent).toBe('Rule deleted. Copy again to use the current handling.'); });
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('Copied. 1 unresolved image(s) omitted.');
});


test('Inspector previews and opens the original media, revokes URLs on close, and reports missing or unreadable images', async ({window}) => {
    const {document} = window;
    const {revoke} = setupInspectorBoundary(window);
    const {api, render} = await setupSearch();
    const content = readFileSync(new URL('data/copy-image-label.svg', import.meta.url)).toString('base64');
    vi.spyOn(api, 'getMedia').mockImplementation(async (targets) => targets.flatMap(({dictionary, path}) => (path === 'missing.svg' ? [] : [{dictionary, path, mediaType: 'image/svg+xml', content, width: 100, height: 40}])));
    await render([createEntry('言葉', [{type: 'image', path: 'label.svg'}, {type: 'image', path: 'missing.svg'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    await vi.waitFor(() => { expect(document.querySelector('#copy-image-inspector img')).not.toBeNull(); });
    const image = /** @type {HTMLImageElement} */ (querySelectorNotNull(document, '#copy-image-inspector img'));
    expect(image.src).toBe('blob:dictionary-image');
    const link = /** @type {HTMLAnchorElement} */ (querySelectorNotNull(document, '#copy-image-inspector a'));
    expect(link.href).toBe(image.src);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(querySelectorNotNull(document, '#copy-image-inspector').textContent).toContain('Could not load this image');
    image.dispatchEvent(new Event('error'));
    expect(querySelectorNotNull(document, '.copy-image-media').textContent).toContain('Could not display this image');
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '#copy-image-inspector-close')).click();
    expect(revoke).toHaveBeenCalledWith('blob:dictionary-image');
});


test('Inspector retains inactive revision rules until each current image is reviewed and saved', async ({window}) => {
    const {document} = window;
    setupInspectorBoundary(window);
    const {api, application, optionsFull, clipboard, render} = await setupSearch();
    mockRulePersistence(api, optionsFull);
    await importRules({version: 1, rules: [{dictionary: 'Dictionary A', revision: 'old-revision', path: 'label.svg', action: 'replace', text: 'Old label'}]});
    await render([createEntry('言葉', ['word', {type: 'image', path: 'label.svg'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    expect(querySelectorNotNull(document, '.copy-image-inactive').textContent).toBe('Inactive rule (old-revision): Old label');
    expect(/** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text')).value).toBe('');
    /** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text')).value = 'Reviewed current label';
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="save-copy-image-rule"]')).click();
    await vi.waitFor(() => { expect(querySelectorNotNull(document, '#copy-image-inspector-status').textContent).toBe('Rule saved. Copy again to use it.'); });
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('Reviewed current label');
    const next = await api.getDictionaryInfo();
    vi.spyOn(api, 'getDictionaryInfo').mockResolvedValue(next.map((value) => ({...value, revision: 'new-revision'})));
    application.trigger('databaseUpdated', {type: 'dictionary', cause: 'import'});
    expect(querySelectorNotNull(document, '#copy-image-inspector').hasAttribute('open')).toBe(false);
    await vi.waitFor(() => {
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
        expect(querySelectorNotNull(document, '.copy-image-revision').textContent).toBe('new-revision');
    });
    expect(querySelectorNotNull(document, '.copy-image-inactive').textContent).toContain('Inactive rule (2026-01): Reviewed current label');
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).not.toContain('Reviewed current label');
    expect(optionsFull.global.copyImageRules.map(({revision}) => revision)).toEqual(['old-revision', '2026-01']);
});

test('Inspector save failure retains the previous handling and entered text for retry', async ({window}) => {
    const {document} = window;
    setupInspectorBoundary(window);
    const {api, clipboard, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockRejectedValue(new Error('Storage unavailable'));
    await render([createEntry('言葉', [{type: 'image', path: 'label.svg'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    /** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text')).value = 'Keep for retry';
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="save-copy-image-rule"]')).click();
    await vi.waitFor(() => { expect(querySelectorNotNull(document, '#copy-image-inspector-status').textContent).toContain('Storage unavailable'); });
    expect(/** @type {HTMLTextAreaElement} */ (querySelectorNotNull(document, '.copy-image-text')).value).toBe('Keep for retry');
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toBe('previous clipboard');
    expect(querySelectorNotNull(document, '.copy-entry-status').textContent).toBe('No dictionary content to copy.');
});


test('Closing the inspector prevents a pending media request from creating unused preview URLs', async ({window}) => {
    const {document} = window;
    const {create} = setupInspectorBoundary(window);
    const {api, render} = await setupSearch();
    /** @type {(value: import('dictionary-database').MediaDataStringContent[]) => void} */
    let complete = () => {};
    vi.spyOn(api, 'getMedia').mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    await render([createEntry('言葉', [{type: 'image', path: 'label.svg'}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '#copy-image-inspector-close')).click();
    complete([{dictionary: 'Dictionary A', path: 'label.svg', mediaType: 'image/svg+xml', content: 'WA==', width: 1, height: 1}]);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(create).not.toHaveBeenCalled();
});


test('Inspector excludes dictionary images before inspection and keeps separate exact paths', async ({window}) => {
    const {document} = window;
    setupInspectorBoundary(window);
    const {api, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockResolvedValue([{result: true}]);
    const entry = createEntry('言葉', [{type: 'image', path: 'label.svg'}]);
    entry.definitions.push({...entry.definitions[0],
        dictionary: 'Dictionary B',
        dictionaryAlias: 'Alias',
        entries: [
            {type: 'image', path: 'images/label.svg'}, {type: 'image', path: 'label.svg'},
        ]});
    await render([entry]);
    /** @type {HTMLInputElement} */ (querySelectorNotNull(document, '#copy-dictionaries input')).click();
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    expect(document.querySelectorAll('.copy-image-card')).toHaveLength(2);
    expect(querySelectorNotNull(document, '#copy-image-inspector-list').textContent).not.toContain('Dictionary A');
    expect(querySelectorNotNull(document, '#copy-image-inspector-list').textContent).toContain('Dictionary B');
    expect(querySelectorNotNull(document, '#copy-image-inspector-list').textContent).not.toContain('Alias');
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '#copy-image-inspector-close')).click();
    await render([createEntry('new result', ['word'])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(document, '[data-action="inspect-copy-images"]')).click();
    expect(querySelectorNotNull(document, '#copy-image-inspector-list').textContent).toContain('No unresolved images');
});


test('Copy defaults to Markdown headings and consecutive included dictionary numbers', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    const entry = createEntry('言葉', ['word']);
    entry.definitions.push({...entry.definitions[0], dictionary: 'Dictionary B', entries: ['second']});
    await render([entry]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toBe('# 言葉 (ことば)\n\n## 1. Dictionary A\n言葉 (ことば)\nword\n\n## 2. Dictionary B\n言葉 (ことば)\nsecond');
    /** @type {HTMLInputElement} */ (querySelectorNotNull(window.document, '#copy-dictionaries input[data-dictionary="Dictionary A"]')).click();
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toBe('# 言葉 (ことば)\n\n## 1. Dictionary B\n言葉 (ことば)\nsecond');
});


test('Copy escapes literal Markdown and preserves ordered and nested lists', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    await render([createEntry('言葉', ['*literal* [link] # heading | pipe \\ backtick `', {type: 'structured-content',
        content: {tag: 'ol',
            content: [
                {tag: 'li', content: ['first', {tag: 'ul', content: {tag: 'li', content: 'child'}}, 'after']},
                {tag: 'li', content: ['second', {tag: 'br'}, 'continuation']},
            ]}}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain(String.raw`\*literal\* \[link\] \# heading \| pipe \\ backtick \``);
    expect(clipboard.text).toContain('1. first\n\n   - child\n\n   after\n2. second\n   continuation');
});


test('Copy preserves empty, merged, multiline and headerless table cells', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    await render([createEntry('言葉', [{type: 'structured-content',
        content: [
            {tag: 'table',
                content: [
                    {tag: 'thead', content: {tag: 'tr', content: [{tag: 'th'}, {tag: 'th', content: 'A|B'}, {tag: 'th', content: 'C'}]}},
                    {tag: 'tbody',
                        content: [
                            {tag: 'tr', content: [{tag: 'td', rowSpan: 2, content: 'shared'}, {tag: 'td', colSpan: 2, content: ['one', {tag: 'br'}, 'two']}]},
                            {tag: 'tr', content: [{tag: 'td'}, {tag: 'td', content: 'last'}]},
                        ]},
                ]},
            {tag: 'table', content: {tag: 'tr', content: [{tag: 'td', content: 'x'}, {tag: 'td', content: 'y'}]}},
        ]}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('|  | A\\|B | C |\n| --- | --- | --- |\n| shared | one; two | one; two |\n| shared |  | last |');
    expect(clipboard.text).toContain('|  |  |\n| --- | --- |\n| x | y |');
});

test('Copy separates Markdown tables from following prose', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    await render([createEntry('言葉', [{type: 'structured-content',
        content: [
            'before',
            {tag: 'table', content: {tag: 'tr', content: [{tag: 'th', content: 'Header'}]}},
            'after',
        ]}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toBe('# 言葉 (ことば)\n\n## 1. Dictionary A\n言葉 (ことば)\nbefore\n\n| Header |\n| --- |\n\nafter');
});


test('Copy represents nested tables in a fenced block with readable row and column boundaries', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    await render([createEntry('言葉', [{type: 'structured-content',
        content: {tag: 'table',
            content: {tag: 'tr',
                content: [
                    {tag: 'td', content: 'outer'},
                    {tag: 'td',
                        content: {tag: 'table',
                            content: [
                                {tag: 'tr', content: [{tag: 'td'}, {tag: 'td', content: 'a|b'}, {tag: 'td', content: 'c'}, {tag: 'td'}]},
                                {tag: 'tr', content: [{tag: 'td', content: '```'}, {tag: 'td', content: 'd'}]},
                            ]}},
                ]}}}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('\n````\nouter\t\ta|b\tc\t\n```\td\t\t\n````');
});


test('Copy recovers original Jitendex forms symbols only in verified source contexts', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    // Exact forms subtree from the official 2026.10.03.0 release; CC BY-SA 4.0 Stephen Kraus.
    const forms = /** @type {import('structured-content').StyledElement} */ (parseJson(readFileSync(new URL('data/copy-jitendex-forms.json', import.meta.url), 'utf8')));
    const entry = createEntry('日本語', [{type: 'structured-content',
        content: [forms,
            {tag: 'span', title: 'unrelated tooltip'},
            {tag: 'div', data: {content: 'forms'}, content: {tag: 'span', title: 'outside table'}},
            {tag: 'table', content: {tag: 'tr', content: {tag: 'td', data: {class: 'form-valid'}, content: {tag: 'span', title: 'outside forms'}}}},
            {tag: 'li',
                data: {content: 'forms'},
                content: {tag: 'table',
                    content: {tag: 'tr',
                        content: [
                            {tag: 'td', data: {class: 'form-irr'}, content: {tag: 'span', title: 'irregular form'}},
                            {tag: 'td', data: {class: 'form-old'}, content: {tag: 'span', title: 'old kanji form (kyūjitai)'}},
                            {tag: 'td', data: {class: 'form-rare'}, content: {tag: 'span', title: 'rarely used form'}},
                            {tag: 'td', data: {class: 'form-out'}, content: {tag: 'span', title: 'archaic or obsolete reading'}},
                            {tag: 'td', data: {class: 'form-valid'}, content: {tag: 'span', title: 'original additional title'}},
                            {tag: 'td', data: {class: 'form-valid'}, content: {tag: 'span', title: 'do not replace visible text', content: 'visible'}},
                            {tag: 'td', data: {class: 'tooltip'}, content: {tag: 'span', title: 'unknown context'}},
                        ]}}}]}]);
    entry.headwords[0].reading = 'にほんご';
    entry.definitions[0].dictionary = 'Jitendex.org [2026-10-03]';
    await render([entry]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('|  | 日本語 |\n| --- | --- |\n| にほんご | high priority form |\n| にっぽんご | valid form/reading combination |');
    expect(clipboard.text).toContain('| irregular form | old kanji form (kyūjitai) | rarely used form | archaic or obsolete reading | original additional title | visible |  |');
    expect(clipboard.text).not.toMatch(/unrelated tooltip|outside table|outside forms|do not replace|unknown context/);
    entry.definitions[0].dictionary = 'Dictionary A';
    await render([entry]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).not.toMatch(/high priority form|valid form\/reading|irregular form|original additional title/);
});


test('Copy recovers titled form cells inside Jitendex sense-group lists', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    const entry = createEntry('言葉', [{type: 'structured-content', content: {tag: 'ul', data: {content: 'sense-groups'}, content: {tag: 'li', data: {content: 'forms'}, content: {tag: 'table', content: {tag: 'tr', content: {tag: 'td', data: {class: 'form-out'}, content: {tag: 'span', title: 'archaic or obsolete reading'}}}}}}}]);
    entry.definitions[0].dictionary = 'Jitendex.org [2026-10-03]';
    await render([entry]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('archaic or obsolete reading');
});


test('Copy retains source cells when table spans would expand excessively or are malformed', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    const cases = [Number.MAX_SAFE_INTEGER, Infinity, -1, 1.5, Number.NaN];
    for (const colSpan of cases) {
        await render([createEntry('言葉', [{type: 'structured-content',
            content: {tag: 'table',
                content: {tag: 'tr',
                    content: [
                        {tag: 'td', colSpan, content: '*original*'}, {tag: 'td', content: 'last'},
                    ]}}}])]);
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
        expect(clipboard.text).toContain('\n```\n*original*\tlast\n```');
        expect(clipboard.text.length).toBeLessThan(200);
    }
});


test('Copy avoids multiplying large cell text by a large span', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    const text = 'original'.repeat(100);
    await render([createEntry('言葉', [{type: 'structured-content', content: {tag: 'table', content: {tag: 'tr', content: {tag: 'td', colSpan: 9999, content: text}}}}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text.length).toBeLessThan(2000);
    expect(clipboard.text).toContain(`\n\`\`\`\n${text}\n\`\`\``);
});


test('Copy protects literal entity, rule, and numbered-list text from Markdown interpretation', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    await render([createEntry('言葉', ['&copy;\n---\n===\n1. literal\n- literal'])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain(String.raw`\&copy;
\-\-\-
\=\=\=
1\. literal
\- literal`);
});

test('Copy escapes literal tilde fences and strikethrough before later dictionary sections', async ({window}) => {
    const {api, clipboard, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockResolvedValue([{result: true}]);
    const entry = createEntry('言葉', ['~~~\n~~literal~~']);
    entry.definitions.push({...entry.definitions[0], dictionary: 'Dictionary B', entries: ['second']});
    await render([entry]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toBe('# 言葉 (ことば)\n\n## 1. Dictionary A\n言葉 (ことば)\n\\~\\~\\~\n\\~\\~literal\\~\\~\n\n## 2. Dictionary B\n言葉 (ことば)\nsecond');
    const format = /** @type {HTMLSelectElement} */ (querySelectorNotNull(window.document, '#copy-format'));
    format.value = 'text';
    format.dispatchEvent(new Event('change'));
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toBe('言葉 (ことば)\n\n1. Dictionary A\n言葉 (ことば)\n~~~\n~~literal~~\n\n2. Dictionary B\n言葉 (ことば)\nsecond');
});


test('Copy keeps image counts and readable inspector context with empty table cells', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    setupInspectorBoundary(window);
    await render([createEntry('言葉', [{type: 'structured-content',
        content: [
            {tag: 'table',
                content: [
                    {tag: 'tr', content: [{tag: 'th'}, {tag: 'th', content: 'Header'}, {tag: 'th'}]},
                    {tag: 'tr', content: [{tag: 'td', content: 'reading'}, {tag: 'td', content: {tag: 'img', path: 'label.svg', alt: 'Label'}}, {tag: 'td'}]},
                ]},
            'before *literal* ',
            {tag: 'img', path: 'unknown.svg'},
            'after',
        ]}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('| reading | Label |  |');
    expect(querySelectorNotNull(window.document, '.copy-entry-status').textContent).toBe('Copied. 1 unresolved image(s) omitted.');
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="inspect-copy-images"]')).click();
    expect(querySelectorNotNull(window.document, '.copy-image-context').textContent).toBe('\tHeader\t\nreading\tLabel\t\nbefore *literal* after');
});


test('Copy plain text retains literal text, numbering, variants, table boundaries and recovered symbols', async ({window}) => {
    const {api, clipboard, render} = await setupSearch();
    vi.spyOn(api, 'modifySettings').mockResolvedValue([{result: true}]);
    const forms = /** @type {import('structured-content').Content} */ (parseJson(readFileSync(new URL('data/copy-jitendex-forms.json', import.meta.url), 'utf8')));
    const entry = createEntry('日本語', ['*literal* | [note]', {type: 'structured-content',
        content: [forms,
            {tag: 'ol', content: [{tag: 'li', content: 'first'}, {tag: 'li', content: 'second'}]},
            {tag: 'table',
                content: [
                    {tag: 'tr', content: [{tag: 'td', rowSpan: 2, content: 'shared'}, {tag: 'td', colSpan: 2, content: ['one', {tag: 'br'}, 'two']}]},
                    {tag: 'tr', content: [{tag: 'td'}, {tag: 'td', content: 'last'}]},
                ]}]}]);
    entry.headwords[0].reading = 'にほんご';
    entry.headwords.push({...entry.headwords[0], index: 1, headwordIndex: 1, term: '詞', reading: 'コトバ'});
    entry.definitions[0].dictionary = 'Jitendex.org [2026-10-03]';
    entry.definitions[0].headwordIndices = [0, 1];
    entry.definitions.push({...entry.definitions[0], dictionary: 'Dictionary A', entries: ['other']});
    await render([entry]);
    const format = /** @type {HTMLSelectElement} */ (querySelectorNotNull(window.document, '#copy-format'));
    format.value = 'text';
    format.dispatchEvent(new Event('change'));
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toContain('日本語 (にほんご)\n詞 (コトバ)\n\n1. Jitendex.org [2026-10-03]');
    expect(clipboard.text).toContain('日本語 (にほんご), 詞 (コトバ)\n*literal* | [note]');
    expect(clipboard.text).toContain('\t日本語\nにほんご\thigh priority form\nにっぽんご\tvalid form/reading combination');
    expect(clipboard.text).toContain('1. first\n2. second');
    expect(clipboard.text).toContain('shared\tone; two\tone; two\nshared\t\tlast');
    expect(clipboard.text).toContain('\n\n2. Dictionary A');
    expect(clipboard.text).not.toMatch(/^#|^\| ---/m);
    /** @type {HTMLInputElement} */ (querySelectorNotNull(window.document, '#copy-dictionaries input[data-dictionary="Dictionary A"]')).click();
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).not.toContain('Dictionary A');
    expect(clipboard.text).toContain('1. Jitendex.org [2026-10-03]');
});


test('Copy preserves the clipboard when a table contains only unresolved images', async ({window}) => {
    const {clipboard, render} = await setupSearch();
    await render([createEntry('言葉', [{type: 'structured-content', content: {tag: 'table', content: {tag: 'tr', content: {tag: 'td', content: {tag: 'img', path: 'unknown.svg'}}}}}])]);
    /** @type {HTMLButtonElement} */ (querySelectorNotNull(window.document, '[data-action="copy-entry"]')).click();
    expect(clipboard.text).toBe('previous clipboard');
    expect(querySelectorNotNull(window.document, '.copy-entry-status').textContent).toBe('No dictionary content to copy.');
});

for (const kind of ['fresh', 'upgraded']) {
    test(`Copy options default to Markdown for ${kind} settings`, async ({window}) => {
        vi.stubGlobal('fetch', fetch);
        vi.stubGlobal('chrome', chrome);
        const util = new OptionsUtil();
        await util.prepare();
        const legacy = {version: 79, profileCurrent: 0, global: {}, profiles: [{name: 'Default', options: {general: {}}}]};
        const saved = kind === 'fresh' ? util.getDefault() : await util.update(legacy);
        await setupSearch(false, 'search', saved);
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
    await setupSearch(false, 'search', reloaded);
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
