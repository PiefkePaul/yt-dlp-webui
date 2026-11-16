const fs = require('node:fs/promises');
const path = require('node:path');

async function publishRelease(env = process.env, request = fetch) {
  const { RELEASE_API_URL, RELEASE_REPOSITORY, RELEASE_TAG, RELEASE_REF_TYPE, RELEASE_TOKEN } = env;
  if (RELEASE_REF_TYPE !== 'tag' || !/^v[0-9][\w.-]*$/.test(RELEASE_TAG || '')) {
    throw new Error('Select an existing version tag (v*) to publish a release.');
  }
  if (!RELEASE_API_URL || !/^[\w.-]+\/[\w.-]+$/.test(RELEASE_REPOSITORY || '') || !RELEASE_TOKEN) {
    throw new Error('Missing Gitea release API configuration.');
  }
  const base = `${RELEASE_API_URL.replace(/\/$/, '')}/repos/${RELEASE_REPOSITORY}/releases`;
  const headers = { Authorization: `token ${RELEASE_TOKEN}` };
  async function api(url, options = {}) {
    const response = await request(url, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) throw new Error(`Gitea release API failed: HTTP ${response.status}`);
    return response.json();
  }
  const files = (await fs.readdir(path.join(__dirname, '..', 'dist-release'))).filter(name => name.endsWith('.zip'));
  if (files.length !== 1) throw new Error('Expected exactly one server ZIP.');
  const lookup = await request(`${base}/tags/${encodeURIComponent(RELEASE_TAG)}`, { headers });
  let release;
  if (lookup.status === 404) {
    release = await api(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: RELEASE_TAG, name: RELEASE_TAG, body: `Server bundle for ${RELEASE_TAG}. See README for runtime requirements.`, draft: false })
    });
  } else {
    if (!lookup.ok) throw new Error(`Gitea release lookup failed: HTTP ${lookup.status}`);
    release = await lookup.json();
  }
  const name = files[0];
  const assets = await api(`${base}/${release.id}/assets`);
  if (assets.some(asset => asset.name === name)) {
    throw new Error('Release ZIP already exists; refusing to overwrite a published asset.');
  }
  const form = new FormData();
  form.append('attachment', new Blob([await fs.readFile(path.join(__dirname, '..', 'dist-release', name))], { type: 'application/zip' }), name);
  await api(`${base}/${release.id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', body: form });
  console.log(`Published ${name} to Gitea release ${RELEASE_TAG}.`);
}

module.exports = { publishRelease };
if (require.main === module) publishRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
