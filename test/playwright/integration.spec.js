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

import path from 'path';
import {createDictionaryArchiveData} from '../../dev/dictionary-archive-util.js';
import {deferPromise} from '../../ext/js/core/utilities.js';
import {
    expect,
    getExpectedAddNoteBody,
    getMockModelFields,
    mockAnkiRouteHandler,
    root,
    test,
    writeToClipboardFromPage,
} from './playwright-util.js';

test.beforeEach(async ({context}) => {
    // Wait for the on-install welcome.html tab to load, which becomes the foreground tab
    const welcome = await context.waitForEvent('page');
    await welcome.close(); // Close the welcome tab so our main tab becomes the foreground tab -- otherwise, the screenshot can hang
});

test('search clipboard', async ({page, extensionId}) => {
    await page.goto(`chrome-extension://${extensionId}/search.html`);
    await page.locator('#search-option-clipboard-monitor-container > label').click();
    await page.waitForTimeout(200); // Race

    await writeToClipboardFromPage(page, 'あ');
    await expect(page.locator('#search-textbox')).toHaveValue('あ');
});

test('copy dictionary selections work with the keyboard and survive reopening search', async ({page, context, extensionId}) => {
    await page.goto(`chrome-extension://${extensionId}/settings.html`);
    const dictionary = await createDictionaryArchiveData(path.join(root, 'test/data/dictionaries/valid-dictionary1'), 'valid-dictionary1');
    await page.locator('#dictionary-import-file-input').setInputFiles({
        name: 'valid-dictionary1.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from(dictionary),
    });
    await expect(page.locator('#dictionaries')).toHaveText('Dictionaries (1 installed, 1 enabled)', {timeout: 60000});
    await page.goto(`chrome-extension://${extensionId}/search.html?query=読む`);
    await expect(page.locator('html')).toHaveAttribute('data-loaded', 'true');
    const copy = page.locator('[data-action="copy-entry"]').first();
    await expect(copy).toBeVisible();
    const results = await page.locator('#dictionary-entries').textContent();
    const summary = page.locator('#copy-options summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#copy-options')).toHaveAttribute('open', '');
    const checkbox = page.getByRole('checkbox', {name: 'valid-dictionary1', exact: true});
    await page.keyboard.press('Tab');
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toBeChecked();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeFocused();
    await copy.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.copy-entry-status').first()).toHaveText('No dictionary content to copy.');
    expect((await page.locator('#dictionary-entries').textContent())?.replace('No dictionary content to copy.', '')).toBe(results);

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/search.html?query=読む`);
    await expect(reopened.locator('html')).toHaveAttribute('data-loaded', 'true');
    await reopened.locator('#copy-options summary').focus();
    await reopened.keyboard.press('Enter');
    const retained = reopened.getByRole('checkbox', {name: 'valid-dictionary1', exact: true});
    await expect(retained).not.toBeChecked();
    await retained.focus();
    await reopened.keyboard.press('Space');
    await expect(retained).toBeChecked();
    await reopened.locator('[data-action="copy-entry"]').first().focus();
    await reopened.keyboard.press('Enter');
    await expect(reopened.locator('.copy-entry-status').first()).toHaveText('Copied.');
    const pastePage = await context.newPage();
    await pastePage.setContent('<textarea aria-label="Paste target"></textarea>');
    await pastePage.getByRole('textbox').focus();
    await pastePage.keyboard.press('Control+V');
    await expect(pastePage.getByRole('textbox')).toHaveValue(/valid-dictionary1[\s\S]*to read/);
    await pastePage.close();
    await reopened.close();
});

test('anki add', async ({context, page, extensionId}) => {
    // Mock anki routes
    /** @type {import('core').DeferredPromiseDetails<Record<string, unknown>>} */
    const addNotePromiseDetails = deferPromise();
    await context.route(/127.0.0.1:8765\/*/, (route) => {
        void mockAnkiRouteHandler(route);
        const req = route.request();
        if (req.url().includes('127.0.0.1:8765')) {
            /** @type {unknown} */
            const requestJson = req.postDataJSON();
            if (
                typeof requestJson === 'object' &&
                requestJson !== null &&
                /** @type {Record<string, unknown>} */ (requestJson).action === 'addNote'
            ) {
                addNotePromiseDetails.resolve(/** @type {Record<string, unknown>} */ (requestJson));
            }
        }
    });

    // Open settings
    await page.goto(`chrome-extension://${extensionId}/settings.html`);

    await expect(page.locator('id=dictionaries')).toBeVisible();

    // Load in test dictionary
    const dictionary = await createDictionaryArchiveData(path.join(root, 'test/data/dictionaries/valid-dictionary1'), 'valid-dictionary1');
    await page.locator('input[id="dictionary-import-file-input"]').setInputFiles({
        name: 'valid-dictionary1.zip',
        mimeType: 'application/x-zip',
        buffer: Buffer.from(dictionary),
    });
    await expect(page.locator('id=dictionaries')).toHaveText('Dictionaries (1 installed, 1 enabled)', {timeout: 1 * 60 * 1000});

    // Connect to anki
    await page.locator('.toggle', {has: page.locator('[data-setting="anki.enable"]')}).click();
    await expect(page.locator('#anki-error-message')).toHaveText('Connected');

    // Prep anki deck
    await page.locator('[data-modal-action="show,anki-cards"]').click();
    await page.locator('select.anki-card-deck').selectOption('Mock Deck');
    await page.locator('select.anki-card-model').selectOption('Mock Model');
    const mockFields = getMockModelFields();
    for (const [modelField, value] of mockFields) {
        await page.locator(`[data-setting="anki.cardFormats[0].fields.${modelField}.value"]`).fill(value);
    }
    await page.locator('#anki-cards-modal > div > div.modal-footer > button:nth-child(2)').click();
    await writeToClipboardFromPage(page, '読むの例文');

    // Add to anki deck
    await page.goto(`chrome-extension://${extensionId}/search.html`);
    await expect(async () => {
        await page.locator('#search-textbox').clear();
        await page.locator('#search-textbox').fill('読む');
        await expect(page.locator('#search-textbox')).toHaveValue('読む');
    }).toPass({timeout: 5000});
    await page.locator('#search-textbox').press('Enter');
    await page.locator('[data-action="save-note"][data-card-format-index="0"]').click();
    const addNoteReqBody = await addNotePromiseDetails.promise;
    expect(addNoteReqBody).toMatchObject(getExpectedAddNoteBody());
});
