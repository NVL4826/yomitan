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

/**
 * @param {import('dictionary').TermDictionaryEntry} entry
 * @param {Set<string>} [excludedDictionaries]
 * @param {import('settings').CopyImageRule[]} [rules]
 * @param {Map<string, string>} [revisions]
 * @returns {{text: string, unresolvedImages: number, images: CopyImageOutcome[]}}
 */
export function getResultEntryText(entry, excludedDictionaries = new Set(), rules = [], revisions = new Map()) {
    const headwords = entry.headwords.map(({term, reading}) => (term === reading || reading.length === 0 ? term : `${term} (${reading})`));
    /** @type {Map<string, string[]>} */
    const sections = new Map();
    /** @type {ImageState} */
    const imageState = {unresolvedImages: 0,
        images: [],
        revisions,
        rules: new Map(rules.map((rule) => [JSON.stringify([rule.dictionary, rule.revision, rule.path]), rule]))};
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
        const imageStart = imageState.images.length;
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
        for (const image of imageState.images.slice(imageStart)) { image.context = text; }
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
    return {text, unresolvedImages: imageState.unresolvedImages, images: imageState.images};
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
 * @param {ImageState} imageState
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
 * @param {ImageState} imageState
 * @returns {string}
 */
function getImageText(image, dictionary, imageState) {
    const {path, alt, description, title, data} = image;
    const revision = imageState.revisions.get(dictionary) ?? '';
    const rule = imageState.rules.get(JSON.stringify([dictionary, revision, path]));
    /** @type {CopyImageOutcome} */
    const outcome = {dictionary, revision, path, handling: 'unresolved', text: '', context: ''};
    imageState.images.push(outcome);
    if (typeof rule !== 'undefined') {
        outcome.handling = rule.action === 'replace' ? 'user-replacement' : 'user-omission';
        outcome.text = rule.action === 'replace' ? rule.text : '';
        return outcome.text;
    }
    if (data?.role === 'illustration') {
        outcome.handling = 'illustration';
        return '';
    }
    // Hover titles alone do not establish equivalent content; require a textual role.
    const textTitle = data?.role === 'text' || data?.role === 'label' ? title : void 0;
    for (const value of [alt, description, textTitle]) {
        if (typeof value !== 'string') { continue; }
        const text = value.trim();
        if (text.length === 0 || text === path || /^(?:image|img|picture|photo)$/i.test(text) || /(?:https?:|data:|blob:|<[^>]*>|\.(?:svg|png|jpe?g|gif|webp|bmp|avif)(?:$|[?#]))/i.test(text)) { continue; }
        outcome.handling = 'metadata';
        outcome.text = text;
        return text;
    }
    ++imageState.unresolvedImages;
    return '';
}

/**
 * @typedef {{dictionary: string, revision: string, path: string, handling: 'user-replacement'|'user-omission'|'metadata'|'illustration'|'unresolved', text: string, context: string}} CopyImageOutcome
 * @typedef {{unresolvedImages: number, images: CopyImageOutcome[], rules: Map<string, import('settings').CopyImageRule>, revisions: Map<string, string>}} ImageState
 */
