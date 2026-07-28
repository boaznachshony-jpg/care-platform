import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');
const destinationRoot = join(packageRoot, 'dist');

async function copyCssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      await copyCssFiles(sourcePath);
      continue;
    }

    if (extname(entry.name) !== '.css') {
      continue;
    }

    const destinationPath = join(
      destinationRoot,
      relative(sourceRoot, sourcePath),
    );

    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath);
  }
}

await mkdir(destinationRoot, { recursive: true });
await copyCssFiles(sourceRoot);
