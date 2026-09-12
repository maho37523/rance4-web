import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const games = {
  rance4: '/Users/cris/Documents/games/RANCE4',
  rance41: '/Users/cris/Documents/games/RANCE4.1',
  rance42: '/Users/cris/Documents/games/RANCE4.2',
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

async function copyGame(id, source) {
  const destination = join(outputRoot, id);
  const entries = await readdir(source, { withFileTypes: true });
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    // The launcher needs root files and BGM tracks only. System 3 hint disks
    // include a second ADISK.dat and therefore stay outside public output.
    if (entry.isFile() || (entry.isDirectory() && entry.name.toLowerCase() === 'bgm')) {
      await cp(sourcePath, destinationPath, { recursive: entry.isDirectory() });
    }
  }

  const files = (await listFiles(destination)).sort();
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({ id, files }, null, 2) + '\n');
  console.log(`${id}: ${files.length} files`);
}

await mkdir(outputRoot, { recursive: true });
for (const [id, source] of Object.entries(games)) await copyGame(id, source);
