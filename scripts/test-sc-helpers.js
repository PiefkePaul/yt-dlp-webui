const assert = require('assert');
const { detectSource } = require('../server');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('detectSource:');
test('soundcloud.com → soundcloud', () => {
  assert.strictEqual(detectSource('https://soundcloud.com/artist/track'), 'soundcloud');
});
test('www.soundcloud.com → soundcloud', () => {
  assert.strictEqual(detectSource('https://www.soundcloud.com/artist/track'), 'soundcloud');
});
test('youtube.com → other', () => {
  assert.strictEqual(detectSource('https://www.youtube.com/watch?v=abc'), 'other');
});
test('ungültige URL → other', () => {
  assert.strictEqual(detectSource('kein-link'), 'other');
});
test('leerer String → other', () => {
  assert.strictEqual(detectSource(''), 'other');
});

const { buildScArgs, buildYtArgs } = require('../server');

console.log('\nbuildScArgs:');
test('enthält bestaudio/best', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(args.includes('-f'));
  assert.ok(args.includes('bestaudio/best'));
});
test('enthält --cookies wenn cookiePath gesetzt', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: '/tmp/sc.cookies' });
  assert.ok(args.includes('--cookies'));
  assert.ok(args.includes('/tmp/sc.cookies'));
});
test('kein --cookies wenn cookiePath null', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(!args.includes('--cookies'));
});
test('kein --js-runtimes in SC-Args', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(!args.includes('--js-runtimes'));
});

console.log('\nbuildYtArgs:');
test('enthält --js-runtimes deno', () => {
  const args = buildYtArgs({ url: 'https://youtube.com/watch?v=x', format: 'mp3', quality: '320', targetDir: '/tmp/x' });
  assert.ok(args.includes('--js-runtimes'));
  assert.ok(args.includes('deno'));
});
test('enthält extractor-args youtube', () => {
  const args = buildYtArgs({ url: 'https://youtube.com/watch?v=x', format: 'mp3', quality: '320', targetDir: '/tmp/x' });
  assert.ok(args.some((a) => a.startsWith('youtube:')));
});
