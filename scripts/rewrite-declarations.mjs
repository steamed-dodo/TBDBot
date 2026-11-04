import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Rewrites the relative specifiers of the emitted declarations so they carry
 * the `.js` extension that Node's ESM resolver expects.
 *
 * The source is written extensionless and resolved with `bundler`, which keeps
 * imports pleasant to read. Declarations are consumed by projects that may use
 * `node16` or `nodenext`, where a relative specifier without an extension is
 * an error. Post-processing the build output keeps both worlds happy without
 * putting extensions in every source file.
 */
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

// Matches `from './x'`, `import './x'`, and `import('./x')`.
const SPECIFIER =
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g;

/**
 * Appends the `.js` extension unless the specifier already has one.
 *
 * The rewrite is idempotent: running it over an already rewritten tree is a
 * no-op, so a partial or repeated build cannot double the extension.
 *
 * @param {string} specifier - The relative specifier to normalize.
 * @returns {string} The specifier as Node ESM expects it.
 */
function withJsExtension(specifier) {
    if (/\.(?:[cm]?js|json)$/i.test(specifier)) {
        return specifier;
    }

    return `${specifier}.js`;
}

/**
 * Yields every declaration file below a directory.
 *
 * @param {string} directory - The directory to walk.
 * @returns {AsyncGenerator<string>} The declaration file paths.
 */
async function* declarationFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            yield* declarationFiles(path);
        } else if (entry.name.endsWith('.d.ts')) {
            yield path;
        }
    }
}

let rewritten = 0;

for await (const file of declarationFiles(DIST)) {
    const source = await readFile(file, 'utf8');
    const next = source.replace(
        SPECIFIER,
        (_match, prefix, quote, specifier) =>
            `${prefix}${quote}${withJsExtension(specifier)}${quote}`,
    );

    if (next !== source) {
        await writeFile(file, next);
        rewritten += 1;
    }
}

console.log(
    `rewrite-declarations: normalized ${rewritten} declaration file(s)`,
);
