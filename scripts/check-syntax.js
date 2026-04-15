const fs = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  'server.js',
  'public',
  'scripts',
  'src'
];

async function collectJavaScriptFiles(targetPath) {
  const absolutePath = path.join(REPO_ROOT, targetPath);
  const stat = await fs.stat(absolutePath);

  if (stat.isFile()) {
    return [absolutePath];
  }

  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    const relativePath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...await collectJavaScriptFiles(relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      collected.push(path.join(REPO_ROOT, relativePath));
    }
  }

  return collected;
}

async function main() {
  const files = [];
  for (const target of TARGETS) {
    files.push(...await collectJavaScriptFiles(target));
  }

  for (const file of files.sort()) {
    const result = spawnSync(process.execPath, ['--check', file], {
      stdio: 'inherit'
    });

    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  }

  console.log(`Syntax check passed for ${files.length} JavaScript-Dateien.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
