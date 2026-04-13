const fs = require('fs/promises');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'public');
const outputDir = path.join(rootDir, 'dist-pages');

function buildPagesConfig() {
  return {
    apiBaseUrl: process.env.PAGES_API_BASE_URL || '',
    demoMode: process.env.PAGES_DEMO_MODE !== 'false',
    demoMessage: process.env.PAGES_DEMO_MESSAGE
      || 'Diese GitHub-Pages-Version ist aktuell nur eine statische Vorschau. Ein produktives Backend ist noch nicht angebunden.'
  };
}

async function main() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.cp(sourceDir, outputDir, { recursive: true });

  const appConfigPath = path.join(outputDir, 'app-config.js');
  const noJekyllPath = path.join(outputDir, '.nojekyll');

  await fs.writeFile(
    appConfigPath,
    `window.APP_CONFIG = ${JSON.stringify(buildPagesConfig(), null, 2)};\n`,
    'utf8'
  );
  await fs.writeFile(noJekyllPath, '', 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
