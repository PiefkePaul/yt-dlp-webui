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
    queued: 'Job wartet auf einen freien Slot...',
    analyze: 'Link und Formate werden analysiert...',
    download: 'Datei wird heruntergeladen...',
    convert: 'Datei wird konvertiert...',
    pack: 'Dateien werden gebuendelt...',
    cancel: 'Job wird abgebrochen...',
    cancelled: 'Job wurde abgebrochen.',
    done: 'Fertig.',
    error: 'Fehler aufgetreten.'
  };

  const defaultSoundcloudTokenText = 'Wird nur fuer diese Session verwendet. Bei SoundCloud-Go+-Tracks ist der Token noetig, damit nicht nur die 30-Sekunden-Vorschau geladen wird.';
  const recommendedSoundcloudTokenText = 'Fuer SoundCloud-Go+/HQ-Varianten ist ein Token sinnvoll, auch wenn frei verfuegbare Varianten ohne Token bereits ladbar sind.';
  const requiredSoundcloudTokenText = 'Fuer den aktuell analysierten SoundCloud-Track ist ein Token zwingend erforderlich, sonst bleibt nur die 30-Sekunden-Vorschau.';

  const appConfig = window.APP_CONFIG || {};
  const apiBaseUrl = typeof appConfig.apiBaseUrl === 'string' ? appConfig.apiBaseUrl.trim() : '';
  const demoMode = Boolean(appConfig.demoMode);
  const demoMessage = appConfig.demoMessage
    || 'Diese Seite ist aktuell nur eine statische Vorschau ohne aktives Backend.';

  const form = document.getElementById('downloadForm');
  const urlInput = document.getElementById('url');
  const formatSelect = document.getElementById('format');
  const qualitySelect = document.getElementById('quality');
  const inspectBtn = document.getElementById('inspectBtn');
  const submitBtn = document.getElementById('submitBtn');
  const advancedOptions = document.getElementById('advancedOptions');
  const soundcloudTokenInput = document.getElementById('soundcloudToken');
  const soundcloudTokenNote = document.getElementById('soundcloudTokenNote');
  const videoPasswordInput = document.getElementById('videoPassword');
  const refererInput = document.getElementById('referer');
  const cookieHeaderInput = document.getElementById('cookieHeader');
  const cookiesTextInput = document.getElementById('cookiesText');
  const extraHeadersInput = document.getElementById('extraHeaders');
  const extractorArgsInput = document.getElementById('extractorArgs');

  const inspectBox = document.getElementById('inspectBox');
  const inspectTitle = document.getElementById('inspectTitle');
  const inspectMeta = document.getElementById('inspectMeta');
  const inspectEntries = document.getElementById('inspectEntries');
  const inspectThumb = document.getElementById('inspectThumb');
  const inspectStatus = document.getElementById('inspectStatus');
  const inspectMessages = document.getElementById('inspectMessages');

  const statusBox = document.getElementById('statusBox');
  const stateText = document.getElementById('stateText');
  const stageText = document.getElementById('stageText');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  const queueText = document.getElementById('queueText');
  const expiryText = document.getElementById('expiryText');
  const summaryLog = document.getElementById('summaryLog');
  const detailsBox = document.getElementById('detailsBox');
  const logArea = document.getElementById('log');
  const downloadLink = document.getElementById('downloadLink');
  const fileName = document.getElementById('fileName');
  const cancelBtn = document.getElementById('cancelBtn');
  const modeBanner = document.getElementById('modeBanner');
  const modeBannerText = document.getElementById('modeBannerText');
  const apiInfo = document.getElementById('apiInfo');

  let activeJobId = null;
  let activePollToken = 0;
  let lastInspectSignature = '';
  let lastInspectPayload = null;
  let activeInspectRequestId = 0;

  function createApiUrl(value) {
    return new URL(value, apiBaseUrl || window.location.origin).toString();
  }

  function fillQualityOptions(format) {
    qualitySelect.innerHTML = '';
    for (const option of qualityMap[format]) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      qualitySelect.appendChild(element);
    }

    qualitySelect.value = format === 'mp4' ? 'best' : '320';
  }

  function collectAdvancedOptions() {
    return {
      soundcloudOauthToken: soundcloudTokenInput.value.trim(),
      videoPassword: videoPasswordInput.value.trim(),
      referer: refererInput.value.trim(),
      cookieHeader: cookieHeaderInput.value.trim(),
      cookiesText: cookiesTextInput.value.trim(),
      extraHeaders: extraHeadersInput.value.trim(),
      extractorArgs: extractorArgsInput.value.trim()
    };
  }

  function getInspectSignature() {
    return JSON.stringify({
      url: urlInput.value.trim(),
      advanced: collectAdvancedOptions()
    });
  }

  function formatDate(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

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

  function updateQueueText(queuePosition) {
    if (!queuePosition) {
      queueText.textContent = '';
      queueText.classList.add('hidden');
      return;
    }

    queueText.textContent = `Warteschlange: Position ${queuePosition}`;
    queueText.classList.remove('hidden');
  }

  function updateProgress(progress, stage) {
    const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
    progressBar.style.width = `${safeProgress}%`;
    progressText.textContent = `${Math.round(safeProgress)}%`;
    stageText.textContent = stageLabels[stage] || 'Verarbeitung...';
  }

  function getCurrentSummary(logText) {
    if (!logText) {
      return 'Noch keine Aktivitaet.';
    }

    const lines = logText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    return lines[lines.length - 1] || 'Noch keine Aktivitaet.';
  }

  function setStateMessage(text, tone) {
    stateText.textContent = text;
    stateText.classList.remove('ok', 'error', 'warning');

    if (tone) {
      stateText.classList.add(tone);
    }
  }

  function createInspectBanner(message) {
    const element = document.createElement('div');
    const tone = message && message.tone === 'warning' ? 'warning' : 'info';
    element.className = `banner ${tone}`;
    element.textContent = message.text;
    return element;
  }

  function updateSoundcloudTokenState(payload) {
    const required = Boolean(payload?.requirements?.soundcloudTokenRequired);
    const recommended = Boolean(payload?.requirements?.soundcloudTokenRecommended);

    soundcloudTokenInput.required = required;
    soundcloudTokenInput.setAttribute('aria-required', required ? 'true' : 'false');
    soundcloudTokenNote.classList.remove('warning', 'ok');

    if (required) {
      soundcloudTokenNote.textContent = requiredSoundcloudTokenText;
      soundcloudTokenNote.classList.add('warning');
      return;
    }

    if (recommended) {
      soundcloudTokenNote.textContent = recommendedSoundcloudTokenText;
      return;
    }

    soundcloudTokenNote.textContent = defaultSoundcloudTokenText;
  }

  function resetInspectBox() {
    inspectTitle.textContent = '';
    inspectMeta.textContent = '';
    inspectStatus.textContent = '';
    inspectThumb.src = '';
    inspectThumb.classList.add('hidden');
    inspectEntries.innerHTML = '';
    inspectEntries.classList.add('hidden');
    inspectMessages.innerHTML = '';
    inspectMessages.classList.add('hidden');
    inspectBox.classList.add('hidden');
    lastInspectPayload = null;
    lastInspectSignature = '';
    updateSoundcloudTokenState(null);
  }

  function renderInspect(payload, requestSignature) {
    lastInspectPayload = payload;
    lastInspectSignature = requestSignature;

    inspectTitle.textContent = payload.title || 'Unbekannter Inhalt';

    const metaParts = [];
    if (payload.siteLabel) {
      metaParts.push(payload.siteLabel);
    } else if (payload.extractor) {
      metaParts.push(payload.extractor);
    }
    if (payload.uploader) {
      metaParts.push(payload.uploader);
    }
    if (payload.durationLabel) {
      metaParts.push(payload.durationLabel);
    }
    if (payload.isPlaylist) {
      metaParts.push(`${payload.playlistCount || payload.entries.length || 0} Eintraege`);
    }

    inspectMeta.textContent = metaParts.join(' · ');
    inspectStatus.textContent = payload.webpageUrl || payload.originalUrl || '';

    inspectMessages.innerHTML = '';
    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      for (const message of payload.messages) {
        inspectMessages.appendChild(createInspectBanner(message));
      }
      inspectMessages.classList.remove('hidden');
    } else {
      inspectMessages.classList.add('hidden');
    }

    if (payload.thumbnail) {
      inspectThumb.src = payload.thumbnail;
      inspectThumb.alt = payload.title || 'Vorschau';
      inspectThumb.classList.remove('hidden');
    } else {
      inspectThumb.src = '';
      inspectThumb.classList.add('hidden');
    }

    inspectEntries.innerHTML = '';
    if (Array.isArray(payload.entries) && payload.entries.length > 0) {
      for (const entry of payload.entries) {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = entry.title || 'Unbekannter Eintrag';

        const meta = document.createElement('span');
        const parts = [];
        if (entry.uploader) {
          parts.push(entry.uploader);
        }
        if (entry.durationLabel) {
          parts.push(entry.durationLabel);
        }
        meta.textContent = parts.join(' · ');

        item.appendChild(title);
        if (meta.textContent) {
          item.appendChild(meta);
        }
        inspectEntries.appendChild(item);
      }

      if (payload.entriesTruncated) {
        const item = document.createElement('li');
        item.textContent = 'Weitere Eintraege wurden fuer die Vorschau abgeschnitten.';
        inspectEntries.appendChild(item);
      }

      inspectEntries.classList.remove('hidden');
    } else {
      inspectEntries.classList.add('hidden');
    }

    updateSoundcloudTokenState(payload);
    inspectBox.classList.remove('hidden');
  }

  function resetStatusBox() {
    activeJobId = null;
    setStateMessage('Download wird gestartet...');
    updateProgress(0, 'queued');
    updateQueueText(null);
    updateExpiryText(null);
    summaryLog.textContent = 'Noch keine Aktivitaet.';
    logArea.value = '';
    logArea.scrollTop = 0;
    detailsBox.open = false;
    downloadLink.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    cancelBtn.disabled = false;
    fileName.textContent = '';
  }

  function setInspectBusyState(isBusy) {
    inspectBtn.disabled = isBusy || demoMode;
  }

  function setSubmitBusyState(isBusy) {
    submitBtn.disabled = isBusy || demoMode;
  }

  function showBanner(message, tone) {
    modeBannerText.textContent = message;
    modeBanner.classList.remove('hidden', 'warning', 'info');
    modeBanner.classList.add(tone);
  }

  function invalidateInspectResult() {
    if (getInspectSignature() === lastInspectSignature) {
      return;
    }

    resetInspectBox();
  }

  function ensureInspectRequirements(payload) {
    if (payload?.requirements?.soundcloudTokenRequired && !collectAdvancedOptions().soundcloudOauthToken) {
      advancedOptions.open = true;
      soundcloudTokenInput.focus();
      throw new Error('Fuer diesen SoundCloud-Track ist ein OAuth-Token erforderlich, sonst bleibt nur die 30-Sekunden-Vorschau verfuegbar.');
    }
  }

  async function inspectCurrentUrl() {
    const url = urlInput.value.trim();

    if (!url) {
      resetInspectBox();
      throw new Error('Bitte zuerst einen gueltigen Link eingeben.');
    }

    const requestSignature = getInspectSignature();
    const requestId = ++activeInspectRequestId;
    const advanced = collectAdvancedOptions();

    setInspectBusyState(true);
    inspectStatus.textContent = 'Link wird analysiert...';
    inspectMessages.innerHTML = '';
    inspectMessages.classList.add('hidden');
    inspectBox.classList.remove('hidden');

    try {
      const response = await fetch(createApiUrl('/api/inspect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          advanced
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Analyse konnte nicht gestartet werden.');
      }

      if (requestId !== activeInspectRequestId) {
        throw new Error('Analyse wurde durch eine neuere Anfrage ersetzt.');
      }

      if (requestSignature !== getInspectSignature()) {
        throw new Error('Formular wurde waehrend der Analyse geaendert. Bitte erneut pruefen.');
      }

      renderInspect(data, requestSignature);
      return data;
    } finally {
      if (requestId === activeInspectRequestId) {
        setInspectBusyState(false);
      }
    }
  }

  async function pollStatus(id, pollToken) {
    if (pollToken !== activePollToken) {
      return;
    }

    const response = await fetch(createApiUrl(`/api/status/${id}`));
    if (!response.ok) {
      throw new Error('Status konnte nicht geladen werden.');
    }

    const data = await response.json();

    if (pollToken !== activePollToken) {
      return;
    }

    logArea.value = data.rawLog || '';
    logArea.scrollTop = logArea.scrollHeight;
    summaryLog.textContent = getCurrentSummary(data.log);
    updateExpiryText(data.expiresAt);
    updateQueueText(data.queuePosition);
    updateProgress(data.progress, data.stage);

    if (data.status === 'queued') {
      setStateMessage('Job wartet in der Warteschlange...');
      cancelBtn.classList.remove('hidden');
      window.setTimeout(() => {
        startPollingJob(id, pollToken);
      }, 1200);
      return;
    }

    if (data.status === 'running') {
      setStateMessage(data.cancelRequested ? 'Abbruch wird verarbeitet...' : 'Verarbeitung laeuft...');
      cancelBtn.classList.remove('hidden');
      window.setTimeout(() => {
        startPollingJob(id, pollToken);
      }, 1500);
      return;
    }

    cancelBtn.classList.add('hidden');

    if (data.status === 'done') {
      setStateMessage('Download abgeschlossen.', 'ok');
      updateProgress(100, 'done');
      downloadLink.href = createApiUrl(data.downloadUrl);
      downloadLink.classList.remove('hidden');
      fileName.textContent = data.downloadName || '';
      setSubmitBusyState(false);
      return;
    }

    if (data.status === 'cancelled') {
      setStateMessage('Job wurde abgebrochen.', 'warning');
      updateProgress(data.progress || 0, 'cancelled');
      setSubmitBusyState(false);
      return;
    }

    setStateMessage(`Fehler: ${data.error || 'Unbekannt'}`, 'error');
    updateProgress(data.progress || 100, 'error');
    setSubmitBusyState(false);
  }

  function startPollingJob(id, pollToken) {
    void pollStatus(id, pollToken).catch((error) => {
      if (pollToken !== activePollToken) {
        return;
      }

      cancelBtn.classList.add('hidden');
      setStateMessage(error.message, 'error');
      updateProgress(100, 'error');
      setSubmitBusyState(false);
    });
  }

  fillQualityOptions('mp3');
  formatSelect.addEventListener('change', () => fillQualityOptions(formatSelect.value));

  urlInput.addEventListener('input', invalidateInspectResult);

  [
    soundcloudTokenInput,
    videoPasswordInput,
    refererInput,
    cookieHeaderInput,
    cookiesTextInput,
    extraHeadersInput,
    extractorArgsInput
  ].forEach((input) => {
    input.addEventListener('input', invalidateInspectResult);
  });

  inspectBtn.addEventListener('click', async () => {
    if (demoMode) {
      return;
    }

    try {
      const payload = await inspectCurrentUrl();
      ensureInspectRequirements(payload);
    } catch (error) {
      if (error.message !== 'Analyse wurde durch eine neuere Anfrage ersetzt.') {
        inspectStatus.textContent = error.message;
      }
    }
  });

  cancelBtn.addEventListener('click', async () => {
    if (!activeJobId) {
      return;
    }

    cancelBtn.disabled = true;
    try {
      await fetch(createApiUrl(`/api/download/${activeJobId}`), {
        method: 'DELETE'
      });
    } finally {
      cancelBtn.disabled = false;
    }
  });

  if (apiBaseUrl) {
    apiInfo.textContent = `API-Ziel: ${apiBaseUrl}`;
    apiInfo.classList.remove('hidden');
  }

  if (demoMode) {
    showBanner(demoMessage, 'warning');
    submitBtn.textContent = 'Demo-Modus';
    inspectBtn.disabled = true;
    submitBtn.disabled = true;
  } else if (apiBaseUrl) {
    showBanner('Frontend ist fuer ein getrenntes Backend vorbereitet.', 'info');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    activePollToken += 1;
    statusBox.classList.remove('hidden');
    resetStatusBox();

    if (demoMode) {
      setStateMessage(demoMessage, 'error');
      updateProgress(100, 'error');
      summaryLog.textContent = 'Kein Backend verbunden.';
      return;
    }

    setSubmitBusyState(true);

    try {
      let inspectionPayload = lastInspectPayload;

      if (getInspectSignature() !== lastInspectSignature) {
        inspectionPayload = await inspectCurrentUrl();
      }

      ensureInspectRequirements(inspectionPayload);

      const requestSignature = getInspectSignature();
      const advanced = collectAdvancedOptions();

      const response = await fetch(createApiUrl('/api/download'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput.value.trim(),
          format: formatSelect.value,
          quality: qualitySelect.value,
          advanced
        })
      });

      const data = await response.json();
      if (!response.ok) {
        if (data.inspection && requestSignature === getInspectSignature()) {
          renderInspect(data.inspection, requestSignature);
        }

        if (data.code === 'SOUNDCLOUD_TOKEN_REQUIRED') {
          advancedOptions.open = true;
          soundcloudTokenInput.focus();
        }

        throw new Error(data.error || 'Download konnte nicht gestartet werden.');
      }

      const pollToken = ++activePollToken;
      activeJobId = data.id;
      cancelBtn.classList.remove('hidden');
      updateQueueText(data.queuePosition);
      startPollingJob(data.id, pollToken);
    } catch (error) {
      setStateMessage(error.message, 'error');
      updateProgress(100, 'error');
      setSubmitBusyState(false);
    }
  });
}());
