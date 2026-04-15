const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function normalizeText(value, label, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }

  if (normalized.length > maxLength) {
    throw new Error(`${label} ist zu lang.`);
  }

  return normalized;
}

function normalizeMultilineText(value, label, maxLength) {
  const normalized = typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim()
    : '';

  if (!normalized) {
    return '';
  }

  if (normalized.length > maxLength) {
    throw new Error(`${label} ist zu lang.`);
  }

  return normalized;
}

function normalizeLinesInput(value, label, maxLength) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item, label, maxLength)).filter(Boolean);
  }

  const text = normalizeMultilineText(value, label, maxLength);
  if (!text) {
    return [];
  }

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseHeaderLines(value) {
  return normalizeLinesInput(value, 'Zusatz-Header', 16 * 1024)
    .map((line) => {
      const delimiterIndex = line.indexOf(':');
      if (delimiterIndex <= 0 || delimiterIndex === line.length - 1) {
        throw new Error('Zusatz-Header muessen pro Zeile als "Name: Wert" angegeben werden.');
      }

      const name = line.slice(0, delimiterIndex).trim();
      const headerValue = line.slice(delimiterIndex + 1).trim();

      if (!name || !headerValue) {
        throw new Error('Zusatz-Header muessen pro Zeile als "Name: Wert" angegeben werden.');
      }

      return `${name}: ${headerValue}`;
    });
}

function parseExtractorArgs(value) {
  return normalizeLinesInput(value, 'Extractor-Args', 8 * 1024);
}

function sanitizeSessionOptions(input) {
  const source = input && typeof input === 'object' ? input : {};

  return {
    cookieHeader: normalizeText(source.cookieHeader, 'Cookie-Header', 16 * 1024),
    cookiesText: normalizeMultilineText(source.cookiesText, 'Cookie-Text', 128 * 1024),
    referer: normalizeText(source.referer, 'Referer', 2048),
    videoPassword: normalizeText(source.videoPassword, 'Video-Passwort', 1024),
    extraHeaders: parseHeaderLines(source.extraHeaders),
    extractorArgs: parseExtractorArgs(source.extractorArgs),
    soundcloudOauthToken: normalizeText(source.soundcloudOauthToken, 'SoundCloud-OAuth-Token', 8 * 1024)
  };
}

function hasSessionOptions(options) {
  return Boolean(
    options?.cookieHeader
    || options?.cookiesText
    || options?.referer
    || options?.videoPassword
    || options?.soundcloudOauthToken
    || (Array.isArray(options?.extraHeaders) && options.extraHeaders.length > 0)
    || (Array.isArray(options?.extractorArgs) && options.extractorArgs.length > 0)
  );
}

async function prepareSessionArtifacts({ sessionOptions, workingDirectory, filePrefix = 'session' }) {
  const options = sanitizeSessionOptions(sessionOptions);
  const args = [];
  const cleanupTasks = [];

  if (options.cookiesText) {
    await fs.mkdir(workingDirectory, { recursive: true });

    const filePath = path.join(workingDirectory, `${filePrefix}-${crypto.randomUUID()}.cookies.txt`);
    await fs.writeFile(filePath, `${options.cookiesText}\n`, 'utf8');

    args.push('--cookies', filePath);
    cleanupTasks.push(() => fs.rm(filePath, { force: true }));
  }

  if (options.cookieHeader) {
    args.push('--add-header', `Cookie: ${options.cookieHeader}`);
  }

  if (options.referer) {
    args.push('--referer', options.referer);
  }

  if (options.videoPassword) {
    args.push('--video-password', options.videoPassword);
  }

  for (const header of options.extraHeaders) {
    args.push('--add-header', header);
  }

  for (const extractorArg of options.extractorArgs) {
    args.push('--extractor-args', extractorArg);
  }

  return {
    options,
    args,
    cleanup: async () => {
      await Promise.allSettled(cleanupTasks.map((task) => task()));
    }
  };
}

module.exports = {
  hasSessionOptions,
  prepareSessionArtifacts,
  sanitizeSessionOptions
};
