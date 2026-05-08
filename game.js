// =============================================================
// GLOBAL VARIABLES
// All variables that need to be accessed across multiple
// functions are declared here at the top of the file.
// =============================================================

// --- Canvas and drawing context ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Webcam and MediaPipe hand tracking ---
const webcamVideo = document.getElementById('webcam');
const handCanvas = document.getElementById('handCanvas');
const handCtx = handCanvas.getContext('2d');
let mediaPipeHands = null;
let currentLandmarks = null; // updated every frame by MediaPipe
const speechEnabled = 'speechSynthesis' in window;
let availableVoices = [];
let speechUnlocked = false;
let queuedSpeech = '';
let speechPrimed = false;
let voiceButton = null;
let currentVoiceAudio = null;
let voiceoverEnabled = false;

const SPEECH_SETTINGS = {
  rate: 0.9,
  pitch: 1.12,
  volume: 0.78,
  language: 'en-US'
};

const SPOKEN_STATUS_COOLDOWN_MS = 5500;
let lastSpokenStatus = '';
let lastSpokenStatusAt = 0;

const PREFERRED_VOICE_NAME_HINTS = [
  'Natural',
  'Neural',
  'Premium',
  'Enhanced',
  'Samantha',
  'Zoe',
  'Aria',
  'Jenny',
  'Michelle',
  'Serena',
  'Ava',
  'Allison',
  'Google US English',
  'Karen',
  'Moira'
];

// --- Road scrolling ---
let roadY1 = 0;
let roadY2 = -720;
const ROAD_SPEED = 3;

// --- Car state ---
const car = {
  x: 240,
  y: 580,
  width: 40,
  height: 70,
  speed: 4
};

// --- Keyboard input tracking ---
const keys = {};

// --- Game state flags ---
let isStuck = false;
let gameMode = null;     // 'choice' or 'signIt' — which popup mode is active
let isPaused = false;
let gameStarted = false;
let imagesLoaded = 0;
const TOTAL_IMAGES = 2;  // road + car (sign images load separately)
const POPUP_CLOSE_DELAY_MS = 500;
const NEXT_OBSTACLE_DELAY_MS = 4000;

// --- Score and distance ---
let score = 0;
let distance = 0;
let mudSnowAvoidedCount = 0;
let hasAskedForMoreObstacles = false;
let bonusObstaclesEnabled = false;
let difficultyChoiceLocked = false;

// --- Toll booth state ---
// Tracks the animated gate bar during open/close sequences
let tollBooth = {
  active: false,
  gateOpenPct: 0,   // 0 = fully closed, 1 = fully open
  phase: 'idle'     // idle | closing | open | resolved
};

// --- Pre-flash mechanic ---
// Before an obstacle arrives, sign images flash briefly to teach recognition
let flashTimer = 0;
const FLASH_DURATION = 120;  // frames (~2 seconds at 60fps)
let flashActive = false;
let waitingForNextObstacle = false;
let pendingObstacleIndex = null; // which obstacle type is about to appear
let lanePromptLocked = false;

// --- Gesture stability tracking ---
// Require gesture to match for N consecutive frames before accepting
let lastDetectedGesture = null;
let gestureConfidenceCount = 0;
const GESTURE_CONFIDENCE_THRESHOLD = 2;  // frames needed to confirm a gesture

// --- Obstacle definitions ---
// Each obstacle type defines its appearance, mechanic type,
// the correct answer, and which sign images to show.
// Add more entries here to expand the game later.
const OBSTACLE_TYPES = [
  {
    id: 'mud',
    label: 'MUD',
    color: '#7a5c2e',
    mechanic: 'choice',               // player presses a key to pick the right sign
    prompt: 'Pick GO.',
    correctKey: 'g',                  // player must press G
    signs: {                          // three signs shown — no word labels
      s: 'PNGs/sign_stop.png',
      g: 'PNGs/sign_go.png',
      p: 'PNGs/sign_park.png'
    },
    correctSignId: 'b'                // sign B (middle image) is the correct one (GO)
  },
  {
    id: 'snow',
    label: 'SNOW',
    color: '#a8d8ea',
    mechanic: 'signIt',              // player signs the word using webcam
    prompt: 'Sign SNOW to get unstuck.',
    signImage: 'PNGs/sign_snow.png',
    gesture: 'snow'
  },
  {
    id: 'cones',
    label: 'CONES',
    color: '#ff7a00',
    mechanic: 'signIt',
    prompt: 'Sign HELP.',
    signImage: 'PNGs/sign_help.png',
    gesture: 'help',
    obstacleWidth: 150,
    obstacleHeight: 60
  },
  {
    id: 'barricade',
    label: 'BARRIER',
    color: '#e14d2a',
    mechanic: 'avoid',
    obstacleWidth: 180,
    obstacleHeight: 50
  },
  {
    id: 'tollOpen',
    label: 'TOLL',
    color: '#f5c842',
    mechanic: 'signIt',
    prompt: 'Sign OPEN to raise the gate!',
    signImage: 'PNGs/sign_open.png',
    gesture: 'open'
  },
  {
    id: 'tollClose',
    label: 'TOLL',
    color: '#f5c842',
    mechanic: 'signIt',
    prompt: 'Sign CLOSE as you pass through.',
    signImage: 'PNGs/sign_close.png',
    gesture: 'close'
  }
];

// --- Active obstacle instance ---
// This tracks the single obstacle currently on screen
let activeObstacle = {
  x: 240,
  y: -150,
  width: 90,
  height: 45,
  typeIndex: 0,         // index into OBSTACLE_TYPES
  spawned: false,
  flashed: false,       // true once the pre-flash has been shown for this obstacle
  promptedLane: false,
  challengeTriggered: false
};

// --- Images ---
const roadImg = new Image();
const carImg = new Image();
roadImg.src = 'PNGs/road_asphalt01.png';
carImg.src = 'PNGs/car_blue_4.png';


// =============================================================
// IMAGE LOADING
// Waits for both road and car images to load before starting.
// Sign images are loaded on demand when popups appear.
// =============================================================

function onImageLoad() {
  imagesLoaded++;
  if (imagesLoaded === TOTAL_IMAGES) {
    initSpeechVoices();
    initGameControls();
    initMediaPipe();
    gameLoop();
  }
}

roadImg.onload = onImageLoad;
carImg.onload = onImageLoad;
roadImg.onerror = function() { console.error('PNGs/road_asphalt01.png failed to load'); };
carImg.onerror = function() { console.error('PNGs/car_blue_4.png failed to load'); };


// =============================================================
// SPEECH / VOICEOVER
// =============================================================

function initSpeechVoices() {
  if (!speechEnabled) return;

  const loadVoices = function() {
    availableVoices = window.speechSynthesis.getVoices();
  };

  loadVoices();
  setTimeout(loadVoices, 250);
  setTimeout(loadVoices, 1000);
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function initGameControls() {
  const pauseBtn = document.getElementById('pauseBtn');
  const loginOverlay = document.getElementById('loginOverlay');
  const loginName = document.getElementById('loginName');
  const loginPassword = document.getElementById('loginPassword');
  const loginSubmit = document.getElementById('loginSubmit');
  const loginError = document.getElementById('loginError');

  createVoiceButton();

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && speechEnabled && voiceoverEnabled && !isPaused) {
      window.speechSynthesis.resume();
    }
  });

  if (pauseBtn) {
    pauseBtn.addEventListener('click', function() {
      isPaused = !isPaused;
      pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
      if (isPaused) {
        stopVoiceover();
      }
    });
  }

  const tryLogin = function() {
    if (!loginName || !loginPassword || !loginError || !loginOverlay) return;
    const user = loginName.value.trim();
    const pass = loginPassword.value;

    if (user === 'Chloe' && pass === 'Uncharted') {
      unlockSpeech();
      loginError.textContent = '';
      loginOverlay.style.display = 'none';
      showStartSignPopup();
    } else {
      loginError.textContent = 'Incorrect demo login. Try Chloe / Uncharted.';
    }
  };

  if (loginSubmit) {
    loginSubmit.addEventListener('click', tryLogin);
  }

  if (loginPassword) {
    loginPassword.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        tryLogin();
      }
    });
  }

  if (loginName) {
    loginName.focus();
  }
}

function createVoiceButton() {
  if (voiceButton) return;

  voiceButton = document.createElement('button');
  voiceButton.id = 'voiceEnableBtn';
  voiceButton.type = 'button';
  voiceButton.textContent = 'Enable Voice';
  voiceButton.style.position = 'fixed';
  voiceButton.style.top = '14px';
  voiceButton.style.right = '14px';
  voiceButton.style.zIndex = '45';
  voiceButton.style.background = '#f5c842';
  voiceButton.style.color = '#162033';
  voiceButton.style.border = '1px solid rgba(255,255,255,0.45)';
  voiceButton.style.borderRadius = '8px';
  voiceButton.style.padding = '8px 12px';
  voiceButton.style.fontWeight = 'bold';
  voiceButton.style.cursor = 'pointer';

  voiceButton.addEventListener('click', function() {
    if (voiceoverEnabled) {
      voiceoverEnabled = false;
      stopVoiceover();
      updateVoiceButton();
      return;
    }

    unlockSpeech();
    const currentPrompt = document.getElementById('popup').style.display === 'block'
      ? getCurrentPopupSpeechText()
      : 'Voice on.';
    speakPrompt(currentPrompt || 'Voice on.', true);
    updateVoiceButton();
  });

  document.body.appendChild(voiceButton);
  updateVoiceButton();
}

function updateVoiceButton() {
  if (!voiceButton) return;
  voiceButton.disabled = false;
  voiceButton.textContent = voiceoverEnabled ? 'Voice On' : 'Voice Off';
  voiceButton.style.opacity = voiceoverEnabled ? '0.72' : '1';
}

function unlockSpeech() {
  speechUnlocked = true;
  voiceoverEnabled = true;
  speechPrimed = true;
  if (speechEnabled) window.speechSynthesis.resume();
  updateVoiceButton();

  if (queuedSpeech) {
    const pendingText = queuedSpeech;
    queuedSpeech = '';
    setTimeout(function() {
      speakPrompt(pendingText, true);
    }, 30);
  }
}

function stopVoiceover() {
  stopCurrentVoiceAudio();
  if (speechEnabled) {
    window.speechSynthesis.cancel();
  }
}

function pickPreferredVoice() {
  if (!availableVoices.length) return null;

  const englishVoices = availableVoices.filter(function(v) {
    return (v.lang || '').toLowerCase().startsWith('en');
  });

  const pool = englishVoices.length ? englishVoices : availableVoices;
  const scoredVoices = pool.map(function(v) {
    const name = (v.name || '').toLowerCase();
    let score = 0;

    for (let i = 0; i < PREFERRED_VOICE_NAME_HINTS.length; i++) {
      const hint = PREFERRED_VOICE_NAME_HINTS[i].toLowerCase();
      if (name.includes(hint)) {
        score += 20;
      }
    }

    if (v.localService) score += 12;
    if (v.default) score += 6;

    return { voice: v, score: score };
  });

  scoredVoices.sort(function(a, b) {
    return b.score - a.score;
  });

  return scoredVoices[0].voice;
}

function cleanSpeechText(text) {
  return String(text || '')
    .replace(/[✓—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function audioKey(text) {
  return cleanSpeechText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Local audio file map — add toll booth prompts here when you record them
const LOCAL_VOICE_AUDIO = {
  [audioKey('Voice on.')]: 'Audio/voice_on.m4a',
  [audioKey('Sign PLAY. Start driving.')]: 'Audio/start_play.m4a',
  [audioKey('Remember these signs!')]: 'Audio/remember_signs.m4a',
  [audioKey('Pick GO.')]: 'Audio/mud_prompt.m4a',
  [audioKey('Sign SNOW to get unstuck.')]: 'Audio/snow_prompt.m4a',
  [audioKey('Sign HELP.')]: 'Audio/cones_prompt.m4a',
  [audioKey('Sign LEFT or RIGHT. Dodge now.')]: 'Audio/lane_prompt.m4a',
  [audioKey('More obstacles? Sign MORE or NO.')]: 'Audio/difficulty_prompt.m4a',
  [audioKey('Great signing! Starting now.')]: 'Audio/great_starting.m4a',
  [audioKey('Sign PLAY.')]: 'Audio/show_play.m4a',
  [audioKey('Dodging LEFT!')]: 'Audio/dodging_left.m4a',
  [audioKey('Dodging RIGHT!')]: 'Audio/dodging_right.m4a',
  [audioKey('Sign LEFT or RIGHT to dodge.')]: 'Audio/sign_left_right.m4a',
  [audioKey('Great signing!')]: 'Audio/great_signing.m4a',
  [audioKey('Nice! More obstacles enabled.')]: 'Audio/more_enabled.m4a',
  [audioKey('Standard obstacles.')]: 'Audio/standard_obstacles.m4a',
  [audioKey('Keep trying.')]: 'Audio/keep_trying.m4a',
  [audioKey('Sign MORE or NO.')]: 'Audio/sign_more_no.m4a',
  [audioKey('Try again.')]: 'Audio/not_quite.m4a'
};

function stopCurrentVoiceAudio() {
  if (!currentVoiceAudio) return;
  currentVoiceAudio.pause();
  currentVoiceAudio.currentTime = 0;
}

function playLocalVoice(spokenText) {
  if (!voiceoverEnabled || isPaused) return false;

  const src = LOCAL_VOICE_AUDIO[audioKey(spokenText)];
  if (!src) return false;

  stopCurrentVoiceAudio();
  if (speechEnabled) window.speechSynthesis.cancel();

  currentVoiceAudio = new Audio(src);
  currentVoiceAudio.volume = SPEECH_SETTINGS.volume;
  currentVoiceAudio.play().catch(function(error) {
    console.warn('Local voice audio blocked or failed:', error);
    speakWithBrowserVoice(spokenText);
  });
  return true;
}

function speakWithBrowserVoice(spokenText) {
  if (!speechEnabled || !voiceoverEnabled || isPaused) return;

  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.lang = SPEECH_SETTINGS.language;
  utterance.rate = SPEECH_SETTINGS.rate;
  utterance.pitch = SPEECH_SETTINGS.pitch;
  utterance.volume = SPEECH_SETTINGS.volume;

  const preferredVoice = pickPreferredVoice();
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  utterance.onerror = function(event) {
    console.warn('Speech synthesis error:', event.error || event);
    if (preferredVoice) {
      const fallback = new SpeechSynthesisUtterance(spokenText);
      fallback.lang = SPEECH_SETTINGS.language;
      fallback.rate = SPEECH_SETTINGS.rate;
      fallback.pitch = SPEECH_SETTINGS.pitch;
      fallback.volume = SPEECH_SETTINGS.volume;
      window.speechSynthesis.speak(fallback);
    }
  };

  window.speechSynthesis.speak(utterance);
}

function speakPrompt(text, forcePlay) {
  const spokenText = cleanSpeechText(text);
  if (!spokenText) return;
  if (!voiceoverEnabled || isPaused) return;

  if (!speechUnlocked && !forcePlay) {
    queuedSpeech = spokenText;
    return;
  }

  if (playLocalVoice(spokenText)) return;
  speakWithBrowserVoice(spokenText);
}

function getCurrentPopupSpeechText() {
  const choiceVisible = document.getElementById('choiceMode').style.display === 'block';
  const signItVisible = document.getElementById('signItMode').style.display === 'block';
  const useChoiceText = choiceVisible || (!signItVisible && gameMode === 'choice');

  const promptText = useChoiceText
    ? document.getElementById('choicePrompt').textContent
    : document.getElementById('signItPrompt').textContent;
  const resultText = useChoiceText
    ? document.getElementById('choiceFeedback').textContent
    : document.getElementById('signResult').textContent;
  return [promptText, resultText].filter(Boolean).join(' ');
}

function speakPopupLines() {
  if (isPaused) return;
  speakPrompt(getCurrentPopupSpeechText());
}

function speakStatus(message) {
  const spokenText = cleanSpeechText(message);
  if (!spokenText) return;

  const now = Date.now();
  if (spokenText === lastSpokenStatus && now - lastSpokenStatusAt < SPOKEN_STATUS_COOLDOWN_MS) {
    return;
  }

  lastSpokenStatus = spokenText;
  lastSpokenStatusAt = now;
  speakPrompt(spokenText);
}

function setSignResult(message, shouldSpeak) {
  document.getElementById('signResult').textContent = message;
  if (shouldSpeak) speakStatus(message);
}

function setChoiceFeedback(message, shouldSpeak) {
  document.getElementById('choiceFeedback').textContent = message;
  if (shouldSpeak) speakStatus(message);
}


// =============================================================
// KEYBOARD INPUT
// Tracks which keys are currently held down.
// On keydown, also checks for popup answer input.
// =============================================================

document.addEventListener('keydown', function(e) {
  keys[e.key] = true;
  handlePopupKeyPress(e.key);
});

document.addEventListener('keyup', function(e) {
  keys[e.key] = false;
});

// Handles key presses while a popup is showing.
// Only S, G, P are valid choice answers.
function handlePopupKeyPress(key) {
  if (!isStuck) return;
  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];

  if (gameMode === 'choice') {
    const pressed = key.toLowerCase();
    if (pressed === 's' || pressed === 'g' || pressed === 'p') {
      if (pressed === type.correctKey) {
        resolveObstacle(true);
      } else {
        showChoiceFeedback('Try again.');
      }
    }
  }
  // signIt mode is resolved by gesture recognition, not key press
}


// =============================================================
// MEDIAPIPE HANDS SETUP
// Initializes the MediaPipe Hands model and webcam stream.
// Runs silently in the background once the game starts.
// =============================================================

function initMediaPipe() {
  mediaPipeHands = new Hands({
    locateFile: function(file) {
      return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + file;
    }
  });

  mediaPipeHands.setOptions({
    maxNumHands: 1,
    modelComplexity: 0,      // 0 = lite, fast enough for real-time
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5
  });

  // This callback fires every frame with detected hand landmarks
  mediaPipeHands.onResults(function(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      currentLandmarks = results.multiHandLandmarks[0];
    } else {
      currentLandmarks = null;
    }
    drawHandOverlay(results);
    checkGestureIfNeeded();
  });

  // Start the webcam
  navigator.mediaDevices.getUserMedia({ video: true }).then(function(stream) {
    webcamVideo.srcObject = stream;
    webcamVideo.play();

    // Feed webcam frames into MediaPipe continuously
    const camera = new Camera(webcamVideo, {
      onFrame: async function() {
        await mediaPipeHands.send({ image: webcamVideo });
      },
      width: 320,
      height: 240
    });
    camera.start();
  }).catch(function(err) {
    console.warn('Webcam not available:', err);
  });
}


// =============================================================
// HAND LANDMARK DRAWING
// Draws dots on the handCanvas overlay so the player
// can see their hand is being detected during sign-it mode.
// =============================================================

function drawHandOverlay(results) {
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  if (!results.multiHandLandmarks) return;

  results.multiHandLandmarks.forEach(function(landmarks) {
    landmarks.forEach(function(lm) {
      const x = lm.x * handCanvas.width;
      const y = lm.y * handCanvas.height;
      handCtx.beginPath();
      handCtx.arc(x, y, 3, 0, Math.PI * 2);
      handCtx.fillStyle = '#f5c842';
      handCtx.fill();
    });
  });
}


// =============================================================
// GESTURE RECOGNITION
// Called every MediaPipe frame. Only runs during sign-it mode.
// Each gesture function returns true if the hand shape matches.
// Landmarks reference: 0=wrist, 4=thumb tip, 8=index tip,
// 12=middle tip, 16=ring tip, 20=pinky tip.
// =============================================================

function checkGestureIfNeeded() {
  if (isPaused) return;
  if (!isStuck || !currentLandmarks) return;

  // --- Start sign (PLAY) ---
  if (gameMode === 'startSign') {
    const matchedStart = confirmGesture('play', currentLandmarks);
    if (matchedStart) {
      setSignResult('Great signing!', true);
      lastDetectedGesture = null;
      gestureConfidenceCount = 0;
      setTimeout(function() {
        isStuck = false;
        gameMode = null;
        gameStarted = true;
        hideAllPopups();
        hideHandCanvas();
      }, 700);
    } else {
      setSignResult('Sign PLAY.', true);
    }
    return;
  }

  // --- Lane dodge (LEFT / RIGHT) ---
  if (gameMode === 'lanePrompt') {
    if (lanePromptLocked) return;

    const matchedLeft = confirmGesture('left', currentLandmarks);
    const matchedRight = confirmGesture('right', currentLandmarks);

    if (matchedLeft) {
      lanePromptLocked = true;
      car.x = Math.max(50, car.x - 95);
      setSignResult('Dodging LEFT!', true);
      lastDetectedGesture = null;
      gestureConfidenceCount = 0;
      setTimeout(finishLanePrompt, 500);
      return;
    }

    if (matchedRight) {
      lanePromptLocked = true;
      car.x = Math.min(430, car.x + 95);
      setSignResult('Dodging RIGHT!', true);
      lastDetectedGesture = null;
      gestureConfidenceCount = 0;
      setTimeout(finishLanePrompt, 500);
      return;
    }

    setSignResult('Sign LEFT or RIGHT.', true);
    return;
  }

  // --- Difficulty choice (MORE / NO) ---
  if (gameMode === 'difficultySign') {
    if (difficultyChoiceLocked) return;
    const choice = recognizeDifficultyChoice(currentLandmarks);
    if (choice === 'more' || choice === 'no') {
      difficultyChoiceLocked = true;
      if (choice === 'more') {
        bonusObstaclesEnabled = true;
        setSignResult('Nice! More obstacles enabled.', true);
      } else {
        bonusObstaclesEnabled = false;
        setSignResult('Standard obstacles.', true);
      }
      setTimeout(function() {
        finishDifficultyPrompt();
      }, 900);
    }
    return;
  }

  // --- Standard signIt obstacles (snow, help, open, close, etc.) ---
  if (gameMode !== 'signIt') return;

  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
  const matched = confirmGesture(type.gesture, currentLandmarks);

  if (matched) {
    setSignResult('Great signing!', true);
    lastDetectedGesture = null;
    gestureConfidenceCount = 0;
    // Animate gate opening for toll booth before resolving
    if (type.id === 'tollOpen') {
      tollBooth.phase = 'open';
      setTimeout(function() {
        resolveObstacle(true);
      }, 900);
    } else {
      setTimeout(function() {
        resolveObstacle(true);
      }, 800);
    }
  } else {
    setSignResult('Keep trying.', true);
  }
}

// Routes to the correct gesture checker by name
function recognizeGesture(gestureName, landmarks) {
  if (gestureName === 'play')  return gesturePlay(landmarks);
  if (gestureName === 'snow')  return gestureSnow(landmarks);
  if (gestureName === 'stop')  return gestureStop(landmarks);
  if (gestureName === 'go')    return gestureGo(landmarks);
  if (gestureName === 'help')  return gestureHelp(landmarks);
  if (gestureName === 'left')  return gestureLeft(landmarks);
  if (gestureName === 'right') return gestureRight(landmarks);
  if (gestureName === 'more')  return gestureMore(landmarks);
  if (gestureName === 'no')    return gestureNo(landmarks);
  if (gestureName === 'open')  return gestureOpen(landmarks);
  if (gestureName === 'close') return gestureClose(landmarks);
  return false;
}

// Confirms a gesture match after N consecutive frames to reduce noise
function confirmGesture(gestureName, landmarks) {
  const matched = recognizeGesture(gestureName, landmarks);

  if (matched) {
    if (lastDetectedGesture === gestureName) {
      gestureConfidenceCount++;
      return gestureConfidenceCount >= GESTURE_CONFIDENCE_THRESHOLD;
    } else {
      lastDetectedGesture = gestureName;
      gestureConfidenceCount = 1;
      return false;
    }
  } else {
    if (lastDetectedGesture === gestureName) {
      lastDetectedGesture = null;
      gestureConfidenceCount = 0;
    }
    return false;
  }
}

// PLAY: reuses GO or a loose open hand — signs the game into action
function gesturePlay(landmarks) {
  return gestureGo(landmarks) || gestureOut(landmarks);
}

function recognizeDifficultyChoice(landmarks) {
  if (gestureMore(landmarks)) return 'more';
  if (gestureNo(landmarks)) return 'no';
  setSignResult('Sign MORE or NO.', true);
  return null;
}

// SNOW: open spread hand — all fingertips above knuckles, thumb spread
function gestureSnow(landmarks) {
  const tips  = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];
  const allExtended = tips.every(function(tip, i) {
    return landmarks[tip].y < landmarks[bases[i]].y;
  });
  const thumbSpread = Math.abs(landmarks[4].x - landmarks[5].x) > 0.08;
  return allExtended && thumbSpread;
}

// STOP: flat open hand, all four fingers extended upward
function gestureStop(landmarks) {
  const tips  = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];
  return tips.every(function(tip, i) {
    return landmarks[tip].y < landmarks[bases[i]].y;
  });
}

// GO: index finger extended, other three fingers curled
function gestureGo(landmarks) {
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const middleCurled  = landmarks[12].y > landmarks[10].y;
  const ringCurled    = landmarks[16].y > landmarks[14].y;
  const pinkyCurled   = landmarks[20].y > landmarks[18].y;
  return indexExtended && middleCurled && ringCurled && pinkyCurled;
}

// HELP: closed fist — all fingertips curled down, thumb tucked in
function gestureHelp(landmarks) {
  const curledFingers = [8, 12, 16, 20].every(function(tip) {
    return landmarks[tip].y > landmarks[tip - 2].y;
  });
  const thumbIn = Math.abs(landmarks[4].x - landmarks[3].x) < 0.06;
  return curledFingers && thumbIn;
}

// OUT: open hand, most fingers extended (at least 3 of 4)
function gestureOut(landmarks) {
  const tips = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];
  const extendedCount = tips.reduce(function(count, tip, i) {
    return count + (landmarks[tip].y < landmarks[bases[i]].y ? 1 : 0);
  }, 0);
  const thumbSeparation = Math.abs(landmarks[4].x - landmarks[5].x) +
                          Math.abs(landmarks[4].y - landmarks[5].y);
  const thumbAway = thumbSeparation > 0.08;
  return extendedCount >= 3 && thumbAway;
}

// LEFT: index pointing left relative to wrist, others curled
function gestureLeft(landmarks) {
  const wristX = landmarks[0].x;
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const othersCurled = landmarks[12].y > landmarks[10].y &&
    landmarks[16].y > landmarks[14].y &&
    landmarks[20].y > landmarks[18].y;
  const pointingLeft = landmarks[8].x < wristX - 0.06;
  return indexExtended && othersCurled && pointingLeft;
}

// RIGHT: index pointing right relative to wrist, others curled
function gestureRight(landmarks) {
  const wristX = landmarks[0].x;
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const othersCurled = landmarks[12].y > landmarks[10].y &&
    landmarks[16].y > landmarks[14].y &&
    landmarks[20].y > landmarks[18].y;
  const pointingRight = landmarks[8].x > wristX + 0.06;
  return indexExtended && othersCurled && pointingRight;
}

// MORE: fingertips gathered toward thumb tip (one-hand approximation)
function gestureMore(landmarks) {
  const thumbTip = landmarks[4];
  const fingerTips = [8, 12, 16, 20];
  return fingerTips.every(function(i) {
    const dx = landmarks[i].x - thumbTip.x;
    const dy = landmarks[i].y - thumbTip.y;
    return Math.hypot(dx, dy) < 0.11;
  });
}

// NO: index and middle extended together, ring and pinky curled
function gestureNo(landmarks) {
  const indexExtended  = landmarks[8].y < landmarks[6].y;
  const middleExtended = landmarks[12].y < landmarks[10].y;
  const ringCurled     = landmarks[16].y > landmarks[14].y;
  const pinkyCurled    = landmarks[20].y > landmarks[18].y;
  const fingersClose   = Math.hypot(
    landmarks[8].x - landmarks[12].x,
    landmarks[8].y - landmarks[12].y
  ) < 0.07;
  return indexExtended && middleExtended && ringCurled && pinkyCurled && fingersClose;
}

// OPEN: spread hand — thumb and pinky tips far apart horizontally, all fingers extended
function gestureOpen(landmarks) {
  const spreadWidth = Math.abs(landmarks[4].x - landmarks[20].x);
  const tips  = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];
  const allExtended = tips.every(function(tip, i) {
    return landmarks[tip].y < landmarks[bases[i]].y;
  });
  return allExtended && spreadWidth > 0.25;
}

// CLOSE: hand compact — thumb and pinky tips close together horizontally
function gestureClose(landmarks) {
  const spreadWidth = Math.abs(landmarks[4].x - landmarks[20].x);
  const tips  = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];
  const someExtended = tips.filter(function(tip, i) {
    return landmarks[tip].y < landmarks[bases[i]].y;
  }).length >= 2;
  return someExtended && spreadWidth < 0.12;
}


// =============================================================
// OBSTACLE MANAGEMENT
// Handles spawning, scrolling, and pre-flash timing.
// =============================================================

// Picks the next obstacle type randomly and resets the obstacle
function spawnObstacle() {
  if (isPaused) {
    setTimeout(spawnObstacle, 500);
    return;
  }

  waitingForNextObstacle = false;

  // Build list of available obstacle types based on current game settings
  const availableTypeIndexes = [];
  for (let i = 0; i < OBSTACLE_TYPES.length; i++) {
    const type = OBSTACLE_TYPES[i];
    const isBonusType = type.id === 'cones' || type.id === 'barricade';
    if (isBonusType && !bonusObstaclesEnabled) continue;
    availableTypeIndexes.push(i);
  }

  activeObstacle.typeIndex = availableTypeIndexes[
    Math.floor(Math.random() * availableTypeIndexes.length)
  ];

  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
  activeObstacle.x = 160 + Math.random() * 160;
  activeObstacle.y = -150;
  activeObstacle.width  = type.obstacleWidth  || 90;
  activeObstacle.height = type.obstacleHeight || 45;
  activeObstacle.spawned = true;
  activeObstacle.flashed = false;
  activeObstacle.promptedLane = false;
  activeObstacle.challengeTriggered = false;

  // Reset toll booth state for each new obstacle
  tollBooth.active = false;
  tollBooth.gateOpenPct = 0;
  tollBooth.phase = 'idle';

  triggerPreFlash();
}

// Shows the three sign images briefly before the obstacle arrives
// Only mud uses the pre-flash teaching popup currently
function triggerPreFlash() {
  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
  if (type.id !== 'mud') return;

  flashActive = true;
  flashTimer = FLASH_DURATION;
  showFlashBanner(type);
}


// =============================================================
// MAIN GAME LOOP
// =============================================================

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}


// =============================================================
// UPDATE — runs every frame
// Handles all game logic: road scroll, car movement,
// obstacle movement, collision detection, flash timer.
// =============================================================

function update() {
  // Nothing moves while paused, not started, or player is solving a popup
  if (isPaused || !gameStarted || isStuck) return;

  const roadSpeed = ROAD_SPEED;

  // --- Scroll road ---
  roadY1 += roadSpeed;
  roadY2 += roadSpeed;
  if (roadY1 >= 720) roadY1 = roadY2 - 720;
  if (roadY2 >= 720) roadY2 = roadY1 - 720;

  // --- Move car ---
  if (keys['ArrowLeft'])  car.x -= car.speed;
  if (keys['ArrowRight']) car.x += car.speed;
  if (keys['ArrowUp'])    car.y -= car.speed;
  if (keys['ArrowDown'])  car.y += car.speed;

  // Keep car within road boundaries
  car.x = Math.max(50,  Math.min(430, car.x));
  car.y = Math.max(80,  Math.min(670, car.y));

  // --- Distance tracking ---
  distance += roadSpeed;

  // --- Flash timer countdown ---
  if (flashActive) {
    flashTimer--;
    if (flashTimer <= 0) {
      flashActive = false;
      hideFlashBanner();
    }
  }

  // --- Obstacle spawning ---
  // Spawn first obstacle after a short warm-up distance
  if (!activeObstacle.spawned && !waitingForNextObstacle && distance > 300) {
    spawnObstacle();
  }

  // --- Move obstacle down with road ---
  if (activeObstacle.spawned) {
    activeObstacle.y += roadSpeed;
    const obstacleType = OBSTACLE_TYPES[activeObstacle.typeIndex];

    // Barricade triggers a lane dodge prompt as it approaches
    if (!activeObstacle.promptedLane && obstacleType.mechanic === 'avoid' && activeObstacle.y > 140) {
      showLaneDodgePrompt();
      activeObstacle.promptedLane = true;
      return;
    }

    // Choice and signIt obstacles trigger their popup when they get close to the car
    if (!activeObstacle.challengeTriggered &&
        (obstacleType.mechanic === 'choice' || obstacleType.mechanic === 'signIt') &&
        activeObstacle.y > 520) {
      activeObstacle.challengeTriggered = true;
      triggerStuck();
      return;
    }

    // If obstacle scrolls off screen without interaction, respawn after gap
    if (activeObstacle.y > 800) {
      const passedType = obstacleType;
      if (passedType.id === 'mud' || passedType.id === 'snow') {
        mudSnowAvoidedCount++;
      }

      activeObstacle.spawned = false;
      waitingForNextObstacle = true;

      if (!hasAskedForMoreObstacles && mudSnowAvoidedCount >= 4) {
        showMoreObstaclesPrompt();
        return;
      }

      setTimeout(spawnObstacle, 2000);
    }

    // --- Collision detection ---
    if (rectsOverlap(car, activeObstacle)) {
      triggerStuck();
    }
  }
}


// =============================================================
// COLLISION DETECTION
// Returns true if two rectangle objects overlap.
// Both objects need x, y (center), width, height properties.
// =============================================================

function rectsOverlap(a, b) {
  return (
    a.x - a.width  / 2 < b.x + b.width  / 2 &&
    a.x + a.width  / 2 > b.x - b.width  / 2 &&
    a.y - a.height / 2 < b.y + b.height / 2 &&
    a.y + a.height / 2 > b.y - b.height / 2
  );
}


// =============================================================
// STUCK STATE
// Called when car approaches or collides with an obstacle.
// Determines which popup mode to show based on obstacle type.
// =============================================================

function triggerStuck() {
  if (isStuck) return; // prevent double-triggering

  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];

  // Avoid obstacles just penalise and move on — no popup
  if (type.mechanic === 'avoid') {
    score = Math.max(0, score - 5);
    activeObstacle.spawned = false;
    waitingForNextObstacle = true;
    setTimeout(spawnObstacle, 1500);
    return;
  }

  isStuck = true;
  flashActive = false;
  flashTimer = 0;
  gameMode = type.mechanic;

  // Initialize toll booth gate state when a toll obstacle triggers
  if (type.id === 'tollOpen') {
    tollBooth.active = true;
    tollBooth.gateOpenPct = 0;    // gate starts closed
    tollBooth.phase = 'closing';
  }
  if (type.id === 'tollClose') {
    tollBooth.active = true;
    tollBooth.gateOpenPct = 1;    // gate starts open (already passed through)
    tollBooth.phase = 'open';
  }

  if (gameMode === 'choice') {
    showChoicePopup(type);
  } else if (gameMode === 'signIt') {
    showSignItPopup(type);
  }
}

// Called when the player answers correctly (either mode)
function resolveObstacle(correct) {
  if (correct) {
    score += 10;
  }

  isStuck = false;
  gameMode = null;
  flashActive = false;
  flashTimer = 0;
  activeObstacle.spawned = false;
  waitingForNextObstacle = true;

  // Reset toll booth state
  tollBooth.active = false;
  tollBooth.gateOpenPct = 0;
  tollBooth.phase = 'idle';

  setTimeout(function() {
    hideAllPopups();
    hideHandCanvas();
  }, POPUP_CLOSE_DELAY_MS);

  // Respawn a new obstacle after a gap
  setTimeout(spawnObstacle, NEXT_OBSTACLE_DELAY_MS);
}


// =============================================================
// CHOICE MODE POPUP
// Shows three sign images (no word labels) with key hints.
// The player presses S, G, or P to pick the correct sign.
// =============================================================

function showChoicePopup(type) {
  const popup = document.getElementById('popup');
  popup.style.width = '340px';
  popup.style.padding = '24px';

  document.getElementById('choicePrompt').textContent = type.prompt;
  document.getElementById('signA').src = type.signs.s;
  document.getElementById('signB').src = type.signs.g;
  document.getElementById('signC').src = type.signs.p;
  document.getElementById('choiceFeedback').textContent = '';

  document.getElementById('choiceMode').style.display = 'block';
  document.getElementById('signItMode').style.display = 'none';
  popup.style.display = 'block';
  speakPopupLines();
}

function showChoiceFeedback(message) {
  setChoiceFeedback(message, true);
}


// =============================================================
// SIGN-IT MODE POPUP
// Shows the target sign image and activates the webcam overlay.
// MediaPipe gesture recognition resolves the obstacle when
// the correct sign is detected.
// =============================================================

function showSignItPopup(type) {
  const popup = document.getElementById('popup');
  popup.style.width = '248px';
  popup.style.padding = '16px';

  document.getElementById('signItPrompt').textContent = type.prompt;
  const signImage = document.getElementById('signItImage');
  signImage.src = type.signImage;
  signImage.style.display = 'block';
  document.getElementById('signResult').textContent = '';

  document.getElementById('signItMode').style.display = 'block';
  document.getElementById('choiceMode').style.display = 'none';
  popup.style.display = 'block';
  speakPopupLines();
  showHandCanvas();
}

// Start screen — player must sign PLAY to begin driving
function showStartSignPopup() {
  const popup = document.getElementById('popup');
  popup.style.width = '320px';
  popup.style.padding = '20px';

  isStuck = true;
  gameMode = 'startSign';

  const signImage = document.getElementById('signItImage');
  signImage.src = 'PNGs/sign_play.png';
  signImage.style.display = 'block';

  document.getElementById('signItPrompt').textContent = 'Sign PLAY.';
  document.getElementById('signResult').textContent = 'Start driving.';

  document.getElementById('signItMode').style.display = 'block';
  document.getElementById('choiceMode').style.display = 'none';
  popup.style.display = 'block';
  showHandCanvas();
  speakPopupLines();
}

// Barricade dodge prompt — player signs LEFT or RIGHT to steer around it
function showLaneDodgePrompt() {
  const popup = document.getElementById('popup');
  popup.style.width = '320px';
  popup.style.padding = '20px';

  isStuck = true;
  gameMode = 'lanePrompt';
  lanePromptLocked = false;

  const signImage = document.getElementById('signItImage');
  signImage.removeAttribute('src');
  signImage.style.display = 'none';

  document.getElementById('signItPrompt').textContent = 'Sign LEFT or RIGHT.';
  document.getElementById('signResult').textContent = 'Dodge now.';

  document.getElementById('signItMode').style.display = 'block';
  document.getElementById('choiceMode').style.display = 'none';
  popup.style.display = 'block';
  showHandCanvas();
  speakPopupLines();
}

function finishLanePrompt() {
  isStuck = false;
  gameMode = null;
  hideAllPopups();
  hideHandCanvas();
}

// Difficulty prompt — after enough obstacles, asks if player wants more
function showMoreObstaclesPrompt() {
  const popup = document.getElementById('popup');
  popup.style.width = '340px';
  popup.style.padding = '24px';

  hasAskedForMoreObstacles = true;
  difficultyChoiceLocked = false;
  isStuck = true;
  gameMode = 'difficultySign';
  flashActive = false;
  flashTimer = 0;
  hideFlashBanner();

  const signImage = document.getElementById('signItImage');
  signImage.removeAttribute('src');
  signImage.style.display = 'none';

  document.getElementById('signItPrompt').textContent = 'More obstacles?';
  document.getElementById('signResult').textContent = 'Sign MORE or NO.';

  document.getElementById('signItMode').style.display = 'block';
  document.getElementById('choiceMode').style.display = 'none';
  popup.style.display = 'block';
  showHandCanvas();
  speakPopupLines();
}

function finishDifficultyPrompt() {
  isStuck = false;
  gameMode = null;
  hideAllPopups();
  hideHandCanvas();
  waitingForNextObstacle = true;
  setTimeout(spawnObstacle, NEXT_OBSTACLE_DELAY_MS);
}

function showHandCanvas() {
  handCanvas.style.display = 'block';
  webcamVideo.style.display = 'block';
}

function hideHandCanvas() {
  handCanvas.style.display = 'none';
  webcamVideo.style.display = 'none';
}

function hideAllPopups() {
  document.getElementById('popup').style.display = 'none';
  document.getElementById('choiceFeedback').textContent = '';
  document.getElementById('signResult').textContent = '';
  stopCurrentVoiceAudio();
  if (speechEnabled) window.speechSynthesis.cancel();
}


// =============================================================
// PRE-FLASH BANNER
// Briefly shows all three sign images before the mud obstacle
// arrives, giving the player a chance to learn the signs
// before being tested on them.
// =============================================================

function showFlashBanner(type) {
  const popup = document.getElementById('popup');
  popup.style.width = '340px';
  popup.style.padding = '24px';

  document.getElementById('choicePrompt').textContent = 'Remember these signs!';
  document.getElementById('signA').src = type.signs.s;
  document.getElementById('signB').src = type.signs.g;
  document.getElementById('signC').src = type.signs.p;
  document.getElementById('choiceFeedback').textContent = '';

  document.getElementById('choiceMode').style.display = 'block';
  document.getElementById('signItMode').style.display = 'none';
  popup.style.display = 'block';
  speakPopupLines();
}

function hideFlashBanner() {
  // Only hide if not currently solving a challenge
  if (!isStuck) {
    hideAllPopups();
  }
}


// =============================================================
// DRAW — runs every frame
// Clears the canvas and redraws everything in order.
// Drawing order matters: background first, foreground last.
// =============================================================

function draw() {
  // Clear the full canvas each frame
  ctx.clearRect(0, 0, 480, 720);

  // --- Draw scrolling road ---
  ctx.drawImage(roadImg, 0, roadY1, 480, 720);
  ctx.drawImage(roadImg, 0, roadY2, 480, 720);

  // --- Draw road edge lines ---
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(60, 0);  ctx.lineTo(60, 720);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(420, 0); ctx.lineTo(420, 720); ctx.stroke();

  // --- Draw active obstacle ---
  if (activeObstacle.spawned) {
    const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
    drawObstacle(type, activeObstacle);

    // Label the obstacle type on the canvas for demo clarity
    ctx.fillStyle = 'white';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(type.label, activeObstacle.x, activeObstacle.y + 5);
    ctx.textAlign = 'left';
  }

  // --- Draw car ---
  ctx.drawImage(
    carImg,
    car.x - car.width  / 2,
    car.y - car.height / 2,
    car.width,
    car.height
  );

  // --- Draw HUD: score and distance ---
  ctx.fillStyle = 'white';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('Score: ' + score, 12, 28);
  ctx.fillText('Dist: ' + Math.floor(distance / 100) + 'm', 340, 28);

  // --- Draw pause overlay ---
  if (isPaused) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, 480, 720);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', 240, 370);
    ctx.textAlign = 'left';
  }
}


// =============================================================
// OBSTACLE DRAWING
// Routes each obstacle type to its own draw function.
// =============================================================

function drawObstacle(type, obstacle) {
  // Toll booth has its own animated drawing function
  if (type.id === 'tollOpen' || type.id === 'tollClose') {
    drawTollBooth(obstacle);
    return;
  }

  if (type.id === 'cones') {
    drawCones(obstacle);
    return;
  }

  if (type.id === 'barricade') {
    drawBarricade(obstacle);
    return;
  }

  // Default: colored rounded rectangle for mud, snow, etc.
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.roundRect(
    obstacle.x - obstacle.width  / 2,
    obstacle.y - obstacle.height / 2,
    obstacle.width,
    obstacle.height,
    8
  );
  ctx.fill();
}

// Draws three orange traffic cones in a row
function drawCones(obstacle) {
  const baseY = obstacle.y + obstacle.height / 2;
  const spacing = obstacle.width / 3;
  const startX = obstacle.x - spacing;

  for (let i = 0; i < 3; i++) {
    const x = startX + i * spacing;
    ctx.fillStyle = '#ff7a00';
    ctx.beginPath();
    ctx.moveTo(x, baseY - 34);
    ctx.lineTo(x - 14, baseY);
    ctx.lineTo(x + 14, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, baseY - 18, 16, 4);
  }
}

// Draws a red and white striped road barricade
function drawBarricade(obstacle) {
  const left = obstacle.x - obstacle.width  / 2;
  const top  = obstacle.y - obstacle.height / 2;

  ctx.fillStyle = '#e14d2a';
  ctx.fillRect(left, top, obstacle.width, obstacle.height);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const offset = i * (obstacle.width / 4);
    ctx.beginPath();
    ctx.moveTo(left + offset, top + obstacle.height);
    ctx.lineTo(left + offset + 24, top);
    ctx.stroke();
  }
}

// Draws the toll booth with an animated gate bar.
// tollBooth.gateOpenPct controls how far the gate has lifted:
// 0 = fully blocking the road, 1 = fully raised.
function drawTollBooth(obstacle) {
  const cx = obstacle.x;
  const cy = obstacle.y;

  // Left and right support posts
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(cx - 90, cy - 30, 12, 60);
  ctx.fillRect(cx + 78, cy - 30, 12, 60);

  // Central booth box
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(cx - 22, cy - 38, 44, 50);

  // Booth window (blue tinted)
  ctx.fillStyle = '#a8d8ea';
  ctx.fillRect(cx - 16, cy - 32, 32, 24);

  // Animated gate bar — shrinks as gateOpenPct increases toward 1
  const gateLength = 78 * (1 - tollBooth.gateOpenPct);
  if (gateLength > 2) {
    ctx.fillStyle = '#e14d2a';
    ctx.fillRect(cx + 22, cy - 8, gateLength, 10);

    // White stripe accents on the gate bar
    ctx.fillStyle = '#ffffff';
    const stripeCount = 3;
    for (let i = 0; i < stripeCount; i++) {
      const stripeX = cx + 22 + (i * (gateLength / stripeCount));
      ctx.fillRect(stripeX, cy - 8, gateLength / (stripeCount * 2), 10);
    }
  }

  // Smoothly animate gate opening when tollBooth.phase is 'open'
  if (tollBooth.phase === 'open' && tollBooth.gateOpenPct < 1) {
    tollBooth.gateOpenPct = Math.min(1, tollBooth.gateOpenPct + 0.04);
  }
}
