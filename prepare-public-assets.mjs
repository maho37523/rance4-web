import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Game data lives beside the application checkout (see PUBLIC_DEPLOYMENT.md).
// Override with GAMES_DIR to point at a different location.
const gamesDir = process.env.GAMES_DIR
  ? resolve(process.env.GAMES_DIR)
  : resolve(import.meta.dirname, '..', 'games');
const games = {
  rance4: join(gamesDir, 'RANCE4'),
  rance41: join(gamesDir, 'RANCE4.1'),
  rance42: join(gamesDir, 'RANCE4.2'),
};
const outputRoot = resolve('dist/games');

async function listFiles(root, directory = '') {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(path.split(sep).join('/'));
  }
  return files;
}

async function publicFileMetadata(root, publicPath) {
  const filePath = join(root, publicPath);
  const [info, contents] = await Promise.all([stat(filePath), readFile(filePath)]);
  return {
    size: info.size,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

async function copyGame(id, source) {
  const destination = join(outputRoot, id);
  const entries = await readdir(source, { withFileTypes: true });
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  const publicEntries = [];
  for (const entry of entries) {
    // Diagnostic backups are intentionally retained beside local data, but they
    // are not game assets and must never be published or preloaded.
    if (entry.isFile() && entry.name.endsWith('.orig-backup')) continue;
    const sourcePath = join(source, entry.name);
    // GitHub Pages/Jekyll can omit dot-prefixed files from a published site.
    // Keep the original name in the manifest, but publish this launcher file
    // under a safe URL name and restore its logical name in autostart.js.
    const publicName = entry.name === '.xsys35rc' ? '__xsys35rc' : entry.name;
    const destinationPath = join(destination, publicName);
    // The launcher needs root files and BGM tracks only. System 3 hint disks
    // include a second ADISK.dat and therefore stay outside public output.
    if (entry.isFile() || (entry.isDirectory() && entry.name.toLowerCase() === 'bgm')) {
      await cp(sourcePath, destinationPath, { recursive: entry.isDirectory() });
      if (entry.isFile()) {
        publicEntries.push({
          path: entry.name,
          publicPath: publicName,
        });
      } else {
        const files = await listFiles(destination, publicName);
        for (const file of files) publicEntries.push({ path: file, publicPath: file });
      }
    }
  }

  publicEntries.sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of publicEntries)
    Object.assign(entry, await publicFileMetadata(destination, entry.publicPath));
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({ id, files: publicEntries }, null, 2) + '\n');
  console.log(`${id}: ${publicEntries.length} files`);
}

await mkdir(outputRoot, { recursive: true });
for (const [id, source] of Object.entries(games)) await copyGame(id, source);
