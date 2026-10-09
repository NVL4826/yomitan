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

import {isObjectNotArray} from '../core/object-utilities.js';

/**
 * @param {unknown} document
 * @returns {import('settings').CopyContentRule[]}
 * @throws {Error}
 */
export function validateCopyContentRuleDocument(document) {
    if (!isObjectNotArray(document) || document.version !== 1 || !Array.isArray(document.rules) || Object.keys(document).some((key) => key !== 'version' && key !== 'rules')) {
        throw new Error('Expected a content rule document with version 1 and a rules array.');
    }
    const ids = new Set();
    return document.rules.map((value, index) => {
        const error = (/** @type {string} */ reason) => new Error(`Rule ${index + 1}: ${reason}`);
        if (!isObjectNotArray(value)) { throw error('expected an object.'); }
        if (Object.keys(value).some((key) => !['id', 'dictionary', 'revision', 'match', 'action', 'text', 'prefix', 'suffix', 'separator'].includes(key))) { throw error('unknown field.'); }
        for (const key of ['id', 'dictionary', 'revision']) {
            if (typeof value[key] !== 'string' || value[key].trim().length === 0) { throw error(`${key} must be a non-empty string.`); }
        }
        if (ids.has(value.id)) { throw error('duplicate id.'); }
        ids.add(value.id);
        validateMatcher(value.match, true);
        if (typeof value.action !== 'string' || !['content', 'title', 'replace', 'omit'].includes(value.action)) { throw error('invalid action.'); }
        if (value.action === 'replace') {
            if (typeof value.text !== 'string' || value.text.trim().length === 0) { throw error('replacement text must be a non-empty string.'); }
        } else if (Object.hasOwn(value, 'text')) { throw error('only replacement rules may contain text.'); }
        for (const key of ['prefix', 'suffix', 'separator']) {
            if (!Object.hasOwn(value, key)) { continue; }
            if (value.action === 'omit' || typeof value[key] !== 'string') { throw error(`invalid ${key}.`); }
        }
        return /** @type {import('settings').CopyContentRule} */ (structuredClone(value));
    });
}

/**
 * @param {unknown} match
 * @param {boolean} allowAncestors
 * @throws {Error}
 */
function validateMatcher(match, allowAncestors) {
    if (!isObjectNotArray(match) || Object.keys(match).length === 0) { throw new Error('Matcher must contain a condition.'); }
    for (const [key, value] of Object.entries(match)) {
        switch (key) {
            case 'tag':
                if (typeof value !== 'string' || value.trim().length === 0) { throw new Error('Matcher tag must be a non-empty string.'); }
                break;
            case 'title':
                if (typeof value !== 'string') { throw new Error('Matcher title must be a string.'); }
                break;
            case 'empty':
                if (typeof value !== 'boolean') { throw new Error('Matcher empty must be a boolean.'); }
                break;
            case 'data':
                if (!isObjectNotArray(value) || Object.keys(value).length === 0 || Object.values(value).some((item) => typeof item !== 'string')) { throw new Error('Matcher data must contain string metadata.'); }
                break;
            case 'ancestors':
                if (!allowAncestors || !Array.isArray(value) || value.length === 0) { throw new Error('Matcher ancestors must contain node matchers.'); }
                for (const ancestor of value) { validateMatcher(ancestor, false); }
                break;
            default: throw new Error(`Unknown matcher field: ${key}.`);
        }
    }
}

/**
 * @param {import('structured-content').Element} node
 * @param {import('structured-content').Element[]} ancestors Nearest first.
 * @param {string} dictionary
 * @param {string|undefined} revision
 * @param {import('settings').CopyContentRule[]} rules
 * @returns {import('settings').CopyContentRule|undefined}
 */
export function findCopyContentRule(node, ancestors, dictionary, revision, rules) {
    if (!revision || node.tag === 'img') { return; }
    return rules.find((rule) => {
        if (rule.dictionary !== dictionary || rule.revision !== revision || !matchesNode(node, rule.match)) { return false; }
        let index = 0;
        for (const matcher of rule.match.ancestors ?? []) {
            while (index < ancestors.length && !matchesNode(ancestors[index], matcher)) { ++index; }
            if (index === ancestors.length) { return false; }
            ++index;
        }
        return true;
    });
}

/**
 * @param {import('structured-content').Element} node
 * @param {import('settings').CopyContentNodeMatch} match
 * @returns {boolean}
 */
function matchesNode(node, match) {
    return (typeof match.tag === 'undefined' || match.tag === node.tag) &&
    (typeof match.title === 'undefined' || ('title' in node && match.title === node.title)) &&
    (typeof match.empty === 'undefined' || match.empty === !hasOriginalText(node.content)) &&
    Object.entries(match.data ?? {}).every(([key, value]) => 'data' in node && node.data?.[key] === value);
}

/**
 * @param {import('structured-content').Content|undefined} content
 * @returns {boolean}
 */
function hasOriginalText(content) {
    if (typeof content === 'string') { return content.trim().length > 0; }
    if (Array.isArray(content)) { return content.some(hasOriginalText); }
    return typeof content !== 'undefined' && hasOriginalText(content.content);
}

/**
 * @param {import('dictionary').TermDictionaryEntry} entry
 * @param {Set<string>} excludedDictionaries
 * @param {import('settings').CopyContentRule[]} rules
 * @param {Map<string, string>} revisions
 * @returns {CopyContentCandidate[]}
 */
export function getCopyContentCandidates(entry, excludedDictionaries, rules, revisions) {
    /** @type {CopyContentCandidate[]} */
    const candidates = [];
    for (const definition of entry.definitions) {
        const {dictionary} = definition;
        if (excludedDictionaries.has(dictionary)) { continue; }
        const revision = revisions.get(dictionary) ?? '';
        /**
         * @param {import('structured-content').Content|undefined} content
         * @param {import('structured-content').Element[]} ancestors
         */
        const visit = (content, ancestors) => {
            if (Array.isArray(content)) {
                for (const child of content) { visit(child, ancestors); }
            } else if (typeof content === 'object' && content.tag !== 'img') {
                const rule = findCopyContentRule(content, ancestors, dictionary, revision, rules);
                const candidate = {node: content, ancestors, dictionary, revision};
                candidates.push(typeof rule === 'undefined' ? candidate : {...candidate, ruleId: rule.id});
                visit(content.content, [content, ...ancestors]);
            }
        };
        for (const content of definition.entries) {
            if (typeof content === 'object' && content.type === 'structured-content') { visit(content.content, []); }
        }
    }
    return candidates;
}

/**
 * @typedef {{node: Exclude<import('structured-content').Element, import('structured-content').ImageElement>, ancestors: import('structured-content').Element[], dictionary: string, revision: string, ruleId?: string}} CopyContentCandidate
 */
