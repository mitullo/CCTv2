let interval=1000, startingInterval=1000, minimumInterval=200;
let intervalIncrement=100;
let numbers=[], feedback=[], responseTimes=[];
let correctStreak=0, wrongStreak=0;
let gameRunning=false, timeoutId, endTime;
let awaitingAnswer=false, beepEnabled=true;
let sessionState="idle";
let nextStimulusTime=0, isStimulusTick=false;
let endCondition="timer", targetCorrect=50, correctAnswers=0;
let arithmeticMode="addition";
let sessionStartedAt=0, sessionEndedAt=0;
let responseStartedAt=0, responseInterval=0;
let excludeLastQuestionFromCount=false;
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
  targetCorrect:"50",
  mode:"addition",
  voice:"female1",
  playbackSpeed:"1",
  beepEnabled:true,
  darkMode:false,
  showAdvancedSettings:false,
  showIntervalTiming:false
};

// NEW: live time tracking
let intervalCounts={}, intervalTime={}, currentIntervalStart=0;
let feedbackIndicatorColor=null, feedbackIndicatorCount=0;
let showIntervalTiming=false;
let selectedVoice="";
let playbackSpeed=1;
let voiceAudioCache={};
let activeStimulusAudios=new Set();
let voiceLibrary={};

function clampInteger(value,fallback,min,max){
  const parsed=parseInt(value,10);
  if(Number.isNaN(parsed)) return fallback;
  return Math.max(min,Math.min(max,parsed));
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

function setSessionState(nextState){
  sessionState=nextState;
  const sessionVisible=nextState==="starting"||nextState==="active";
  const resultsVisible=nextState==="results";

  sessionView.classList.toggle("hidden",!sessionVisible);
  resultsView.classList.toggle("hidden",!resultsVisible);
  settingsView.classList.toggle("hidden",sessionVisible||resultsVisible);
  footerView.classList.toggle("hidden",sessionVisible||resultsVisible);
  startBtn.disabled=nextState!=="idle";
  answer.disabled=nextState!=="active";
  endSessionBtn.disabled=!sessionVisible;
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
  const correctThreshold=Math.max(1,parseInt(correctThresholdInput.value)||parseInt(defaultSettings.correctThreshold));
  const incorrectThreshold=Math.max(1,parseInt(incorrectThresholdInput.value)||parseInt(defaultSettings.incorrectThreshold));
  return Math.max(correctThreshold,incorrectThreshold);
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
  void preloadVoice(selectedVoice);
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
  void preloadVoice(selectedVoice);
  updateEndConditionControls();
  saveSettings();
}

function applyIntervalTimingVisibility(isVisible){
  const wasVisible=showIntervalTiming;
  showIntervalTiming=isVisible;
  intervalStats.classList.toggle("hidden",!isVisible);
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
      label:entry,
      basePath:`audio/${voiceKey}`
    };
  }

  return {
    label:entry.label || formatVoiceLabel(voiceKey),
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
  try{
    const manifestResponse=await fetch("audio/voices.json");
    if(manifestResponse.ok){
      const manifest=await manifestResponse.json();
      if(Array.isArray(manifest)){
        manifest.forEach(item=>{
          if(!item) return;
          if(typeof item==="string"){
            discovered[item]=normalizeVoiceEntry(item,{});
            return;
          }
          const voiceKey=item.key||item.id||item.name;
          if(!voiceKey) return;
          discovered[voiceKey]=normalizeVoiceEntry(voiceKey,item);
        });
      }else{
        mergeVoiceEntries(discovered,manifest);
      }
    }
  }catch(e){}

  try{
    const response=await fetch("audio/");
    const html=await response.text();
    const matches=[...html.matchAll(/href="([^"/?#]+)\/"/g)];
    matches.forEach(match=>{
      const voiceKey=match[1];
      if(voiceKey==="."||voiceKey==="..") return;
      if(!discovered[voiceKey]){
        discovered[voiceKey]={
          label:formatVoiceLabel(voiceKey),
          basePath:`audio/${voiceKey}`
        };
      }
    });
  }catch(e){}

  if(!Object.keys(discovered).length){
    discovered.female1={ label:"Female 1", basePath:"audio/female1" };
    discovered.female2={ label:"Female 2", basePath:"audio/female2" };
  }

  voiceLibrary=discovered;
  return discovered;
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
    selectedVoice=voices[0]?.[0] || "female1";
  }
  voiceSelect.value=selectedVoice;
}

function getClockTime(){
  return window.performance&&window.performance.now?window.performance.now():Date.now();
}

function getVoiceConfig(voiceKey){
  const fallbackKey=Object.keys(voiceLibrary)[0];
  return voiceLibrary[voiceKey] || voiceLibrary[fallbackKey] || { label:"Voice", basePath:"audio/female1" };
}

function getVoiceClipUrl(voiceKey,num){
  const voice=getVoiceConfig(voiceKey);
  return `${voice.basePath}/${num}.mp3`;
}

function loadAudioClip(src){
  const audio=new Audio();
  audio.preload="auto";
  audio.src=src;
  audio.load();
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

function playBeep(){
  if(!beepEnabled)return;
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  const o=ctx.createOscillator();
  const g=ctx.createGain();
  o.frequency.value=1200; g.gain.value=0.1;
  o.connect(g); g.connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime+0.12);
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

function updateIntervalStats(){
  if(!showIntervalTiming){
    intervalStats.innerHTML="";
    return;
  }

  const el=document.getElementById("intervalStats"); el.innerHTML="";

  Object.keys(intervalCounts)
    .sort((a,b)=>b-a)
    .forEach(k=>{
      const time=(intervalTime[k]||0)/1000;
      const div=document.createElement("div");
      div.textContent = k + "ms: " + intervalCounts[k] + "  —  " + time.toFixed(1) + "s"; // EXACT 3 spaces
      el.appendChild(div);
    });
}

function getThresholds(){
  return {
    correct:Math.max(1,parseInt(correctThresholdInput.value)||parseInt(defaultSettings.correctThreshold)),
    wrong:Math.max(1,parseInt(incorrectThresholdInput.value)||parseInt(defaultSettings.incorrectThreshold))
  };
}

function changeInterval(newInterval){
  const clampedInterval=Math.max(minimumInterval,Math.min(startingInterval,newInterval));
  if(clampedInterval===interval) return;

  const now=getClockTime();
  const previousInterval=interval;

  if(showIntervalTiming){
    // finalize previous interval time
    if(previousInterval !== startingInterval || intervalCounts[previousInterval]){
      intervalTime[previousInterval]=(intervalTime[previousInterval]||0)+(now-currentIntervalStart);
    }
  }

  interval=clampedInterval;
  if(showIntervalTiming){
    currentIntervalStart=now;

    // count AFTER first change rule
    intervalCounts[interval]=(intervalCounts[interval]||0)+1;

    updateIntervalStats();
  }
  resetFeedbackIndicators();

  if(gameRunning&&!isStimulusTick){
    if(interval<previousInterval && nextStimulusTime){
      nextStimulusTime=Math.max(now,nextStimulusTime-(previousInterval-interval));
    }else{
      nextStimulusTime=now+interval;
    }
    scheduleNextStimulus();
  }
}

function adjustDifficulty(){
  const t=getThresholds();

  if(correctStreak>=t.correct){
    changeInterval(interval-intervalIncrement);
    correctStreak=0;
  }

  if(wrongStreak>=t.wrong){
    changeInterval(interval+intervalIncrement);
    wrongStreak=0;
  }

  document.getElementById("currentInterval").textContent=interval;
}

function recordScoredItem(isCorrect,responseTime){
  feedback.push(isCorrect);
  responseTimes.push(Math.max(0,responseTime));
  if(isCorrect) correctAnswers++;
}

function clearPendingAnswer(){
  awaitingAnswer=false;
  responseStartedAt=0;
  responseInterval=0;
  answer.value="";
}

function registerWrong(){
  recordScoredItem(false,responseInterval||interval);
  setFeedbackIndicators("red",wrongStreak+1);
  wrongStreak++;
  correctStreak=0;
  clearPendingAnswer();
  playBeep();
  adjustDifficulty();
}

function finalizePendingAnswer(){
  if(awaitingAnswer && numbers.length>=2){
    const val=parseInt(answer.value);
    const correct=getExpectedAnswer(numbers[numbers.length-2],numbers[numbers.length-1]);

    if(val===correct){
      recordScoredItem(true,Math.min(Math.max(0,responseStartedAt?getClockTime()-responseStartedAt:0),responseInterval||interval));
    }else{
      recordScoredItem(false,responseInterval||interval);
    }
  }

  clearPendingAnswer();
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
}

function scheduleNextStimulus(){
  if(!gameRunning)return;

  clearTimeout(timeoutId);
  const delay=Math.max(0,nextStimulusTime-getClockTime());
  timeoutId=setTimeout(runStimulus,delay);
}

function startStimulusScheduler(){
  nextStimulusTime=getClockTime();
  scheduleNextStimulus();
}

function runStimulus(){
  if(!gameRunning)return;

  isStimulusTick=true;

  if(awaitingAnswer && numbers.length>=2) registerWrong();

  const num=getRandomNumber();
  const now=getClockTime();
  numbers.push(num);
  playStimulusAudio(num);

  if(numbers.length>=2){
    awaitingAnswer=true;
    responseStartedAt=now;
    responseInterval=interval;
  }else{
    clearPendingAnswer();
  }

  nextStimulusTime+=interval;

  if(nextStimulusTime<=now){
    nextStimulusTime=now+interval;
  }

  isStimulusTick=false;
  scheduleNextStimulus();
}

function updateTimer(){
  if(!gameRunning||endCondition!=="timer")return;
  const r=Math.max(0,Math.floor((endTime-Date.now())/1000));
  document.getElementById("timeLeft").textContent=r;
  if(r<=0) stopGame(); else requestAnimationFrame(updateTimer);
}

async function startGame(){
  if(sessionState!=="idle") return;

  saveSettings();
  setSessionState("starting");

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

  numbers=[]; feedback=[]; responseTimes=[];
  correctStreak=0; wrongStreak=0;
  correctAnswers=0;
  excludeLastQuestionFromCount=false;
  intervalCounts={}; intervalTime={};
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

function stopGame(){
  if(sessionState!=="active"&&sessionState!=="starting") return;

  excludeLastQuestionFromCount=awaitingAnswer && numbers.length>=2 && answer.value.trim()==="";
  sessionEndedAt=Date.now();
  gameRunning=false;
  clearTimeout(timeoutId);
  stopStimulusAudioPlayback();
  finalizePendingAnswer();
  answer.blur();

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
  setSessionState("results");
}

function checkInputLive(){
  if(sessionState!=="active") return;
  if(!awaitingAnswer || numbers.length<2)return;

  const val=parseInt(answer.value);
  const correct=getExpectedAnswer(numbers[numbers.length-2],numbers[numbers.length-1]);

  if(val===correct){
    const elapsed=responseStartedAt?getClockTime()-responseStartedAt:0;
    const responseTime=Math.min(Math.max(0,elapsed),responseInterval||interval);
    recordScoredItem(true,responseTime);
    setFeedbackIndicators("green",correctStreak+1);
    correctStreak++;
    wrongStreak=0;

    clearPendingAnswer();

    adjustDifficulty();
    updateSessionLimitUI();

    if(endCondition==="correct"&&correctAnswers>=targetCorrect){
      stopGame();
    }
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
const sessionView=document.getElementById("sessionView");
const resultsView=document.getElementById("resultsView");
const resultAccuracy=document.getElementById("resultAccuracy");
const resultAverageResponse=document.getElementById("resultAverageResponse");
const resultDuration=document.getElementById("resultDuration");
const resultCorrect=document.getElementById("resultCorrect");
const resultQuestions=document.getElementById("resultQuestions");
const settingsView=document.getElementById("settingsView");
const footerView=document.getElementById("footerView");
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
endSessionBtn.onclick=stopGame;
newSessionBtn.onclick=()=>setSessionState("idle");
resetSettingsBtn.onclick=resetSettingsToDefault;
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
});
showAdvancedSettingsToggle.addEventListener("change",()=>{
  if(!showAdvancedSettingsToggle.checked){
    thresholdHelp.classList.remove("tooltip-open");
    thresholdInfoBtn.setAttribute("aria-expanded","false");
  }
});
answer.addEventListener("input",checkInputLive);
settingsControls.forEach(control=>{
  control.addEventListener("input",handleSettingsChange);
  control.addEventListener("change",handleSettingsChange);
});
async function initializeApp(){
  await discoverVoices();
  populateVoiceSelect();
  applySettings(readSavedSettings());
  setSessionState("idle");
}

void initializeApp();
