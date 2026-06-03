process.env.SESSION_ENCRYPTION_KEY = 'd29ea4ebf361d8ff1d4b1d08eb452dc5d29ea4ebf361d8ff1d4b1d08eb452dc5';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fsp = require('fs/promises');
const os = require('os');

const {
  encryptForClient,
  decryptFromClient,
  fetchScSession,
  writeTempCookieFile
} = require('../server');

test('encryptForClient/decryptFromClient — Roundtrip', (t) => {
  const plaintext = 'test-oauth-token-123';
  const encrypted = encryptForClient(plaintext);
  assert.equal(typeof encrypted, 'string');
  assert.equal(encrypted.split(':').length, 3);
  assert.equal(decryptFromClient(encrypted), plaintext);
});

test('decryptFromClient — manipulierter Ciphertext gibt null zurück', (t) => {
  const encrypted = encryptForClient('some-value');
  const tampered = encrypted.slice(0, -4) + 'XXXX';
  assert.equal(decryptFromClient(tampered), null);
});

test('decryptFromClient — ungültige Inputs geben null zurück', (t) => {
  assert.equal(decryptFromClient(''), null);
  assert.equal(decryptFromClient(null), null);
  assert.equal(decryptFromClient('kein:format'), null);
  assert.equal(decryptFromClient(undefined), null);
});

test('encryptForClient — gleicher Input erzeugt unterschiedlichen Ciphertext (IV-Randomness)', (t) => {
  const a = encryptForClient('value');
  const b = encryptForClient('value');
  assert.notEqual(a, b);
});
