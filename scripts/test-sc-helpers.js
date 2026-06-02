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
