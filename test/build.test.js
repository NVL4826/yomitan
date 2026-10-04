/*
 * Copyright (C) 2026  Yomitan Authors
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

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test, vi} from 'vitest';

test('Firefox ZIP dry-run packages in memory without changing files', async ({expect}) => {
    const libraryDir = fileURLToPath(new URL('../ext/lib/', import.meta.url));
    const argv = process.argv;
    /** @type {string[]} */
    const mutations = [];
    const writeFileSync = fs.writeFileSync;
    const copyFileSync = fs.copyFileSync;
    // Library regeneration precedes packaging even in the existing dry-run CLI.
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
        if (typeof file !== 'string' || path.dirname(file) + path.sep !== libraryDir) {
            mutations.push('writeFileSync');
            throw new Error('Dry-run packaging tried to write a file');
        }
        writeFileSync(file, data, options);
    });
    vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, flags) => {
        if (typeof destination !== 'string' || path.dirname(destination) + path.sep !== libraryDir) {
            mutations.push('copyFileSync');
            throw new Error('Dry-run packaging tried to copy a file');
        }
        copyFileSync(source, destination, flags);
    });
    for (const method of /** @type {const} */ (['mkdtempSync', 'mkdirSync', 'cpSync', 'rmSync', 'unlinkSync'])) {
        vi.spyOn(fs, method).mockImplementation(() => {
            mutations.push(method);
            throw new Error(`Dry-run packaging tried to mutate the filesystem: ${method}`);
        });
    }
    process.argv = [process.execPath, 'dev/bin/build.js', '--target', 'firefox', '--dryRun', '--dryRunBuildZip'];
    try {
        await import('../dev/bin/build.js');
        expect(mutations).toEqual([]);
    } finally {
        process.argv = argv;
        vi.restoreAllMocks();
    }
}, 30000);
