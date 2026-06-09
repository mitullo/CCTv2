let interval=1000, startingInterval=1000, minimumInterval=200;
let intervalIncrement=100;
let numbers=[], feedback=[], responseTimes=[];
let correctStreak=0, wrongStreak=0;
let gameRunning=false, timeoutId, endTime;
let awaitingAnswer=false, beepEnabled=true;
let sessionState="idle";
let isStimulusTick=false;
let stimulusScheduleSerial=0;
let lastStimulusAt=0;
let endCondition="timer", targetCorrect=50, correctAnswers=0;
let arithmeticMode="addition";
let sessionStartedAt=0, sessionEndedAt=0;
let responseStartedAt=0, responseInterval=0;
let excludeLastQuestionFromCount=false;
let sessionOutcome="Completed";
let currentSessionId="";
let historyVisible=false;
let historyFilterVisible=false;
let sessionIntervalTrace=[];
let activeQuestionState=null;
let historyChartMode=null;
let historyChartModeIsUserSelected=false;
let historyPageIndex=0;
let historyTrendRefreshToken=0;
let historySessionRefreshToken=0;
let historyTrendUpdateChain=Promise.resolve();
const HISTORY_PAGE_SIZE=20;
const historyFilters={
  status:"all",
  mode:"all",
  trendInclusion:"all"
};
const EMPTY_HISTORY_STATS={
  completedSessions:0,
  totalCorrectAnswers:0,
  totalDurationMs:0
};
const SETTINGS_KEY="cctSettings";
const ARITHMETIC_MODES=new Set(["addition","multiplication","subtraction","difference"]);
const defaultSettings={
  startingInterval:"1500",
  minimumInterval:"700",
  intervalIncrement:"100",
  correctThreshold:"4",
  incorrectThreshold:"4",
  duration:"15",
  endCondition:"timer",
  targetCorrect:"500",
  mode:"addition",
  voice:"samantha",
  playbackSpeed:"1",
  beepEnabled:true,
  darkMode:false,
  showAdvancedSettings:false,
  showIntervalTiming:false
};

let intervalCounts={}, intervalTime={}, currentIntervalStart=0;
let feedbackIndicatorColor=null, feedbackIndicatorCount=0;
let showIntervalTiming=false;
let selectedVoice="";
let playbackSpeed=1;
let voiceAudioCache={};
let activeStimulusAudios=new Set();
let voiceLibrary={};
let voiceTestInProgress=false;
let beepAudioContext=null;

function clampInteger(value,fallback,min,max){
  const parsed=parseInt(value,10);
  if(Number.isNaN(parsed)) return fallback;
  return Math.max(min,Math.min(max,parsed));
}

function parsePositiveInteger(value,fallback,min=1){
  return Math.max(min,parseInt(value,10)||parseInt(fallback,10));
}

function coercePositiveNumber(value,fallback,min=1){
  return Math.max(min,Number(value)||Number(fallback)||min);
}

function normalizeSavedSettings(parsed){
  const startingInterval=String(clampInteger(parsed.startingInterval ?? parsed.interval,defaultSettings.startingInterval,200,1500));
  const minimumFallback=Math.min(parseInt(defaultSettings.minimumInterval,10),parseInt(startingInterval,10));
  const minimumInterval=String(Math.min(
    parseInt(startingInterval,10),
    clampInteger(parsed.minimumInterval,minimumFallback,100,1500)
  ));
  const intervalIncrement=String(clampInteger(parsed.intervalIncrement,defaultSettings.intervalIncrement,10,100));
  const correctThreshold=String(clampInteger(parsed.correctThreshold,defaultSettings.correctThreshold,1,10));
  const incorrectThreshold=String(clampInteger(parsed.incorrectThreshold,defaultSettings.incorrectThreshold,1,10));
  const duration=String(Math.max(1,clampInteger(parsed.duration,defaultSettings.duration,1,9999)));
  const targetCorrect=String(Math.max(1,clampInteger(parsed.targetCorrect,defaultSettings.targetCorrect,1,9999)));
  const mode=ARITHMETIC_MODES.has(parsed.mode) ? parsed.mode : defaultSettings.mode;

  return {
    ...defaultSettings,
    ...parsed,
    startingInterval,
    minimumInterval,
    intervalIncrement,
    correctThreshold,
    incorrectThreshold,
    duration,
    targetCorrect,
    mode,
    voice:parsed.voice ?? defaultSettings.voice,
    playbackSpeed:String(Math.max(1,Math.min(1.5,parseFloat(parsed.playbackSpeed)||parseFloat(defaultSettings.playbackSpeed)))),
    showAdvancedSettings:!!parsed.showAdvancedSettings,
    showIntervalTiming:!!parsed.showIntervalTiming,
    beepEnabled:parsed.beepEnabled ?? defaultSettings.beepEnabled,
    darkMode:parsed.darkMode ?? defaultSettings.darkMode
  };
}

function updateAppViews(){
  const sessionVisible=sessionState==="starting"||sessionState==="active";
  const resultsVisible=sessionState==="results";
  const settingsVisible=sessionState==="idle"&&!historyVisible;
  const historyPageVisible=historyVisible;

  sessionView.classList.toggle("hidden",!sessionVisible);
  resultsView.classList.toggle("hidden",!resultsVisible);
  historyView.classList.toggle("hidden",!historyPageVisible);
  settingsView.classList.toggle("hidden",!settingsVisible);
  footerView.classList.toggle("hidden",!settingsVisible);
  startBtn.disabled=sessionState!=="idle";
  answer.disabled=sessionState!=="active";
  endSessionBtn.disabled=!sessionVisible;
}

function hideHistoryFilters(){
  historyFilterVisible=false;
  if(historyFiltersPanel){
    historyFiltersPanel.classList.add("hidden");
  }
  if(historyFilterBtn){
    historyFilterBtn.setAttribute("aria-expanded","false");
  }
}

function setSessionState(nextState){
  sessionState=nextState;
  if(nextState!=="idle"){
    historyVisible=false;
  }
  updateAppViews();
}

function setHistoryVisible(isVisible){
  historyVisible=isVisible;
  hideHistoryFilters();
  if(isVisible){
    sessionState="idle";
  }
  updateAppViews();
}

function readSavedSettings(){
  try{
    const saved=window.localStorage.getItem(SETTINGS_KEY);
    if(!saved) return {...defaultSettings};
    const parsed=JSON.parse(saved);
    return normalizeSavedSettings(parsed);
  }catch(e){
    return {...defaultSettings};
  }
}

function getSettingsFromForm(){
  return {
    startingInterval:startingIntervalInput.value,
    minimumInterval:minimumIntervalInput.value,
    intervalIncrement:intervalIncrementSelect.value,
    correctThreshold:correctThresholdInput.value,
    incorrectThreshold:incorrectThresholdInput.value,
    duration:durationInput.value,
    endCondition:endConditionSelect.value,
    targetCorrect:targetCorrectInput.value,
    mode:modeSelect.value,
    voice:voiceSelect.value,
    playbackSpeed:playbackSpeedSelect.value,
    beepEnabled:beepToggle.checked,
    darkMode:themeToggle.checked,
    showAdvancedSettings:showAdvancedSettingsToggle.checked,
    showIntervalTiming:showIntervalTimingToggle.checked
  };
}

function saveSettings(){
  try{
    window.localStorage.setItem(SETTINGS_KEY,JSON.stringify(getSettingsFromForm()));
  }catch(e){}
}

function resetSettingsToDefault(){
  const defaults={...defaultSettings};
  try{
    window.localStorage.setItem(SETTINGS_KEY,JSON.stringify(defaults));
  }catch(e){}
  applySettings(defaults);
  saveSettings();
}

function applyTheme(isDark){
  document.body.classList.toggle("theme-dark",isDark);
}

function formatPlaybackSpeed(value){
  const normalized=Math.max(1,Math.min(1.5,parseFloat(value)||1));
  return normalized.toFixed(1).replace(/\.0$/,"") + "x";
}

function updateThresholdLabels(){
  correctThresholdValue.textContent=correctThresholdInput.value;
  incorrectThresholdValue.textContent=incorrectThresholdInput.value;
}

function getIndicatorSlotCount(){
  const thresholds=getThresholds();
  return Math.max(thresholds.correct,thresholds.incorrect);
}

function applyArithmeticMode(mode){
  arithmeticMode=ARITHMETIC_MODES.has(mode) ? mode : defaultSettings.mode;
  modeSelect.value=arithmeticMode;
}

function applyAdvancedSettingsVisibility(isVisible){
  advancedSettingsPanel.classList.toggle("hidden",!isVisible);
  advancedSections.classList.toggle("hidden",!isVisible);
  modeField.classList.toggle("hidden",!isVisible);
}

function applySettings(settings){
  startingIntervalInput.value=settings.startingInterval;
  minimumIntervalInput.value=settings.minimumInterval;
  intervalIncrementSelect.value=settings.intervalIncrement;
  correctThresholdInput.value=settings.correctThreshold;
  incorrectThresholdInput.value=settings.incorrectThreshold;
  durationInput.value=settings.duration;
  endConditionSelect.value=settings.endCondition;
  targetCorrectInput.value=settings.targetCorrect;
  applyArithmeticMode(settings.mode);
  selectedVoice=voiceLibrary[settings.voice] ? settings.voice : Object.keys(voiceLibrary)[0];
  voiceSelect.value=selectedVoice;
  playbackSpeedSelect.value=Math.max(1,Math.min(1.5,parseFloat(settings.playbackSpeed)||1));
  playbackSpeedValue.textContent=formatPlaybackSpeed(playbackSpeedSelect.value);
  beepToggle.checked=settings.beepEnabled;
  themeToggle.checked=settings.darkMode;
  showIntervalTimingToggle.checked=settings.showIntervalTiming;
  intervalIncrementValue.textContent=settings.intervalIncrement;
  updateThresholdLabels();
  currentInterval.textContent=settings.startingInterval;
  applyTheme(settings.darkMode);
  intervalIncrement=parseInt(intervalIncrementSelect.value)||parseInt(defaultSettings.intervalIncrement);
  playbackSpeed=parseFloat(playbackSpeedSelect.value)||1;
  showAdvancedSettingsToggle.checked=settings.showAdvancedSettings;
  applyAdvancedSettingsVisibility(settings.showAdvancedSettings);
  applyIntervalTimingVisibility(settings.showIntervalTiming);
  updateEndConditionControls();
}

function handleSettingsChange(){
  applyTheme(themeToggle.checked);
  applyArithmeticMode(modeSelect.value);
  selectedVoice=voiceSelect.value;
  intervalIncrement=parseInt(intervalIncrementSelect.value)||parseInt(defaultSettings.intervalIncrement);
  intervalIncrementValue.textContent=intervalIncrement;
  updateThresholdLabels();
  updateFeedbackUI();
  playbackSpeed=parseFloat(playbackSpeedSelect.value)||1;
  playbackSpeedValue.textContent=formatPlaybackSpeed(playbackSpeed);
  applyAdvancedSettingsVisibility(showAdvancedSettingsToggle.checked);
  applyIntervalTimingVisibility(showIntervalTimingToggle.checked);
  if(sessionState==="active"){
    void preloadVoice(selectedVoice).then(()=>{
      if(sessionState==="active"){
        retainOnlyVoiceCache(selectedVoice);
      }
    }).catch(()=>{});
  }
  updateEndConditionControls();
  saveSettings();
}

function applyIntervalTimingVisibility(isVisible){
  const wasVisible=showIntervalTiming;
  showIntervalTiming=isVisible;
  intervalStats.classList.toggle("hidden",!isVisible);
  if(resultsIntervalStatsWrap){
    resultsIntervalStatsWrap.classList.toggle("hidden",!isVisible);
  }
  if(!isVisible){
    if(wasVisible && gameRunning && currentIntervalStart){
      const now=getClockTime();
      if(interval !== startingInterval || intervalCounts[interval]){
        intervalTime[interval]=(intervalTime[interval]||0)+(now-currentIntervalStart);
      }
    }
    intervalStats.innerHTML="";
  }else if(gameRunning){
    currentIntervalStart=getClockTime();
  }
}

function updateEndConditionControls(){
  const isCorrectMode=endConditionSelect.value==="correct";
  durationInput.disabled=isCorrectMode;
  targetCorrectInput.disabled=!isCorrectMode;
  durationField.classList.toggle("locked",isCorrectMode);
  targetCorrectField.classList.toggle("locked",!isCorrectMode);
  durationField.setAttribute("aria-disabled",isCorrectMode);
  targetCorrectField.setAttribute("aria-disabled",!isCorrectMode);
}

function applyThresholdPreset(correct,incorrect){
  correctThresholdInput.value=String(correct);
  incorrectThresholdInput.value=String(incorrect);
  updateThresholdLabels();
  updateFeedbackUI();
  saveSettings();
}

function getExpectedAnswer(a,b){
  switch(arithmeticMode){
    case "multiplication":
      return a*b;
    case "subtraction":
      return a-b;
    case "difference":
      return Math.abs(a-b);
    case "addition":
    default:
      return a+b;
  }
}

const THRESHOLD_PRESETS={
  Balanced:{ correct:4, incorrect:4 },
  Strict:{ correct:5, incorrect:3 }
};

const HISTORY_FILTER_DEFS={
  status:{
    defaultValue:"all",
    values:new Set(["all","Completed","Manually exited"]),
    matches(session,value){
      return value==="all" || session.status===value;
    }
  },
  mode:{
    defaultValue:"all",
    values:new Set(["all","addition","multiplication","subtraction","difference"]),
    matches(session,value){
      return value==="all" || (session.arithmeticMode || defaultSettings.mode)===value;
    }
  },
  trendInclusion:{
    defaultValue:"all",
    values:new Set(["all","included","excluded"]),
    matches(session,value){
      if(value==="all") return true;
      return value==="included" ? session.includeInTrends===true : session.includeInTrends===false;
    }
  }
};

function getActiveHistoryFilterCount(){
  return Object.entries(historyFilters).reduce((count,[key,value])=>{
    const def=HISTORY_FILTER_DEFS[key];
    return count + (def && value!==def.defaultValue ? 1 : 0);
  },0);
}

function applyHistoryFilters(sessions,filters=historyFilters){
  return sessions.filter(session=>matchesHistoryFilters(session,filters));
}

function matchesHistoryFilters(session,filters=historyFilters){
  return Object.entries(filters).every(([key,value])=>{
    const def=HISTORY_FILTER_DEFS[key];
    if(!def) return true;
    return def.matches(session,value);
  });
}

function setHistoryChartMode(mode){
  if(!ARITHMETIC_MODES.has(mode)) return;
  historyChartMode=mode;
  historyChartModeIsUserSelected=true;
  if(historyChartModeSelect){
    historyChartModeSelect.value=mode;
  }
}

function ensureHistoryChartMode(fallbackMode){
  const resolvedFallback=ARITHMETIC_MODES.has(fallbackMode) ? fallbackMode : defaultSettings.mode;
  if(!historyChartModeIsUserSelected || !ARITHMETIC_MODES.has(historyChartMode)){
    historyChartMode=resolvedFallback;
  }
  const resolvedMode=ARITHMETIC_MODES.has(historyChartMode) ? historyChartMode : resolvedFallback;
  if(historyChartModeSelect){
    historyChartModeSelect.value=resolvedMode;
  }
  if(historyChartModeNote){
    historyChartModeNote.textContent=`Charts show ${formatArithmeticModeLabel(resolvedMode)} sessions only.`;
  }
  return resolvedMode;
}

function syncHistoryFilterControls(){
  historyStatusFilter.value=historyFilters.status;
  historyModeFilter.value=historyFilters.mode;
  historyTrendFilter.value=historyFilters.trendInclusion;
  historyFilterBtn.setAttribute("aria-expanded",String(historyFilterVisible));
  const activeFilterCount=getActiveHistoryFilterCount();
  if(historyFilterCountBadge){
    historyFilterCountBadge.textContent=String(activeFilterCount);
    historyFilterCountBadge.classList.toggle("hidden",activeFilterCount===0);
  }
}

function setHistoryFilterValue(key,value){
  if(!(key in historyFilters)) return;
  const def=HISTORY_FILTER_DEFS[key];
  const nextValue=def && def.values && def.values.has(value) ? value : def.defaultValue;
  historyFilters[key]=nextValue;
  historyPageIndex=0;
  syncHistoryFilterControls();
}

function resetHistoryFilters(){
  Object.entries(HISTORY_FILTER_DEFS).forEach(([key,def])=>{
    historyFilters[key]=def.defaultValue;
  });
  historyPageIndex=0;
  syncHistoryFilterControls();
}

function setHistoryPageIndex(pageIndex){
  historyPageIndex=Math.max(0,Math.floor(Number(pageIndex)||0));
}

function createEmptyHistoryPageData(){
  return {
    sessions:[],
    totalSessions:0,
    pageIndex:0,
    pageCount:0,
    pageSize:HISTORY_PAGE_SIZE,
    visibleStart:0,
    visibleEnd:0,
    hasPrevious:false,
    hasNext:false
  };
}

function createEmptyTrendData(){
  return {
    accuracyPoints:[],
    responsePoints:[]
  };
}

function toggleHistoryFiltersVisible(forceVisible){
  historyFilterVisible=typeof forceVisible==="boolean" ? forceVisible : !historyFilterVisible;
  historyFiltersPanel.classList.toggle("hidden",!historyFilterVisible);
  historyFilterBtn.setAttribute("aria-expanded",String(historyFilterVisible));
}

function getThresholdPresetName(correct,incorrect){
  const match=Object.entries(THRESHOLD_PRESETS).find(([,preset])=>preset.correct===correct && preset.incorrect===incorrect);
  return match?match[0]:"";
}

function formatThresholdSummary(correct,incorrect){
  const presetName=getThresholdPresetName(correct,incorrect);
  if(presetName) return presetName;
  return "Custom (" + correct + " / " + incorrect + ")";
}

function formatArithmeticModeLabel(mode){
  switch(mode){
    case "multiplication":
      return "Multiplication";
    case "subtraction":
      return "Subtraction";
    case "difference":
      return "Difference";
    case "addition":
    default:
      return "Addition";
  }
}

function getDefaultTrendInclusion(status){
  return status==="Manually exited" ? false : true;
}

function generateSessionId(){
  if(window.crypto && typeof window.crypto.randomUUID==="function"){
    return window.crypto.randomUUID();
  }
  return "session_" + Date.now() + "_" + Math.random().toString(36).slice(2,10);
}

function txDone(tx){
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror=()=>reject(tx.error || new Error("IndexedDB transaction failed"));
  });
}

function normalizeHistoryRecord(record){
  const startedAt=Number(record?.startedAt)||Number(record?.endedAt)||Date.now();
  const endedAt=Number(record?.endedAt)||startedAt;
  const durationMs=Number(record?.durationMs);
  const correctAnswers=Number(record?.correctAnswers)||0;
  const totalQuestionsAsked=Number(record?.totalQuestionsAsked)||0;
  const averageResponseTimeMs=Number(record?.averageResponseTimeMs)||0;
  const rawCorrectThreshold=record?.correctThreshold ?? record?.thresholds?.correct;
  const rawIncorrectThreshold=record?.incorrectThreshold ?? record?.thresholds?.incorrect;
  const rawMode=record?.arithmeticMode ?? record?.mode;
  const status=record?.status==="Manually exited" ? "Manually exited" : "Completed";
  const correctThreshold=coercePositiveNumber(rawCorrectThreshold,defaultSettings.correctThreshold);
  const incorrectThreshold=coercePositiveNumber(rawIncorrectThreshold,defaultSettings.incorrectThreshold);
  const accuracy=Number.isFinite(record?.accuracy)
    ? Number(record.accuracy)
    : (totalQuestionsAsked?correctAnswers/totalQuestionsAsked*100:0);
  const rawIncludeInTrends=record?.includeInTrends;
  const includeInTrends=typeof rawIncludeInTrends==="boolean"
    ? rawIncludeInTrends
    : getDefaultTrendInclusion(status);

  return {
    ...record,
    schemaVersion:1,
    sessionId:record?.sessionId || generateSessionId(),
    startedAt,
    endedAt,
    status,
    arithmeticMode:ARITHMETIC_MODES.has(rawMode) ? rawMode : defaultSettings.mode,
    endCondition:record?.endCondition || defaultSettings.endCondition,
    durationMs:Number.isFinite(durationMs) ? Math.max(0,durationMs) : Math.max(0,endedAt-startedAt),
    accuracy,
    correctAnswers,
    totalQuestionsAsked,
    averageResponseTimeMs,
    correctThreshold,
    incorrectThreshold,
    startingInterval:Math.max(100,Number(record?.startingInterval)||parseInt(defaultSettings.startingInterval)),
    minimumInterval:Math.max(100,Number(record?.minimumInterval)||parseInt(defaultSettings.minimumInterval)),
    intervalIncrement:Math.max(10,Number(record?.intervalIncrement)||parseInt(defaultSettings.intervalIncrement)),
    voice:record?.voice || defaultSettings.voice,
    playbackSpeed:Math.max(1,Math.min(1.5,Number(record?.playbackSpeed)||parseFloat(defaultSettings.playbackSpeed))),
    includeInTrends,
    thresholds:{
      correct:correctThreshold,
      incorrect:incorrectThreshold
    }
  };
}

function normalizeLatestTraceRecord(record){
  const trace=Array.isArray(record?.trace) ? record.trace : [];
  const normalizedTrace=trace
    .map((point,index)=>({
      questionNumber:Math.max(1,Number(point?.questionNumber)||index+1),
      interval:Math.max(1,Number(point?.interval)||0),
      timestamp:Number(point?.timestamp)||Number(record?.startedAt)||Date.now(),
      responseTime:point?.responseTime===null || point?.responseTime===undefined
        ? null
        : (Number.isFinite(Number(point?.responseTime)) ? Math.max(0,Number(point?.responseTime)) : null)
    }))
    .filter(point=>Number.isFinite(point.questionNumber) && Number.isFinite(point.interval));

  return {
    ...record,
    schemaVersion:1,
    id:"latest",
    sessionId:record?.sessionId || null,
    startedAt:Number(record?.startedAt)||Date.now(),
    endedAt:Number(record?.endedAt)||Number(record?.startedAt)||Date.now(),
    status:record?.status==="Manually exited" ? "Manually exited" : "Completed",
    totalQuestionsAsked:Math.max(0,Number(record?.totalQuestionsAsked)||0),
    trace:normalizedTrace
  };
}

const sessionHistoryStore=(()=>{
  const DB_NAME="cct-session-history";
  const DB_VERSION=4;
  const STORE_NAME="sessions";
  const TRACE_STORE_NAME="latestTrace";
  const TOTALS_STORE_NAME="historyTotals";
  const ENDED_AT_INDEX_NAME="endedAt";
  const fallbackSessions=[];
  let fallbackLatestTrace=null;
  let fallbackTotals={
    completedSessions:0,
    totalCorrectAnswers:0,
    totalDurationMs:0
  };
  const HISTORY_BACKUP_KEY="cct-session-history-backup";
  let hasBackupSnapshot=false;
  let backupMigrationPromise=null;
  let dbPromise=null;
  const supportsIndexedDB=typeof window.indexedDB!=="undefined";

  function loadBackupSnapshot(){
    try{
      const saved=window.localStorage.getItem(HISTORY_BACKUP_KEY);
      if(!saved) return null;
      const parsed=JSON.parse(saved);
      return {
        sessions:Array.isArray(parsed?.sessions) ? parsed.sessions.map(normalizeHistoryRecord) : [],
        latestTrace:parsed?.latestSessionTrace ? normalizeLatestTraceRecord(parsed.latestSessionTrace) : null,
        totals:parsed?.historyTotals ? normalizeTotalsRecord(parsed.historyTotals) : createEmptyTotals()
      };
    }catch(e){
      return null;
    }
  }

  function persistBackupSnapshot(){
    try{
      const snapshot={
        schemaVersion:1,
        exportedAt:new Date().toISOString(),
        sessions:fallbackSessions.map(normalizeHistoryRecord),
        latestSessionTrace:fallbackLatestTrace ? normalizeLatestTraceRecord(fallbackLatestTrace) : null,
        historyTotals:normalizeTotalsRecord(fallbackTotals)
      };
      window.localStorage.setItem(HISTORY_BACKUP_KEY,JSON.stringify(snapshot));
    }catch(e){}
  }

  const initialBackup=loadBackupSnapshot();
  if(initialBackup){
    fallbackSessions.push(...initialBackup.sessions);
    fallbackLatestTrace=initialBackup.latestTrace;
    fallbackTotals=initialBackup.totals;
    hasBackupSnapshot=!supportsIndexedDB;
  }

  async function migrateBackupSnapshotToIndexedDb(){
    if(!supportsIndexedDB || !hasBackupSnapshot) return;
    if(backupMigrationPromise) return backupMigrationPromise;

    backupMigrationPromise=(async()=>{
      try{
        const db=await openDb();
        const tx=db.transaction([STORE_NAME,TRACE_STORE_NAME,TOTALS_STORE_NAME],"readwrite");
        const sessionStore=tx.objectStore(STORE_NAME);
        fallbackSessions.forEach(session=>{
          sessionStore.put(normalizeHistoryRecord(session));
        });
        if(fallbackLatestTrace){
          tx.objectStore(TRACE_STORE_NAME).put(normalizeLatestTraceRecord(fallbackLatestTrace));
        }
        tx.objectStore(TOTALS_STORE_NAME).put(normalizeTotalsRecord(fallbackTotals));
        await txDone(tx);
        hasBackupSnapshot=false;
      }catch(e){}
      backupMigrationPromise=null;
    })();

    return backupMigrationPromise;
  }

  function upsertFallbackSession(session){
    const index=fallbackSessions.findIndex(item=>item.sessionId===session.sessionId);
    if(index>=0){
      fallbackSessions[index]=session;
    }else{
      fallbackSessions.unshift(session);
    }
  }

  async function openDb(){
    if(!supportsIndexedDB) return null;
    if(dbPromise) return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const request=window.indexedDB.open(DB_NAME,DB_VERSION);

      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)){
          db.createObjectStore(STORE_NAME,{ keyPath:"sessionId" });
        }
        const sessionStore=request.transaction.objectStore(STORE_NAME);
        if(!sessionStore.indexNames.contains(ENDED_AT_INDEX_NAME)){
          sessionStore.createIndex(ENDED_AT_INDEX_NAME,"endedAt",{ unique:false });
        }
        if(!db.objectStoreNames.contains(TRACE_STORE_NAME)){
          db.createObjectStore(TRACE_STORE_NAME,{ keyPath:"id" });
        }
        if(!db.objectStoreNames.contains(TOTALS_STORE_NAME)){
          db.createObjectStore(TOTALS_STORE_NAME,{ keyPath:"id" });
        }
      };

      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error || new Error("Failed to open IndexedDB"));
    });
    return dbPromise;
  }

  async function saveSession(record){
    const normalized=normalizeHistoryRecord(record);
    const previousSession=await getStoredSessionById(normalized.sessionId);
    const previousDelta=previousSession ? getSessionTotalsDelta(previousSession) : null;
    const nextDelta=getSessionTotalsDelta(normalized);
    if(!supportsIndexedDB){
      upsertFallbackSession(normalized);
      if(previousDelta){
        fallbackTotals=subtractTotals(fallbackTotals,previousDelta);
      }
      fallbackTotals=addTotals(fallbackTotals,nextDelta);
      persistBackupSnapshot();
      return normalized;
    }

    try{
      const db=await openDb();
      const currentTotals=await readStoredTotals();
      const adjustedTotals=previousDelta ? subtractTotals(currentTotals,previousDelta) : currentTotals;
      const updatedTotals=addTotals(adjustedTotals,nextDelta);
      const tx=db.transaction([STORE_NAME,TOTALS_STORE_NAME],"readwrite");
      tx.objectStore(STORE_NAME).put(normalized);
      tx.objectStore(TOTALS_STORE_NAME).put(updatedTotals);
      await txDone(tx);
    }catch(e){}
    upsertFallbackSession(normalized);
    if(previousDelta){
      fallbackTotals=subtractTotals(fallbackTotals,previousDelta);
    }
    fallbackTotals=addTotals(fallbackTotals,nextDelta);
    persistBackupSnapshot();
    return normalized;
  }

  async function getStoredSessionById(sessionId){
    if(!sessionId) return null;
    if(!supportsIndexedDB){
      return fallbackSessions.find(session=>session.sessionId===sessionId) || null;
    }

    await migrateBackupSnapshotToIndexedDb();
    if(hasBackupSnapshot){
      return fallbackSessions.find(session=>session.sessionId===sessionId) || null;
    }

    try{
      const db=await openDb();
      const tx=db.transaction(STORE_NAME,"readonly");
      const request=tx.objectStore(STORE_NAME).get(sessionId);
      const session=await new Promise((resolve,reject)=>{
        request.onsuccess=()=>resolve(request.result || null);
        request.onerror=()=>reject(request.error || new Error("Failed to read session"));
      });
      return session ? normalizeHistoryRecord(session) : null;
    }catch(e){
      return fallbackSessions.find(session=>session.sessionId===sessionId) || null;
    }
  }

  function getSortedFallbackSessions(){
    return fallbackSessions
      .map(normalizeHistoryRecord)
      .sort((a,b)=>Number(b.endedAt||0)-Number(a.endedAt||0));
  }

  function buildPagedSessionResult(sessions,pageIndex,pageSize){
    const totalSessions=sessions.length;
    const pageCount=totalSessions ? Math.ceil(totalSessions/pageSize) : 0;
    const resolvedPageIndex=pageCount ? Math.min(pageIndex,pageCount-1) : 0;
    const startIndex=pageCount ? resolvedPageIndex*pageSize : 0;
    const pageSessions=pageCount ? sessions.slice(startIndex,startIndex+pageSize) : [];
    const visibleStart=pageSessions.length ? startIndex + 1 : 0;
    const visibleEnd=pageSessions.length ? startIndex + pageSessions.length : 0;

    return {
      sessions:pageSessions,
      totalSessions,
      pageIndex:resolvedPageIndex,
      pageCount,
      pageSize,
      visibleStart,
      visibleEnd,
      hasPrevious:resolvedPageIndex>0,
      hasNext:pageCount>0 && resolvedPageIndex<pageCount-1
    };
  }

  async function getSessionPage({ filters=historyFilters, pageIndex=0, pageSize=HISTORY_PAGE_SIZE }={}){
    const safePageSize=Math.max(1,Math.floor(Number(pageSize)||HISTORY_PAGE_SIZE));
    const requestedPageIndex=Math.max(0,Math.floor(Number(pageIndex)||0));

    if(!supportsIndexedDB){
      const filtered=applyHistoryFilters(getSortedFallbackSessions(),filters);
      return buildPagedSessionResult(filtered,requestedPageIndex,safePageSize);
    }

    await migrateBackupSnapshotToIndexedDb();
    if(hasBackupSnapshot){
      const filtered=applyHistoryFilters(getSortedFallbackSessions(),filters);
      return buildPagedSessionResult(filtered,requestedPageIndex,safePageSize);
    }

    const readPagedSessions=async(pageIndexToUse)=>{
      const db=await openDb();
      const tx=db.transaction(STORE_NAME,"readonly");
      const source=tx.objectStore(STORE_NAME).index(ENDED_AT_INDEX_NAME);
      const pageStart=pageIndexToUse*safePageSize;
      const pageSessions=[];
      let totalSessions=0;

      await new Promise((resolve,reject)=>{
        const request=source.openCursor(null,"prev");
        request.onsuccess=()=>{
          const cursor=request.result;
          if(!cursor){
            resolve();
            return;
          }

          const session=normalizeHistoryRecord(cursor.value);
          if(matchesHistoryFilters(session,filters)){
            if(totalSessions>=pageStart && pageSessions.length<safePageSize){
              pageSessions.push(session);
            }
            totalSessions++;
          }
          cursor.continue();
        };
        request.onerror=()=>reject(request.error || new Error("Failed to read sessions"));
      });

      const pageCount=totalSessions ? Math.ceil(totalSessions/safePageSize) : 0;
      const visibleStart=pageSessions.length ? pageStart + 1 : 0;
      const visibleEnd=pageSessions.length ? pageStart + pageSessions.length : 0;

      return {
        sessions:pageSessions,
        totalSessions,
        pageIndex:pageIndexToUse,
        pageCount,
        pageSize:safePageSize,
        visibleStart,
        visibleEnd,
        hasPrevious:pageIndexToUse>0,
        hasNext:pageCount>0 && pageIndexToUse<pageCount-1
      };
    };

    try{
      const initialResult=await readPagedSessions(requestedPageIndex);
      if(initialResult.pageCount && initialResult.pageIndex>initialResult.pageCount-1){
        return readPagedSessions(initialResult.pageCount-1);
      }
      return initialResult;
    }catch(e){
      const filtered=applyHistoryFilters(getSortedFallbackSessions(),filters);
      return buildPagedSessionResult(filtered,requestedPageIndex,safePageSize);
    }
  }

  async function getMostRecentHistoryMode(){
    if(!supportsIndexedDB){
      const latestSession=getSortedFallbackSessions().find(session=>ARITHMETIC_MODES.has(session?.arithmeticMode));
      return latestSession ? latestSession.arithmeticMode : defaultSettings.mode;
    }

    await migrateBackupSnapshotToIndexedDb();
    if(hasBackupSnapshot){
      const latestSession=getSortedFallbackSessions().find(session=>ARITHMETIC_MODES.has(session?.arithmeticMode));
      return latestSession ? latestSession.arithmeticMode : defaultSettings.mode;
    }

    try{
      const db=await openDb();
      const tx=db.transaction(STORE_NAME,"readonly");
      const source=tx.objectStore(STORE_NAME).index(ENDED_AT_INDEX_NAME);
      const latestSession=await new Promise((resolve,reject)=>{
        const request=source.openCursor(null,"prev");
        request.onsuccess=()=>{
          const cursor=request.result;
          if(!cursor){
            resolve(null);
            return;
          }
          resolve(normalizeHistoryRecord(cursor.value));
        };
        request.onerror=()=>reject(request.error || new Error("Failed to read most recent session"));
      });
      return latestSession && ARITHMETIC_MODES.has(latestSession.arithmeticMode)
        ? latestSession.arithmeticMode
        : defaultSettings.mode;
    }catch(e){
      const latestSession=getSortedFallbackSessions().find(session=>ARITHMETIC_MODES.has(session?.arithmeticMode));
      return latestSession ? latestSession.arithmeticMode : defaultSettings.mode;
    }
  }

  async function getTrendData(mode){
    const resolvedMode=ARITHMETIC_MODES.has(mode) ? mode : defaultSettings.mode;
    if(!supportsIndexedDB){
      return buildTrendDataForSessions(getSortedFallbackSessions(),resolvedMode);
    }

    await migrateBackupSnapshotToIndexedDb();
    if(hasBackupSnapshot){
      return buildTrendDataForSessions(getSortedFallbackSessions(),resolvedMode);
    }

    try{
      const db=await openDb();
      const tx=db.transaction(STORE_NAME,"readonly");
      const source=tx.objectStore(STORE_NAME).index(ENDED_AT_INDEX_NAME);
      const accuracyBuckets=new Map();
      const responseBuckets=new Map();

      await new Promise((resolve,reject)=>{
        const request=source.openCursor(null,"prev");
        request.onsuccess=()=>{
          const cursor=request.result;
          if(!cursor){
            resolve();
            return;
          }

          const session=normalizeHistoryRecord(cursor.value);
          if(!isTrendEligibleSession(session) || !isSessionInMode(session,resolvedMode)){
            cursor.continue();
            return;
          }

          const weight=Math.max(1,Number(session.totalQuestionsAsked)||0);
          addDailyTrendBucket(accuracyBuckets,session,session.accuracy,weight);
          addDailyTrendBucket(responseBuckets,session,session.averageResponseTimeMs,weight);

          cursor.continue();
        };
        request.onerror=()=>reject(request.error || new Error("Failed to read trend data"));
      });

      const accuracyPoints=finalizeDailyTrendBuckets(accuracyBuckets);
      const responsePoints=finalizeDailyTrendBuckets(responseBuckets);

      return { accuracyPoints, responsePoints, mode:resolvedMode };
    }catch(e){
      return buildTrendDataForSessions(getSortedFallbackSessions(),resolvedMode);
    }
  }

  async function saveLatestTrace(record){
    const normalized=normalizeLatestTraceRecord(record);
    if(!supportsIndexedDB){
      fallbackLatestTrace=normalized;
      persistBackupSnapshot();
      return normalized;
    }

    try{
      const db=await openDb();
      const tx=db.transaction(TRACE_STORE_NAME,"readwrite");
      tx.objectStore(TRACE_STORE_NAME).put(normalized);
      await txDone(tx);
    }catch(e){}
    fallbackLatestTrace=normalized;
    persistBackupSnapshot();
    return normalized;
  }

  function createEmptyTotals(){
    return {
      id:"totals",
      schemaVersion:1,
      completedSessions:0,
      totalCorrectAnswers:0,
      totalDurationMs:0
    };
  }

  function normalizeTotalsRecord(record){
    const base=createEmptyTotals();
    if(!record) return base;
    return {
      ...base,
      ...record,
      id:"totals",
      schemaVersion:1,
      completedSessions:Math.max(0,Number(record.completedSessions)||0),
      totalCorrectAnswers:Math.max(0,Number(record.totalCorrectAnswers)||0),
      totalDurationMs:Math.max(0,Number(record.totalDurationMs)||0)
    };
  }

  function getSessionTotalsDelta(session){
    return {
      completedSessions:session?.status==="Completed" ? 1 : 0,
      totalCorrectAnswers:Number(session?.correctAnswers)||0,
      totalDurationMs:Number(session?.durationMs)||0
    };
  }

  function addTotals(base,delta){
    return normalizeTotalsRecord({
      ...base,
      completedSessions:(Number(base?.completedSessions)||0) + (Number(delta?.completedSessions)||0),
      totalCorrectAnswers:(Number(base?.totalCorrectAnswers)||0) + (Number(delta?.totalCorrectAnswers)||0),
      totalDurationMs:(Number(base?.totalDurationMs)||0) + (Number(delta?.totalDurationMs)||0)
    });
  }

  function subtractTotals(base,delta){
    return normalizeTotalsRecord({
      ...base,
      completedSessions:Math.max(0,(Number(base?.completedSessions)||0) - (Number(delta?.completedSessions)||0)),
      totalCorrectAnswers:Math.max(0,(Number(base?.totalCorrectAnswers)||0) - (Number(delta?.totalCorrectAnswers)||0)),
      totalDurationMs:Math.max(0,(Number(base?.totalDurationMs)||0) - (Number(delta?.totalDurationMs)||0))
    });
  }

  async function readStoredTotals(){
    if(!supportsIndexedDB){
      return normalizeTotalsRecord(fallbackTotals);
    }

    await migrateBackupSnapshotToIndexedDb();
    if(hasBackupSnapshot){
      return normalizeTotalsRecord(fallbackTotals);
    }

    try{
      const db=await openDb();
      const tx=db.transaction(TOTALS_STORE_NAME,"readonly");
      const request=tx.objectStore(TOTALS_STORE_NAME).get("totals");
      const totals=await new Promise((resolve,reject)=>{
        request.onsuccess=()=>resolve(request.result || null);
        request.onerror=()=>reject(request.error || new Error("Failed to read history totals"));
      });
      if(totals){
        fallbackTotals=normalizeTotalsRecord(totals);
        persistBackupSnapshot();
        return fallbackTotals;
      }
    }catch(e){}

    return normalizeTotalsRecord(fallbackTotals);
  }

  async function writeStoredTotals(totals){
    const normalized=normalizeTotalsRecord(totals);
    fallbackTotals=normalized;
    persistBackupSnapshot();
    if(!supportsIndexedDB){
      return normalized;
    }

    try{
      const db=await openDb();
      const tx=db.transaction(TOTALS_STORE_NAME,"readwrite");
      tx.objectStore(TOTALS_STORE_NAME).put(normalized);
      await txDone(tx);
    }catch(e){}
    return normalized;
  }

  async function replaceStoredTotalsWithSessions(sessions){
    const totals=sessions.reduce((acc,session)=>addTotals(acc,getSessionTotalsDelta(session)),createEmptyTotals());
    return writeStoredTotals(totals);
  }

  async function getAllSessions(){
    if(!supportsIndexedDB){
      return getSortedFallbackSessions();
    }

    await migrateBackupSnapshotToIndexedDb();
    if(hasBackupSnapshot){
      return getSortedFallbackSessions();
    }

    try{
      const db=await openDb();
      const tx=db.transaction(STORE_NAME,"readonly");
      const request=tx.objectStore(STORE_NAME).getAll();
      const sessions=await new Promise((resolve,reject)=>{
        request.onsuccess=()=>resolve(request.result || []);
        request.onerror=()=>reject(request.error || new Error("Failed to read history"));
      });
      if(sessions.length){
        fallbackSessions.length=0;
        fallbackSessions.push(...sessions.map(normalizeHistoryRecord));
        persistBackupSnapshot();
      }
      return sessions.map(normalizeHistoryRecord).sort((a,b)=>b.endedAt-a.endedAt);
    }catch(e){
      return getSortedFallbackSessions();
    }
  }

  async function getLatestTrace(){
    if(!supportsIndexedDB){
      return fallbackLatestTrace ? normalizeLatestTraceRecord(fallbackLatestTrace) : null;
    }

    await migrateBackupSnapshotToIndexedDb();
    if(hasBackupSnapshot){
      return fallbackLatestTrace ? normalizeLatestTraceRecord(fallbackLatestTrace) : null;
    }

    try{
      const db=await openDb();
      const tx=db.transaction(TRACE_STORE_NAME,"readonly");
      const request=tx.objectStore(TRACE_STORE_NAME).get("latest");
      const trace=await new Promise((resolve,reject)=>{
        request.onsuccess=()=>resolve(request.result || null);
        request.onerror=()=>reject(request.error || new Error("Failed to read latest trace"));
      });
      if(trace){
        fallbackLatestTrace=normalizeLatestTraceRecord(trace);
        persistBackupSnapshot();
      }
      return trace ? normalizeLatestTraceRecord(trace) : null;
    }catch(e){
      return fallbackLatestTrace ? normalizeLatestTraceRecord(fallbackLatestTrace) : null;
    }
  }

  async function clearAll(){
    if(!supportsIndexedDB){
      fallbackSessions.length=0;
      fallbackLatestTrace=null;
      fallbackTotals=createEmptyTotals();
      persistBackupSnapshot();
      return;
    }

    try{
      const db=await openDb();
      const tx=db.transaction([STORE_NAME,TRACE_STORE_NAME,TOTALS_STORE_NAME],"readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(TRACE_STORE_NAME).clear();
      tx.objectStore(TOTALS_STORE_NAME).clear();
      await txDone(tx);
    }catch(e){}
    fallbackSessions.length=0;
    fallbackLatestTrace=null;
    fallbackTotals=createEmptyTotals();
    persistBackupSnapshot();
  }

  async function clearSessionsOnly(){
    if(!supportsIndexedDB){
      fallbackSessions.length=0;
      fallbackLatestTrace=null;
      persistBackupSnapshot();
      return;
    }

    try{
      const db=await openDb();
      const tx=db.transaction([STORE_NAME,TRACE_STORE_NAME],"readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(TRACE_STORE_NAME).clear();
      await txDone(tx);
    }catch(e){}
    fallbackSessions.length=0;
    fallbackLatestTrace=null;
    persistBackupSnapshot();
  }

  async function importData(payload){
    const source=Array.isArray(payload) ? payload : (Array.isArray(payload?.sessions) ? payload.sessions : []);
    const sessions=source.map(normalizeHistoryRecord);
    const latestTracePayload=payload?.latestSessionTrace ?? payload?.latestTrace ?? null;
    const latestTrace=latestTracePayload ? normalizeLatestTraceRecord(latestTracePayload) : null;
    const totalsPayload=payload?.historyTotals ?? payload?.totals ?? null;
    const totals=totalsPayload ? normalizeTotalsRecord(totalsPayload) : null;

    if(!supportsIndexedDB){
      const existingSessions=new Map(fallbackSessions.map(session=>[session.sessionId,session]));
      sessions.forEach(session=>{
        upsertFallbackSession(session);
        existingSessions.set(session.sessionId,session);
      });
      if(latestTrace) fallbackLatestTrace=latestTrace;
      if(totals && sessions.length===0){
        fallbackTotals=totals;
      }else{
        let mergedTotals=normalizeTotalsRecord(fallbackTotals);
        sessions.forEach(session=>{
          const previous=existingSessions.get(session.sessionId);
          if(previous){
            mergedTotals=subtractTotals(mergedTotals,getSessionTotalsDelta(previous));
          }
          mergedTotals=addTotals(mergedTotals,getSessionTotalsDelta(session));
          existingSessions.set(session.sessionId,session);
        });
        fallbackTotals=mergedTotals;
      }
      persistBackupSnapshot();
      return sessions.length;
    }

    const currentSessions=await getAllSessions();
    const currentSessionsById=new Map(currentSessions.map(session=>[session.sessionId,session]));
    const currentTotals=await readStoredTotals();
    let mergedTotals=totals && sessions.length===0 ? totals : currentTotals;

    if(!totals || sessions.length>0){
      sessions.forEach(session=>{
        const previous=currentSessionsById.get(session.sessionId);
        if(previous){
          mergedTotals=subtractTotals(mergedTotals,getSessionTotalsDelta(previous));
        }
        mergedTotals=addTotals(mergedTotals,getSessionTotalsDelta(session));
        currentSessionsById.set(session.sessionId,session);
      });
    }

    const db=await openDb();
    const tx=db.transaction([STORE_NAME,TRACE_STORE_NAME,TOTALS_STORE_NAME],"readwrite");
    const store=tx.objectStore(STORE_NAME);
    sessions.forEach(session=>store.put(session));
    if(latestTrace){
      tx.objectStore(TRACE_STORE_NAME).put(latestTrace);
    }
    tx.objectStore(TOTALS_STORE_NAME).put(mergedTotals);
    await txDone(tx);
    fallbackSessions.length=0;
    fallbackSessions.push(...sessions.map(normalizeHistoryRecord), ...currentSessions.filter(session=>!sessions.some(next=>next.sessionId===session.sessionId)));
    fallbackLatestTrace=latestTrace || fallbackLatestTrace;
    fallbackTotals=normalizeTotalsRecord(mergedTotals);
    persistBackupSnapshot();
    return sessions.length;
  }

  async function exportData(){
    const sessions=await getAllSessions();
    const latestSessionTrace=await getLatestTrace();
    const historyTotals=await readStoredTotals();
    return {
      schemaVersion:1,
      exportedAt:new Date().toISOString(),
      sessions,
      latestSessionTrace,
      historyTotals
    };
  }

  async function getStats(){
    const historyTotals=await readStoredTotals();

    return {
      completedSessions:historyTotals.completedSessions,
      totalCorrectAnswers:historyTotals.totalCorrectAnswers,
      totalDurationMs:historyTotals.totalDurationMs
    };
  }

  return {
    saveSession,
    saveLatestTrace,
    getAllSessions,
    getLatestTrace,
    getMostRecentHistoryMode,
    getSessionPage,
    getTrendData,
    clearAll,
    clearSessionsOnly,
    importData,
    exportData,
    getStats
  };
})();

function buildSessionRecord(){
  const totalItems=feedback.length;
  const totalResponseTime=responseTimes.reduce((sum,time)=>sum+time,0);
  const totalQuestionsAsked=Math.max(0,totalItems-(excludeLastQuestionFromCount?1:0));
  const thresholds=getThresholds();

  return normalizeHistoryRecord({
    sessionId:currentSessionId || generateSessionId(),
    startedAt:sessionStartedAt,
    endedAt:sessionEndedAt,
    status:sessionOutcome,
    arithmeticMode,
    endCondition,
    durationMs:Math.max(0,sessionEndedAt-sessionStartedAt),
    accuracy:totalItems?correctAnswers/totalItems*100:0,
    correctAnswers,
    totalQuestionsAsked,
    averageResponseTimeMs:totalItems?totalResponseTime/totalItems:0,
    correctThreshold:thresholds.correct,
    incorrectThreshold:thresholds.incorrect,
    startingInterval,
    minimumInterval,
    intervalIncrement,
    voice:selectedVoice,
    playbackSpeed,
    includeInTrends:sessionOutcome!=="Manually exited"
  });
}

function buildLatestTraceRecord(){
  const trimmedTrace=sessionIntervalTrace
    .slice(2,Math.max(2,sessionIntervalTrace.length-(excludeLastQuestionFromCount ? 1 : 0)))
    .map((point,index)=>({
      questionNumber:index+1,
      interval:point.interval,
      timestamp:point.timestamp,
      responseTime:point.responseTime
    }));
  const totalQuestionsAsked=trimmedTrace.length;
  return normalizeLatestTraceRecord({
    sessionId:currentSessionId || generateSessionId(),
    startedAt:sessionStartedAt,
    endedAt:sessionEndedAt,
    status:sessionOutcome,
    totalQuestionsAsked,
    trace:trimmedTrace
  });
}

function shouldStoreSession(record){
  const durationMs=Number(record?.durationMs)||0;
  const correctAnswersCount=Number(record?.correctAnswers)||0;
  return durationMs>=30000 && correctAnswersCount>=10;
}

function formatSessionDateTime(timestamp){
  return new Intl.DateTimeFormat(undefined,{
    dateStyle:"medium",
    timeStyle:"short"
  }).format(new Date(timestamp));
}

function escapeSvgText(value){
  return String(value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

function getLabelIndices(count,maxLabels){
  if(count<=0) return [];
  if(count<=maxLabels) return Array.from({ length: count }, (_,index)=>index);

  const indices=[0,count-1];
  const steps=maxLabels-1;
  const span=count-1;

  for(let i=1;i<steps;i++){
    indices.push(Math.round((span/steps)*i));
  }

  return [...new Set(indices)].sort((a,b)=>a-b);
}

function getQuestionLabelIndices(count){
  if(count<=0) return [];
  if(count===1) return [0];

  const desiredLabels=count<=50 ? 7 : count<=200 ? 8 : count<=1000 ? 9 : 10;
  const rawStep=Math.max(1,Math.ceil(count/desiredLabels));
  const niceSteps=[1,2,5,10,20,50,100,200,500,1000];
  const step=niceSteps.find(value=>value>=rawStep) || niceSteps[niceSteps.length-1];
  const indices=[0];

  for(let questionNumber=step; questionNumber<count; questionNumber+=step){
    indices.push(questionNumber-1);
  }

  indices.push(count-1);
  return [...new Set(indices)].sort((a,b)=>a-b);
}

function formatChartDateLabel(timestamp,includeYear=false){
  const options={ month:"short", day:"numeric" };
  if(includeYear) options.year="numeric";
  return new Intl.DateTimeFormat(undefined,options).format(new Date(timestamp));
}

function getLocalCalendarDayKey(timestamp){
  const date=new Date(Number(timestamp)||0);
  return [
    date.getFullYear(),
    String(date.getMonth()+1).padStart(2,"0"),
    String(date.getDate()).padStart(2,"0")
  ].join("-");
}

function getLocalCalendarDayStart(timestamp){
  const date=new Date(Number(timestamp)||0);
  return new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
}

function addDailyTrendBucket(buckets,session,value,weight){
  const numericValue=Number(value);
  const numericWeight=Number(weight);
  if(!Number.isFinite(numericValue) || !Number.isFinite(numericWeight) || numericWeight<=0) return;

  const timestamp=Number(session?.endedAt || session?.startedAt || Date.now());
  const dayKey=getLocalCalendarDayKey(timestamp);
  const dayStart=getLocalCalendarDayStart(timestamp);
  const bucket=buckets.get(dayKey) || {
    dayKey,
    dayStart,
    total:0,
    weightTotal:0,
    count:0
  };

  bucket.total += numericValue * numericWeight;
  bucket.weightTotal += numericWeight;
  bucket.count += 1;
  bucket.dayStart=Math.min(bucket.dayStart,dayStart);
  buckets.set(dayKey,bucket);
}

function finalizeDailyTrendBuckets(buckets){
  return [...buckets.values()]
    .sort((a,b)=>a.dayStart-b.dayStart)
    .map(bucket=>({
      dayKey:bucket.dayKey,
      dayStart:bucket.dayStart,
      value:bucket.weightTotal ? bucket.total / bucket.weightTotal : 0,
      count:bucket.count,
      weightTotal:bucket.weightTotal,
      label:formatChartDateLabel(bucket.dayStart,false)
    }));
}

function aggregateSessionsByDay(sessions,valueGetter,weightGetter){
  const buckets=new Map();

  sessions.forEach(session=>{
    const weight=Number(weightGetter ? weightGetter(session) : 1);
    addDailyTrendBucket(buckets,session,valueGetter(session),weight);
  });

  return finalizeDailyTrendBuckets(buckets);
}

function isTrendEligibleSession(session){
  return session?.includeInTrends!==false;
}

function isSessionInMode(session,mode){
  return (session?.arithmeticMode || defaultSettings.mode)===mode;
}

function buildTrendDataForSessions(sessions,mode){
  const filteredSessions=sessions.filter(session=>isTrendEligibleSession(session) && isSessionInMode(session,mode));
  return {
    accuracyPoints:aggregateSessionsByDay(
      filteredSessions,
      session=>Number(session.accuracy),
      session=>Number(session.totalQuestionsAsked)
    ),
    responsePoints:aggregateSessionsByDay(
      filteredSessions,
      session=>Number(session.averageResponseTimeMs),
      session=>Number(session.totalQuestionsAsked)
    ),
    mode
  };
}

function getDailyTrendLabelCount(pointCount){
  if(pointCount<=7) return pointCount;
  if(pointCount<=14) return 6;
  if(pointCount<=30) return 7;
  if(pointCount<=90) return 8;
  return 9;
}

function formatChartValue(value,unit=""){
  const rounded=Math.round(Number(value)||0);
  return rounded.toLocaleString() + unit;
}

function formatChartExactValue(value,unit=""){
  const num=Number(value);
  if(!Number.isFinite(num)) return "0" + unit;
  const digits=Number.isInteger(num) ? 0 : 2;
  return num.toLocaleString(undefined,{
    minimumFractionDigits:0,
    maximumFractionDigits:digits
  }) + unit;
}

const chartInteractionState=new Map();
const latestIntervalChartViewState={
  mode:"overview",
  blockIndex:null,
  sessionKey:null
};
let latestHistoryChartContext={
  stats:null,
  latestTrace:null
};

function getChartThemeColors(){
  const styles=getComputedStyle(document.documentElement);
  return {
    accent:styles.getPropertyValue("--accent").trim() || "#2563eb",
    surface:styles.getPropertyValue("--surface").trim() || "#ffffff",
    text:styles.getPropertyValue("--text").trim() || "#17202a",
    muted:styles.getPropertyValue("--muted").trim() || "#5f6b7a",
    border:styles.getPropertyValue("--border").trim() || "#d7dde5"
  };
}

function getChartState(container){
  const key=container.id || container;
  if(!chartInteractionState.has(key)){
    chartInteractionState.set(key,{
      selectedIndex:null,
      hoverIndex:null,
      selectedAnchor:null,
      hoverAnchor:null,
      detailsEl:null,
      points:[],
      chartKey:key,
      boundHandlers:null
    });
  }
  return chartInteractionState.get(key);
}

function ensureChartTooltip(container,detailsEl){
  if(!detailsEl) return null;
  if(detailsEl.parentElement!==container){
    container.appendChild(detailsEl);
  }
  detailsEl.classList.add("chart-tooltip");
  return detailsEl;
}

function ensureChartSurface(container){
  let surface=[...container.children].find(child=>child.classList && child.classList.contains("chart-surface")) || null;
  if(!surface){
    surface=document.createElement("div");
    surface.className="chart-surface";
    const detailsEl=container.querySelector(".chart-tooltip");
    if(detailsEl && detailsEl.parentElement===container){
      container.insertBefore(surface,detailsEl);
    }else{
      container.appendChild(surface);
    }
  }
  return surface;
}

function getChartTooltipPosition(point){
  const x=Number(point?.xPercent);
  const y=Number(point?.yPercent);
  const safeX=Number.isFinite(x) ? Math.max(0,Math.min(100,x)) : 50;
  const safeY=Number.isFinite(y) ? Math.max(0,Math.min(100,y)) : 50;
  const placementY=safeY > 60 ? "top" : "bottom";
  let placementX="center";
  if(safeX < 22){
    placementX="left";
  }else if(safeX > 78){
    placementX="right";
  }
  let transform="translate(-50%, calc(-100% - 10px))";
  if(placementX==="left" && placementY==="top"){
    transform="translate(0, calc(-100% - 10px))";
  }else if(placementX==="right" && placementY==="top"){
    transform="translate(-100%, calc(-100% - 10px))";
  }else if(placementX==="left" && placementY==="bottom"){
    transform="translate(0, 10px)";
  }else if(placementX==="right" && placementY==="bottom"){
    transform="translate(-100%, 10px)";
  }else if(placementY==="bottom"){
    transform="translate(-50%, 10px)";
  }
  return {
    left: `${safeX}%`,
    top: `${safeY}%`,
    transform
  };
}

function buildChartPointDetail(point,config,index){
  if(!point) return config.emptyDetailMessage || "Hover, tap, or click a point to inspect it.";

  const xLabelName=config.xDetailLabel || "X";
  const yLabelName=config.yDetailLabel || "Y";
  const summary=point.summary || `${xLabelName} ${index + 1}`;

  if(Array.isArray(point.seriesValues) && point.seriesValues.length){
    if(config.showExactPointDetails){
      const rows=point.seriesValues
        .filter(series=>series && (series.exactLabel || series.displayLabel))
        .map(series=>{
          const color=escapeSvgText(series.color || "var(--accent)");
          return `
            <div class="chart-tooltip-row">
              <span><span class="chart-tooltip-swatch" style="background:${color}"></span>${escapeSvgText(series.label || "Value")}</span>
              <strong>${escapeSvgText(series.exactLabel || series.displayLabel || "")}</strong>
            </div>
          `;
        })
        .join("");
      return `
        <div class="chart-tooltip-title">${escapeSvgText(summary)}</div>
        <div class="chart-tooltip-row"><span>${escapeSvgText(xLabelName)}</span><strong>${escapeSvgText(point.xExactLabel || point.xDisplayLabel || "")}</strong></div>
        ${rows}
      `;
    }

    const rows=point.seriesValues
      .filter(series=>series && (series.exactLabel || series.displayLabel))
      .map(series=>{
        const color=escapeSvgText(series.color || "var(--accent)");
        return `
          <div class="chart-tooltip-row">
            <span><span class="chart-tooltip-swatch" style="background:${color}"></span>${escapeSvgText(series.label || "Value")}</span>
            <strong>${escapeSvgText(series.exactLabel || series.displayLabel || "")}</strong>
          </div>
        `;
      })
      .join("");
    return `
      <div class="chart-tooltip-title">${escapeSvgText(summary)}</div>
      ${rows}
    `;
  }

  return `
    <div class="chart-tooltip-title">${escapeSvgText(summary)}</div>
    <div class="chart-tooltip-row"><span>${escapeSvgText(xLabelName)}</span><strong>${escapeSvgText(point.xExactLabel || point.xDisplayLabel || "")}</strong></div>
    <div class="chart-tooltip-row"><span>${escapeSvgText(yLabelName)}</span><strong>${escapeSvgText(point.yExactLabel || point.yDisplayLabel || "")}</strong></div>
  `;
}

function applyChartState(container,config){
  const state=getChartState(container);
  const circles=[...container.querySelectorAll("circle.chart-point")];
  const detailsEl=container.id ? document.getElementById(container.id.replace(/Chart$/,"Details")) : null;
  state.detailsEl=ensureChartTooltip(container,detailsEl);
  state.points=config.pointMeta || [];

  if(state.selectedIndex!==null && state.selectedIndex>=circles.length){
    state.selectedIndex=null;
  }

  if(state.hoverIndex!==null && state.hoverIndex>=circles.length){
    state.hoverIndex=null;
  }

  const colors=getChartThemeColors();
  const multiSeries=Array.isArray(config.series) && config.series.length>1;
  const baseRadius=Number.isFinite(Number(config.pointRadius)) ? Math.max(0,Number(config.pointRadius)) : 4.5;
  const hoverRadius=Number.isFinite(Number(config.pointHoverRadius)) ? Math.max(baseRadius,Number(config.pointHoverRadius)) : baseRadius + 1.2;
  const selectedRadius=Number.isFinite(Number(config.pointSelectedRadius)) ? Math.max(hoverRadius,Number(config.pointSelectedRadius)) : baseRadius + 2.2;
  circles.forEach((circle,index)=>{
    const circleIndex=Number(circle.dataset.pointIndex);
    const isSelected=circleIndex===state.selectedIndex;
    const isHovered=!isSelected && circleIndex===state.hoverIndex;
    const active=isSelected || isHovered;
    const radius=isSelected ? selectedRadius : isHovered ? hoverRadius : baseRadius;
    const seriesIndex=Number(circle.dataset.seriesIndex);
    const seriesColor=multiSeries && config.series && config.series[seriesIndex]
      ? (config.series[seriesIndex].lineColor || config.series[seriesIndex].pointStroke || colors.accent)
      : colors.accent;

    circle.setAttribute("r",String(radius));
    if(multiSeries){
      circle.setAttribute("fill",active ? seriesColor : colors.surface);
      circle.setAttribute("stroke",active ? colors.surface : seriesColor);
    }else{
      circle.setAttribute("fill",active ? colors.accent : colors.surface);
      circle.setAttribute("stroke",active ? colors.surface : colors.accent);
    }
    circle.setAttribute("stroke-width",isSelected ? "3" : isHovered ? "2.5" : "2");
    circle.setAttribute("opacity",active ? "1" : "0.95");
    circle.style.cursor="pointer";
    circle.classList.toggle("is-selected",isSelected);
    circle.classList.toggle("is-hovered",isHovered);
  });

  if(detailsEl){
    const activeIndex=state.hoverIndex!==null ? state.hoverIndex : state.selectedIndex;
    const activePoint=activeIndex!==null ? state.points[activeIndex] : null;
    const tooltipEl=state.detailsEl;
    if(tooltipEl){
      tooltipEl.hidden=!activePoint;
      tooltipEl.innerHTML=buildChartPointDetail(activePoint,config,activeIndex===null ? 0 : activeIndex);
      if(activePoint){
        const activeAnchor=state.hoverAnchor || state.selectedAnchor || activePoint;
        const position=getChartTooltipPosition(activeAnchor);
        tooltipEl.style.setProperty("--chart-tooltip-left",position.left);
        tooltipEl.style.setProperty("--chart-tooltip-top",position.top);
        tooltipEl.style.setProperty("--chart-tooltip-transform",position.transform);
      }
    }
  }
}

function bindChartInteractions(container,config){
  const state=getChartState(container);
  if(state.boundHandlers){
    container.removeEventListener("pointermove",state.boundHandlers.pointermove);
    container.removeEventListener("pointerdown",state.boundHandlers.pointerdown);
    container.removeEventListener("pointerleave",state.boundHandlers.pointerleave);
    container.removeEventListener("pointercancel",state.boundHandlers.pointerleave);
  }
  state.selectedIndex=null;
  state.hoverIndex=null;
  state.selectedAnchor=null;
  state.hoverAnchor=null;

  const getLiveCircleHit=event=>{
    const circles=[...container.querySelectorAll("circle.chart-point")].filter(circle=>circle.isConnected);
    if(!circles.length) return null;

    let nearest=null;
    let nearestDistance=Infinity;
    circles.forEach(circle=>{
      const rect=circle.getBoundingClientRect();
      if(!rect.width && !rect.height) return;
      const centerX=rect.left + rect.width/2;
      const centerY=rect.top + rect.height/2;
      const distance=Math.hypot(centerX-event.clientX,centerY-event.clientY);
      if(distance<nearestDistance){
        nearestDistance=distance;
        nearest={ circle, distance, centerX, centerY };
      }
    });

    const radius=nearest?.circle ? Number(nearest.circle.getAttribute("r")) || 4.5 : 4.5;
    const hitRadius=Math.max(14,radius*3);
    if(!nearest || nearestDistance>hitRadius) return null;

    const index=Number(nearest.circle.dataset.pointIndex);
    if(!Number.isFinite(index)) return null;
    return {
      index,
      centerX:nearest.centerX,
      centerY:nearest.centerY
    };
  };

  const getAnchorFromHit=hit=>{
    if(!hit) return null;
    const rect=container.getBoundingClientRect();
    if(!rect.width || !rect.height) return null;
    return {
      xPercent:((hit.centerX-rect.left)/rect.width)*100,
      yPercent:((hit.centerY-rect.top)/rect.height)*100
    };
  };

  const handlePointerMove=event=>{
    const hit=getLiveCircleHit(event);
    if(!hit){
      if(getChartState(container).hoverIndex!==null){
        clearChartHover(container,config);
      }
      return;
    }

    const currentState=getChartState(container);
    if(currentState.hoverIndex===hit.index){
      return;
    }
    setChartHover(container,hit.index,config,getAnchorFromHit(hit));
  };

  const handlePointerDown=event=>{
    const hit=getLiveCircleHit(event);
    if(!hit){
      clearChartSelection(container,config);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const anchor=getAnchorFromHit(hit);
    setChartSelection(container,hit.index,config,anchor);
    if(typeof config.onPointSelect==="function"){
      config.onPointSelect(hit.index,anchor,event);
    }
  };

  const handlePointerLeave=()=>{
    const currentState=getChartState(container);
    if(currentState.selectedIndex===null){
      clearChartHover(container,config);
      return;
    }
    currentState.hoverIndex=null;
    currentState.hoverAnchor=null;
    applyChartState(container,config);
  };

  state.boundHandlers={
    pointermove:handlePointerMove,
    pointerdown:handlePointerDown,
    pointerleave:handlePointerLeave
  };

  container.addEventListener("pointermove",handlePointerMove);
  container.addEventListener("pointerdown",handlePointerDown);
  container.addEventListener("pointerleave",handlePointerLeave);
  container.addEventListener("pointercancel",handlePointerLeave);
}

function clearChartInteractions(container){
  const state=getChartState(container);
  if(state.boundHandlers){
    container.removeEventListener("pointermove",state.boundHandlers.pointermove);
    container.removeEventListener("pointerdown",state.boundHandlers.pointerdown);
    container.removeEventListener("pointerleave",state.boundHandlers.pointerleave);
    container.removeEventListener("pointercancel",state.boundHandlers.pointerleave);
    state.boundHandlers=null;
  }
  state.selectedIndex=null;
  state.hoverIndex=null;
  state.selectedAnchor=null;
  state.hoverAnchor=null;
  state.points=[];
}

function setChartHover(container,index,config,anchor=null){
  const state=getChartState(container);
  state.hoverIndex=index;
  state.hoverAnchor=anchor;
  applyChartState(container,config);
}

function setChartSelection(container,index,config,anchor=null){
  const state=getChartState(container);
  state.selectedIndex=index;
  state.hoverIndex=index;
  state.selectedAnchor=anchor;
  state.hoverAnchor=anchor;
  applyChartState(container,config);
}

function clearChartHover(container,config){
  const state=getChartState(container);
  state.hoverIndex=null;
  state.hoverAnchor=null;
  applyChartState(container,config);
}

function clearChartSelection(container,config){
  const state=getChartState(container);
  state.selectedIndex=null;
  state.hoverIndex=null;
  state.selectedAnchor=null;
  state.hoverAnchor=null;
  applyChartState(container,config);
}

function buildChartPath(points){
  let path="";
  let started=false;
  points.forEach(point=>{
    if(!point){
      started=false;
      return;
    }
    path += `${started ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)} `;
    started=true;
  });
  return path.trim();
}

function getNiceMsTicks(min,max,desiredTickCount=5){
  const safeMin=Number.isFinite(min) ? min : 0;
  const safeMax=Number.isFinite(max) ? max : safeMin + 1;
  const range=Math.max(1,safeMax-safeMin);
  const rawStep=range/Math.max(1,desiredTickCount);
  const preferredStep=Math.max(100,Math.ceil(rawStep/100)*100);
  const tickStep=preferredStep;
  const tickMin=Math.floor(safeMin/tickStep)*tickStep;
  const tickMax=Math.ceil(safeMax/tickStep)*tickStep;
  const ticks=[];

  for(let value=tickMin; value<=tickMax + tickStep/2; value+=tickStep){
    ticks.push(value);
  }

  return { ticks, tickStep, tickMin, tickMax };
}

function getLatestIntervalTargetBlockCount(chartWidth=720){
  const usableWidth=Math.max(320,chartWidth-140);
  return Math.max(22,Math.min(60,Math.round(usableWidth/13)));
}

function getLatestIntervalBlockSize(pointCount,chartWidth=720){
  if(pointCount<=75) return 1;

  const targetBlocks=getLatestIntervalTargetBlockCount(chartWidth);
  const rawStep=Math.max(1,Math.ceil(pointCount/targetBlocks));
  const niceSteps=[2,3,4,5,6,8,10,12,15,20,25,30,40,50,75,100,125,150,200,250,300,400,500,750,1000,1500,2000,2500,5000];
  return niceSteps.find(value=>value>=rawStep) || niceSteps[niceSteps.length-1];
}

function getLatestIntervalSessionKey(latestTrace){
  return latestTrace?.sessionId || `${Number(latestTrace?.startedAt)||0}-${Number(latestTrace?.endedAt)||0}`;
}

function buildLatestIntervalOverviewBlocks(tracePoints,chartWidth=720){
  const pointCount=tracePoints.length;
  const blockSize=getLatestIntervalBlockSize(pointCount,chartWidth);
  const blocks=[];

  for(let start=0; start<pointCount; start+=blockSize){
    const slice=tracePoints.slice(start,start+blockSize);
    const intervalValues=slice.map(point=>Number(point.interval)).filter(Number.isFinite);
    const responseValues=slice
      .map(point=>Number(point.responseTime))
      .filter(Number.isFinite);
    const intervalAverage=intervalValues.length
      ? intervalValues.reduce((sum,value)=>sum+value,0)/intervalValues.length
      : NaN;
    const responseAverage=responseValues.length
      ? responseValues.reduce((sum,value)=>sum+value,0)/responseValues.length
      : NaN;
    const startQuestion=Number(slice[0]?.questionNumber)||start+1;
    const endQuestion=Number(slice[slice.length-1]?.questionNumber)||start+slice.length;

    blocks.push({
      startIndex:start,
      endIndex:start + slice.length - 1,
      startQuestion,
      endQuestion,
      blockSize:slice.length,
      interval:intervalAverage,
      responseTime:responseAverage,
      summary:startQuestion===endQuestion
        ? `Question ${startQuestion}`
        : `Questions ${startQuestion}-${endQuestion}`,
      rangeLabel:startQuestion===endQuestion
        ? `${startQuestion}`
        : `${startQuestion}-${endQuestion}`,
      intervalLabel:Number.isFinite(intervalAverage) ? formatChartExactValue(intervalAverage," ms") : "n/a",
      responseLabel:Number.isFinite(responseAverage) ? formatChartExactValue(responseAverage," ms") : "n/a"
    });
  }

  return { blockSize, blocks };
}

function buildLatestIntervalDetailPoints(tracePoints,block){
  if(!block) return [];
  return tracePoints.slice(block.startIndex,block.endIndex + 1).map((point,index)=>({
    questionNumber:Number(point.questionNumber)||block.startQuestion + index,
    interval:Number(point.interval),
    responseTime:Number(point.responseTime),
    timestamp:Number(point.timestamp)||0
  }));
}

function setLatestIntervalChartMode(mode,blockIndex=null){
  latestIntervalChartViewState.mode=mode;
  latestIntervalChartViewState.blockIndex=blockIndex;
}

function syncLatestIntervalChartSession(latestTrace){
  const traceSessionKey=getLatestIntervalSessionKey(latestTrace);
  if(latestIntervalChartViewState.sessionKey===traceSessionKey) return false;
  latestIntervalChartViewState.sessionKey=traceSessionKey;
  setLatestIntervalChartMode("overview",null);
  clearChartInteractions(latestIntervalChart);
  return true;
}

function renderLatestIntervalChartEmptyState(message){
  clearChartInteractions(latestIntervalChart);
  ensureChartSurface(latestIntervalChart).innerHTML=`<div class="chart-empty">${escapeSvgText(message)}</div>`;
  latestIntervalBackBtn.classList.add("hidden");
  if(latestIntervalCaption){
    latestIntervalCaption.textContent=message;
  }
  if(latestIntervalDetails){
    latestIntervalDetails.hidden=true;
    latestIntervalDetails.innerHTML="";
  }
}

function renderLatestIntervalChartOverview(latestTrace,overviewData){
  const overviewPointMeta=overviewData.blocks.map(block=>({
    xExactLabel:block.summary,
    summary:block.summary,
    seriesValues:[
      {
        label:"Interval avg",
        exactLabel:block.intervalLabel,
        color:"var(--accent)"
      },
      {
        label:"Response avg",
        exactLabel:block.responseLabel,
        color:"var(--good)"
      }
    ].filter(series=>series.exactLabel)
  }));

  const overviewIntervalValues=overviewData.blocks.map(block=>Number(block.interval));
  const overviewResponseValues=overviewData.blocks.map(block=>Number(block.responseTime));
  const overviewResponseValuesForScale=overviewResponseValues.filter(value=>Number.isFinite(value));
  const overviewMax=Math.max(...overviewIntervalValues, ...(overviewResponseValuesForScale.length ? overviewResponseValuesForScale : [0]));
  const overviewMin=Math.min(...overviewIntervalValues, ...(overviewResponseValuesForScale.length ? overviewResponseValuesForScale : [0]));

    renderOverlayLineChart(latestIntervalChart,{
    series:[
      {
        label:"Interval",
        values:overviewIntervalValues,
        lineColor:"var(--accent)",
        pointTitles:overviewPointMeta.map(point=>`${point.xExactLabel} - ${point.seriesValues[0]?.exactLabel || ""}`),
        yFormatter:value=>formatChartValue(value," ms")
      },
      {
        label:"Response time",
        values:overviewResponseValues,
        lineColor:"var(--good)",
        lineOpacity:0.62,
        lineWidth:2,
        pointTitles:overviewPointMeta.map(point=>`${point.xExactLabel} - ${point.seriesValues[1]?.exactLabel || ""}`),
        yFormatter:value=>formatChartValue(value," ms")
      }
      ],
      xLabels:overviewData.blocks.map(block=>block.rangeLabel),
      pointMeta:overviewPointMeta,
    xDetailLabel:"Question block",
    yDetailLabel:"Milliseconds",
    yMin:overviewMin,
    yMax:overviewMax,
    xAxisLabel:"Question blocks",
    yAxisLabel:"Time (ms)",
    ariaLabel:"Latest session interval and response time overview chart",
    emptyMessage:"No interval data is available yet.",
      yFormatter:value=>formatChartValue(value," ms"),
      maxXLabels:overviewData.blocks.length > 20 ? 6 : overviewData.blocks.length > 10 ? 5 : 6,
      floorAtZero:false,
      height:258,
      margin:{ top:18, right:14, bottom:48, left:52 },
      pointRadius:3.6,
      pointHoverRadius:4.8,
      pointSelectedRadius:6.0,
      labelFontSize:10,
      axisLabelFontSize:10,
      onPointSelect:index=>{
        clearChartInteractions(latestIntervalChart);
        setLatestIntervalChartMode("detail",index);
        renderLatestIntervalChart(latestTrace);
    }
  });

  latestIntervalBackBtn.classList.add("hidden");
  if(latestIntervalCaption){
    latestIntervalCaption.textContent=overviewData.blockSize===1
      ? "Overview shows individual questions. Tap a point to inspect it."
      : `Overview shows ${overviewData.blockSize}-question blocks. Tap a block to zoom into its questions.`;
  }
}

function renderLatestIntervalChartRaw(latestTrace){
  setLatestIntervalChartMode("overview",null);
  const tracePoints=Array.isArray(latestTrace?.trace) ? latestTrace.trace : [];
  const intervalValues=tracePoints.map(point=>Number(point.interval)).filter(Number.isFinite);
  const responseTimeValues=tracePoints.map(point=>Number(point.responseTime)).filter(Number.isFinite);
  const responseValuesForScale=responseTimeValues.filter(value=>Number.isFinite(value));
  const rawMax=Math.max(...intervalValues, ...(responseValuesForScale.length ? responseValuesForScale : [0]));
  const rawMin=Math.min(...intervalValues, ...(responseValuesForScale.length ? responseValuesForScale : [0]));
  const pointMeta=tracePoints.map((point,index)=>{
    const xExact=`Question ${Number(point.questionNumber)||index+1}`;
    const yExact=formatChartExactValue(Number(point.interval)||0," ms");
    const responseTimeValue=Number(point.responseTime);
    const responseTimeExact=Number.isFinite(responseTimeValue) ? formatChartExactValue(responseTimeValue," ms") : "";
    return {
      xExactLabel:xExact,
      summary:xExact,
      seriesValues:[
        {
          label:"Interval",
          exactLabel:yExact,
          color:"var(--accent)"
        },
        {
          label:"Response time",
          exactLabel:responseTimeExact,
          color:"var(--good)"
        }
      ].filter(series=>series.exactLabel)
    };
  });

    renderOverlayLineChart(latestIntervalChart,{
    series:[
      {
        label:"Interval",
        values:intervalValues,
        lineColor:"var(--accent)",
        pointTitles:pointMeta.map(point=>`${point.xExactLabel} - ${point.seriesValues[0]?.exactLabel || ""}`),
        yFormatter:value=>formatChartValue(value," ms")
      },
      {
        label:"Response time",
        values:tracePoints.map(point=>Number(point.responseTime)),
        lineColor:"var(--good)",
        lineOpacity:0.62,
        lineWidth:2,
        pointTitles:pointMeta.map(point=>`${point.xExactLabel} - ${point.seriesValues[1]?.exactLabel || ""}`),
        yFormatter:value=>formatChartValue(value," ms")
      }
    ],
    xLabels:tracePoints.map(point=>String(point.questionNumber)),
    pointMeta,
    xLabelMode:"questionNumber",
    xDetailLabel:"Question",
    yDetailLabel:"Milliseconds",
    showExactPointDetails:true,
    yMin:rawMin,
    yMax:rawMax,
    xAxisLabel:"Question number",
    yAxisLabel:"Time (ms)",
    ariaLabel:"Latest session interval and response time chart",
    emptyMessage:"No interval data is available yet.",
      yFormatter:value=>formatChartValue(value," ms"),
      maxXLabels:tracePoints.length > 30 ? 6 : tracePoints.length > 15 ? 5 : 6,
      floorAtZero:false,
      height:236,
      margin:{ top:16, right:14, bottom:42, left:74 },
      pointRadius:3.6,
      pointHoverRadius:4.8,
      pointSelectedRadius:6.0,
      labelFontSize:12,
      axisLabelFontSize:12
    });

  latestIntervalBackBtn.classList.add("hidden");
  if(latestIntervalCaption){
    latestIntervalCaption.textContent=tracePoints.length===1
      ? "Hover or tap the point to inspect exact values."
      : "Hover or tap a point to inspect exact values.";
  }
}

function renderLatestIntervalChartDetail(latestTrace,detailBlock){
  const tracePoints=Array.isArray(latestTrace?.trace) ? latestTrace.trace : [];
  const detailPoints=buildLatestIntervalDetailPoints(tracePoints,detailBlock);
  const intervalValues=detailPoints.map(point=>Number(point.interval)).filter(Number.isFinite);
  const responseTimeValues=detailPoints.map(point=>Number(point.responseTime)).filter(Number.isFinite);
  const maxInterval=Math.max(...intervalValues, ...(responseTimeValues.length ? responseTimeValues : [0]));
  const minValue=Math.min(...intervalValues, ...(responseTimeValues.length ? responseTimeValues : [0]));
  const detailRange=Math.max(1,maxInterval-minValue);
  const detailPad=Math.max(50,Math.ceil(detailRange*0.12));
  const detailMin=Math.max(0,minValue-detailPad);
  const detailMax=maxInterval+detailPad;
  const pointMeta=detailPoints.map((point,index)=>{
    const xExact=`Question ${Number(point.questionNumber)||index+1}`;
    const yExact=formatChartExactValue(Number(point.interval)||0," ms");
    const responseTimeValue=Number(point.responseTime);
    const responseTimeExact=Number.isFinite(responseTimeValue) ? formatChartExactValue(responseTimeValue," ms") : "";
    return {
      xExactLabel:xExact,
      summary:xExact,
      seriesValues:[
        {
          label:"Interval",
          exactLabel:yExact,
          color:"var(--accent)"
        },
        {
          label:"Response time",
          exactLabel:responseTimeExact,
          color:"var(--good)"
        }
      ].filter(series=>series.exactLabel)
    };
  });

    renderOverlayLineChart(latestIntervalChart,{
    series:[
      {
        label:"Interval",
        values:detailPoints.map(point=>Number(point.interval)),
        lineColor:"var(--accent)",
        pointTitles:pointMeta.map(point=>`${point.xExactLabel} - ${point.seriesValues[0]?.exactLabel || ""}`),
        yFormatter:value=>formatChartValue(value," ms")
      },
      {
        label:"Response time",
        values:detailPoints.map(point=>Number(point.responseTime)),
        lineColor:"var(--good)",
        lineOpacity:0.62,
        lineWidth:2,
        pointTitles:pointMeta.map(point=>`${point.xExactLabel} - ${point.seriesValues[1]?.exactLabel || ""}`),
        yFormatter:value=>formatChartValue(value," ms")
      }
    ],
    xLabels:detailPoints.map(point=>String(point.questionNumber)),
    pointMeta,
    xLabelMode:"questionNumber",
    xDetailLabel:"Question",
    yDetailLabel:"Milliseconds",
    showExactPointDetails:true,
    yMin:detailMin,
    yMax:detailMax,
    xAxisLabel:"Question number",
    yAxisLabel:"Time (ms)",
    ariaLabel:"Latest session interval and response time chart",
    emptyMessage:"No interval data is available yet.",
      yFormatter:value=>formatChartValue(value," ms"),
      maxXLabels:detailPoints.length > 30 ? 6 : detailPoints.length > 15 ? 5 : 6,
      floorAtZero:false,
      height:252,
      margin:{ top:18, right:14, bottom:48, left:76 },
      pointRadius:3.6,
      pointHoverRadius:4.8,
      pointSelectedRadius:6.0,
      labelFontSize:11,
      axisLabelFontSize:11
    });

  latestIntervalBackBtn.classList.remove("hidden");
  if(latestIntervalCaption){
    const startQuestion=Number(detailBlock.startQuestion)||1;
    const endQuestion=Number(detailBlock.endQuestion)||startQuestion;
    latestIntervalCaption.textContent=`Showing questions ${startQuestion}-${endQuestion}. Tap Back to Overview to return.`;
  }
}

function renderLineChart(container,config){
  const detailsEl=container.id ? document.getElementById(container.id.replace(/Chart$/,"Details")) : null;
  const values=Array.isArray(config.values) ? config.values.filter(value=>Number.isFinite(Number(value))) : [];
  if(!values.length){
    clearChartInteractions(container);
    ensureChartSurface(container).innerHTML=`<div class="chart-empty">${escapeSvgText(config.emptyMessage || "No data available.")}</div>`;
    if(detailsEl){
      detailsEl.hidden=true;
      detailsEl.innerHTML="";
    }
    return;
  }

  const width=720;
  const height=260;
  const margin={ top:18, right:18, bottom:50, left:60 };
  const innerWidth=width-margin.left-margin.right;
  const innerHeight=height-margin.top-margin.bottom;
  let min=Number.isFinite(config.yMin) ? config.yMin : Math.min(...values);
  let max=Number.isFinite(config.yMax) ? config.yMax : Math.max(...values);
  const xValues=Array.isArray(config.xValues) ? config.xValues.map(value=>Number(value)) : null;
  const hasXValues=Array.isArray(xValues) && xValues.length===values.length && xValues.every(Number.isFinite);

  if(min===max){
    min-=1;
    max+=1;
  }else if(!Number.isFinite(config.yMin) || !Number.isFinite(config.yMax)){
    const padding=(max-min)*0.08;
    if(!Number.isFinite(config.yMin)) min-=padding;
    if(!Number.isFinite(config.yMax)) max+=padding;
  }

  if(config.floorAtZero && min>0){
    min=0;
  }

  const safeRange=max-min || 1;
  const pointCount=values.length;
  const xMin=hasXValues ? Math.min(...xValues) : 0;
  const xMax=hasXValues ? Math.max(...xValues) : Math.max(1,pointCount-1);
  const xSafeRange=Math.max(1,xMax-xMin);
  const xPosition=index=>{
    if(pointCount===1) return margin.left + innerWidth/2;
    if(hasXValues){
      return margin.left + (((xValues[index]-xMin)/xSafeRange)*innerWidth);
    }
    return margin.left + (innerWidth*(index/(pointCount-1)));
  };
  const yPosition=value=>margin.top + innerHeight - (((value-min)/safeRange)*innerHeight);
  const points=values.map((value,index)=>({
    x:xPosition(index),
    y:yPosition(value)
  }));
  const path=points.map((point,index)=>(index===0 ? "M" : "L") + " " + point.x.toFixed(2) + " " + point.y.toFixed(2)).join(" ");
  const xLabelIndices=config.xLabelMode==="questionNumber"
    ? getQuestionLabelIndices(pointCount)
    : getLabelIndices(pointCount,config.maxXLabels || 6);
  const tickCount=4;
  const yTicks=Array.from({ length: tickCount + 1 }, (_,index)=>min + (safeRange*(index/tickCount)));

  const xAxisLabel=escapeSvgText(config.xAxisLabel || "");
  const yAxisLabel=escapeSvgText(config.yAxisLabel || "");
  const ariaLabel=escapeSvgText(config.ariaLabel || config.title || "Chart");
  const lineColor=config.lineColor || "var(--accent)";
  const pointFill=config.pointFill || "var(--surface)";
  const pointStroke=config.pointStroke || "var(--accent)";
  const gridColor=config.gridColor || "var(--border)";
  const textColor=config.textColor || "var(--muted)";
  const labelFontSize=Number.isFinite(Number(config.labelFontSize)) ? Math.max(8,Number(config.labelFontSize)) : 12;
  const axisLabelFontSize=Number.isFinite(Number(config.axisLabelFontSize)) ? Math.max(8,Number(config.axisLabelFontSize)) : labelFontSize;
  const pointRadius=Number.isFinite(Number(config.pointRadius)) ? Math.max(0,Number(config.pointRadius)) : null;
  const showPoints=config.showPoints !== false;
  const interactive=config.interactive !== false;

  let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}" class="chart-svg">`;
  svg+=`<rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>`;

  yTicks.forEach(tick=>{
    const y=yPosition(tick);
    svg+=`<line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${width-margin.right}" y2="${y.toFixed(2)}" stroke="${gridColor}" stroke-width="1"></line>`;
    svg+=`<text x="${margin.left-8}" y="${(y+4).toFixed(2)}" text-anchor="end" fill="${textColor}" font-size="${labelFontSize}">${escapeSvgText(config.yFormatter ? config.yFormatter(tick) : formatChartValue(tick))}</text>`;
  });

  svg+=`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height-margin.bottom}" stroke="${gridColor}" stroke-width="1"></line>`;
  svg+=`<line x1="${margin.left}" y1="${height-margin.bottom}" x2="${width-margin.right}" y2="${height-margin.bottom}" stroke="${gridColor}" stroke-width="1"></line>`;

  if(pointCount>1){
    svg+=`<path d="${path}" fill="none" stroke="${lineColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }

  if(showPoints){
    points.forEach((point,index)=>{
      const title=config.pointTitles && config.pointTitles[index] ? config.pointTitles[index] : "";
      const radius=pointRadius !== null ? pointRadius : (pointCount===1 ? 5 : 4.5);
      svg+=`<circle class="chart-point" data-point-index="${index}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${radius}" fill="${pointFill}" stroke="${pointStroke}" stroke-width="2" aria-label="${escapeSvgText(title || `Point ${index + 1}`)}"></circle>`;
    });
  }

  xLabelIndices.forEach(index=>{
    const x=xPosition(index);
    const label=config.xLabels && config.xLabels[index] ? config.xLabels[index] : String(index + 1);
    const anchor=index===0 ? "start" : index===pointCount-1 ? "end" : "middle";
    svg+=`<text x="${x.toFixed(2)}" y="${height-14}" text-anchor="${anchor}" fill="${textColor}" font-size="${labelFontSize}">${escapeSvgText(label)}</text>`;
  });

  if(xAxisLabel){
    svg+=`<text x="${(margin.left + innerWidth/2).toFixed(2)}" y="${height-2}" text-anchor="middle" fill="${textColor}" font-size="${axisLabelFontSize}">${xAxisLabel}</text>`;
  }

  if(yAxisLabel){
    svg+=`<text x="14" y="${(margin.top + innerHeight/2).toFixed(2)}" text-anchor="middle" fill="${textColor}" font-size="${axisLabelFontSize}" transform="rotate(-90 14 ${(margin.top + innerHeight/2).toFixed(2)})">${yAxisLabel}</text>`;
  }

  svg+="</svg>";
  ensureChartSurface(container).innerHTML=svg;

  const pointMeta=Array.isArray(config.pointMeta) ? config.pointMeta : values.map((value,index)=>({
    xExactLabel:config.xLabels && config.xLabels[index] ? config.xLabels[index] : String(index + 1),
    yExactLabel:config.yFormatter ? config.yFormatter(value) : formatChartValue(value),
    summary:`Point ${index + 1}`
  }));
  const mergedPointMeta=pointMeta.map((point,index)=>({
    ...point,
    xPercent:points[index] ? (points[index].x / width) * 100 : (pointCount===1 ? 50 : (index/(pointCount-1))*100),
    yPercent:points[index] ? (points[index].y / height) * 100 : 50
  }));

  const state=getChartState(container);
  state.chartKey=container.id || container;

  config.pointMeta=mergedPointMeta;
  if(interactive){
    state.points=mergedPointMeta;
    bindChartInteractions(container,config);
    applyChartState(container,config);
  }else{
    clearChartInteractions(container);
    if(detailsEl){
      detailsEl.hidden=true;
      detailsEl.innerHTML="";
    }
  }
}

function renderOverlayLineChart(container,config){
  const seriesConfigs=Array.isArray(config.series) ? config.series.filter(series=>series && Array.isArray(series.values)) : [];
  if(!seriesConfigs.length){
    renderLineChart(container,config);
    return;
  }

  const width=720;
  const height=config.height || 290;
  const margin=config.margin || { top:22, right:18, bottom:60, left:72 };
  const innerWidth=width-margin.left-margin.right;
  const innerHeight=height-margin.top-margin.bottom;
  const pointCount=Math.max(...seriesConfigs.map(series=>series.values.length),0);
  const allValues=seriesConfigs.flatMap(series=>series.values.map(value=>Number(value)).filter(Number.isFinite));
  let min=Number.isFinite(config.yMin) ? config.yMin : Math.min(...allValues);
  let max=Number.isFinite(config.yMax) ? config.yMax : Math.max(...allValues);

  if(!allValues.length){
    clearChartInteractions(container);
    ensureChartSurface(container).innerHTML=`<div class="chart-empty">${escapeSvgText(config.emptyMessage || "No data available.")}</div>`;
    return;
  }

  if(min===max){
    min-=1;
    max+=1;
  }else if(!Number.isFinite(config.yMin) || !Number.isFinite(config.yMax)){
    const padding=(max-min)*0.08;
    if(!Number.isFinite(config.yMin)) min-=padding;
    if(!Number.isFinite(config.yMax)) max+=padding;
  }

  if(config.floorAtZero && min>0){
    min=0;
  }

  const yTicksInfo=getNiceMsTicks(min,max,5);
  const yTicks=yTicksInfo.ticks;
  min=yTicksInfo.tickMin;
  max=yTicksInfo.tickMax;

  const safeRange=max-min || 1;
  const xPosition=index=>{
    if(pointCount===1) return margin.left + innerWidth/2;
    return margin.left + (innerWidth*(index/Math.max(1,pointCount-1)));
  };
  const yPosition=value=>margin.top + innerHeight - (((value-min)/safeRange)*innerHeight);
  const xLabelIndices=config.xLabelMode==="questionNumber"
    ? getQuestionLabelIndices(pointCount)
    : getLabelIndices(pointCount,config.maxXLabels || 6);
  const xAxisLabel=escapeSvgText(config.xAxisLabel || "");
  const yAxisLabel=escapeSvgText(config.yAxisLabel || "");
  const ariaLabel=escapeSvgText(config.ariaLabel || config.title || "Chart");
  const gridColor=config.gridColor || "var(--border)";
  const textColor=config.textColor || "var(--muted)";
  const colors=getChartThemeColors();
  const labelFontSize=Number.isFinite(Number(config.labelFontSize)) ? Math.max(8,Number(config.labelFontSize)) : 12;
  const axisLabelFontSize=Number.isFinite(Number(config.axisLabelFontSize)) ? Math.max(8,Number(config.axisLabelFontSize)) : labelFontSize;
  const pointRadius=Number.isFinite(Number(config.pointRadius)) ? Math.max(0,Number(config.pointRadius)) : 4.5;
  const seriesPoints=seriesConfigs.map(series=>series.values.map((value,index)=>{
    const numeric=Number(value);
    if(!Number.isFinite(numeric)) return null;
    return {
      x:xPosition(index),
      y:yPosition(numeric),
      value:numeric
    };
  }));

  let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}" class="chart-svg">`;
  svg+=`<rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>`;

  yTicks.forEach(tick=>{
    const y=yPosition(tick);
    svg+=`<line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${width-margin.right}" y2="${y.toFixed(2)}" stroke="${gridColor}" stroke-width="1"></line>`;
    svg+=`<text x="${margin.left-10}" y="${(y+4).toFixed(2)}" text-anchor="end" fill="${textColor}" font-size="${labelFontSize}">${escapeSvgText(config.yFormatter ? config.yFormatter(tick) : formatChartValue(tick))}</text>`;
  });

  svg+=`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height-margin.bottom}" stroke="${gridColor}" stroke-width="1"></line>`;
  svg+=`<line x1="${margin.left}" y1="${height-margin.bottom}" x2="${width-margin.right}" y2="${height-margin.bottom}" stroke="${gridColor}" stroke-width="1"></line>`;

  seriesConfigs.forEach((series,seriesIndex)=>{
    const lineColor=series.lineColor || series.pointStroke || colors.accent;
    const lineOpacity=Number.isFinite(Number(series.lineOpacity)) ? Math.max(0,Math.min(1,Number(series.lineOpacity))) : 1;
    const lineWidth=Number.isFinite(Number(series.lineWidth)) ? Math.max(1,Number(series.lineWidth)) : 3;
    const path=buildChartPath(seriesPoints[seriesIndex]);
    if(path){
      svg+=`<path d="${path}" fill="none" stroke="${lineColor}" stroke-opacity="${lineOpacity}" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round"></path>`;
    }
  });

  seriesConfigs.forEach((series,seriesIndex)=>{
    const lineColor=series.lineColor || series.pointStroke || colors.accent;
    const seriesLabel=series.label || `Series ${seriesIndex + 1}`;
    seriesPoints[seriesIndex].forEach((point,index)=>{
      if(!point) return;
      const title=series.pointTitles && series.pointTitles[index] ? series.pointTitles[index] : `${seriesLabel} ${index + 1}`;
      svg+=`<circle class="chart-point" data-point-index="${index}" data-series-index="${seriesIndex}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${pointRadius}" fill="${colors.surface}" stroke="${lineColor}" stroke-width="2" aria-label="${escapeSvgText(title)}"></circle>`;
    });
  });

  xLabelIndices.forEach(index=>{
    const x=xPosition(index);
    const label=config.xLabels && config.xLabels[index] ? config.xLabels[index] : String(index + 1);
    const anchor=index===0 ? "start" : index===pointCount-1 ? "end" : "middle";
    svg+=`<text x="${x.toFixed(2)}" y="${height-14}" text-anchor="${anchor}" fill="${textColor}" font-size="${labelFontSize}">${escapeSvgText(label)}</text>`;
  });

  if(xAxisLabel){
    svg+=`<text x="${(margin.left + innerWidth/2).toFixed(2)}" y="${height-2}" text-anchor="middle" fill="${textColor}" font-size="${axisLabelFontSize}">${xAxisLabel}</text>`;
  }

  if(yAxisLabel){
    svg+=`<text x="14" y="${(margin.top + innerHeight/2).toFixed(2)}" text-anchor="middle" fill="${textColor}" font-size="${axisLabelFontSize}" transform="rotate(-90 14 ${(margin.top + innerHeight/2).toFixed(2)})">${yAxisLabel}</text>`;
  }

  svg+="</svg>";
  ensureChartSurface(container).innerHTML=svg;

  const pointMetaBase=Array.isArray(config.pointMeta) ? config.pointMeta : Array.from({ length: pointCount }, (_,index)=>({
    xExactLabel:config.xLabels && config.xLabels[index] ? config.xLabels[index] : String(index + 1),
    summary:config.xLabels && config.xLabels[index] ? config.xLabels[index] : String(index + 1)
  }));
  const pointMeta=pointMetaBase.map((point,index)=>{
    const xExactLabel=point.xExactLabel || (config.xLabels && config.xLabels[index] ? config.xLabels[index] : String(index + 1));
    const existingSeriesValues=Array.isArray(point.seriesValues) ? point.seriesValues : null;
    const seriesValues=existingSeriesValues || seriesConfigs.map((series,seriesIndex)=>{
      const numeric=Number(series.values[index]);
      if(!Number.isFinite(numeric)) return null;
      const lineColor=series.lineColor || series.pointStroke || colors.accent;
      const displayLabel=series.yFormatter ? series.yFormatter(numeric) : formatChartValue(numeric);
      return {
        label:series.label || `Series ${seriesIndex + 1}`,
        exactLabel:displayLabel,
        displayLabel,
        color:lineColor
      };
    }).filter(Boolean);

    const firstSeriesIndex=seriesValues.length ? seriesConfigs.findIndex(series=>Number.isFinite(Number(series.values[index]))) : -1;
    const firstPoint=firstSeriesIndex>=0 ? seriesPoints[firstSeriesIndex][index] : null;

    return {
      ...point,
      xExactLabel,
      summary:point.summary || xExactLabel,
      xPercent:Number.isFinite(Number(point.xPercent))
        ? Number(point.xPercent)
        : firstPoint
          ? (firstPoint.x / width) * 100
          : (pointCount===1 ? 50 : (index/Math.max(1,pointCount-1))*100),
      yPercent:Number.isFinite(Number(point.yPercent))
        ? Number(point.yPercent)
        : firstPoint
          ? (firstPoint.y / height) * 100
          : 50,
      seriesValues
    };
  });

  config.pointMeta=pointMeta;

  const state=getChartState(container);
  state.points=pointMeta;
  state.chartKey=container.id || container;
  state.seriesConfig=seriesConfigs;

  bindChartInteractions(container,config);
  applyChartState(container,config);
}

function renderHistoryCharts(trendData,latestTrace,fallbackMode){
  latestHistoryChartContext={ stats:null, latestTrace };
  const historyMode=ensureHistoryChartMode(fallbackMode);
  const dailyAccuracyPoints=Array.isArray(trendData?.accuracyPoints) ? trendData.accuracyPoints : [];
  const dailyResponsePoints=Array.isArray(trendData?.responsePoints) ? trendData.responsePoints : [];
  const dailyYears=new Set([...dailyAccuracyPoints,...dailyResponsePoints].map(point=>new Date(point.dayStart).getFullYear()));
  const includeYearInLabels=dailyYears.size>1;
  const hasTrendData=dailyAccuracyPoints.length>0 || dailyResponsePoints.length>0;

  if(hasTrendData){
    renderLineChart(accuracyTrendChart,{
      values:dailyAccuracyPoints.map(point=>point.value),
      xValues:dailyAccuracyPoints.map(point=>point.dayStart),
      xLabels:dailyAccuracyPoints.map(point=>formatChartDateLabel(point.dayStart,includeYearInLabels)),
      xDetailLabel:"Date",
      yDetailLabel:"Average daily accuracy",
      yMin:0,
      yMax:100,
      xAxisLabel:"Date",
      yAxisLabel:"Accuracy (%)",
      ariaLabel:"Accuracy trend chart",
      emptyMessage:"No session data is available yet.",
      yFormatter:value=>formatChartValue(value,"%"),
      maxXLabels:getDailyTrendLabelCount(dailyAccuracyPoints.length),
      floorAtZero:true,
      showPoints:dailyAccuracyPoints.length===1,
      pointRadius:3.8,
      pointHoverRadius:5.0,
      pointSelectedRadius:6.0,
      labelFontSize:12,
      axisLabelFontSize:12,
      margin:{ top:14, right:12, bottom:42, left:50 },
      interactive:false
    });

    const responseValues=dailyResponsePoints.map(point=>point.value);
    const responseMax=Math.max(...responseValues,0);

    renderLineChart(responseTimeTrendChart,{
      values:responseValues,
      xValues:dailyResponsePoints.map(point=>point.dayStart),
      xLabels:dailyResponsePoints.map(point=>formatChartDateLabel(point.dayStart,includeYearInLabels)),
      xDetailLabel:"Date",
      yDetailLabel:"Average daily response time",
      yMin:0,
      yMax:responseMax ? responseMax * 1.1 : 100,
      xAxisLabel:"Date",
      yAxisLabel:"Average response time (ms)",
      ariaLabel:"Response time trend chart",
      emptyMessage:"No session data is available yet.",
      yFormatter:value=>formatChartValue(value," ms"),
      maxXLabels:getDailyTrendLabelCount(dailyResponsePoints.length),
      floorAtZero:true,
      showPoints:dailyResponsePoints.length===1,
      pointRadius:3.8,
      pointHoverRadius:5.0,
      pointSelectedRadius:6.0,
      labelFontSize:11,
      axisLabelFontSize:11,
      margin:{ top:14, right:12, bottom:42, left:50 },
      interactive:false
    });
  }else{
    const emptyMessage=`No ${formatArithmeticModeLabel(historyMode)} sessions saved yet. Finish a session in this mode to see trends over time.`;
    clearChartInteractions(accuracyTrendChart);
    clearChartInteractions(responseTimeTrendChart);
    ensureChartSurface(accuracyTrendChart).innerHTML=`<div class="chart-empty">${escapeSvgText(emptyMessage)}</div>`;
    ensureChartSurface(responseTimeTrendChart).innerHTML=`<div class="chart-empty">${escapeSvgText(emptyMessage)}</div>`;
    if(accuracyTrendDetails){
      accuracyTrendDetails.hidden=true;
      accuracyTrendDetails.innerHTML="";
    }
    if(responseTimeTrendDetails){
      responseTimeTrendDetails.hidden=true;
      responseTimeTrendDetails.innerHTML="";
    }
  }

  renderLatestIntervalChart(latestTrace);
}

function renderHistoryChartsSection(trendData,latestTrace,fallbackMode){
  renderHistoryCharts(trendData,latestTrace,fallbackMode);
}

function formatHistoryPageSummary(pageData){
  const totalSessions=Number(pageData?.totalSessions)||0;
  if(!totalSessions) return "Showing 0 sessions";
  const visibleStart=Number(pageData?.visibleStart)||0;
  const visibleEnd=Number(pageData?.visibleEnd)||0;
  return `Showing ${visibleStart}-${visibleEnd} of ${totalSessions} sessions`;
}

function formatHistoryPageIndicator(pageData){
  const pageCount=Number(pageData?.pageCount)||0;
  const pageIndex=Number(pageData?.pageIndex)||0;
  if(!pageCount) return "Page 0 of 0";
  return `Page ${pageIndex + 1} of ${pageCount}`;
}

function updateHistoryPaginationControls(pageData){
  const pageCount=Number(pageData?.pageCount)||0;
  if(historyPaginationSummary){
    historyPaginationSummary.textContent=formatHistoryPageSummary(pageData);
  }
  if(historyPaginationIndicator){
    historyPaginationIndicator.textContent=formatHistoryPageIndicator(pageData);
  }
  if(historyPaginationControls){
    historyPaginationControls.classList.toggle("is-single-page",pageCount<=1);
  }
  if(historyPrevPageBtn){
    historyPrevPageBtn.disabled=!pageData?.hasPrevious;
  }
  if(historyNextPageBtn){
    historyNextPageBtn.disabled=!pageData?.hasNext;
  }
}

function applyHistoryTrendToggleState(button,includeInTrends){
  if(!button) return;
  button.dataset.included=includeInTrends ? "true" : "false";
  button.textContent=includeInTrends ? "Included in trends" : "Excluded from trends";
  button.setAttribute("aria-pressed",String(!!includeInTrends));
  button.classList.toggle("is-included",includeInTrends);
  button.classList.toggle("is-excluded",!includeInTrends);
}

async function toggleHistorySessionTrendInclusion(session,button){
  if(!session || !button) return;
  const nextIncludeInTrends=!session.includeInTrends;
  const previousIncludeInTrends=!!session.includeInTrends;
  applyHistoryTrendToggleState(button,nextIncludeInTrends);
  button.disabled=true;

  try{
    const updatedSession={
      ...session,
      includeInTrends:nextIncludeInTrends
    };
    const savePromise=historyTrendUpdateChain.then(()=>sessionHistoryStore.saveSession(updatedSession));
    historyTrendUpdateChain=savePromise.catch(()=>{});
    const saved=await savePromise;
    session.includeInTrends=typeof saved?.includeInTrends==="boolean" ? saved.includeInTrends : nextIncludeInTrends;
    applyHistoryTrendToggleState(button,session.includeInTrends);
  }catch(e){
    session.includeInTrends=previousIncludeInTrends;
    applyHistoryTrendToggleState(button,previousIncludeInTrends);
  }finally{
    button.disabled=false;
  }
}

function renderHistorySessionsSection(viewData){
  const stats=viewData?.stats || EMPTY_HISTORY_STATS;
  const pageData=viewData?.pageData || createEmptyHistoryPageData();

  historyCompletedSessions.textContent=String(stats.completedSessions);
  historyCorrectAnswers.textContent=String(stats.totalCorrectAnswers);
  historyDurationTrained.textContent=formatDuration(stats.totalDurationMs);

  syncHistoryFilterControls();
  recentSessionsList.innerHTML="";
  updateHistoryPaginationControls(pageData);

  if(!pageData.totalSessions){
    const empty=document.createElement("div");
    empty.className="history-empty";
    empty.textContent=getActiveHistoryFilterCount() ? "No sessions match the current filters." : "No saved sessions yet.";
    recentSessionsList.appendChild(empty);
    return;
  }

  if(!pageData.sessions.length){
    const empty=document.createElement("div");
    empty.className="history-empty";
    empty.textContent=getActiveHistoryFilterCount() ? "No sessions match the current filters." : "No saved sessions yet.";
    recentSessionsList.appendChild(empty);
    return;
  }

  pageData.sessions.forEach(session=>{
    const item=document.createElement("div");
    item.className="history-item";

    const top=document.createElement("div");
    top.className="history-item-top";

    const date=document.createElement("div");
    date.className="history-item-date";
    date.textContent=formatSessionDateTime(session.endedAt || session.startedAt);

    const status=document.createElement("span");
    status.className="history-status " + (session.status==="Manually exited" ? "manual" : "completed");
    status.textContent=session.status;

    top.appendChild(date);
    top.appendChild(status);

    const meta=document.createElement("div");
    meta.className="history-item-meta";

    const accuracy=document.createElement("span");
    accuracy.textContent="Accuracy: " + formatPercent(Number(session.accuracy)||0);

    const duration=document.createElement("span");
    duration.textContent="Duration: " + formatDuration(Number(session.durationMs)||0);

    const correct=document.createElement("span");
    correct.textContent="Correct: " + (Number(session.correctAnswers)||0);

    const questions=document.createElement("span");
    questions.textContent="Total Questions: " + (Number(session.totalQuestionsAsked)||0);

    const mode=document.createElement("span");
    mode.textContent="Mode: " + formatArithmeticModeLabel(session.arithmeticMode || defaultSettings.mode);

    const endConditionLabel=document.createElement("span");
    endConditionLabel.textContent="End: " + ((session.endCondition || defaultSettings.endCondition) === "correct" ? "Correct answers" : "Timer");

    const thresholds=document.createElement("span");
    thresholds.textContent="Thresholds: " + formatThresholdSummary(Number(session.correctThreshold)||4, Number(session.incorrectThreshold)||4);

    meta.appendChild(accuracy);
    meta.appendChild(duration);
    meta.appendChild(correct);
    meta.appendChild(questions);
    meta.appendChild(mode);
    meta.appendChild(endConditionLabel);
    meta.appendChild(thresholds);

    const trendRow=document.createElement("div");
    trendRow.className="history-item-trend";

    const trendLabel=document.createElement("span");
    trendLabel.textContent="Trend inclusion";

    const trendButton=document.createElement("button");
    trendButton.type="button";
    trendButton.className="history-trend-toggle";
    trendButton.setAttribute("aria-label","Toggle whether this session contributes to trend graphs");
    applyHistoryTrendToggleState(trendButton,session.includeInTrends!==false);
    trendButton.onclick=()=>{
      void toggleHistorySessionTrendInclusion(session,trendButton);
    };

    trendRow.appendChild(trendLabel);
    trendRow.appendChild(trendButton);

    item.appendChild(top);
    item.appendChild(meta);
    item.appendChild(trendRow);
    recentSessionsList.appendChild(item);
  });
}

function renderLatestIntervalChart(latestTrace){
  const tracePoints=Array.isArray(latestTrace?.trace) ? latestTrace.trace : [];
  syncLatestIntervalChartSession(latestTrace);

  if(!tracePoints.length){
    renderLatestIntervalChartEmptyState("No recent session data is available yet.");
    return;
  }

  const overviewData=buildLatestIntervalOverviewBlocks(tracePoints,latestIntervalChart?.clientWidth || 720);
  const detailBlockIndex=latestIntervalChartViewState.mode==="detail" ? latestIntervalChartViewState.blockIndex : null;
  const detailBlock=detailBlockIndex===null ? null : overviewData.blocks[detailBlockIndex];

  if(latestIntervalChartViewState.mode==="detail" && !detailBlock){
    setLatestIntervalChartMode("overview",null);
  }

  if(overviewData.blockSize===1){
    renderLatestIntervalChartRaw(latestTrace);
    return;
  }

  if(latestIntervalChartViewState.mode==="detail" && detailBlock){
    renderLatestIntervalChartDetail(latestTrace,detailBlock);
    return;
  }

  renderLatestIntervalChartOverview(latestTrace,overviewData);
}

function renderHistoryView(viewData){
  const stats=viewData?.stats || EMPTY_HISTORY_STATS;
  const latestTrace=viewData?.latestTrace || null;
  const pageData=viewData?.pageData || createEmptyHistoryPageData();
  const trendData=viewData?.trendData || createEmptyTrendData();
  const fallbackMode=viewData?.fallbackMode || defaultSettings.mode;

  renderHistoryChartsSection(trendData,latestTrace,fallbackMode);
  renderHistorySessionsSection({ stats, pageData });
}

async function refreshHistoryTrendCharts(){
  const refreshToken=++historyTrendRefreshToken;
  try{
    await historyTrendUpdateChain;
    const [latestTrace,fallbackMode]=await Promise.all([
      sessionHistoryStore.getLatestTrace(),
      sessionHistoryStore.getMostRecentHistoryMode()
    ]);
    const resolvedMode=ensureHistoryChartMode(fallbackMode);
    const trendData=await sessionHistoryStore.getTrendData(resolvedMode);
    if(refreshToken!==historyTrendRefreshToken) return;
    renderHistoryChartsSection(trendData,latestTrace,fallbackMode);
  }catch(e){
    if(refreshToken!==historyTrendRefreshToken) return;
    renderHistoryChartsSection(createEmptyTrendData(),null,defaultSettings.mode);
  }
}

async function refreshHistorySessions(){
  const refreshToken=++historySessionRefreshToken;
  const filtersSnapshot={ ...historyFilters };
  try{
    await historyTrendUpdateChain;
    const [stats,pageData]=await Promise.all([
      sessionHistoryStore.getStats(),
      sessionHistoryStore.getSessionPage({
        filters:filtersSnapshot,
        pageIndex:historyPageIndex,
        pageSize:HISTORY_PAGE_SIZE
      })
    ]);
    if(refreshToken!==historySessionRefreshToken) return;
    historyPageIndex=pageData.pageIndex;
    renderHistorySessionsSection({ stats, pageData });
  }catch(e){
    if(refreshToken!==historySessionRefreshToken) return;
    historyPageIndex=0;
    renderHistorySessionsSection({
      stats:EMPTY_HISTORY_STATS,
      pageData:createEmptyHistoryPageData()
    });
  }
}

async function refreshHistoryView(){
  const trendRefreshToken=++historyTrendRefreshToken;
  const sessionRefreshToken=++historySessionRefreshToken;
  const filtersSnapshot={ ...historyFilters };
  try{
    await historyTrendUpdateChain;
    const [stats,latestTrace,fallbackMode,pageData]=await Promise.all([
      sessionHistoryStore.getStats(),
      sessionHistoryStore.getLatestTrace(),
      sessionHistoryStore.getMostRecentHistoryMode(),
      sessionHistoryStore.getSessionPage({
        filters:filtersSnapshot,
        pageIndex:historyPageIndex,
        pageSize:HISTORY_PAGE_SIZE
      })
    ]);
    const resolvedMode=ensureHistoryChartMode(fallbackMode);
    const trendData=await sessionHistoryStore.getTrendData(resolvedMode);
    if(trendRefreshToken!==historyTrendRefreshToken || sessionRefreshToken!==historySessionRefreshToken) return;
    historyPageIndex=pageData.pageIndex;
    renderHistoryView({ stats, latestTrace, trendData, pageData, fallbackMode });
  }catch(e){
    if(trendRefreshToken!==historyTrendRefreshToken || sessionRefreshToken!==historySessionRefreshToken) return;
    historyPageIndex=0;
    renderHistoryView({
      stats:EMPTY_HISTORY_STATS,
      latestTrace:null,
      trendData:createEmptyTrendData(),
      pageData:createEmptyHistoryPageData(),
      fallbackMode:defaultSettings.mode
    });
  }
}

function updateSessionLimitUI(){
  if(endCondition==="correct"){
    sessionLimitLabel.textContent="Correct Answers";
    timeLeft.textContent=correctAnswers + " / " + targetCorrect;
    sessionLimitSuffix.textContent="";
    return;
  }

  sessionLimitLabel.textContent="Time Left";
  sessionLimitSuffix.textContent="s";
}

function formatVoiceLabel(voiceKey){
  return voiceKey
    .replace(/([a-zA-Z])(\d)/g,"$1 $2")
    .replace(/(\d)([a-zA-Z])/g,"$1 $2")
    .replace(/[-_]+/g," ")
    .replace(/\b\w/g,char=>char.toUpperCase());
}

function normalizeVoiceEntry(voiceKey,entry){
  if(typeof entry==="string"){
    return {
      label:voiceKey,
      basePath:`audio/${voiceKey}`
    };
  }

  return {
    label:entry.label || voiceKey,
    basePath:entry.basePath || `audio/${voiceKey}`
  };
}

function mergeVoiceEntries(target,source){
  Object.entries(source||{}).forEach(([voiceKey,entry])=>{
    target[voiceKey]=normalizeVoiceEntry(voiceKey,entry);
  });
}

async function discoverVoices(){
  const discovered={};
  mergeVoiceEntries(discovered,window.CCT_VOICE_LIBRARY);

  if(!Object.keys(discovered).length){
    discovered.samantha={ label:"samantha", basePath:"audio/samantha" };
    discovered.nathan={ label:"nathan", basePath:"audio/nathan" };
    discovered.enhancednathan={ label:"enhancednathan", basePath:"audio/enhancednathan" };
    discovered.siri4={ label:"siri4", basePath:"audio/siri4" };
  }

  voiceLibrary=discovered;
  return discovered;
}

async function refreshVoiceLibrary(){
  await discoverVoices();
  populateVoiceSelect();
}

function populateVoiceSelect(){
  const voices=Object.entries(voiceLibrary);
  voiceSelect.innerHTML="";

  voices.forEach(([voiceKey,voice])=>{
    const option=document.createElement("option");
    option.value=voiceKey;
    option.textContent=voice.label;
    voiceSelect.appendChild(option);
  });

  if(!voices.some(([voiceKey])=>voiceKey===selectedVoice)){
    selectedVoice=voices[0]?.[0] || "samantha";
  }
  voiceSelect.value=selectedVoice;
}

function getClockTime(){
  return window.performance&&window.performance.now?window.performance.now():Date.now();
}

function getVoiceConfig(voiceKey){
  const fallbackKey=Object.keys(voiceLibrary)[0];
  return voiceLibrary[voiceKey] || voiceLibrary[fallbackKey] || { label:"samantha", basePath:"audio/samantha" };
}

function getVoiceClipUrl(voiceKey,num){
  const voice=getVoiceConfig(voiceKey);
  return `${voice.basePath}/${num}.mp3`;
}

function retainOnlyVoiceCache(voiceKey){
  Object.keys(voiceAudioCache).forEach(key=>{
    if(key!==voiceKey){
      delete voiceAudioCache[key];
    }
  });
}

function shouldPreloadAudio(){
  return window.location && window.location.protocol !== "file:";
}

function loadAudioClip(src){
  const audio=new Audio();
  audio.preload=shouldPreloadAudio() ? "auto" : "none";
  audio.src=src;
  if(shouldPreloadAudio()){
    audio.load();
  }
  return audio;
}

function preloadVoice(voiceKey){
  if(voiceAudioCache[voiceKey]?.ready) return Promise.resolve(voiceAudioCache[voiceKey]);
  if(voiceAudioCache[voiceKey]?.loading) return voiceAudioCache[voiceKey].loading;

  const entry=voiceAudioCache[voiceKey] || { clips:{}, ready:false, loading:null };
  const clipNumbers=[1,2,3,4,5,6,7,8,9];
  const clipPromises=clipNumbers.map(num=>new Promise(resolve=>{
    const audio=loadAudioClip(getVoiceClipUrl(voiceKey,num));
    entry.clips[num]=audio;
    let settled=false;
    const timeoutId=setTimeout(finish,1500);

    function finish(){
      if(settled) return;
      settled=true;
      clearTimeout(timeoutId);
      audio.removeEventListener("canplaythrough",finish);
      audio.removeEventListener("loadeddata",finish);
      audio.removeEventListener("error",finish);
      resolve(audio);
    }

    if(audio.readyState>=3){
      resolve(audio);
      return;
    }

    audio.addEventListener("canplaythrough",finish,{once:true});
    audio.addEventListener("loadeddata",finish,{once:true});
    audio.addEventListener("error",finish,{once:true});
  }));

  entry.loading=Promise.all(clipPromises).then(()=>{
    entry.ready=true;
    entry.loading=null;
    voiceAudioCache[voiceKey]=entry;
    return entry;
  });
  voiceAudioCache[voiceKey]=entry;
  return entry.loading;
}

async function testSelectedVoice(){
  if(voiceTestInProgress) return;
  const voice=voiceSelect.value || selectedVoice;
  if(!voice) return;

  voiceTestInProgress=true;
  const testButton=voiceTestBtn;
  if(testButton){
    testButton.disabled=true;
  }

  try{
    await preloadVoice(voice);
    const entry=voiceAudioCache[voice];
    const clipNumbers=entry && entry.clips ? Object.keys(entry.clips).map(Number).filter(Number.isFinite) : [];
    const clipNumber=clipNumbers.length ? clipNumbers[Math.floor(Math.random()*clipNumbers.length)] : 1;
    const template=entry && entry.clips && entry.clips[clipNumber];
    if(!template) return;

    stopStimulusAudioPlayback();

    const audio=template.cloneNode(true);
    audio.playbackRate=playbackSpeed;
    audio.currentTime=0;
    activeStimulusAudios.add(audio);

    const cleanup=()=>{
      activeStimulusAudios.delete(audio);
    };

    let resolvePlayback;
    const playbackDone=new Promise(resolve=>{
      resolvePlayback=resolve;
    });
    const settle=()=>{
      cleanup();
      resolvePlayback();
    };

    audio.addEventListener("ended",settle,{once:true});
    audio.addEventListener("error",settle,{once:true});

    const playPromise=audio.play();
    if(playPromise&&typeof playPromise.catch==="function"){
      playPromise.catch(cleanup);
    }
    await playbackDone;
  }finally{
    voiceTestInProgress=false;
    if(testButton){
      testButton.disabled=false;
    }
  }
}

function stopStimulusAudioPlayback(){
  activeStimulusAudios.forEach(audio=>{
    try{
      audio.pause();
      audio.currentTime=0;
    }catch(e){}
  });
  activeStimulusAudios.clear();
}

function playStimulusAudio(num){
  const voice=selectedVoice;
  const entry=voiceAudioCache[voice] || voiceAudioCache[Object.keys(voiceAudioCache)[0]];
  const template=entry&&entry.clips&&entry.clips[num];
  if(!template) return;

  stopStimulusAudioPlayback();

  const audio=template.cloneNode(true);
  audio.playbackRate=playbackSpeed;
  audio.currentTime=0;
  activeStimulusAudios.add(audio);

  const cleanup=()=>{
    activeStimulusAudios.delete(audio);
  };

  audio.addEventListener("ended",cleanup,{once:true});
  audio.addEventListener("error",cleanup,{once:true});

  const playPromise=audio.play();
  if(playPromise&&typeof playPromise.catch==="function"){
    playPromise.catch(cleanup);
  }
}

function updateLatestTraceResponseTime(responseTime,traceIndex=sessionIntervalTrace.length-1){
  if(!sessionIntervalTrace.length) return;
  const index=Math.max(0,Math.min(sessionIntervalTrace.length-1,Math.floor(Number(traceIndex)||0)));
  const point=sessionIntervalTrace[index];
  if(!point) return;
  const numeric=Number(responseTime);
  if(!Number.isFinite(numeric)) return;
  point.responseTime=Math.max(0,numeric);
}

function playBeep(){
  if(!beepEnabled)return;
  const AudioContextCtor=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextCtor) return;

  if(!beepAudioContext){
    beepAudioContext=new AudioContextCtor();
  }

  const ctx=beepAudioContext;
  if(ctx.state==="suspended" && typeof ctx.resume==="function"){
    void ctx.resume();
  }

  const o=ctx.createOscillator();
  const g=ctx.createGain();
  o.frequency.value=1200; g.gain.value=0.1;
  o.connect(g); g.connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime+0.12);
  o.onended=()=>{
    try{
      o.disconnect();
      g.disconnect();
    }catch(e){}
  };
}

async function closeBeepAudioContext(){
  if(!beepAudioContext) return;
  const ctx=beepAudioContext;
  beepAudioContext=null;
  try{
    if(typeof ctx.close==="function" && ctx.state!=="closed"){
      await ctx.close();
    }
  }catch(e){}
}

function getRandomNumber(){return Math.floor(Math.random()*9)+1;}

function updateFeedbackUI(){
  const fb=document.getElementById("feedback"); fb.innerHTML="";
  const slotCount=getIndicatorSlotCount();
  for(let i=0;i<slotCount;i++){
    const d=document.createElement("span");
    const active=i<feedbackIndicatorCount;
    d.className=`dot feedback-slot ${active?feedbackIndicatorColor:"empty"}`;
    fb.appendChild(d);
  }
}

function resetFeedbackIndicators(){
  feedbackIndicatorColor=null;
  feedbackIndicatorCount=0;
  updateFeedbackUI();
}

function setFeedbackIndicators(color,count){
  feedbackIndicatorColor=color;
  feedbackIndicatorCount=Math.max(0,Math.min(getIndicatorSlotCount(),count));
  updateFeedbackUI();
}

// FIX: continuously update time
function tickIntervalTime(){
  if(!gameRunning) return;
  if(!showIntervalTiming) return;

  const now=getClockTime();

  if(interval !== startingInterval || intervalCounts[interval]){
    intervalTime[interval]=(intervalTime[interval]||0)+(now-currentIntervalStart);
  }

  currentIntervalStart=now;
  updateIntervalStats();

  requestAnimationFrame(tickIntervalTime);
}

function renderIntervalStatsInto(target){
  if(!target) return;
  target.innerHTML="";

  Object.keys(intervalCounts)
    .sort((a,b)=>b-a)
    .forEach(k=>{
      const time=(intervalTime[k]||0)/1000;
      const div=document.createElement("div");
      div.textContent = k + "ms: " + intervalCounts[k] + "  —  " + time.toFixed(1) + "s";
      target.appendChild(div);
    });
}

function updateIntervalStats(){
  if(!showIntervalTiming){
    intervalStats.innerHTML="";
    if(resultsIntervalStats){
      resultsIntervalStats.innerHTML="";
    }
    return;
  }

  renderIntervalStatsInto(intervalStats);
  renderIntervalStatsInto(resultsIntervalStats);
}

function getThresholds(){
  return {
    correct:parsePositiveInteger(correctThresholdInput.value,defaultSettings.correctThreshold),
    incorrect:parsePositiveInteger(incorrectThresholdInput.value,defaultSettings.incorrectThreshold)
  };
}

function changeInterval(newInterval){
  const clampedInterval=Math.max(minimumInterval,Math.min(startingInterval,newInterval));
  if(clampedInterval===interval) return;

  const now=getClockTime();
  const previousInterval=interval;

  if(showIntervalTiming){
    if(previousInterval !== startingInterval || intervalCounts[previousInterval]){
      intervalTime[previousInterval]=(intervalTime[previousInterval]||0)+(now-currentIntervalStart);
    }
  }

  interval=clampedInterval;
  if(showIntervalTiming){
    currentIntervalStart=now;

    intervalCounts[interval]=(intervalCounts[interval]||0)+1;

    updateIntervalStats();
  }
  resetFeedbackIndicators();

  if(gameRunning&&!isStimulusTick){
    scheduleNextStimulusFromLastStimulus();
  }
}

function adjustDifficulty(){
  const t=getThresholds();

  if(correctStreak>=t.correct){
    changeInterval(interval-intervalIncrement);
    correctStreak=0;
  }

  if(wrongStreak>=t.incorrect){
    changeInterval(interval+intervalIncrement);
    wrongStreak=0;
  }

  document.getElementById("currentInterval").textContent=interval;
}

function recordScoredItem(isCorrect,responseTime,traceIndex=sessionIntervalTrace.length-1){
  feedback.push(isCorrect);
  responseTimes.push(Math.max(0,responseTime));
  if(isCorrect) correctAnswers++;
  updateLatestTraceResponseTime(responseTime,traceIndex);
}

function clearPendingAnswer(){
  awaitingAnswer=false;
  responseStartedAt=0;
  responseInterval=0;
  answer.value="";
}

function resetQuestionStates(){
  activeQuestionState=null;
}

function createQuestionState(startedAt){
  const traceIndex=Math.max(0,sessionIntervalTrace.length-1);
  return {
    startedAt,
    responseInterval:interval,
    expectedAnswer:numbers.length>=2 ? getExpectedAnswer(numbers[numbers.length-2],numbers[numbers.length-1]) : null,
    traceIndex,
    resolved:false
  };
}

function finalizeQuestionState(questionState,submittedValue,finalizedAt){
  if(!questionState || questionState.resolved) return false;

  const resolvedAt=Number.isFinite(Number(finalizedAt)) ? Number(finalizedAt) : getClockTime();
  const isCorrect=isCorrectAnswerInput(questionState,submittedValue,resolvedAt);
  const responseTime=isCorrect
    ? Math.min(Math.max(0,questionState.startedAt ? resolvedAt-questionState.startedAt : 0),questionState.responseInterval || interval)
    : (questionState.responseInterval || interval);

  questionState.resolved=true;

  if(questionState===activeQuestionState){
    clearPendingAnswer();
  }

  recordScoredItem(isCorrect,responseTime,questionState.traceIndex);

  if(isCorrect){
    setFeedbackIndicators("green",correctStreak+1);
    correctStreak++;
    wrongStreak=0;
    adjustDifficulty();
    updateSessionLimitUI();
    if(endCondition==="correct"&&correctAnswers>=targetCorrect){
      stopGame("completed");
    }
  }else{
    setFeedbackIndicators("red",wrongStreak+1);
    wrongStreak++;
    correctStreak=0;
    playBeep();
    adjustDifficulty();
  }

  return isCorrect;
}

function isCorrectAnswerInput(questionState,submittedValue,finalizedAt){
  if(!questionState || questionState.resolved) return false;

  const normalizedValue=String(submittedValue ?? "").trim();
  return normalizedValue!==""
    && questionState.expectedAnswer!==null
    && normalizedValue===String(questionState.expectedAnswer);
}

function isAllowedSessionClick(target){
  return target===answer || answer.contains(target) || target===endSessionBtn || endSessionBtn.contains(target);
}

function restoreAnswerFocus(){
  if(sessionState!=="active") return;
  if(document.activeElement===answer) return;
  try{
    answer.focus({ preventScroll:true });
  }catch(e){
    answer.focus();
  }
}

function formatPercent(value){
  return value.toFixed(1).replace(/\.0$/,"") + "%";
}

function formatDuration(ms){
  if(ms<10000){
    const seconds=(ms/1000).toFixed(1).replace(/\.0$/,"");
    return seconds + "s";
  }

  const totalSeconds=Math.round(ms/1000);
  const minutes=Math.floor(totalSeconds/60);
  const seconds=totalSeconds%60;

  if(minutes===0) return seconds + "s";
  return minutes + "m " + seconds + "s";
}

function renderResults(){
  const totalItems=feedback.length;
  const accuracy=totalItems?correctAnswers/totalItems*100:0;
  const totalResponseTime=responseTimes.reduce((sum,time)=>sum+time,0);
  const averageResponseTime=totalItems?totalResponseTime/totalItems:0;
  const duration=Math.max(0,sessionEndedAt-sessionStartedAt);
  const totalQuestionsAsked=Math.max(0,totalItems-(excludeLastQuestionFromCount?1:0));

  resultAccuracy.textContent=formatPercent(accuracy);
  resultAverageResponse.textContent=Math.round(averageResponseTime) + " ms";
  resultDuration.textContent=formatDuration(duration);
  resultCorrect.textContent=correctAnswers.toString();
  resultQuestions.textContent=totalQuestionsAsked.toString();
  resultStatus.textContent=sessionOutcome;
}

function scheduleNextStimulus(delay=interval){
  if(!gameRunning)return;

  const scheduleSerial=++stimulusScheduleSerial;
  clearTimeout(timeoutId);
  timeoutId=setTimeout(()=>{
    if(!gameRunning || scheduleSerial!==stimulusScheduleSerial) return;
    runStimulus();
  },Math.max(0,delay));
}

function scheduleNextStimulusFromLastStimulus(){
  if(!gameRunning) return;
  const anchorAt=lastStimulusAt || getClockTime();
  scheduleNextStimulus((anchorAt + interval) - getClockTime());
}

function startStimulusScheduler(){
  lastStimulusAt=getClockTime()-interval;
  scheduleNextStimulusFromLastStimulus();
}

function runStimulus(){
  if(!gameRunning)return;

  isStimulusTick=true;

  const expiredQuestionState=activeQuestionState;
  if(expiredQuestionState && !expiredQuestionState.resolved){
    finalizeQuestionState(expiredQuestionState,answer.value,getClockTime());
  }

  const num=getRandomNumber();
  const now=getClockTime();
  lastStimulusAt=now;
  clearPendingAnswer();
  numbers.push(num);
  sessionIntervalTrace.push({
    questionNumber:numbers.length,
    interval,
    timestamp:now,
    responseTime:null
  });
  playStimulusAudio(num);

  if(numbers.length>=2){
    awaitingAnswer=true;
    responseStartedAt=now;
    responseInterval=interval;
    activeQuestionState=createQuestionState(now);
  }else{
    clearPendingAnswer();
    activeQuestionState=null;
  }

  isStimulusTick=false;
  if(gameRunning){
    scheduleNextStimulusFromLastStimulus();
  }
}

function updateTimer(){
  if(!gameRunning||endCondition!=="timer")return;
  const r=Math.max(0,Math.floor((endTime-Date.now())/1000));
  document.getElementById("timeLeft").textContent=r;
  if(r<=0) stopGame("completed"); else requestAnimationFrame(updateTimer);
}

async function startGame(){
  if(sessionState!=="idle") return;

  saveSettings();
  setSessionState("starting");
  currentSessionId=generateSessionId();

  startingInterval=Math.max(100,parseInt(startingIntervalInput.value)||parseInt(defaultSettings.startingInterval));
  minimumInterval=Math.max(100,parseInt(minimumIntervalInput.value)||parseInt(defaultSettings.minimumInterval));
  if(minimumInterval>startingInterval) minimumInterval=startingInterval;
  interval=startingInterval;
  endCondition=endConditionSelect.value;
  targetCorrect=Math.max(1,parseInt(targetCorrectInput.value)||parseInt(defaultSettings.targetCorrect));
  applyArithmeticMode(modeSelect.value);
  const duration=Math.max(1,parseInt(durationInput.value)||parseInt(defaultSettings.duration))*60000;
  beepEnabled=beepToggle.checked;
  showIntervalTiming=showIntervalTimingToggle.checked;
  selectedVoice=voiceSelect.value;
  playbackSpeed=parseFloat(playbackSpeedSelect.value)||1;
  await preloadVoice(selectedVoice);
  if(sessionState!=="starting") return;
  retainOnlyVoiceCache(selectedVoice);

  numbers=[]; feedback=[]; responseTimes=[];
  correctStreak=0; wrongStreak=0;
  correctAnswers=0;
  excludeLastQuestionFromCount=false;
  sessionOutcome="Completed";
  intervalCounts={}; intervalTime={};
  sessionIntervalTrace=[];
  resetQuestionStates();
  resetFeedbackIndicators();
  applyIntervalTimingVisibility(showIntervalTiming);
  sessionStartedAt=Date.now();
  sessionEndedAt=0;
  responseStartedAt=0;
  responseInterval=0;

  gameRunning=false;
  awaitingAnswer=false;

  currentIntervalStart=showIntervalTiming?getClockTime():0;

  answer.value="";

  currentInterval.textContent=startingInterval;
  updateSessionLimitUI();
  if(endCondition==="timer"){
    endTime=sessionStartedAt+duration;
    timeLeft.textContent=Math.ceil(duration/1000);
  }else{
    endTime=0;
  }
  intervalStats.innerHTML="";
  updateFeedbackUI();

  timeoutId=setTimeout(()=>{
    if(sessionState!=="starting") return;

    gameRunning=true;
    setSessionState("active");
    answer.focus();

    startStimulusScheduler();
    if(endCondition==="timer") updateTimer();
    tickIntervalTime(); // START CONTINUOUS TRACKING
  },100);
}

function stopGame(reason="manual"){
  if(sessionState!=="active"&&sessionState!=="starting") return;

  sessionOutcome=reason==="manual" ? "Manually exited" : "Completed";
  excludeLastQuestionFromCount=awaitingAnswer && numbers.length>=2 && answer.value.trim()==="";
  sessionEndedAt=Date.now();
  gameRunning=false;
  clearTimeout(timeoutId);
  stopStimulusAudioPlayback();
  void closeBeepAudioContext();

  if(awaitingAnswer && numbers.length>=2 && activeQuestionState){
    if(answer.value.trim()===""){
      updateLatestTraceResponseTime(responseInterval||interval,activeQuestionState.traceIndex);
    }else{
      finalizeQuestionState(activeQuestionState,answer.value,getClockTime());
    }
  }
  clearPendingAnswer();

  answer.blur();
  resetQuestionStates();

  // finalize last interval
  if(showIntervalTiming && currentIntervalStart){
    const now=getClockTime();
    if(interval !== startingInterval || intervalCounts[interval]){
      intervalTime[interval]=(intervalTime[interval]||0)+(now-currentIntervalStart);
    }
  }

  updateIntervalStats();

  if(endCondition==="timer") timeLeft.textContent="0";
  renderResults();
  const sessionRecord=buildSessionRecord();
  const latestTraceRecord=buildLatestTraceRecord();
  if(shouldStoreSession(sessionRecord)){
    void sessionHistoryStore.saveLatestTrace(latestTraceRecord).catch(()=>{});
    void sessionHistoryStore.saveSession(sessionRecord).catch(()=>{});
  }
  setSessionState("results");
}

function checkInputLive(event){
  if(sessionState!=="active") return;
  if(!awaitingAnswer || numbers.length<2 || !activeQuestionState || activeQuestionState.resolved) return;

  const submittedValue=answer.value.trim();
  if(submittedValue==="") return;

  if(isCorrectAnswerInput(activeQuestionState,submittedValue,getClockTime())){
    finalizeQuestionState(activeQuestionState,submittedValue,getClockTime());
  }
}

const startBtn=document.getElementById("startBtn");
const endSessionBtn=document.getElementById("endSessionBtn");
const newSessionBtn=document.getElementById("newSessionBtn");
const answer=document.getElementById("answer");
const startingIntervalInput=document.getElementById("startingInterval");
const minimumIntervalInput=document.getElementById("minimumInterval");
const durationInput=document.getElementById("duration");
const durationField=document.getElementById("durationField");
const intervalIncrementSelect=document.getElementById("intervalIncrement");
const intervalIncrementValue=document.getElementById("intervalIncrementValue");
const endConditionSelect=document.getElementById("endCondition");
const targetCorrectInput=document.getElementById("targetCorrect");
const targetCorrectField=document.getElementById("targetCorrectField");
const modeField=document.getElementById("modeField");
const modeSelect=document.getElementById("modeSelect");
const correctThresholdInput=document.getElementById("correctThreshold");
const incorrectThresholdInput=document.getElementById("incorrectThreshold");
const showAdvancedSettingsToggle=document.getElementById("showAdvancedSettingsToggle");
const advancedSettingsPanel=document.getElementById("advancedSettingsPanel");
const advancedSections=document.getElementById("advancedSections");
const normalThresholdPresetBtn=document.getElementById("normalThresholdPresetBtn");
const highAccuracyPresetBtn=document.getElementById("highAccuracyPresetBtn");
const thresholdHelp=document.querySelector(".threshold-help");
const thresholdInfoBtn=document.getElementById("thresholdInfoBtn");
const voiceSelect=document.getElementById("voiceSelect");
const voiceTestBtn=document.getElementById("voiceTestBtn");
const playbackSpeedSelect=document.getElementById("playbackSpeedSelect");
const beepToggle=document.getElementById("beepToggle");
const themeToggle=document.getElementById("themeToggle");
const showIntervalTimingToggle=document.getElementById("showIntervalTimingToggle");
const resetSettingsBtn=document.getElementById("resetSettingsBtn");
const playbackSpeedValue=document.getElementById("playbackSpeedValue");
const currentInterval=document.getElementById("currentInterval");
const timeLeft=document.getElementById("timeLeft");
const sessionLimitLabel=document.getElementById("sessionLimitLabel");
const sessionLimitSuffix=document.getElementById("sessionLimitSuffix");
const intervalStats=document.getElementById("intervalStats");
const resultsIntervalStatsWrap=document.getElementById("resultsIntervalStatsWrap");
const resultsIntervalStats=document.getElementById("resultsIntervalStats");
const sessionView=document.getElementById("sessionView");
const resultsView=document.getElementById("resultsView");
const resultAccuracy=document.getElementById("resultAccuracy");
const resultAverageResponse=document.getElementById("resultAverageResponse");
const resultDuration=document.getElementById("resultDuration");
const resultCorrect=document.getElementById("resultCorrect");
const resultQuestions=document.getElementById("resultQuestions");
const resultStatus=document.getElementById("resultStatus");
const settingsView=document.getElementById("settingsView");
const footerView=document.getElementById("footerView");
const historyView=document.getElementById("historyView");
const historyBtn=document.getElementById("historyBtn");
const clearSessionsOnlyBtn=document.getElementById("clearSessionsOnlyBtn");
const clearAllHistoryBtn=document.getElementById("clearAllHistoryBtn");
const historyFilterBtn=document.getElementById("historyFilterBtn");
const historyFilterCountBadge=document.getElementById("historyFilterCountBadge");
const resetHistoryFiltersBtn=document.getElementById("resetHistoryFiltersBtn");
const backFromHistoryBtn=document.getElementById("backFromHistoryBtn");
const refreshTrendChartsBtn=document.getElementById("refreshTrendChartsBtn");
const refreshSessionsBtn=document.getElementById("refreshSessionsBtn");
const exportHistoryBtn=document.getElementById("exportHistoryBtn");
const importHistoryBtn=document.getElementById("importHistoryBtn");
const importHistoryInput=document.getElementById("importHistoryInput");
const historyFiltersPanel=document.getElementById("historyFiltersPanel");
const historyStatusFilter=document.getElementById("historyStatusFilter");
const historyModeFilter=document.getElementById("historyModeFilter");
const historyTrendFilter=document.getElementById("historyTrendFilter");
const historyCompletedSessions=document.getElementById("historyCompletedSessions");
const historyCorrectAnswers=document.getElementById("historyCorrectAnswers");
const historyDurationTrained=document.getElementById("historyDurationTrained");
const historyChartModeSelect=document.getElementById("historyChartModeSelect");
const historyChartModeNote=document.getElementById("historyChartModeNote");
const accuracyTrendChart=document.getElementById("accuracyTrendChart");
const accuracyTrendDetails=document.getElementById("accuracyTrendDetails");
const responseTimeTrendChart=document.getElementById("responseTimeTrendChart");
const responseTimeTrendDetails=document.getElementById("responseTimeTrendDetails");
const latestIntervalChart=document.getElementById("latestIntervalChart");
const latestIntervalDetails=document.getElementById("latestIntervalDetails");
const latestIntervalBackBtn=document.getElementById("latestIntervalBackBtn");
const latestIntervalCaption=document.getElementById("latestIntervalCaption");
const recentSessionsList=document.getElementById("recentSessionsList");
const historyPaginationControls=document.querySelector(".history-pagination-controls");
const historyPaginationSummary=document.getElementById("historyPaginationSummary");
const historyPaginationIndicator=document.getElementById("historyPaginationIndicator");
const historyPrevPageBtn=document.getElementById("historyPrevPageBtn");
const historyNextPageBtn=document.getElementById("historyNextPageBtn");
const settingsControls=[
  startingIntervalInput,
  minimumIntervalInput,
  intervalIncrementSelect,
  durationInput,
  endConditionSelect,
  targetCorrectInput,
  modeSelect,
  correctThresholdInput,
  incorrectThresholdInput,
  showAdvancedSettingsToggle,
  voiceSelect,
  playbackSpeedSelect,
  beepToggle,
  themeToggle,
  showIntervalTimingToggle
];

startBtn.onclick=startGame;
endSessionBtn.onclick=()=>stopGame("manual");
newSessionBtn.onclick=()=>setSessionState("idle");
resetSettingsBtn.onclick=resetSettingsToDefault;
historyBtn.onclick=()=>{
  setHistoryVisible(true);
  void refreshHistoryView();
};
latestIntervalBackBtn.onclick=()=>{
  if(latestIntervalChartViewState.mode!=="detail") return;
  clearChartInteractions(latestIntervalChart);
  setLatestIntervalChartMode("overview",null);
  if(latestHistoryChartContext.latestTrace){
    renderLatestIntervalChart(latestHistoryChartContext.latestTrace);
  }
};
clearSessionsOnlyBtn.onclick=async()=>{
  if(!window.confirm("Delete saved sessions but keep lifetime totals?")) return;
  try{
    await historyTrendUpdateChain;
    setHistoryPageIndex(0);
    await sessionHistoryStore.clearSessionsOnly();
    await refreshHistoryView();
  }catch(e){}
};
clearAllHistoryBtn.onclick=async()=>{
  if(!window.confirm("Delete all saved history and totals from this browser?")) return;
  try{
    await historyTrendUpdateChain;
    setHistoryPageIndex(0);
    await sessionHistoryStore.clearAll();
    await refreshHistoryView();
  }catch(e){}
};
historyFilterBtn.onclick=()=>{
  toggleHistoryFiltersVisible();
};
backFromHistoryBtn.onclick=()=>setHistoryVisible(false);
refreshTrendChartsBtn.onclick=()=>{
  void refreshHistoryTrendCharts();
};
refreshSessionsBtn.onclick=()=>{
  void refreshHistorySessions();
};
exportHistoryBtn.onclick=async()=>{
  try{
    await historyTrendUpdateChain;
    const data=await sessionHistoryStore.exportData();
    const blob=new Blob([JSON.stringify(data,null,2)],{ type:"application/json" });
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download="cct-session-history.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }catch(e){}
};
importHistoryBtn.onclick=()=>importHistoryInput.click();
importHistoryInput.onchange=async()=>{
  const file=importHistoryInput.files&&importHistoryInput.files[0];
  if(!file) return;
  try{
    await historyTrendUpdateChain;
    const text=await file.text();
    const parsed=JSON.parse(text);
    await sessionHistoryStore.importData(parsed);
    setHistoryPageIndex(0);
    await refreshHistoryView();
  }catch(e){}
  importHistoryInput.value="";
};
historyStatusFilter.onchange=()=>{
  setHistoryFilterValue("status",historyStatusFilter.value);
  void refreshHistorySessions();
};
historyModeFilter.onchange=()=>{
  setHistoryFilterValue("mode",historyModeFilter.value);
  void refreshHistorySessions();
};
historyTrendFilter.onchange=()=>{
  setHistoryFilterValue("trendInclusion",historyTrendFilter.value);
  void refreshHistorySessions();
};
historyChartModeSelect.onchange=()=>{
  setHistoryChartMode(historyChartModeSelect.value);
  void refreshHistoryTrendCharts();
};
resetHistoryFiltersBtn.onclick=()=>{
  resetHistoryFilters();
  void refreshHistorySessions();
};
historyPrevPageBtn.onclick=()=>{
  if(historyPageIndex<=0) return;
  setHistoryPageIndex(historyPageIndex-1);
  void refreshHistorySessions();
};
historyNextPageBtn.onclick=()=>{
  setHistoryPageIndex(historyPageIndex+1);
  void refreshHistorySessions();
};
voiceTestBtn.onclick=()=>{
  void testSelectedVoice();
};
normalThresholdPresetBtn.onclick=()=>applyThresholdPreset(4,4);
highAccuracyPresetBtn.onclick=()=>applyThresholdPreset(5,3);
thresholdInfoBtn.onclick=event=>{
  event.stopPropagation();
  const isOpen=thresholdHelp.classList.toggle("tooltip-open");
  thresholdInfoBtn.setAttribute("aria-expanded",String(isOpen));
};
document.addEventListener("click",event=>{
  if(!thresholdHelp.contains(event.target)){
    thresholdHelp.classList.remove("tooltip-open");
    thresholdInfoBtn.setAttribute("aria-expanded","false");
  }
  if(historyFilterVisible && historyFiltersPanel && historyFilterBtn && !historyFiltersPanel.contains(event.target) && !historyFilterBtn.contains(event.target)){
    toggleHistoryFiltersVisible(false);
  }
});
showAdvancedSettingsToggle.addEventListener("change",()=>{
  if(!showAdvancedSettingsToggle.checked){
    thresholdHelp.classList.remove("tooltip-open");
    thresholdInfoBtn.setAttribute("aria-expanded","false");
  }
});
answer.addEventListener("input",checkInputLive);
document.addEventListener("pointerdown",event=>{
  if(sessionState!=="active") return;
  if(isAllowedSessionClick(event.target)) return;
  event.preventDefault();
  restoreAnswerFocus();
},true);
answer.addEventListener("blur",()=>{
  if(sessionState!=="active") return;
  setTimeout(()=>{
    if(sessionState==="active" && !isAllowedSessionClick(document.activeElement)){
      restoreAnswerFocus();
    }
  },0);
});
window.addEventListener("focus",()=>{
  if(sessionState==="active"){
    restoreAnswerFocus();
  }
});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible" && sessionState==="active"){
    restoreAnswerFocus();
  }
});
settingsControls.forEach(control=>{
  control.addEventListener("input",handleSettingsChange);
  control.addEventListener("change",handleSettingsChange);
});
voiceSelect.addEventListener("focus",()=>{
  void refreshVoiceLibrary();
});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){
    void refreshVoiceLibrary();
  }
});
async function initializeApp(){
  await refreshVoiceLibrary();
  applySettings(readSavedSettings());
  setSessionState("idle");
  historyVisible=false;
  updateAppViews();
}

void initializeApp();
