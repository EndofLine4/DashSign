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
const MUD_SNOW_CLEARS_PER_TUNNEL = 2;
const MIN_CLEARS_BETWEEN_TUNNELS = 2;

// --- Score and distance ---
let score = 0;
let distance = 0;
let mudSnowAvoidedCount = 0;
let mudSnowClearsSinceTunnel = 0;
let clearsSinceLastTunnel = 0;
let hasAskedForMoreObstacles = false;
let bonusObstaclesEnabled = false;
let difficultyChoiceLocked = false;

// --- Tunnel event state ---
const TUNNEL_APPROACH_MULTIPLIER = 0.55;
const TUNNEL_INSIDE_MULTIPLIER = 0.7;
const TUNNEL_INSIDE_DISTANCE = 680;
let tunnelEvent = {
  active: false,
  phase: 'idle', // idle | approach | enterPrompt | inside | exitSlow | exitPrompt
  y: -260,
  width: 280,
  height: 180,
  insideDistance: 0,
  exitSpeed: 0,
  brightness: 0
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
// Require gesture to match for N consecutive frames before accepting (reduces jitter and lag)
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
    gesture: 'snow'                  // matches a gesture function below
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
    id: 'tunnel_in',
    label: 'IN',
    color: '#3f4a57',
    mechanic: 'signIt',
    prompt: 'Sign IN to enter tunnel.',
    signImage: 'PNGs/sign_in.png',
    gesture: 'in'
  },
  {
    id: 'tunnel_out',
    label: 'OUT',
    color: '#f5d96b',
    mechanic: 'signIt',
    prompt: 'Sign OUT to leave tunnel.',
    signImage: 'PNGs/sign_out.png',
    gesture: 'out'
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
roadImg.onerror = () => console.error('PNGs/road_asphalt01.png failed to load');
carImg.onerror = () => console.error('PNGs/car_blue_4.png failed to load');

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

const LOCAL_VOICE_AUDIO = {
  [audioKey('Voice on.')]: 'Audio/voice_on.m4a',
  [audioKey('Sign PLAY. Start driving.')]: 'Audio/start_play.m4a',
  [audioKey('Remember these signs!')]: 'Audio/remember_signs.m4a',
  [audioKey('Pick GO.')]: 'Audio/mud_prompt.m4a',
  [audioKey('Sign SNOW to get unstuck.')]: 'Audio/snow_prompt.m4a',
  [audioKey('Sign HELP.')]: 'Audio/cones_prompt.m4a',
  [audioKey('Sign IN to enter tunnel.')]: 'Audio/tunnel_in_prompt.m4a',
  [audioKey('Sign OUT to leave tunnel.')]: 'Audio/tunnel_out_prompt.m4a',
  [audioKey('Sign LEFT or RIGHT. Dodge now.')]: 'Audio/lane_prompt.m4a',
  [audioKey('More obstacles? Sign MORE or NO.')]: 'Audio/difficulty_prompt.m4a',
  [audioKey('Great signing! Starting now.')]: 'Audio/great_starting.m4a',
  [audioKey('Sign PLAY.')]: 'Audio/show_play.m4a',
  [audioKey('Dodging LEFT!')]: 'Audio/dodging_left.m4a',
  [audioKey('Dodging RIGHT!')]: 'Audio/dodging_right.m4a',
  [audioKey('Sign LEFT or RIGHT to dodge.')]: 'Audio/sign_left_right.m4a',
  [audioKey('Great signing!')]: 'Audio/great_signing.m4a',
  [audioKey('Sign IN.')]: 'Audio/show_in.m4a',
  [audioKey('Sign OUT.')]: 'Audio/show_out.m4a',
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

  if (gameMode === 'tunnelEnter') {
    const matchedIn = confirmGesture('in', currentLandmarks);
    if (matchedIn) {
      setSignResult('Great signing!', true);
      lastDetectedGesture = null;
      gestureConfidenceCount = 0;
      setTimeout(function() {
        resolveObstacle(true);
      }, 800);
    } else {
      setSignResult('Sign IN.', true);
    }
    return;
  }

  if (gameMode === 'tunnelExit') {
    const matchedOut = confirmGesture('out', currentLandmarks);
    if (matchedOut) {
      setSignResult('Great signing!', true);
      lastDetectedGesture = null;
      gestureConfidenceCount = 0;
      setTimeout(function() {
        resolveObstacle(true);
      }, 800);
    } else {
      setSignResult('Sign OUT.', true);
    }
    return;
  }

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

  if (gameMode !== 'signIt') return;

  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
  const matched = confirmGesture(type.gesture, currentLandmarks);

  if (matched) {
    setSignResult('Great signing!', true);
    lastDetectedGesture = null;
    gestureConfidenceCount = 0;
    // Small delay so player sees the success message before popup closes
    setTimeout(function() {
      resolveObstacle(true);
    }, 800);
  } else {
    setSignResult('Keep trying.', true);
  }
}

// Routes to the correct gesture checker by name
function recognizeGesture(gestureName, landmarks) {
  if (gestureName === 'play') return gesturePlay(landmarks);
  if (gestureName === 'snow') return gestureSnow(landmarks);
  if (gestureName === 'stop') return gestureStop(landmarks);
  if (gestureName === 'go')   return gestureGo(landmarks);
  if (gestureName === 'help') return gestureHelp(landmarks);
  if (gestureName === 'in') return gestureIn(landmarks);
  if (gestureName === 'out') return gestureOut(landmarks);
  if (gestureName === 'left') return gestureLeft(landmarks);
  if (gestureName === 'right') return gestureRight(landmarks);
  if (gestureName === 'more') return gestureMore(landmarks);
  if (gestureName === 'no')   return gestureNo(landmarks);
  return false;
}

// Confirms a gesture match after N consecutive frames to reduce noise and lag
function confirmGesture(gestureName, landmarks) {
  const matched = recognizeGesture(gestureName, landmarks);
  
  if (matched) {
    if (lastDetectedGesture === gestureName) {
      gestureConfidenceCount++;
      return gestureConfidenceCount >= GESTURE_CONFIDENCE_THRESHOLD;
    } else {
      lastDetectedGesture = gestureName;
      gestureConfidenceCount = 1;
      return false; // need more frames
    }
  } else {
    // Reset if gesture no longer matches
    if (lastDetectedGesture === gestureName) {
      lastDetectedGesture = null;
      gestureConfidenceCount = 0;
    }
    return false;
  }
}

function gesturePlay(landmarks) {
  return gestureGo(landmarks) || gestureOut(landmarks);
}

function recognizeDifficultyChoice(landmarks) {
  if (gestureMore(landmarks)) return 'more';
  if (gestureNo(landmarks)) return 'no';
  setSignResult('Sign MORE or NO.', true);
  return null;
}

// SNOW: fingers spread and wiggling approximated by
// checking all fingertips are above their MCP knuckles (open hand)
// and thumb tip is away from index finger (spread).
function gestureSnow(landmarks) {
  const tips  = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];

  // All four fingers must be extended (tip Y < base Y in normalized coords)
  const allExtended = tips.every(function(tip, i) {
    return landmarks[tip].y < landmarks[bases[i]].y;
  });

  // Thumb should be spread (tip X far from index MCP)
  const thumbSpread = Math.abs(landmarks[4].x - landmarks[5].x) > 0.08;

  return allExtended && thumbSpread;
}

// STOP: flat open hand — same open hand check as snow
// (for your deadline these are intentionally similar;
// you can tighten the distinction post-demo)
function gestureStop(landmarks) {
  const tips  = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];
  return tips.every(function(tip, i) {
    return landmarks[tip].y < landmarks[bases[i]].y;
  });
}

// GO: index finger extended, others curled
function gestureGo(landmarks) {
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const middleCurled  = landmarks[12].y > landmarks[10].y;
  const ringCurled    = landmarks[16].y > landmarks[14].y;
  const pinkyCurled   = landmarks[20].y > landmarks[18].y;
  return indexExtended && middleCurled && ringCurled && pinkyCurled;
}

// HELP: closed fist approximation (all fingertips curled down)
function gestureHelp(landmarks) {
  const curledFingers = [8, 12, 16, 20].every(function(tip) {
    return landmarks[tip].y > landmarks[tip - 2].y;
  });
  const thumbIn = Math.abs(landmarks[4].x - landmarks[3].x) < 0.06;
  return curledFingers && thumbIn;
}

// IN: index points inward with others curled (demo approximation)
function gestureIn(landmarks) {
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const othersCurled = landmarks[12].y > landmarks[10].y &&
    landmarks[16].y > landmarks[14].y &&
    landmarks[20].y > landmarks[18].y;
  return indexExtended && othersCurled;
}

// OUT: open hand (most fingers extended, loose checks for webcam variation)
function gestureOut(landmarks) {
  const tips = [8, 12, 16, 20];
  const bases = [6, 10, 14, 18];

  // Most fingers extended (at least 3 of 4) — natural hand pose allows some curl.
  const extendedCount = tips.reduce(function(count, tip, i) {
    return count + (landmarks[tip].y < landmarks[bases[i]].y ? 1 : 0);
  }, 0);

  // Thumb roughly away from index — very loose to accept different hand angles.
  const thumbSeparation = Math.abs(landmarks[4].x - landmarks[5].x) + 
                         Math.abs(landmarks[4].y - landmarks[5].y);
  const thumbAway = thumbSeparation > 0.08;

  return extendedCount >= 3 && thumbAway;
}

function gestureLeft(landmarks) {
  const wristX = landmarks[0].x;
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const othersCurled = landmarks[12].y > landmarks[10].y &&
    landmarks[16].y > landmarks[14].y &&
    landmarks[20].y > landmarks[18].y;
  const pointingLeft = landmarks[8].x < wristX - 0.06;
  return indexExtended && othersCurled && pointingLeft;
}

function gestureRight(landmarks) {
  const wristX = landmarks[0].x;
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const othersCurled = landmarks[12].y > landmarks[10].y &&
    landmarks[16].y > landmarks[14].y &&
    landmarks[20].y > landmarks[18].y;
  const pointingRight = landmarks[8].x > wristX + 0.06;
  return indexExtended && othersCurled && pointingRight;
}

// MORE: fingertips gathered toward thumb tip (demo-friendly one-hand approximation)
function gestureMore(landmarks) {
  const thumbTip = landmarks[4];
  const fingerTips = [8, 12, 16, 20];
  return fingerTips.every(function(i) {
    const dx = landmarks[i].x - thumbTip.x;
    const dy = landmarks[i].y - thumbTip.y;
    return Math.hypot(dx, dy) < 0.11;
  });
}

// NO: index+middle extended together, ring+pinky curled
function gestureNo(landmarks) {
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const middleExtended = landmarks[12].y < landmarks[10].y;
  const ringCurled = landmarks[16].y > landmarks[14].y;
  const pinkyCurled = landmarks[20].y > landmarks[18].y;
  const fingersClose = Math.hypot(
    landmarks[8].x - landmarks[12].x,
    landmarks[8].y - landmarks[12].y
  ) < 0.07;

  return indexExtended && middleExtended && ringCurled && pinkyCurled && fingersClose;
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

  if (tunnelEvent.active) {
    return;
  }

  const availableTypeIndexes = [];
  for (let i = 0; i < OBSTACLE_TYPES.length; i++) {
    const type = OBSTACLE_TYPES[i];
    if (type.id === 'tunnel_in' || type.id === 'tunnel_out') continue;
    const isBonusType = type.id === 'cones' || type.id === 'barricade';
    if (isBonusType && !bonusObstaclesEnabled) continue;
    availableTypeIndexes.push(i);
  }

  activeObstacle.typeIndex = availableTypeIndexes[
    Math.floor(Math.random() * availableTypeIndexes.length)
  ];

  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
  activeObstacle.x = 160 + Math.random() * 160; // random lane position
  activeObstacle.y = -150;
  activeObstacle.width = type.obstacleWidth || 90;
  activeObstacle.height = type.obstacleHeight || 45;
  activeObstacle.spawned = true;
  activeObstacle.flashed = false;
  activeObstacle.promptedLane = false;
  activeObstacle.challengeTriggered = false;
  triggerPreFlash();
}

// Shows the three sign images briefly before the obstacle arrives
function triggerPreFlash() {
  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
  if (type.id !== 'mud') return; // only mud uses this pre-flash teaching popup

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
  // Nothing moves while the player is solving a popup
  if (isPaused || !gameStarted || isStuck) return;

  const roadSpeed = getCurrentRoadSpeed();

  // --- Scroll road ---
  roadY1 += roadSpeed;
  roadY2 += roadSpeed;
  if (roadY1 >= 720)  roadY1 = roadY2 - 720;
  if (roadY2 >= 720)  roadY2 = roadY1 - 720;

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

  updateTunnelEvent(roadSpeed);

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
  if (!tunnelEvent.active && !activeObstacle.spawned && !waitingForNextObstacle && distance > 300) {
    spawnObstacle();
  }

  // --- Move obstacle down with road ---
  if (activeObstacle.spawned) {
    activeObstacle.y += roadSpeed;
    const obstacleType = OBSTACLE_TYPES[activeObstacle.typeIndex];

    if (!activeObstacle.promptedLane && obstacleType.mechanic === 'avoid' && activeObstacle.y > 140) {
      showLaneDodgePrompt();
      activeObstacle.promptedLane = true;
      return;
    }

    if (!activeObstacle.challengeTriggered && (obstacleType.mechanic === 'choice' || obstacleType.mechanic === 'signIt') && activeObstacle.y > 520) {
      activeObstacle.challengeTriggered = true;
      triggerStuck();
      return;
    }

    // If it scrolls off screen without being hit, respawn
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

      // Respawn after a short gap
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
// Called when car collides with an obstacle.
// Determines which popup mode to show based on obstacle type.
// =============================================================

function triggerStuck() {
  if (isStuck) return; // prevent double-triggering

  const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
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

  if (gameMode === 'choice') {
    showChoicePopup(type);
  } else if (gameMode === 'signIt') {
    showSignItPopup(type);
  }
}

// Called when the player answers correctly (either mode)
function resolveObstacle(correct) {
  const resolvedMode = gameMode;
  const resolvedType = OBSTACLE_TYPES[activeObstacle.typeIndex];

  if (correct) {
    score += 10;

    const isTunnelResolution = resolvedMode === 'tunnelEnter' || resolvedMode === 'tunnelExit';
    if (!isTunnelResolution && resolvedType && (resolvedType.id === 'mud' || resolvedType.id === 'snow')) {
      mudSnowClearsSinceTunnel++;
      clearsSinceLastTunnel++;
      mudSnowAvoidedCount++;
    }
  }
  isStuck = false;
  gameMode = null;
  flashActive = false;
  flashTimer = 0;
  activeObstacle.spawned = false;
  waitingForNextObstacle = true;

  if (resolvedMode === 'tunnelEnter') {
    finishTunnelEnter();
    return;
  }

  if (resolvedMode === 'tunnelExit') {
    finishTunnelExit();
    return;
  }

  if (correct && mudSnowClearsSinceTunnel >= MUD_SNOW_CLEARS_PER_TUNNEL && clearsSinceLastTunnel >= MIN_CLEARS_BETWEEN_TUNNELS && !tunnelEvent.active) {
    mudSnowClearsSinceTunnel = 0;
    setTimeout(startTunnelEvent, NEXT_OBSTACLE_DELAY_MS);
    return;
  }

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
// MediaPipe gesture recognition runs in the background and
// resolves the obstacle when the correct sign is detected.
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

  // Show the hand overlay canvas so player can see their hand
  showHandCanvas();
}

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

function showTunnelEnterPopup() {
  isStuck = true;
  gameMode = 'tunnelEnter';
  const type = OBSTACLE_TYPES.find(function(t) { return t.id === 'tunnel_in'; });
  showSignItPopup(type);
}

function showTunnelExitPopup() {
  isStuck = true;
  gameMode = 'tunnelExit';
  const type = OBSTACLE_TYPES.find(function(t) { return t.id === 'tunnel_out'; });
  showSignItPopup(type);
}

function finishTunnelEnter() {
  hideAllPopups();
  hideHandCanvas();
  isStuck = false;
  gameMode = null;
  tunnelEvent.phase = 'inside';
  tunnelEvent.insideDistance = 0;
}

function finishTunnelExit() {
  hideAllPopups();
  hideHandCanvas();
  isStuck = false;
  gameMode = null;
  tunnelEvent.active = false;
  tunnelEvent.phase = 'idle';
  tunnelEvent.y = -260;
  tunnelEvent.insideDistance = 0;
  tunnelEvent.brightness = 0;
  clearsSinceLastTunnel = 0;
  waitingForNextObstacle = true;
  setTimeout(spawnObstacle, 1400);
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

  document.getElementById('signItPrompt').textContent =
    'More obstacles?';
  document.getElementById('signResult').textContent =
    'Sign MORE or NO.';

  document.getElementById('signItMode').style.display = 'block';
  document.getElementById('choiceMode').style.display = 'none';
  popup.style.display = 'block';
  showHandCanvas();
  speakPopupLines();
}

function startTunnelEvent() {
  if (isPaused) {
    setTimeout(startTunnelEvent, 500);
    return;
  }

  tunnelEvent.active = true;
  tunnelEvent.phase = 'approach';
  tunnelEvent.y = -260;
  tunnelEvent.insideDistance = 0;
  tunnelEvent.exitSpeed = ROAD_SPEED * TUNNEL_APPROACH_MULTIPLIER;
  tunnelEvent.brightness = 0;
  activeObstacle.spawned = false;
  waitingForNextObstacle = true;
}

function getCurrentRoadSpeed() {
  if (!tunnelEvent.active) {
    return ROAD_SPEED;
  }

  if (tunnelEvent.phase === 'approach') {
    return ROAD_SPEED * TUNNEL_APPROACH_MULTIPLIER;
  }

  if (tunnelEvent.phase === 'inside') {
    return ROAD_SPEED * TUNNEL_INSIDE_MULTIPLIER;
  }

  if (tunnelEvent.phase === 'exitSlow') {
    return Math.max(0, tunnelEvent.exitSpeed);
  }

  return 0;
}

function updateTunnelEvent(roadSpeed) {
  if (!tunnelEvent.active) return;

  if (tunnelEvent.phase === 'approach') {
    tunnelEvent.y += roadSpeed;
    if (tunnelEvent.y >= 190) {
      tunnelEvent.phase = 'enterPrompt';
      showTunnelEnterPopup();
    }
    return;
  }

  if (tunnelEvent.phase === 'inside') {
    tunnelEvent.insideDistance += roadSpeed;
    if (tunnelEvent.insideDistance > TUNNEL_INSIDE_DISTANCE) {
      tunnelEvent.phase = 'exitSlow';
      tunnelEvent.exitSpeed = ROAD_SPEED * TUNNEL_APPROACH_MULTIPLIER;
      tunnelEvent.brightness = 0;
    }
    return;
  }

  if (tunnelEvent.phase === 'exitSlow') {
    tunnelEvent.exitSpeed = Math.max(0, tunnelEvent.exitSpeed - 0.035);
    tunnelEvent.brightness = Math.min(1, tunnelEvent.brightness + 0.012);
    if (tunnelEvent.exitSpeed <= 0.05) {
      tunnelEvent.phase = 'exitPrompt';
      showTunnelExitPopup();
    }
  }
}

function finishDifficultyPrompt() {
  isStuck = false;
  gameMode = null;
  hideAllPopups();
  hideHandCanvas();
  waitingForNextObstacle = true;
  setTimeout(spawnObstacle, NEXT_OBSTACLE_DELAY_MS);
}


// =============================================================
// PRE-FLASH BANNER
// Briefly shows all three sign images before the obstacle
// arrives, giving the player a chance to learn the signs
// before being tested on them.
// =============================================================

function showFlashBanner(type) {
  const popup = document.getElementById('popup');
  popup.style.width = '340px';
  popup.style.padding = '24px';

  // Reuse the choice popup but without the prompt text,
  // showing it as a preview with a "memorize these!" message
  document.getElementById('choicePrompt').textContent = 'Remember these signs!';
  document.getElementById('signA').src = type.signs.s;
  document.getElementById('signB').src = type.signs.g;
  document.getElementById('signC').src = type.signs.p;
  document.getElementById('choiceFeedback').textContent = '';

  document.getElementById('choiceMode').style.display = 'block';
  document.getElementById('signItMode').style.display = 'none';
  popup.style.display = 'block';
  speakPopupLines();

  // Auto-hide after FLASH_DURATION frames (handled in update())
}

function hideFlashBanner() {
  // Only hide if we're not currently stuck — if the obstacle
  // arrived while the flash was still showing, keep popup open
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

  // --- Draw road edge lines for visual polish ---
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(60, 0);  ctx.lineTo(60, 720);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(420, 0); ctx.lineTo(420, 720); ctx.stroke();

  drawTunnelEffects();

  // --- Draw active obstacle ---
  if (activeObstacle.spawned) {
    const type = OBSTACLE_TYPES[activeObstacle.typeIndex];
    drawObstacle(type, activeObstacle);

    // Label the obstacle type for clarity during the demo
    ctx.fillStyle = 'white';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      type.label,
      activeObstacle.x,
      activeObstacle.y + 5
    );
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

function drawTunnelEffects() {
  if (!tunnelEvent.active) return;

  if (tunnelEvent.phase === 'approach' || tunnelEvent.phase === 'enterPrompt') {
    const left = 240 - tunnelEvent.width / 2;
    const top = tunnelEvent.y - tunnelEvent.height / 2;

    ctx.fillStyle = '#2e3742';
    ctx.fillRect(left, top, tunnelEvent.width, tunnelEvent.height);

    ctx.strokeStyle = '#e5edf7';
    ctx.lineWidth = 10;
    ctx.strokeRect(left, top, tunnelEvent.width, tunnelEvent.height);

    ctx.fillStyle = '#111820';
    ctx.fillRect(left + 25, top + 25, tunnelEvent.width - 50, tunnelEvent.height - 40);

    ctx.fillStyle = '#f0f6ff';
    ctx.fillRect(left, top + tunnelEvent.height - 14, tunnelEvent.width, 8);

    ctx.fillStyle = '#d8e1ea';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TUNNEL', 240, top + 22);
    ctx.textAlign = 'left';
    return;
  }

  if (tunnelEvent.phase === 'inside' || tunnelEvent.phase === 'exitSlow' || tunnelEvent.phase === 'exitPrompt') {
    const darkness = tunnelEvent.phase === 'inside' ? 0.62 : Math.max(0.28, 0.62 - tunnelEvent.brightness * 0.34);
    ctx.fillStyle = 'rgba(0,0,0,' + darkness.toFixed(3) + ')';
    ctx.fillRect(0, 0, 480, 720);

    if (tunnelEvent.phase === 'exitSlow' || tunnelEvent.phase === 'exitPrompt') {
      const glow = 0.18 + tunnelEvent.brightness * 0.42;
      ctx.fillStyle = 'rgba(255,245,200,' + glow.toFixed(3) + ')';
      ctx.fillRect(0, 0, 480, 720);

      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(0, 128, 480, 10);
      ctx.fillRect(0, 582, 480, 10);
    }
  }
}

function drawObstacle(type, obstacle) {
  if (type.id === 'cones') {
    drawCones(obstacle);
    return;
  }

  if (type.id === 'barricade') {
    drawBarricade(obstacle);
    return;
  }

  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.roundRect(
    obstacle.x - obstacle.width / 2,
    obstacle.y - obstacle.height / 2,
    obstacle.width,
    obstacle.height,
    8
  );
  ctx.fill();
}

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

function drawBarricade(obstacle) {
  const left = obstacle.x - obstacle.width / 2;
  const top = obstacle.y - obstacle.height / 2;

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
