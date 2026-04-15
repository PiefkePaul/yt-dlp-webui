const fs = require('fs/promises');
const path = require('path');
const { app, buildPublicClientConfig } = require('../server');

function collectRoutes(expressApp) {
  const router = expressApp._router;
  if (!router || !Array.isArray(router.stack)) {
    return [];
  }

  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => {
      const methods = Object.keys(layer.route.methods || {}).filter((method) => layer.route.methods[method]);
      return methods.map((method) => ({
        method: method.toUpperCase(),
        path: layer.route.path
      }));
    });
}

function hasRoute(routes, method, routePath) {
  return routes.some((route) => route.method === method && route.path === routePath);
}

async function main() {
  const routes = collectRoutes(app);
  const publicConfig = buildPublicClientConfig();
  const indexHtml = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const frontendScript = await fs.readFile(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const dockerfile = await fs.readFile(path.join(__dirname, '..', 'docker', 'Dockerfile'), 'utf8');

  if (!hasRoute(routes, 'GET', '/health')) {
    throw new Error('GET /health ist nicht registriert.');
  }

  if (!hasRoute(routes, 'POST', '/api/download')) {
    throw new Error('POST /api/download ist nicht registriert.');
  }

  if (!hasRoute(routes, 'POST', '/api/inspect')) {
    throw new Error('POST /api/inspect ist nicht registriert.');
  }

  if (!hasRoute(routes, 'GET', '/api/status/:id')) {
    throw new Error('GET /api/status/:id ist nicht registriert.');
  }

  if (!hasRoute(routes, 'DELETE', '/api/download/:id')) {
    throw new Error('DELETE /api/download/:id ist nicht registriert.');
  }

  if (!hasRoute(routes, 'GET', '/api/file/:id')) {
    throw new Error('GET /api/file/:id ist nicht registriert.');
  }

  if (!hasRoute(routes, 'GET', '/app-config.js')) {
    throw new Error('GET /app-config.js ist nicht registriert.');
  }

  if (!indexHtml.includes('yt-dlp Download-Server')) {
    throw new Error('Die Startseite enthaelt nicht den erwarteten Titel.');
  }

  if (!indexHtml.includes('Erweitertes Menue fuer diese Session')) {
    throw new Error('Die Startseite enthaelt kein erweitertes Session-Menue.');
  }

  if (!indexHtml.includes('SoundCloud OAuth-Token')) {
    throw new Error('Die Startseite enthaelt keinen SoundCloud-Token-Hinweis.');
  }

  if (!frontendScript.includes('window.APP_CONFIG')) {
    throw new Error('Das Frontend verwendet keine APP_CONFIG-Konfiguration.');
  }

  if (!frontendScript.includes('/api/inspect')) {
    throw new Error('Das Frontend verwendet keinen Inspect-Endpoint.');
  }

  if (!dockerfile.includes('${PORT:-3000}/health')) {
    throw new Error('Der Docker-Healthcheck beruecksichtigt den konfigurierten PORT nicht.');
  }

  if (typeof publicConfig.demoMode !== 'boolean') {
    throw new Error('Die oeffentliche Client-Konfiguration ist unvollstaendig.');
  }
}

main()
  .then(() => {
    console.log('Smoke test passed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
