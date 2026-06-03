(function bootstrapApp() {
  const qualityMap = {
    mp3: [
      { value: '320', label: 'Hoechste Qualitaet (320 kbps)' },
      { value: '192', label: '192 kbps' },
      { value: '128', label: '128 kbps' }
    ],
    mp4: [
      { value: 'best', label: 'Beste verfuegbare Qualitaet' },
      { value: '1080', label: '1080p' },
      { value: '720', label: '720p' },
      { value: '480', label: '480p' }
    ]
  };

  const stageLabels = {
    queued: 'Wartet auf Start...',
    analyze: 'Link und Formate werden analysiert...',
    download: 'Datei wird heruntergeladen...',
    convert: 'Datei wird konvertiert...',
    pack: 'Dateien werden gebuendelt...',
    done: 'Fertig.',
    error: 'Fehler aufgetreten.'
  };

  const appConfig = window.APP_CONFIG || {};
  const apiBaseUrl = typeof appConfig.apiBaseUrl === 'string' ? appConfig.apiBaseUrl.trim() : '';
  const demoMode = Boolean(appConfig.demoMode);
  const demoMessage = appConfig.demoMessage
    || 'Diese Seite ist aktuell nur eine statische Vorschau ohne aktives Backend.';

  const form = document.getElementById('downloadForm');
  const formatSelect = document.getElementById('format');
  const qualitySelect = document.getElementById('quality');
  const statusBox = document.getElementById('statusBox');
  const stateText = document.getElementById('stateText');
  const stageText = document.getElementById('stageText');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  const expiryText = document.getElementById('expiryText');
  const summaryLog = document.getElementById('summaryLog');
  const detailsBox = document.getElementById('detailsBox');
  const logArea = document.getElementById('log');
  const downloadLink = document.getElementById('downloadLink');
  const fileName = document.getElementById('fileName');
  const submitBtn = document.getElementById('submitBtn');
  const modeBanner = document.getElementById('modeBanner');
  const modeBannerText = document.getElementById('modeBannerText');
  const apiInfo = document.getElementById('apiInfo');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const scTokenInput = document.getElementById('scTokenInput');
  const scTokenSave = document.getElementById('scTokenSave');
  const scTokenVerify = document.getElementById('scTokenVerify');
  const scVerifyResult = document.getElementById('scVerifyResult');
  const scBanner = document.getElementById('scBanner');
  const scBannerTokenBtn = document.getElementById('scBannerTokenBtn');

  function createApiUrl(value) {
    return new URL(value, apiBaseUrl || window.location.origin).toString();
  }

  function detectSoundCloud(url) {
    try {
      const hostname = new URL(url).hostname;
      return hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com');
    } catch {
      return false;
    }
  }

  function loadEncryptedCredentials() {
    return {
      encryptedToken: localStorage.getItem('sc_oauth_token_enc') || '',
      encryptedSession: localStorage.getItem('sc_session_enc') || ''
    };
  }

  function saveEncryptedCredentials(encryptedToken, encryptedSession) {
    localStorage.setItem('sc_oauth_token_enc', encryptedToken);
    if (encryptedSession) {
      localStorage.setItem('sc_session_enc', encryptedSession);
    }
  }

  function clearEncryptedCredentials() {
    localStorage.removeItem('sc_oauth_token_enc');
    localStorage.removeItem('sc_session_enc');
  }

  function hasStoredCredentials() {
    return Boolean(localStorage.getItem('sc_oauth_token_enc'));
  }

  function updateUiForSource(isSoundCloud) {
    const mp4Option = formatSelect.querySelector('option[value="mp4"]');
    const originalOption = formatSelect.querySelector('option[value="original"]');

    if (isSoundCloud) {
      if (mp4Option) mp4Option.style.display = 'none';
      if (originalOption) originalOption.style.display = '';
      if (formatSelect.value === 'mp4') {
        formatSelect.value = 'mp3';
        fillQualityOptions('mp3');
      }
      const hasToken = hasStoredCredentials();
      scBanner.classList.toggle('hidden', hasToken);
    } else {
      if (mp4Option) mp4Option.style.display = '';
      if (originalOption) originalOption.style.display = 'none';
      if (formatSelect.value === 'original') {
        formatSelect.value = 'mp3';
        fillQualityOptions('mp3');
      }
      scBanner.classList.add('hidden');
    }
  }

  function fillQualityOptions(format) {
    qualitySelect.innerHTML = '';

    if (format === 'original') {
      qualitySelect.disabled = true;
      const el = document.createElement('option');
      el.value = '';
      el.textContent = '—';
      qualitySelect.appendChild(el);
      return;
    }

    qualitySelect.disabled = false;
    for (const option of qualityMap[format] || []) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      qualitySelect.appendChild(element);
    }
    if (format === 'mp3') qualitySelect.value = '320';
    if (format === 'mp4') qualitySelect.value = 'best';
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'medium'
    }).format(date);
  }

  function updateExpiryText(expiresAt) {
    const formatted = formatDate(expiresAt);
    if (!formatted) {
      expiryText.textContent = '';
      expiryText.classList.add('hidden');
      return;
    }

    expiryText.textContent = `Verfuegbar bis: ${formatted}`;
    expiryText.classList.remove('hidden');
  }

  function updateProgress(progress, stage) {
    const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
    progressBar.style.width = `${safeProgress}%`;
    progressText.textContent = `${Math.round(safeProgress)}%`;
    stageText.textContent = stageLabels[stage] || 'Verarbeitung...';
  }

  function getCurrentSummary(logText) {
    if (!logText) return 'Noch keine Aktivitaet.';

    const lines = logText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    return lines[lines.length - 1] || 'Noch keine Aktivitaet.';
  }

  function resetStatusBox() {
    stateText.textContent = 'Download wird gestartet...';
    updateProgress(0, 'queued');
    updateExpiryText(null);
    summaryLog.textContent = 'Noch keine Aktivitaet.';
    logArea.value = '';
    logArea.scrollTop = 0;
    detailsBox.open = false;
    downloadLink.classList.add('hidden');
    fileName.textContent = '';
  }

  function showBanner(message, tone) {
    modeBannerText.textContent = message;
    modeBanner.classList.remove('hidden', 'warning', 'info');
    modeBanner.classList.add(tone);
  }

  async function pollStatus(id) {
    const response = await fetch(createApiUrl(`/api/status/${id}`));
    if (!response.ok) throw new Error('Status konnte nicht geladen werden.');
    const data = await response.json();

    logArea.value = data.rawLog || '';
    logArea.scrollTop = logArea.scrollHeight;
    summaryLog.textContent = getCurrentSummary(data.log);
    updateExpiryText(data.expiresAt);
    updateProgress(data.progress, data.stage);

    if (data.status === 'running') {
      stateText.textContent = 'Verarbeitung laeuft...';
      setTimeout(() => pollStatus(id), 1500);
      return;
    }

    if (data.status === 'done') {
      stateText.innerHTML = '<span class="ok">Download abgeschlossen.</span>';
      updateProgress(100, 'done');
      downloadLink.href = createApiUrl(data.downloadUrl);
      downloadLink.classList.remove('hidden');
      fileName.textContent = data.downloadName || '';
      submitBtn.disabled = false;
      return;
    }

    stateText.innerHTML = `<span class="error">Fehler: ${data.error || 'Unbekannt'}</span>`;
    updateProgress(data.progress || 100, 'error');
    submitBtn.disabled = false;
  }

  fillQualityOptions('mp3');
  formatSelect.addEventListener('change', () => fillQualityOptions(formatSelect.value));

  document.getElementById('url').addEventListener('input', (e) => {
    updateUiForSource(detectSoundCloud(e.target.value));
  });

  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    if (!settingsPanel.classList.contains('hidden')) {
      scTokenInput.value = '';
      scTokenInput.placeholder = hasStoredCredentials() ? '••••••••••••••' : 'OAuth Token eingeben';
      scVerifyResult.textContent = '';
      scVerifyResult.className = 'verify-result';
    }
  });

  scBannerTokenBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
    scTokenInput.value = '';
    scTokenInput.placeholder = hasStoredCredentials() ? '••••••••••••••' : 'OAuth Token eingeben';
    scVerifyResult.textContent = '';
    scVerifyResult.className = 'verify-result';
    scTokenInput.focus();
  });

  scTokenSave.addEventListener('click', () => {
    clearEncryptedCredentials();
    scTokenInput.value = '';
    scTokenInput.placeholder = 'OAuth Token eingeben';
    const isSC = detectSoundCloud(document.getElementById('url').value);
    updateUiForSource(isSC);
    scVerifyResult.textContent = 'Token entfernt.';
    scVerifyResult.className = 'verify-result ok';
  });

  scTokenVerify.addEventListener('click', async () => {
    const token = scTokenInput.value.trim();
    if (!token) {
      scVerifyResult.textContent = 'Bitte zuerst einen Token eingeben.';
      scVerifyResult.className = 'verify-result error';
      return;
    }

    scTokenVerify.disabled = true;
    scVerifyResult.textContent = 'Prüfe Token...';
    scVerifyResult.className = 'verify-result pending';

    try {
      const response = await fetch(createApiUrl('/api/sc-verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      if (!response.ok && response.status !== 400) {
        throw new Error(`Server-Fehler: ${response.status}`);
      }
      const data = await response.json();

      if (data.valid) {
        const goLabel = data.goPlus ? ' · SC Go+: ✓' : '';
        scVerifyResult.textContent = `✓ Token gültig · Nutzer: ${data.username}${goLabel}`;
        scVerifyResult.className = 'verify-result ok';
        if (data.encryptedToken) {
          saveEncryptedCredentials(data.encryptedToken, data.encryptedSession || '');
          scTokenInput.value = '';
          scTokenInput.placeholder = '••••••••••••••';
          const isSC = detectSoundCloud(document.getElementById('url').value);
          updateUiForSource(isSC);
        }
      } else {
        scVerifyResult.textContent = `✗ ${data.error || 'Token ungültig.'}`;
        scVerifyResult.className = 'verify-result error';
      }
    } catch {
      scVerifyResult.textContent = '✗ Verbindung zum Server fehlgeschlagen.';
      scVerifyResult.className = 'verify-result error';
    } finally {
      scTokenVerify.disabled = false;
    }
  });

  if (apiBaseUrl) {
    apiInfo.textContent = `API-Ziel: ${apiBaseUrl}`;
    apiInfo.classList.remove('hidden');
  }

  if (demoMode) {
    showBanner(demoMessage, 'warning');
    submitBtn.textContent = 'Demo-Modus';
  } else if (apiBaseUrl) {
    showBanner('Frontend ist fuer ein getrenntes Backend vorbereitet.', 'info');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    statusBox.classList.remove('hidden');
    resetStatusBox();

    if (demoMode) {
      stateText.innerHTML = `<span class="error">${demoMessage}</span>`;
      updateProgress(100, 'error');
      summaryLog.textContent = 'Kein Backend verbunden.';
      return;
    }

    submitBtn.disabled = true;

    try {
      const urlInput = document.getElementById('url').value;
      const isSC = detectSoundCloud(urlInput);
      const { encryptedToken, encryptedSession } = isSC ? loadEncryptedCredentials() : {};

      const response = await fetch(createApiUrl('/api/download'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput,
          format: formatSelect.value,
          quality: qualitySelect.value,
          ...(encryptedToken ? { encryptedToken } : {}),
          ...(encryptedSession ? { encryptedSession } : {})
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Download konnte nicht gestartet werden.');

      if (data.encryptedSession && encryptedToken) {
        localStorage.setItem('sc_session_enc', data.encryptedSession);
      }

      await pollStatus(data.id);
    } catch (error) {
      stateText.innerHTML = `<span class="error">${error.message}</span>`;
      updateProgress(100, 'error');
      submitBtn.disabled = false;
    }
  });

  if (hasStoredCredentials()) {
    scTokenInput.placeholder = '••••••••••••••';
  }
}());
