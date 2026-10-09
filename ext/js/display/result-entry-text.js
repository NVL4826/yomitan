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

import {findCopyContentRule} from './copy-content-rules.js';

/**
 * @param {import('dictionary').TermDictionaryEntry} entry
 * @param {Set<string>} [excludedDictionaries]
 * @param {import('settings').CopyImageRule[]} [rules]
 * @param {Map<string, string>} [revisions]
 * @param {'markdown'|'text'} [format]
 * @param {{contentRules?: import('settings').CopyContentRule[], reduceHeadwordRepetition?: boolean}} [options]
 * @returns {{text: string, unresolvedImages: number, images: CopyImageOutcome[]}}
 */
export function getResultEntryText(entry, excludedDictionaries = new Set(), rules = [], revisions = new Map(), format = 'markdown', options = {}) {
    const literal = (/** @type {string} */ text) => escapeText(text, format);
    const headwords = entry.headwords.map(({term, reading}) => (term === reading || reading.length === 0 ? term : `${term} (${reading})`));
    const headingLabels = new Set(headwords);
    /** @type {Map<string, string[]>} */
    const sections = new Map();
    /** @type {ImageState} */
    const imageState = {unresolvedImages: 0,
        images: [],
        revisions,
        contentRules: options.contentRules ?? [],
        rules: new Map(rules.map((rule) => [JSON.stringify([rule.dictionary, rule.revision, rule.path]), rule]))};
    /**
     * @param {string} dictionary
     * @param {string} text
     */
    const append = (dictionary, text) => {
        if (excludedDictionaries.has(dictionary)) { return; }
        text = text.replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^[ \n]+|[ \n]+$/g, '');
        if (text.trim().length === 0) { return; }
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
                append(dictionary, `Tags (${literal(headwords[index])}): ${literal(getTagsText([tag], excludedDictionaries, dictionary))}`);
            }
        }
    }
    for (const definition of entry.definitions) {
        if (excludedDictionaries.has(definition.dictionary)) { continue; }
        const imageStart = imageState.images.length;
        const lines = [];
        for (const content of definition.entries) {
            if (typeof content === 'string') {
                lines.push(literal(content));
            } else {
                switch (content.type) {
                    case 'text':
                        lines.push(literal(content.text));
                        break;
                    case 'image':
                        lines.push(literal(getImageText(content, definition.dictionary, imageState)));
                        break;
                    case 'structured-content':
                        lines.push(getStructuredContentText(content.content, definition.dictionary, imageState, format));
                        break;
                }
            }
        }
        const text = lines.join('\n').replace(/^[ \n]+|[ \n]+$/g, '');
        if (imageState.images.length > imageStart) {
            const contextState = {...imageState, images: [], unresolvedImages: 0};
            const context = definition.entries.map((content) => {
                if (typeof content === 'string') { return content; }
                if (content.type === 'text') { return content.text; }
                return content.type === 'image' ? getImageText(content, definition.dictionary, contextState) : getStructuredContentText(content.content, definition.dictionary, contextState, 'text');
            }).join('\n').replace(/^[ \n]+|[ \n]+$/g, '');
            for (const image of imageState.images.slice(imageStart)) { image.context = context; }
        }
        const tags = getTagsText(definition.tags, excludedDictionaries);
        if (text.trim().length === 0 && tags.length === 0) { continue; }
        const definitionLabels = new Set(definition.headwordIndices.map((index) => headwords[index]));
        const redundant = options.reduceHeadwordRepetition && definitionLabels.size === headingLabels.size && [...definitionLabels].every((label) => headingLabels.has(label));
        const variants = redundant ? '' : definition.headwordIndices.map((index) => literal(headwords[index])).join(', ');
        append(definition.dictionary, [variants, tags.length > 0 ? literal(`[${tags}]`) : '', text].filter((line) => line.length > 0).join('\n'));
    }
    for (const frequency of entry.frequencies) {
        if (excludedDictionaries.has(frequency.dictionary)) { continue; }
        append(frequency.dictionary, literal(`Frequency: ${headwords[frequency.headwordIndex]}: ${frequency.displayValue ?? frequency.frequency}`));
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
            append(pronunciation.dictionary, literal(text));
        }
    }
    const text = (
        sections.size === 0 ?
            '' :
            [
                [...new Set(headwords)].map((headword) => `${format === 'markdown' ? '# ' : ''}${literal(headword)}`).join('\n'),
                ...[...sections].map(([dictionary, lines], index) => `${format === 'markdown' ? '## ' : ''}${index + 1}. ${literal(dictionary)}\n${lines.join('\n\n')}`),
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
 * @param {string} text
 * @param {'markdown'|'text'} format
 * @returns {string}
 */
function escapeText(text, format) {
    if (format === 'text') { return text; }
    return text.replace(/[\\`*_{}[\]<>|#&~]/g, '\\$&').replace(/^([ \t]*)([-+]|\d+[.)]|[-=]{2,})(?=\s|$)/gm, (_, space, marker) => `${space}${marker.replace(/[-+.)=]/g, '\\$&')}`);
}

/**
 * @param {string} left
 * @param {string} right
 * @param {'markdown'|'text'} format
 * @returns {string}
 */
function joinText(left, right, format) {
    const text = left + right;
    if (format === 'text' || left.length === 0 || right.length === 0) { return text; }
    // Escape markers assembled across literal boundaries without altering generated lists.
    return text.replace(/^([ \t]*)([-+]|\d+[.)]|[-=]{2,})(?=\s|$)/gm, (/** @type {string} */ _, /** @type {string} */ space, /** @type {string} */ marker, /** @type {number} */ index) => {
        const start = index + space.length;
        return start < left.length && start + marker.length >= left.length ? `${space}${marker.replace(/[-+.)=]/g, '\\$&')}` : space + marker;
    });
}

/**
 * @param {import('structured-content').Content|undefined} content
 * @param {string} dictionary
 * @param {ImageState} imageState
 * @param {'markdown'|'text'} format
 * @param {import('structured-content').Element[]} [ancestors]
 * @param {'normal'|'list-item'|'table-cell'} [layout]
 * @returns {string}
 */
function getStructuredContentText(content, dictionary, imageState, format, ancestors = [], layout = 'normal') {
    if (typeof content === 'string') { return escapeText(content, format); }
    if (typeof content === 'undefined') { return ''; }
    if (Array.isArray(content)) {
        let text = '';
        /** @type {import('settings').CopyContentRule|undefined} */
        let previous;
        for (const item of content) {
            const rule = typeof item === 'object' && !Array.isArray(item) ? findCopyContentRule(item, ancestors, dictionary, imageState.revisions.get(dictionary), imageState.contentRules) : void 0;
            const output = getStructuredContentText(item, dictionary, imageState, format, ancestors, layout);
            if (output.trim().length > 0 && rule && rule === previous && rule.action !== 'omit') { text = joinText(text, escapeText(rule.separator ?? '', format), format); }
            text = joinText(text, output, format);
            previous = output.trim().length > 0 && rule?.action !== 'omit' ? rule : void 0;
        }
        return text;
    }
    const {tag} = content;
    const rule = findCopyContentRule(content, ancestors, dictionary, imageState.revisions.get(dictionary), imageState.contentRules);
    if (rule?.action === 'omit') { return ''; }
    const children = [content, ...ancestors];
    let text;
    if (rule?.action === 'replace') {
        text = escapeText((rule.prefix ?? '') + rule.text + (rule.suffix ?? ''), format);
    } else if (rule?.action === 'title') {
        text = escapeText((rule.prefix ?? '') + ('title' in content ? content.title ?? '' : '') + (rule.suffix ?? ''), format);
    } else {
        switch (tag) {
            case 'img': text = escapeText(getImageText(content, dictionary, imageState), format); break;
            case 'br': text = '\n'; break;
            case 'rp': text = ''; break;
            case 'table':
                text = getTableText(content.content, dictionary, imageState, format, children);
                break;
            case 'tr':
            case 'thead':
            case 'tbody':
            case 'tfoot':
                text = getStructuredContentText(content.content, dictionary, imageState, format, children);
                break;
            case 'ol':
            case 'ul': {
                const items = Array.isArray(content.content) ? content.content : [content.content];
                const separator = format === 'markdown' ? '\n\n' : '\n';
                let index = 0;
                /** @type {import('settings').CopyContentRule|undefined} */
                let previous;
                /** @type {string[]} */
                const outputs = [];
                for (const item of items) {
                    const itemRule = typeof item === 'object' && !Array.isArray(item) ? findCopyContentRule(item, children, dictionary, imageState.revisions.get(dictionary), imageState.contentRules) : void 0;
                    const isListItem = typeof item === 'object' && !Array.isArray(item) && item.tag === 'li';
                    const output = getStructuredContentText(item, dictionary, imageState, format, children, isListItem ? 'list-item' : 'normal').trim();
                    if (output.length > 0 && itemRule && itemRule === previous && itemRule.action !== 'omit') { outputs[outputs.length - 1] += escapeText(itemRule.separator ?? '', format); }
                    previous = output.length > 0 && itemRule?.action !== 'omit' ? itemRule : void 0;
                    if (output.length === 0) { continue; }
                    const marker = isListItem ? (tag === 'ol' ? `${++index}. ` : '- ') : '';
                    outputs.push(marker + output.replace(format === 'markdown' ? /\n/g : /\n+/g, `\n${' '.repeat(marker.length)}`));
                }
                text = `${separator}${outputs.join('\n')}${separator}`;
                break;
            }
            default: text = getStructuredContentText(content.content, dictionary, imageState, format, children); break;
        }
    }
    if (rule?.action === 'content') { text = joinText(joinText(escapeText(rule.prefix ?? '', format), text, format), escapeText(rule.suffix ?? '', format), format); }
    if (layout === 'list-item' || layout === 'table-cell') { return text; }
    if (tag === 'table') { return text; }
    if (tag === 'ol' || tag === 'ul') { return text; }
    switch (tag) {
        case 'rt': return `(${text})`;
        case 'td':
        case 'th': return `${text}\t`;
        case 'li': return `\n- ${text.trim()}\n`;
        case 'div':
        case 'details':
        case 'summary':
        case 'thead':
        case 'tbody':
        case 'tfoot':
        case 'tr': return `\n${text}\n`;
        default: return text;
    }
}

/**
 * @param {import('structured-content').Content|undefined} content
 * @returns {boolean}
 */
function hasTable(content) {
    if (typeof content !== 'object') { return false; }
    if (Array.isArray(content)) { return content.some(hasTable); }
    return content.tag === 'table' || hasTable(content.content);
}

/**
 * @param {import('structured-content').Content|undefined} content
 * @param {string} dictionary
 * @param {ImageState} imageState
 * @param {'markdown'|'text'} format
 * @param {import('structured-content').Element[]} ancestors
 * @returns {string}
 */
function getTableText(content, dictionary, imageState, format, ancestors) {
    /** @type {import('structured-content').TableElement[][]} */
    const rows = [];
    /** @type {Map<import('structured-content').TableElement, import('structured-content').Element[]>} */
    const cellAncestors = new Map();
    /** @type {Set<import('structured-content').TableElement>} */
    const suppressedCells = new Set();
    /** @type {{node: import('structured-content').Element, start: number, end: number, rule: import('settings').CopyContentRule, next?: import('structured-content').Element}[]} */
    const groups = [];
    /**
     * @param {import('structured-content').Content|undefined} item
     * @param {import('structured-content').Element[]} parents
     * @param {boolean} suppressed
     * @param {import('structured-content').Element} [next]
     */
    const collect = (item, parents, suppressed, next) => {
        if (Array.isArray(item)) {
            for (const [index, child] of item.entries()) {
                const sibling = item[index + 1];
                collect(child, parents, suppressed, typeof sibling === 'object' && !Array.isArray(sibling) ? sibling : void 0);
            }
            return;
        }
        if (typeof item !== 'object') { return; }
        const rule = findCopyContentRule(item, parents, dictionary, imageState.revisions.get(dictionary), imageState.contentRules);
        const start = rows.length;
        const skipContent = suppressed || (typeof rule !== 'undefined' && rule.action !== 'content');
        if (item.tag === 'tr') {
            /** @type {import('structured-content').TableElement[]} */
            const cells = [];
            /** @param {import('structured-content').Content|undefined} child */
            const collectCells = (child) => {
                if (Array.isArray(child)) {
                    for (const value of child) { collectCells(value); }
                } else if (typeof child === 'object' && (child.tag === 'td' || child.tag === 'th')) {
                    cells.push(child);
                    cellAncestors.set(child, [item, ...parents]);
                    if (skipContent) { suppressedCells.add(child); }
                }
            };
            collectCells(item.content);
            rows.push(cells);
        } else if (item.tag === 'thead' || item.tag === 'tbody' || item.tag === 'tfoot') { collect(item.content, [item, ...parents], skipContent); }
        if (rule && !suppressed && rows.length > start) {
            groups.push({node: item, start, end: rows.length, rule, next: next && findCopyContentRule(next, parents, dictionary, imageState.revisions.get(dictionary), imageState.contentRules) === rule ? next : void 0});
        }
    };
    collect(content, ancestors, false);
    const nested = rows.some((row) => row.some((cell) => hasTable(cell.content)));
    const cellFormat = nested ? 'text' : format;
    /**
     * @param {ImageState} state
     * @param {'markdown'|'text'} outputFormat
     * @param {boolean} preserveLines
     * @returns {string[][]}
     */
    const getCellTexts = (state, outputFormat, preserveLines) => rows.map((row) => {
        /** @type {string[]} */
        const outputs = [];
        /** @type {import('settings').CopyContentRule|undefined} */
        let previous;
        for (const cell of row) {
            const parents = cellAncestors.get(cell) ?? ancestors;
            const rule = findCopyContentRule(cell, parents, dictionary, state.revisions.get(dictionary), state.contentRules);
            const text = suppressedCells.has(cell) ? '' : getStructuredContentText(cell, dictionary, state, outputFormat, parents, 'table-cell');
            const output = preserveLines ? text.replace(/^[ \n]+|[ \n]+$/g, '') : text.trim().replace(/\s*\n\s*/g, '; ').replace(/\t/g, ' ');
            if (output.trim().length > 0 && rule && rule === previous && rule.action !== 'omit') { outputs[outputs.length - 1] += escapeText(rule.separator ?? '', outputFormat); }
            outputs.push(output);
            previous = output.trim().length > 0 && rule?.action !== 'omit' ? rule : void 0;
        }
        return outputs;
    });
    const texts = getCellTexts(imageState, cellFormat, nested);
    /** @type {string[][]} */
    let grid = [];
    let expanded = 0;
    let expandedCharacters = 0;
    let oversized = false;
    for (const [rowIndex, row] of rows.entries()) {
        grid[rowIndex] ??= [];
        let column = 0;
        for (const [cellIndex, cell] of row.entries()) {
            while (typeof grid[rowIndex][column] !== 'undefined') { ++column; }
            const colSpan = cell.colSpan ?? 1;
            const rowSpan = cell.rowSpan === 0 ? rows.length - rowIndex : cell.rowSpan ?? 1;
            const height = Math.min(rowSpan, rows.length - rowIndex);
            // Bound expansion of dictionary-controlled spans; retain original cells on overflow.
            if (!Number.isSafeInteger(colSpan) || !Number.isSafeInteger(rowSpan) || colSpan < 1 || rowSpan < 1 || column + colSpan > 10000 || expanded + colSpan * height > 10000 || expandedCharacters + texts[rowIndex][cellIndex].length * colSpan * height > 1000000) {
                oversized = true;
                break;
            }
            expanded += colSpan * height;
            expandedCharacters += texts[rowIndex][cellIndex].length * colSpan * height;
            for (let y = rowIndex; y < rowIndex + height; ++y) {
                grid[y] ??= [];
                for (let x = column; x < column + colSpan; ++x) { grid[y][x] = texts[rowIndex][cellIndex]; }
            }
            column += colSpan;
        }
        if (oversized) { break; }
    }
    if (grid.length === 0) { return ''; }
    let width = 0;
    for (const row of grid) { width = Math.max(width, row.length); }
    oversized ||= width * rows.length > 10000;
    if (oversized) {
        const contextState = {...imageState, images: [], unresolvedImages: 0};
        grid = getCellTexts(contextState, 'text', true);
    } else {
        for (const row of grid) {
            for (let i = 0; i < width; ++i) { row[i] ??= ''; }
        }
    }
    const outputFormat = nested || oversized ? 'text' : format;
    /** @type {Set<number>} */
    const omittedRows = new Set();
    const literal = (/** @type {string} */ value) => {
        value = escapeText(value, outputFormat);
        return nested || oversized ? value : value.replace(/\s*\n\s*/g, '; ').replace(/\t/g, ' ');
    };
    const groupsByNode = new Map(groups.map((group) => [group.node, group]));
    // Decorate the expanded grid so row mappings cannot shift cells carried from earlier rows.
    for (const {node, start, end, rule, next} of groups) {
        const indices = Array.from({length: end - start}, (_, index) => start + index).filter((index) => !omittedRows.has(index));
        if (indices.length === 0) { continue; }
        const first = indices[0];
        const last = indices[indices.length - 1];
        if (rule.action === 'omit') {
            for (const index of indices) { omittedRows.add(index); }
            continue;
        }
        if (rule.action !== 'content') {
            for (const index of indices) { grid[index].fill(''); }
            const source = rule.action === 'replace' ? rule.text : ('title' in node ? node.title ?? '' : '');
            grid[first][0] = literal((rule.prefix ?? '') + source + (rule.suffix ?? ''));
            for (const index of indices.slice(1)) { omittedRows.add(index); }
            continue;
        }
        grid[first][0] = joinText(literal(rule.prefix ?? ''), grid[first][0] ?? '', outputFormat);
        const column = Math.max(0, grid[last].length - 1);
        grid[last][column] = joinText(grid[last][column] ?? '', literal(rule.suffix ?? ''), outputFormat);
        const nextGroup = next && groupsByNode.get(next);
        if (nextGroup && grid.slice(first, last + 1).some((row) => row.some((text) => text.trim().length > 0)) && grid.slice(nextGroup.start, nextGroup.end).some((row) => row.some((text) => text.trim().length > 0))) {
            grid[last][column] = joinText(grid[last][column], literal(rule.separator ?? ''), outputFormat);
        }
    }
    grid = grid.filter((_, index) => !omittedRows.has(index));
    if (!grid.some((row) => row.some((text) => text.trim().length > 0))) { return ''; }
    if (format === 'text' || nested || oversized) {
        const text = grid.map((row) => row.join('\t')).join('\n');
        if (format === 'text') { return `\n${text}\n`; }
        let fenceLength = 3;
        for (const [match] of text.matchAll(/`+/g)) { fenceLength = Math.max(fenceLength, match.length + 1); }
        const fence = '`'.repeat(fenceLength);
        return `\n\n${fence}\n${text}\n${fence}\n\n`;
    }
    for (const row of grid) { width = Math.max(width, row.length); }
    if (!(rows.find((_, index) => !omittedRows.has(index)) ?? []).some((cell) => cell.tag === 'th')) { grid.unshift(Array.from({length: width}, () => '')); }
    const lines = grid.map((row) => `| ${row.join(' | ')} |`);
    lines.splice(1, 0, `| ${Array.from({length: width}, () => '---').join(' | ')} |`);
    return `\n\n${lines.join('\n')}\n\n`;
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
 * @typedef {{unresolvedImages: number, images: CopyImageOutcome[], rules: Map<string, import('settings').CopyImageRule>, revisions: Map<string, string>, contentRules: import('settings').CopyContentRule[]}} ImageState
 */
