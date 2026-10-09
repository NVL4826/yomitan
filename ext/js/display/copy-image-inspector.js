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

import {base64ToArrayBuffer} from '../data/array-buffer-util.js';
import {querySelectorNotNull} from '../dom/query-selector.js';

export class CopyImageInspector {
    /**
     * @param {import('./search-display-controller.js').SearchDisplayController} controller
     * @param {import('../comm/api.js').API} api
     */
    constructor(controller, api) {
        /** @type {import('../comm/api.js').API} */
        this._api = api;
        /** @type {string[]} */
        this._urls = [];
        /** @type {import('./search-display-controller.js').SearchDisplayController} */
        this._controller = controller;
        /** @type {HTMLDialogElement} */
        this._dialog = querySelectorNotNull(document, '#copy-image-inspector');
        /** @type {HTMLInputElement} */
        this._showAll = querySelectorNotNull(this._dialog, '#copy-image-show-all');
        /** @type {?import('dictionary').TermDictionaryEntry} */
        this._entry = null;
        /** @type {boolean} */
        this._saving = false;
        this._dialog.addEventListener('keydown', (event) => { event.stopPropagation(); });
        this._dialog.addEventListener('paste', (event) => { event.stopPropagation(); });
        this._dialog.addEventListener('close', () => {
            this._entry = null;
            this._releaseMedia();
        });
        this._showAll.addEventListener('change', () => { this._render(); });
        querySelectorNotNull(this._dialog, '#copy-image-inspector-close').addEventListener('click', () => { this.close(); });
    }

    /** @param {import('dictionary').TermDictionaryEntry} entry */
    show(entry) {
        this._entry = entry;
        this._showAll.checked = false;
        querySelectorNotNull(this._dialog, '#copy-image-inspector-status').textContent = '';
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
        this._releaseMedia();
        const list = querySelectorNotNull(this._dialog, '#copy-image-inspector-list');
        list.textContent = '';
        /** @type {Map<string, import('./result-entry-text.js').CopyImageOutcome>} */
        const images = new Map();
        for (const image of this._controller.getCopyEntryText(this._entry, 'text').images) {
            const key = JSON.stringify([image.dictionary, image.revision, image.path]);
            if (images.get(key)?.handling !== 'unresolved') { images.set(key, image); }
        }
        for (const image of images.values()) {
            if (!this._showAll.checked && image.handling !== 'unresolved') { continue; }
            list.appendChild(this._createCard(image));
        }
        if (list.childElementCount === 0) { list.textContent = this._showAll.checked ? 'No included images in this result.' : 'No unresolved images. Choose Show all to edit existing rules.'; }
    }

    /**
     * @param {import('./result-entry-text.js').CopyImageOutcome} image
     * @returns {DocumentFragment}
     */
    _createCard(image) {
        /** @type {HTMLTemplateElement} */
        const template = querySelectorNotNull(document, '#copy-image-card-template');
        const fragment = /** @type {DocumentFragment} */ (template.content.cloneNode(true));
        const card = querySelectorNotNull(fragment, '.copy-image-card');
        querySelectorNotNull(card, '.copy-image-dictionary').textContent = image.dictionary;
        querySelectorNotNull(card, '.copy-image-revision').textContent = image.revision || 'Unavailable; cannot save rules until the revision can be read.';
        querySelectorNotNull(card, '.copy-image-path').textContent = image.path;
        querySelectorNotNull(card, '.copy-image-context').textContent = image.context;
        const handling = {'user-replacement': 'User replacement', 'user-omission': 'User omission', 'metadata': 'Metadata', 'illustration': 'Known illustration', 'unresolved': 'Unresolved'};
        querySelectorNotNull(card, '.copy-image-handling').textContent = `${handling[image.handling]}${image.text.length > 0 ? `: ${image.text}` : ''}`;
        const rules = this._controller.getCopyImageRules();
        const rule = rules.find((value) => this._matchesImage(value, image));
        const inactive = rules.filter((value) => value.dictionary === image.dictionary && value.path === image.path && value.revision !== image.revision);
        querySelectorNotNull(card, '.copy-image-inactive').textContent = inactive.map((value) => `Inactive rule (${value.revision}): ${value.action === 'replace' ? value.text : 'Omit deliberately'}`).join('\n');
        /** @type {HTMLSelectElement} */
        const action = querySelectorNotNull(card, '.copy-image-action');
        /** @type {HTMLTextAreaElement} */
        const text = querySelectorNotNull(card, '.copy-image-text');
        action.value = rule?.action ?? 'replace';
        text.value = rule?.action === 'replace' ? rule.text : '';
        text.disabled = action.value === 'omit';
        action.addEventListener('change', () => { text.disabled = action.value === 'omit'; });
        /** @type {HTMLFieldSetElement} */
        const fields = querySelectorNotNull(card, 'fieldset');
        fields.disabled = image.revision.length === 0 || image.dictionary.length === 0 || image.path.length === 0 || this._saving;
        querySelectorNotNull(card, '[data-action="save-copy-image-rule"]').addEventListener('click', () => {
            /** @type {import('settings').CopyImageRule} */
            const value = action.value === 'omit' ?
                {dictionary: image.dictionary, revision: image.revision, path: image.path, action: 'omit'} :
                {dictionary: image.dictionary, revision: image.revision, path: image.path, action: 'replace', text: text.value};
            void this._save(image, value);
        });
        /** @type {HTMLButtonElement} */
        const remove = querySelectorNotNull(card, '[data-action="delete-copy-image-rule"]');
        remove.disabled = typeof rule === 'undefined';
        remove.addEventListener('click', () => { void this._save(image); });
        void this._loadMedia(image, querySelectorNotNull(card, '.copy-image-media'));
        return fragment;
    }

    /**
     * @param {import('settings').CopyImageRule} rule
     * @param {import('./result-entry-text.js').CopyImageOutcome} image
     * @returns {boolean}
     */
    _matchesImage(rule, image) {
        return rule.dictionary === image.dictionary && rule.revision === image.revision && rule.path === image.path;
    }

    /**
     * @param {import('./result-entry-text.js').CopyImageOutcome} image
     * @param {import('settings').CopyImageRule} [replacement]
     */
    async _save(image, replacement) {
        if (this._saving) { return; }
        this._saving = true;
        const status = querySelectorNotNull(this._dialog, '#copy-image-inspector-status');
        status.textContent = 'Saving…';
        const fieldStates = [...this._dialog.querySelectorAll('fieldset')].map((fields) => ({fields, disabled: fields.disabled}));
        for (const {fields} of fieldStates) { fields.disabled = true; }
        this._showAll.disabled = true;
        let saved = false;
        try {
            const rules = this._controller.getCopyImageRules().filter((rule) => !this._matchesImage(rule, image));
            if (typeof replacement !== 'undefined') { rules.push(replacement); }
            await this._controller.saveCopyImageRules(rules);
            saved = true;
            status.textContent = typeof replacement === 'undefined' ? 'Rule deleted. Copy again to use the current handling.' : 'Rule saved. Copy again to use it.';
        } catch (error) {
            status.textContent = `Could not save image copy rule: ${error instanceof Error ? error.message : 'Please try again.'}`;
        } finally {
            this._saving = false;
            this._showAll.disabled = false;
            if (saved) {
                this._render();
                if (this._dialog.open) { this._showAll.focus(); }
            } else {
                for (const {fields, disabled} of fieldStates) { fields.disabled = disabled; }
            }
        }
    }

    /**
     * @param {import('./result-entry-text.js').CopyImageOutcome} image
     * @param {HTMLElement} container
     */
    async _loadMedia(image, container) {
        container.textContent = 'Loading image…';
        try {
            const [media] = await this._api.getMedia([{dictionary: image.dictionary, path: image.path}]);
            if (!container.isConnected || !this._dialog.open) { return; }
            if (media === null || typeof media === 'undefined') { throw new Error('Image is missing.'); }
            const blob = new Blob([base64ToArrayBuffer(media.content)], {type: media.mediaType});
            const url = URL.createObjectURL(blob);
            this._urls.push(url);
            const preview = document.createElement('img');
            preview.alt = `Dictionary image: ${image.path}`;
            preview.addEventListener('error', () => {
                preview.remove();
                const error = document.createElement('p');
                error.textContent = 'Could not display this image. Try opening the original.';
                container.prepend(error);
            }, {once: true});
            preview.src = url;
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Open original';
            container.textContent = '';
            container.append(preview, link);
        } catch (error) {
            if (container.isConnected) { container.textContent = 'Could not load this image. Reimport the dictionary or try again.'; }
        }
    }

    /** */
    _releaseMedia() {
        for (const url of this._urls) { URL.revokeObjectURL(url); }
        this._urls = [];
    }
}
