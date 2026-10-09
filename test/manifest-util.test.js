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

import {test} from 'vitest';
import {ManifestUtil} from '../dev/manifest-util.js';

test('manifest variants are independent of generation order and caller mutation', ({expect}) => {
    const manifests = new ManifestUtil();
    const variants = manifests.getVariants().filter(({buildable}) => buildable !== false);
    const expected = variants.map(({name}) => new ManifestUtil().getManifest(name));
    for (const {name} of variants) {
        const manifest = manifests.getManifest(name);
        manifest.name = 'Changed by caller';
        if (manifest.browser_specific_settings?.gecko) {
            manifest.browser_specific_settings.gecko.id = 'changed-by-caller';
        }
    }
    expect(variants.map(({name}) => manifests.getManifest(name))).toEqual(expected);
});
