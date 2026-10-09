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

import {parseJson} from '../core/json.js';
import {querySelectorNotNull} from '../dom/query-selector.js';
import {validateCopyContentRuleDocument} from './copy-content-rules.js';

export class CopyContentInspector {
    /** @param {import('./search-display-controller.js').SearchDisplayController} controller */
    constructor(controller) {
        /** @type {import('./search-display-controller.js').SearchDisplayController} */
        this._controller = controller;
        /** @type {HTMLDialogElement} */
        this._dialog = querySelectorNotNull(document, '#copy-content-inspector');
        /** @type {HTMLSelectElement} */
        this._select = querySelectorNotNull(this._dialog, '#copy-content-candidate');
        /** @type {HTMLFieldSetElement} */
        this._fields = querySelectorNotNull(this._dialog, '#copy-content-fields');
        /** @type {HTMLTextAreaElement} */
        this._match = querySelectorNotNull(this._dialog, '#copy-content-match');
        /** @type {HTMLSelectElement} */
        this._action = querySelectorNotNull(this._dialog, '#copy-content-action');
        /** @type {HTMLTextAreaElement} */
        this._text = querySelectorNotNull(this._dialog, '#copy-content-text');
        /** @type {HTMLInputElement} */
        this._prefix = querySelectorNotNull(this._dialog, '#copy-content-prefix');
        /** @type {HTMLInputElement} */
        this._suffix = querySelectorNotNull(this._dialog, '#copy-content-suffix');
        /** @type {HTMLInputElement} */
        this._separator = querySelectorNotNull(this._dialog, '#copy-content-separator');
        /** @type {HTMLButtonElement} */
        this._saveButton = querySelectorNotNull(this._dialog, '#copy-content-save');
        /** @type {ReturnType<import('./copy-content-rules.js').getCopyContentCandidates>} */
        this._candidates = [];
        /** @type {?import('dictionary').TermDictionaryEntry} */
        this._entry = null;
        /** @type {?import('settings').CopyContentRule[]} */
        this._draft = null;
        /** @type {boolean} */
        this._saving = false;
        this._dialog.addEventListener('keydown', (event) => { event.stopPropagation(); });
        this._dialog.addEventListener('paste', (event) => { event.stopPropagation(); });
        this._dialog.addEventListener('close', () => { this._entry = null; });
        this._select.addEventListener('change', () => { this._edit(); });
        this._fields.addEventListener('input', () => { this._invalidatePreview(); });
        this._action.addEventListener('change', () => {
            this._invalidatePreview();
            this._updateAction();
        });
        querySelectorNotNull(this._dialog, '#copy-content-preview-button').addEventListener('click', () => { this._preview(); });
        this._saveButton.addEventListener('click', () => {
            if (this._draft !== null) { void this._save(this._draft); }
        });
        querySelectorNotNull(this._dialog, '#copy-content-delete').addEventListener('click', () => { this._changeRule('delete'); });
        querySelectorNotNull(this._dialog, '#copy-content-earlier').addEventListener('click', () => { this._changeRule('earlier'); });
        querySelectorNotNull(this._dialog, '#copy-content-later').addEventListener('click', () => { this._changeRule('later'); });
        querySelectorNotNull(this._dialog, '#copy-content-inspector-close').addEventListener('click', () => { this.close(); });
    }

    /** @param {import('dictionary').TermDictionaryEntry} entry */
    show(entry) {
        this._entry = entry;
        querySelectorNotNull(this._dialog, '#copy-content-inspector-status').textContent = '';
        this._render();
        this._dialog.showModal();
    }

    /** */
    close() {
        if (this._dialog.open) { this._dialog.close(); }
        this._entry = null;
    }

    /** */
    _render() {
        if (this._entry === null) { return; }
        const selected = this._select.value || '0';
        this._candidates = this._controller.getCopyContentCandidates(this._entry);
        this._select.replaceChildren();
        for (const [index, {node, dictionary, ruleId}] of this._candidates.entries()) {
            const option = document.createElement('option');
            option.value = `${index}`;
            option.textContent = `${index + 1}. ${dictionary}: ${node.tag} ${JSON.stringify(node.data ?? {})}${typeof ruleId === 'string' ? ` (rule: ${ruleId})` : ''}`;
            this._select.appendChild(option);
        }
        if (this._candidates.length > 0) { this._select.value = this._candidates[Number(selected)] ? selected : '0'; }
        this._edit();
    }

    /** */
    _edit() {
        this._invalidatePreview();
        const candidate = this._candidates[Number(this._select.value)];
        this._fields.disabled = this._saving || typeof candidate === 'undefined' || candidate.revision.length === 0;
        const context = querySelectorNotNull(this._dialog, '#copy-content-context');
        if (typeof candidate === 'undefined') {
            context.textContent = 'No included structured content in this result.';
            querySelectorNotNull(this._dialog, '#copy-content-active-rule').textContent = '';
            querySelectorNotNull(this._dialog, '#copy-content-inactive').textContent = '';
            return;
        }
        const {node, ancestors, dictionary, revision, ruleId} = candidate;
        context.textContent = JSON.stringify({dictionary, revision: revision || 'Unavailable; rules are paused.', node, ancestors}, null, 2);
        const rules = this._controller.getCopyContentRules();
        const index = rules.findIndex((rule) => rule.id === ruleId);
        const rule = rules[index];
        querySelectorNotNull(this._dialog, '#copy-content-active-rule').textContent = rule ? `First matching rule: ${rule.id} (position ${index + 1})` : 'No matching rule.';
        querySelectorNotNull(this._dialog, '#copy-content-inactive').textContent = rules.filter((value) => value.dictionary === dictionary && value.revision !== revision).map((value) => `Inactive revision: ${value.id} (${value.revision})`).join('\n');
        this._match.value = JSON.stringify(rule?.match ?? {
            tag: node.tag,
            ...(node.data && Object.keys(node.data).length > 0 ? {data: node.data} : {}),
            ...('title' in node && typeof node.title === 'string' ? {title: node.title} : {}),
            ...(ancestors.length > 0 ? {ancestors: ancestors.map((ancestor) => ({tag: ancestor.tag, ...(ancestor.data && Object.keys(ancestor.data).length > 0 ? {data: ancestor.data} : {})}))} : {}),
        }, null, 2);
        this._action.value = rule?.action ?? 'content';
        this._text.value = rule?.action === 'replace' ? rule.text : '';
        this._prefix.value = rule && rule.action !== 'omit' ? rule.prefix ?? '' : '';
        this._suffix.value = rule && rule.action !== 'omit' ? rule.suffix ?? '' : '';
        this._separator.value = rule && rule.action !== 'omit' ? rule.separator ?? '' : '';
        this._updateAction();
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(this._dialog, '#copy-content-delete')).disabled = index < 0;
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(this._dialog, '#copy-content-earlier')).disabled = index <= 0;
        /** @type {HTMLButtonElement} */ (querySelectorNotNull(this._dialog, '#copy-content-later')).disabled = index < 0 || index === rules.length - 1;
    }

    /** */
    _updateAction() {
        this._text.disabled = this._action.value !== 'replace';
        for (const input of [this._prefix, this._suffix, this._separator]) { input.disabled = this._action.value === 'omit'; }
    }

    /** */
    _invalidatePreview() {
        this._draft = null;
        this._saveButton.disabled = true;
        querySelectorNotNull(this._dialog, '#copy-content-preview').textContent = '';
    }

    /** */
    _preview() {
        if (this._entry === null) { return; }
        const status = querySelectorNotNull(this._dialog, '#copy-content-inspector-status');
        this._invalidatePreview();
        try {
            const candidate = this._candidates[Number(this._select.value)];
            if (!candidate || candidate.revision.length === 0) { throw new Error('Dictionary revision unavailable.'); }
            const rules = [...this._controller.getCopyContentRules()];
            const index = rules.findIndex((rule) => rule.id === candidate.ruleId);
            const id = index >= 0 ? rules[index].id : `content-${crypto.randomUUID()}`;
            const value = {
                id,
                dictionary: candidate.dictionary,
                revision: candidate.revision,
                match: parseJson(this._match.value),
                action: this._action.value,
                ...(this._action.value === 'replace' ? {text: this._text.value} : {}),
                ...(this._action.value !== 'omit' ? {prefix: this._prefix.value, suffix: this._suffix.value, separator: this._separator.value} : {}),
            };
            const [rule] = validateCopyContentRuleDocument({version: 1, rules: [value]});
            if (index >= 0) {
                rules[index] = rule;
            } else {
                rules.push(rule);
            }
            this._previewRules(rules);
        } catch (error) {
            status.textContent = `Could not preview rule: ${error instanceof Error ? error.message : 'Please try again.'}`;
        }
    }

    /** @param {'delete' | 'earlier' | 'later'} action */
    _changeRule(action) {
        const candidate = this._candidates[Number(this._select.value)];
        if (!candidate) { return; }
        const rules = [...this._controller.getCopyContentRules()];
        const index = rules.findIndex((rule) => rule.id === candidate.ruleId);
        if (index < 0) { return; }
        if (action === 'delete') {
            rules.splice(index, 1);
        } else {
            const target = index + (action === 'earlier' ? -1 : 1);
            if (target < 0 || target >= rules.length) { return; }
            [rules[index], rules[target]] = [rules[target], rules[index]];
        }
        this._previewRules(rules);
    }

    /** @param {import('settings').CopyContentRule[]} rules */
    _previewRules(rules) {
        if (this._entry === null) { return; }
        this._invalidatePreview();
        const status = querySelectorNotNull(this._dialog, '#copy-content-inspector-status');
        try {
            const {text, unresolvedImages} = this._controller.getCopyEntryText(this._entry, void 0, rules);
            querySelectorNotNull(this._dialog, '#copy-content-preview').textContent = text;
            this._draft = rules;
            this._saveButton.disabled = false;
            status.textContent = `Draft preview. ${unresolvedImages} unresolved image(s). Save to apply.`;
        } catch (error) {
            status.textContent = `Could not preview rule: ${error instanceof Error ? error.message : 'Please try again.'}`;
        }
    }

    /** @param {import('settings').CopyContentRule[]} rules */
    async _save(rules) {
        if (this._saving) { return; }
        this._saving = true;
        const status = querySelectorNotNull(this._dialog, '#copy-content-inspector-status');
        const disabled = this._fields.disabled;
        this._fields.disabled = true;
        this._select.disabled = true;
        let saved = false;
        try {
            await this._controller.saveCopyContentRules(rules);
            saved = true;
            status.textContent = 'Rules saved. Copy again to use them.';
        } catch (error) {
            status.textContent = `Could not save content copy rule: ${error instanceof Error ? error.message : 'Please try again.'}`;
        } finally {
            this._saving = false;
            this._select.disabled = false;
            if (saved) {
                this._render();
                if (this._dialog.open) { this._select.focus(); }
            } else {
                this._fields.disabled = disabled;
            }
        }
    }
}
