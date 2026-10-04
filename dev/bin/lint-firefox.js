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

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {ManifestUtil} from '../manifest-util.js';

// Requires web-ext on PATH. Check rebuilt artifacts, including files that are
// packaged but not executed; preserve self-hosted development update behavior.
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifests = new ManifestUtil();
for (const {name, fileName, buildable} of manifests.getVariants()) {
    const manifest = manifests.getManifest(name);
    if (buildable === false || !fileName || !manifest.browser_specific_settings?.gecko) { continue; }
    const artifact = path.join(root, 'builds', fileName);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yomitan-lint-firefox-'));
    try {
        let sourceDir = artifact;
        if (fileName.endsWith('.zip')) {
            sourceDir = path.join(tempDir, 'extension');
            const zip = await JSZip.loadAsync(fs.readFileSync(artifact));
            for (const entry of Object.values(zip.files)) {
                if (entry.dir) { continue; }
                const target = path.join(sourceDir, entry.name);
                fs.mkdirSync(path.dirname(target), {recursive: true});
                fs.writeFileSync(target, await entry.async('nodebuffer'));
            }
        }
        const args = ['lint', '--source-dir', sourceDir, '--artifacts-dir', tempDir, '--no-config-discovery', '--warnings-as-errors'];
        if (manifest.browser_specific_settings.gecko.update_url) { args.push('--self-hosted'); }
        process.stdout.write(`Validating ${name}...\n`);
        childProcess.execFileSync('web-ext', args, {stdio: 'inherit', env: {...process.env, NO_UPDATE_NOTIFIER: '1'}});
    } finally {
        fs.rmSync(tempDir, {recursive: true, force: true});
    }
}
