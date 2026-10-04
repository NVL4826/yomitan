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
 * @returns {import('settings').CopyImageRule[]}
 * @throws {Error}
 */
export function validateCopyImageRuleDocument(document) {
    if (!isObjectNotArray(document) || document.version !== 1 || !Array.isArray(document.rules)) {
        throw new Error('Expected an image rule document with version 1 and a rules array.');
    }
    const identities = new Set();
    return document.rules.map((value, index) => {
        const error = (/** @type {string} */ reason) => new Error(`Rule ${index + 1}: ${reason}`);
        if (!isObjectNotArray(value)) { throw error('expected an object.'); }
        const {dictionary, revision, path, action, text} = value;
        for (const [name, identifier] of [['dictionary', dictionary], ['revision', revision], ['path', path]]) {
            if (typeof identifier !== 'string' || identifier.trim().length === 0) { throw error(`${name} must be a non-empty string.`); }
        }
        if (action !== 'replace' && action !== 'omit') { throw error('action must be replace or omit.'); }
        if (action === 'replace' && (typeof text !== 'string' || text.trim().length === 0)) { throw error('replacement text must be a non-empty string.'); }
        if (action === 'omit' && Object.hasOwn(value, 'text')) { throw error('omission rules must not contain text.'); }
        const identity = JSON.stringify([dictionary, revision, path]);
        if (identities.has(identity)) { throw error('duplicate dictionary/revision/path identity.'); }
        identities.add(identity);
        return /** @type {import('settings').CopyImageRule} */ (action === 'replace' ? {dictionary, revision, path, action, text} : {dictionary, revision, path, action});
    });
}
