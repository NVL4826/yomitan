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

// Exact paths and text verified from the supplied SMK8 label SVGs.
const smk8Labels = new Map([
    ['smk8/かぞえ方-default.svg', 'かぞえ方'],
    ['smk8/一-fill.svg', '一'],
    ['smk8/二-fill.svg', '二'],
    ['smk8/三-fill.svg', '三'],
    ['smk8/四-fill.svg', '四'],
    ['smk8/五-fill.svg', '五'],
    ['smk8/六-fill.svg', '六'],
    ['smk8/他動-default.svg', '他動'],
    ['smk8/動-default.svg', '動'],
    ['smk8/名-default.svg', '名'],
    ['smk8/文法-red.svg', '文法'],
    ['smk8/派-default.svg', '派'],
    ['smk8/自動-default.svg', '自動'],
    ['smk8/表記-redfill.svg', '表記'],
    ['smk8/運用-fill.svg', '運用'],
]);

/**
 * @param {import('dictionary').TermDictionaryEntry} entry
 * @param {Set<string>} [excludedDictionaries]
 * @returns {{text: string, unresolvedImages: number}}
 */
export function getResultEntryText(entry, excludedDictionaries = new Set()) {
    const headwords = entry.headwords.map(({term, reading}) => (term === reading || reading.length === 0 ? term : `${term} (${reading})`));
    /** @type {Map<string, string[]>} */
    const sections = new Map();
    const imageState = {unresolvedImages: 0};
    /**
     * @param {string} dictionary
     * @param {string} text
     */
    const append = (dictionary, text) => {
        if (excludedDictionaries.has(dictionary)) { return; }
        text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (text.length === 0) { return; }
        let section = sections.get(dictionary);
        if (typeof section === 'undefined') {
            section = [];
            sections.set(dictionary, section);
        }
        section.push(text);
    };
    for (const [index, headword] of entry.headwords.entries()) {
        for (const tag of headword.tags) {
            for (const dictionary of tag.dictionaries) {
                append(dictionary, `Tags (${headwords[index]}): ${getTagsText([tag], excludedDictionaries, dictionary)}`);
            }
        }
    }
    for (const definition of entry.definitions) {
        if (excludedDictionaries.has(definition.dictionary)) { continue; }
        const lines = [];
        for (const content of definition.entries) {
            if (typeof content === 'string') {
                lines.push(content);
            } else {
                switch (content.type) {
                    case 'text':
                        lines.push(content.text);
                        break;
                    case 'image':
                        lines.push(getImageText(content, definition.dictionary, imageState));
                        break;
                    case 'structured-content':
                        lines.push(getStructuredContentText(content.content, definition.dictionary, imageState));
                        break;
                }
            }
        }
        const text = lines.join('\n').trim();
        const tags = getTagsText(definition.tags, excludedDictionaries);
        if (text.length === 0 && tags.length === 0) { continue; }
        const variants = definition.headwordIndices.map((index) => headwords[index]).join(', ');
        append(definition.dictionary, [variants, tags.length > 0 ? `[${tags}]` : '', text].filter((line) => line.length > 0).join('\n'));
    }
    for (const frequency of entry.frequencies) {
        if (excludedDictionaries.has(frequency.dictionary)) { continue; }
        append(frequency.dictionary, `Frequency: ${headwords[frequency.headwordIndex]}: ${frequency.displayValue ?? frequency.frequency}`);
    }
    for (const pronunciation of entry.pronunciations) {
        if (excludedDictionaries.has(pronunciation.dictionary)) { continue; }
        for (const value of pronunciation.pronunciations) {
            let text;
            if (value.type === 'pitch-accent') {
                text = `Pitch accent: ${headwords[pronunciation.headwordIndex]}: downstep ${value.positions}`;
                if (value.nasalPositions.length > 0) { text += `; nasal morae ${value.nasalPositions.join(', ')}`; }
                if (value.devoicePositions.length > 0) { text += `; devoiced morae ${value.devoicePositions.join(', ')}`; }
            } else {
                text = `IPA: ${headwords[pronunciation.headwordIndex]}: ${value.ipa}`;
            }
            const tags = getTagsText(value.tags, excludedDictionaries);
            if (tags.length > 0) { text += ` [${tags}]`; }
            append(pronunciation.dictionary, text);
        }
    }
    const text = (
        sections.size === 0 ?
            '' :
            [
                [...new Set(headwords)].join('\n'),
                ...[...sections].map(([dictionary, lines]) => `${dictionary}\n${lines.join('\n\n')}`),
            ].join('\n\n')
    );
    return {text, unresolvedImages: imageState.unresolvedImages};
}

/**
 * @param {import('dictionary').Tag[]} tags
 * @param {Set<string>} [excludedDictionaries]
 * @param {string} [sourceDictionary]
 * @returns {string}
 */
function getTagsText(tags, excludedDictionaries = new Set(), sourceDictionary) {
    return tags
        .filter(({dictionaries}) => dictionaries.length === 0 || dictionaries.some((dictionary) => !excludedDictionaries.has(dictionary)))
        .map(({name, content, contentSources}) => {
            if (typeof contentSources !== 'undefined') {
                content = [...new Set(contentSources
                    .filter((source) => !excludedDictionaries.has(source.dictionary) && (typeof sourceDictionary === 'undefined' || source.dictionary === sourceDictionary))
                    .flatMap((source) => source.content))];
            }
            return content.length === 0 ? name : `${name}: ${content.join('; ')}`;
        }).join(', ');
}

/**
 * @param {import('structured-content').Content|undefined} content
 * @param {string} dictionary
 * @param {{unresolvedImages: number}} imageState
 * @returns {string}
 */
function getStructuredContentText(content, dictionary, imageState) {
    if (typeof content === 'string') { return content; }
    if (typeof content === 'undefined') { return ''; }
    if (Array.isArray(content)) { return content.map((item) => getStructuredContentText(item, dictionary, imageState)).join(''); }
    const {tag} = content;
    if (tag === 'img') {
        return getImageText(content, dictionary, imageState);
    }
    if (tag === 'br') { return '\n'; }
    if (tag === 'rp') { return ''; }
    const text = getStructuredContentText(content.content, dictionary, imageState);
    switch (tag) {
        case 'rt': return `(${text})`;
        case 'td':
        case 'th': return `${text}\t`;
        case 'li': return `\n- ${text.trim()}\n`;
        case 'div':
        case 'ol':
        case 'ul':
        case 'details':
        case 'summary':
        case 'table':
        case 'thead':
        case 'tbody':
        case 'tfoot':
        case 'tr': return `\n${text}\n`;
        default: return text;
    }
}

/**
 * @param {import('structured-content').ImageElementBase} image
 * @param {string} dictionary
 * @param {{unresolvedImages: number}} imageState
 * @returns {string}
 */
function getImageText(image, dictionary, imageState) {
    const {path, alt, description, title, data} = image;
    if (data?.role === 'illustration') { return ''; }
    const label = dictionary === '新明解国語辞典　第八版' ? smk8Labels.get(path) : void 0;
    // Hover titles alone do not establish equivalent content; require a textual role or a verified label.
    const textTitle = data?.role === 'text' || data?.role === 'label' || (typeof label === 'string' && title?.trim() === label) ? title : void 0;
    for (const value of [alt, description, textTitle]) {
        if (typeof value !== 'string') { continue; }
        const text = value.trim();
        if (text.length === 0 || text === path || /^(?:image|img|picture|photo)$/i.test(text) || /(?:https?:|data:|blob:|<[^>]*>|\.(?:svg|png|jpe?g|gif|webp|bmp|avif)(?:$|[?#]))/i.test(text)) { continue; }
        return text;
    }
    if (typeof label === 'string') { return label; }
    ++imageState.unresolvedImages;
    return '';
}
