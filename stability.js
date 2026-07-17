(() => {
  "use strict";

  const CHECKPOINT_KEY = "cctActiveSessionCheckpointV2";
  const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const AUDIO_PROBE_TIMEOUT_MS = 5000;
  const AUDIO_TAIL_PADDING_MS = 120;

  let isPaused = false;
  let pauseStartedWallTime = 0;
  let pausedTimerRemainingMs = 0;
  let wakeLock = null;
  let checkpointTimer = 0;
  let suppressCheckpoint = false;
  const voiceValidationCache = new Map();

  const originalStartGame = startGame;
  const originalStopGame = stopGame;
  const originalStartStimulusScheduler = startStimulusScheduler;
  const originalScheduleNextStimulus = scheduleNextStimulus;
  const originalRecordScoredItem = recordScoredItem;
  const originalRunStimulus = runStimulus;
  const originalIsAllowedSessionClick = isAllowedSessionClick;

  const style = document.createElement("style");
  style.textContent = `
    .stability-session-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      width: 100%;
      margin-top: 12px;
    }

    .stability-session-actions > button {
      width: 100%;
      margin: 0;
    }

    .voice-stability-status {
      min-height: 18px;
      margin-top: 7px;
      color: var(--muted, #6b7078);
      font-size: 0.82rem;
      line-height: 1.35;
    }

    .voice-stability-status.error {
      color: #c33c3c;
    }

    .voice-stability-status.success {
      color: #287a4d;
    }

    .theme-dark .voice-stability-status.success {
      color: #6ed49b;
    }

    @media (max-width: 520px) {
      .stability-session-actions {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);

  const sessionActions = document.createElement("div");
  sessionActions.className = "stability-session-actions";

  const pauseButton = document.createElement("button");
  pauseButton.id = "pauseSessionBtn";
  pauseButton.className = "secondary-button";
  pauseButton.type = "button";
  pauseButton.textContent = "Pause";
  pauseButton.disabled = true;

  endSessionBtn.parentNode.insertBefore(sessionActions, endSessionBtn);
  sessionActions.appendChild(pauseButton);
  sessionActions.appendChild(endSessionBtn);

  isAllowedSessionClick = function stableAllowedSessionClick(target) {
    return target === pauseButton
      || pauseButton.contains(target)
      || originalIsAllowedSessionClick(target);
  };

  const voiceField = voiceSelect.closest(".voice-field") || voiceSelect.parentElement;
  const voiceStatus = document.createElement("div");
  voiceStatus.className = "voice-stability-status";
  voiceStatus.setAttribute("aria-live", "polite");
  voiceField.appendChild(voiceStatus);

  function setVoiceStatus(message, type = "") {
    voiceStatus.textContent = message;
    voiceStatus.classList.toggle("error", type === "error");
    voiceStatus.classList.toggle("success", type === "success");
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock || document.visibilityState !== "visible") return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      }, { once: true });
    } catch (error) {
      wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    if (!lock) return;
    try {
      await lock.release();
    } catch (error) {}
  }

  function probeAudioClip(src) {
    return new Promise(resolve => {
      const audio = new Audio();
      let settled = false;
      const timer = setTimeout(() => finish(false, 0), AUDIO_PROBE_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timer);
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("canplaythrough", onReady);
        audio.removeEventListener("error", onError);
      }

      function finish(ok, durationMs) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ ok, durationMs });
      }

      function onReady() {
        const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
        finish(true, durationMs);
      }

      function onError() {
        finish(false, 0);
      }

      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", onReady, { once: true });
      audio.addEventListener("canplaythrough", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.src = src;

      try {
        audio.load();
      } catch (error) {
        finish(false, 0);
      }
    });
  }

  async function validateVoice(voiceKey, force = false) {
    const normalizedVoice = resolveVoiceKey(voiceKey);
    if (!force && voiceValidationCache.has(normalizedVoice)) {
      return voiceValidationCache.get(normalizedVoice);
    }

    const pending = Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(async number => {
        const result = await probeAudioClip(getVoiceClipUrl(normalizedVoice, number));
        return { number, ...result };
      })
    ).then(results => {
      const missing = results.filter(result => !result.ok).map(result => result.number);
      const maxDurationMs = Math.max(0, ...results.map(result => result.durationMs || 0));
      return {
        voiceKey: normalizedVoice,
        ok: missing.length === 0,
        missing,
        maxDurationMs
      };
    });

    voiceValidationCache.set(normalizedVoice, pending);
    const report = await pending;
    voiceValidationCache.set(normalizedVoice, Promise.resolve(report));
    return report;
  }

  function getSafeMinimumInterval(report) {
    if (!report || !report.maxDurationMs) return 100;
    const speed = Math.max(0.5, parseFloat(playbackSpeedSelect.value) || 1);
    const safeValue = (report.maxDurationMs / speed) + AUDIO_TAIL_PADDING_MS;
    return Math.max(100, Math.ceil(safeValue / 10) * 10);
  }

  function applySafeMinimumInterval(report) {
    const safeMinimum = getSafeMinimumInterval(report);
    const cappedMinimum = Math.min(1500, safeMinimum);
    minimumIntervalInput.min = String(cappedMinimum);

    if ((parseInt(minimumIntervalInput.value, 10) || 0) < cappedMinimum) {
      minimumIntervalInput.value = String(cappedMinimum);
    }

    if ((parseInt(startingIntervalInput.value, 10) || 0) < cappedMinimum) {
      startingIntervalInput.value = String(cappedMinimum);
    }

    saveSettings();
    return safeMinimum;
  }

  async function refreshVoiceSafetyStatus(force = false) {
    const voiceKey = resolveVoiceKey(voiceSelect.value || selectedVoice);
    setVoiceStatus("Checking all nine voice clips…");

    const report = await validateVoice(voiceKey, force);
    if (!report.ok) {
      setVoiceStatus(`Missing or unreadable clips: ${report.missing.join(", ")}.`, "error");
      return report;
    }

    const safeMinimum = applySafeMinimumInterval(report);
    if (safeMinimum > 1500) {
      setVoiceStatus("This voice is too long for the available interval range.", "error");
      return { ...report, ok: false, unsafe: true };
    }

    setVoiceStatus(`Voice ready. Safe minimum interval: ${safeMinimum} ms.`, "success");
    return report;
  }

  async function stableTestSelectedVoice() {
    if (voiceTestInProgress) return;

    const voice = resolveVoiceKey(voiceSelect.value || selectedVoice);
    voiceTestInProgress = true;
    voiceTestBtn.disabled = true;

    try {
      const report = await refreshVoiceSafetyStatus();
      if (!report.ok) return;

      await preloadVoice(voice);
      const entry = voiceAudioCache[voice];
      const clipNumbers = entry && entry.clips
        ? Object.keys(entry.clips).map(Number).filter(Number.isFinite)
        : [];
      const clipNumber = clipNumbers.length
        ? clipNumbers[Math.floor(Math.random() * clipNumbers.length)]
        : 1;
      const template = entry && entry.clips && entry.clips[clipNumber];
      if (!template) return;

      stopStimulusAudioPlayback();
      const audio = template.cloneNode(true);
      audio.playbackRate = parseFloat(playbackSpeedSelect.value) || 1;
      audio.currentTime = 0;
      activeStimulusAudios.add(audio);

      await new Promise(resolve => {
        let settled = false;
        const timeout = setTimeout(settle, 4000);

        function settle() {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          activeStimulusAudios.delete(audio);
          resolve();
        }

        audio.addEventListener("ended", settle, { once: true });
        audio.addEventListener("error", settle, { once: true });

        try {
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(settle);
          }
        } catch (error) {
          settle();
        }
      });
    } finally {
      voiceTestInProgress = false;
      voiceTestBtn.disabled = false;
    }
  }

  function queueCheckpointSave() {
    clearTimeout(checkpointTimer);
    checkpointTimer = setTimeout(saveCheckpoint, 40);
  }

  function getQuestionElapsedMs() {
    if (!activeQuestionState || !activeQuestionState.startedAt) return 0;
    return Math.max(0, getClockTime() - activeQuestionState.startedAt);
  }

  function createCheckpoint() {
    if (sessionState !== "active" && sessionState !== "starting") return null;

    const currentPauseMs = isPaused && pauseStartedWallTime
      ? Math.max(0, Date.now() - pauseStartedWallTime)
      : 0;
    const activeElapsedMs = Math.max(0, Date.now() - sessionStartedAt - currentPauseMs);
    const remainingMs = endCondition === "timer"
      ? (isPaused ? pausedTimerRemainingMs : Math.max(0, endTime - Date.now()))
      : 0;

    return {
      version: 2,
      savedAt: Date.now(),
      settings: getSettingsFromForm(),
      session: {
        currentSessionId,
        numbers: [...numbers],
        feedback: [...feedback],
        responseTimes: [...responseTimes],
        correctStreak,
        wrongStreak,
        correctAnswers,
        interval,
        startingInterval,
        minimumInterval,
        intervalIncrement,
        endCondition,
        targetCorrect,
        arithmeticMode,
        selectedVoice,
        playbackSpeed,
        beepEnabled,
        showIntervalTiming,
        intervalCounts: { ...intervalCounts },
        intervalTime: { ...intervalTime },
        sessionIntervalTrace: sessionIntervalTrace.map(point => ({ ...point })),
        feedbackIndicatorColor,
        feedbackIndicatorCount,
        awaitingAnswer,
        answerValue: answer.value,
        activeQuestionState: activeQuestionState ? {
          expectedAnswer: activeQuestionState.expectedAnswer,
          responseInterval: activeQuestionState.responseInterval,
          traceIndex: activeQuestionState.traceIndex,
          resolved: activeQuestionState.resolved,
          elapsedMs: getQuestionElapsedMs()
        } : null,
        activeElapsedMs,
        remainingMs
      }
    };
  }

  function saveCheckpoint() {
    if (suppressCheckpoint) return;
    try {
      const checkpoint = createCheckpoint();
      if (!checkpoint) return;
      localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
    } catch (error) {}
  }

  function clearCheckpoint() {
    clearTimeout(checkpointTimer);
    try {
      localStorage.removeItem(CHECKPOINT_KEY);
    } catch (error) {}
  }

  function readCheckpoint() {
    try {
      const raw = localStorage.getItem(CHECKPOINT_KEY);
      if (!raw) return null;
      const checkpoint = JSON.parse(raw);
      if (!checkpoint || checkpoint.version !== 2 || !checkpoint.session) {
        clearCheckpoint();
        return null;
      }
      if (Date.now() - Number(checkpoint.savedAt || 0) > CHECKPOINT_MAX_AGE_MS) {
        clearCheckpoint();
        return null;
      }
      return checkpoint;
    } catch (error) {
      clearCheckpoint();
      return null;
    }
  }

  function restoreCheckpoint(checkpoint) {
    const saved = checkpoint.session;
    applySettings(normalizeSavedSettings(checkpoint.settings || {}));

    currentSessionId = saved.currentSessionId || generateSessionId();
    numbers = Array.isArray(saved.numbers) ? [...saved.numbers] : [];
    feedback = Array.isArray(saved.feedback) ? [...saved.feedback] : [];
    responseTimes = Array.isArray(saved.responseTimes) ? [...saved.responseTimes] : [];
    correctStreak = Math.max(0, Number(saved.correctStreak) || 0);
    wrongStreak = Math.max(0, Number(saved.wrongStreak) || 0);
    correctAnswers = Math.max(0, Number(saved.correctAnswers) || 0);
    startingInterval = Math.max(100, Number(saved.startingInterval) || 1500);
    minimumInterval = Math.max(100, Math.min(startingInterval, Number(saved.minimumInterval) || 700));
    intervalIncrement = Math.max(10, Number(saved.intervalIncrement) || 100);
    interval = Math.max(minimumInterval, Math.min(startingInterval, Number(saved.interval) || startingInterval));
    endCondition = saved.endCondition === "correct" ? "correct" : "timer";
    targetCorrect = Math.max(1, Number(saved.targetCorrect) || 500);
    arithmeticMode = ARITHMETIC_MODES.has(saved.arithmeticMode) ? saved.arithmeticMode : "addition";
    selectedVoice = resolveVoiceKey(saved.selectedVoice || voiceSelect.value);
    playbackSpeed = Math.max(1, Math.min(1.5, Number(saved.playbackSpeed) || 1));
    beepEnabled = saved.beepEnabled !== false;
    showIntervalTiming = !!saved.showIntervalTiming;
    intervalCounts = saved.intervalCounts && typeof saved.intervalCounts === "object" ? { ...saved.intervalCounts } : {};
    intervalTime = saved.intervalTime && typeof saved.intervalTime === "object" ? { ...saved.intervalTime } : {};
    sessionIntervalTrace = Array.isArray(saved.sessionIntervalTrace)
      ? saved.sessionIntervalTrace.map(point => ({ ...point }))
      : [];
    feedbackIndicatorColor = saved.feedbackIndicatorColor || null;
    feedbackIndicatorCount = Math.max(0, Number(saved.feedbackIndicatorCount) || 0);
    awaitingAnswer = !!saved.awaitingAnswer;

    const elapsedActiveMs = Math.max(0, Number(saved.activeElapsedMs) || 0);
    pausedTimerRemainingMs = Math.max(0, Number(saved.remainingMs) || 0);
    sessionStartedAt = Date.now() - elapsedActiveMs;
    sessionEndedAt = 0;
    endTime = endCondition === "timer" ? Date.now() + pausedTimerRemainingMs : 0;

    const savedQuestion = saved.activeQuestionState;
    if (savedQuestion && !savedQuestion.resolved) {
      const now = getClockTime();
      activeQuestionState = {
        startedAt: now - Math.max(0, Number(savedQuestion.elapsedMs) || 0),
        responseInterval: Math.max(100, Number(savedQuestion.responseInterval) || interval),
        expectedAnswer: savedQuestion.expectedAnswer,
        traceIndex: Math.max(0, Number(savedQuestion.traceIndex) || 0),
        resolved: false
      };
      responseStartedAt = activeQuestionState.startedAt;
      responseInterval = activeQuestionState.responseInterval;
    } else {
      activeQuestionState = null;
      responseStartedAt = 0;
      responseInterval = 0;
    }

    answer.value = String(saved.answerValue || "");
    gameRunning = false;
    isPaused = true;
    pauseStartedWallTime = Date.now();
    currentIntervalStart = 0;
    sessionOutcome = "Completed";

    setSessionState("active");
    answer.disabled = true;
    currentInterval.textContent = String(interval);
    updateSessionLimitUI();
    if (endCondition === "timer") {
      timeLeft.textContent = String(Math.ceil(pausedTimerRemainingMs / 1000));
    }
    updateFeedbackUI();
    updateIntervalStats();
    pauseButton.disabled = false;
    pauseButton.textContent = "Resume";
  }

  function beginRunningSession({ replayLastStimulus = false } = {}) {
    const nowWall = Date.now();
    const nowClock = getClockTime();
    const pausedFor = pauseStartedWallTime
      ? Math.max(0, nowWall - pauseStartedWallTime)
      : 0;

    sessionStartedAt += pausedFor;
    if (endCondition === "timer") {
      endTime = nowWall + pausedTimerRemainingMs;
    }

    pauseStartedWallTime = 0;
    isPaused = false;
    gameRunning = true;
    answer.disabled = false;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause";
    currentIntervalStart = showIntervalTiming ? nowClock : 0;
    lastStimulusAt = nowClock;

    if (replayLastStimulus && numbers.length) {
      const lastNumber = numbers[numbers.length - 1];
      playStimulusAudio(lastNumber);

      if (activeQuestionState && !activeQuestionState.resolved) {
        activeQuestionState.startedAt = nowClock;
        activeQuestionState.responseInterval = interval;
        responseStartedAt = nowClock;
        responseInterval = interval;
        awaitingAnswer = true;
      }
    }

    scheduleNextStimulus(interval);
    if (endCondition === "timer") updateTimer();
    tickIntervalTime();
    restoreAnswerFocus();
    void requestWakeLock();
    queueCheckpointSave();
  }

  function pauseSession() {
    if (sessionState !== "active" || isPaused) return;

    isPaused = true;
    gameRunning = false;
    pauseStartedWallTime = Date.now();
    pausedTimerRemainingMs = endCondition === "timer"
      ? Math.max(0, endTime - Date.now())
      : 0;

    stimulusScheduleSerial++;
    clearTimeout(timeoutId);
    stopStimulusAudioPlayback();
    answer.disabled = true;
    pauseButton.textContent = "Resume";
    void releaseWakeLock();
    saveCheckpoint();
  }

  function resumeSession() {
    if (sessionState !== "active" || !isPaused) return;

    const shouldReplayLastStimulus = numbers.length > 0 && (
      (activeQuestionState && !activeQuestionState.resolved)
      || (numbers.length === 1 && !activeQuestionState)
    );

    beginRunningSession({ replayLastStimulus: shouldReplayLastStimulus });
  }

  startStimulusScheduler = function stableInitialScheduler() {
    isPaused = false;
    pauseStartedWallTime = 0;
    pausedTimerRemainingMs = endCondition === "timer"
      ? Math.max(0, endTime - Date.now())
      : 0;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause";
    originalStartStimulusScheduler();
    void requestWakeLock();
    queueCheckpointSave();
  };

  scheduleNextStimulusFromLastStimulus = function stableScheduleFromAnchor() {
    if (!gameRunning) return;

    const now = getClockTime();
    const anchor = lastStimulusAt || now;
    const intendedTime = anchor + interval;
    const lateness = now - intendedTime;
    const lateThreshold = Math.max(250, interval * 0.4);

    if (lateness > lateThreshold) {
      lastStimulusAt = now;
      originalScheduleNextStimulus(interval);
      return;
    }

    originalScheduleNextStimulus(intendedTime - now);
  };

  recordScoredItem = function stableRecordScoredItem(...args) {
    const result = originalRecordScoredItem(...args);
    queueCheckpointSave();
    return result;
  };

  runStimulus = function stableRunStimulus(...args) {
    const result = originalRunStimulus(...args);
    queueCheckpointSave();
    return result;
  };

  stopGame = function stableStopGame(reason = "manual") {
    if (isPaused && pauseStartedWallTime) {
      sessionStartedAt += Math.max(0, Date.now() - pauseStartedWallTime);
    }

    isPaused = false;
    pauseStartedWallTime = 0;
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause";
    clearCheckpoint();
    void releaseWakeLock();

    return originalStopGame(reason);
  };

  startGame = async function stableStartGame() {
    if (sessionState !== "idle") return;

    const originalText = startBtn.textContent;
    startBtn.disabled = true;
    startBtn.textContent = "Checking voice…";

    try {
      const report = await refreshVoiceSafetyStatus();
      if (!report.ok) return;
      await originalStartGame();
    } finally {
      if (sessionState === "idle") {
        startBtn.disabled = false;
      }
      startBtn.textContent = originalText;
    }
  };

  testSelectedVoice = stableTestSelectedVoice;
  startBtn.onclick = () => {
    void startGame();
  };

  pauseButton.addEventListener("click", () => {
    if (isPaused) resumeSession();
    else pauseSession();
  });

  voiceSelect.addEventListener("change", () => {
    void refreshVoiceSafetyStatus();
  });

  playbackSpeedSelect.addEventListener("change", () => {
    void refreshVoiceSafetyStatus();
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || sessionState !== "active") return;
    event.preventDefault();
    if (isPaused) resumeSession();
    else pauseSession();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && sessionState === "active" && !isPaused) {
      pauseSession();
    } else if (document.visibilityState === "visible" && sessionState === "active" && !isPaused) {
      void requestWakeLock();
    }
  });

  window.addEventListener("beforeunload", event => {
    if (suppressCheckpoint) return;
    if (sessionState !== "active" && sessionState !== "starting") return;
    saveCheckpoint();
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("pagehide", saveCheckpoint);

  window.addEventListener("load", () => {
    setTimeout(() => {
      const checkpoint = readCheckpoint();
      if (checkpoint) {
        restoreCheckpoint(checkpoint);
      } else {
        void refreshVoiceSafetyStatus();
      }
    }, 120);
  });
})();
