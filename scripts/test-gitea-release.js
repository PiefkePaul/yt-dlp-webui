const assert = require('node:assert/strict');
const { publishRelease } = require('./publish-gitea-release');

async function main() {
  let calls = [];
  const env = { RELEASE_API_URL: 'https://gitea.invalid/api/v1', RELEASE_REPOSITORY: 'Scholz/yt-dlp-webui', RELEASE_TAG: 'v1.1.0', RELEASE_REF_TYPE: 'tag', RELEASE_TOKEN: 'test-only' };
  const mock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/tags/')) return new Response('', { status: 404 });
    if (options.method === 'POST' && url.endsWith('/releases')) return Response.json({ id: 7 });
    if (options.method === 'POST') {
      assert.ok(options.body instanceof FormData);
      assert.ok((await options.body.get('attachment').arrayBuffer()).byteLength > 0);
      return Response.json({ id: 8 });
    }
    return Response.json([]);
  };
  await assert.rejects(publishRelease({ ...env, RELEASE_REF_TYPE: 'branch' }, mock), /version tag/);
  assert.equal(calls.length, 0);
  await publishRelease(env, mock);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.url.startsWith('https://gitea.invalid/api/v1/repos/Scholz/yt-dlp-webui/releases')));
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(JSON.parse(calls[1].options.body).tag_name, env.RELEASE_TAG);
  await assert.rejects(publishRelease(env, async () => new Response('', { status: 403 })), /403/);
  await assert.rejects(publishRelease(env, async (url) => Response.json(url.includes('/tags/') ? { id: 7 } : [{ name: 'yt-dlp-download-server-v1.1.0.zip' }])), /already exists/);
  console.log('Gitea release tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
