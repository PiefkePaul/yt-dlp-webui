const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const archiver = require('archiver');
const pkg = require('../package.json');

const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'dist-release');
const bundleDirName = `yt-dlp-download-server-v${pkg.version}`;
const bundleZipPath = path.join(outputDir, `${bundleDirName}.zip`);

const bundleEntries = [
  '.env.example',
  'README.md',
  'package.json',
  'package-lock.json',
  'server.js',
  'public',
  'node_modules'
];

async function copyEntry(relativePath) {
  const source = path.join(rootDir, relativePath);
  const stats = await fsp.stat(source);

  return { relativePath, source, isDirectory: stats.isDirectory() };
}

async function createArchive(entries) {
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.rm(bundleZipPath, { force: true });

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(bundleZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    for (const entry of entries) {
      const archivePath = `${bundleDirName}/${entry.relativePath}`;

      if (entry.isDirectory) {
        archive.directory(entry.source, archivePath);
      } else {
        archive.file(entry.source, { name: archivePath });
      }
    }

    archive.finalize();
  });
}

async function main() {
  await fsp.rm(outputDir, { recursive: true, force: true });

  const entries = [];
  for (const entry of bundleEntries) {
    entries.push(await copyEntry(entry));
  }

  await createArchive(entries);
  console.log(`Release bundle created: ${path.relative(rootDir, bundleZipPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
