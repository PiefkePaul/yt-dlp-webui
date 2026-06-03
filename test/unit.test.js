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
