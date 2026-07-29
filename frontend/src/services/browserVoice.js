const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQQAAAAAAA==";
const MALE_VOICE_HINTS = /\b(guy|david|mark|ryan|george|daniel|james|michael|eric|male)\b/i;
const FEMALE_VOICE_HINTS = /\b(jenny|aria|sara|susan|zira|emma|female)\b/i;

let playbackUnlockArmed = false;
let voicesReadyPromise = null;

export function unlockVoicePlayback() {
  const audio = new Audio(SILENT_WAV);
  audio.volume = 0.01;
  audio.play().catch(() => {});
}

export function armVoicePlaybackUnlock() {
  if (playbackUnlockArmed) return;
  playbackUnlockArmed = true;

  const unlock = () => {
    unlockVoicePlayback();
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
  };

  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

function selectBrowserVoice(gender = "male") {
  const genderHints = gender === "male" ? MALE_VOICE_HINTS : FEMALE_VOICE_HINTS;

  return window.speechSynthesis
    .getVoices()
    .filter((voice) => /^en(-|_)/i.test(voice.lang))
    .map((voice) => ({
      voice,
      score:
        (genderHints.test(voice.name) ? 20 : 0) +
        (/natural|neural|online/i.test(voice.name) ? 8 : 0) +
        (/en-US/i.test(voice.lang) ? 3 : 0) +
        (voice.localService ? 1 : 0)
    }))
    .sort((left, right) => right.score - left.score)[0]?.voice;
}

function waitForBrowserVoices(timeoutMs = 800) {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length) return Promise.resolve();
  if (voicesReadyPromise) return voicesReadyPromise;

  voicesReadyPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.speechSynthesis.removeEventListener?.("voiceschanged", finish);
      voicesReadyPromise = null;
      resolve();
    };
    const timeoutId = window.setTimeout(finish, timeoutMs);
    window.speechSynthesis.addEventListener?.("voiceschanged", finish, {
      once: true
    });
  });

  return voicesReadyPromise;
}

export function prepareBrowserSpeech(
  text,
  { gender = "male", rate = 0.82, pitch = 0.72, volume = 1 } = {}
) {
  return {
    text: text.replace(/\s+/g, " ").trim(),
    gender,
    rate,
    pitch,
    volume
  };
}

export function createBrowserAudio(data) {
  if (!data?.text) return null;

  let finished = false;
  const audio = {
    src: "",
    onplay: null,
    onended: null,
    onerror: null,
    async play() {
      return new Promise((resolve, reject) => {
        if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
          reject(new Error("Browser speech is unavailable"));
          return;
        }

        waitForBrowserVoices().then(() => {
          if (finished) {
            resolve();
            return;
          }

          const utterance = new SpeechSynthesisUtterance(data.text);
          utterance.rate = Math.min(1.4, Math.max(0.7, data.rate || 1));
          utterance.pitch = Math.min(1.4, Math.max(0.5, data.pitch || 1));
          utterance.volume = Math.min(1, Math.max(0, data.volume ?? 1));
          const preferredVoice = selectBrowserVoice(data.gender);
          if (preferredVoice) utterance.voice = preferredVoice;

          utterance.onstart = () => {
            audio.onplay?.();
            resolve();
          };
          utterance.onend = () => {
            if (finished) return;
            finished = true;
            audio.onended?.();
          };
          utterance.onerror = (event) => {
            if (finished) return;
            finished = true;
            audio.onerror?.(event);
            reject(new Error(event.error || "Browser speech failed"));
          };

          window.speechSynthesis.speak(utterance);
        });
      });
    },
    pause() {
      window.speechSynthesis?.cancel();
      if (!finished) {
        finished = true;
        audio.onended?.();
      }
    }
  };

  return { audio, release: () => {} };
}

export function playBrowserAudio(audio) {
  return audio.play().catch((error) => {
    if (error?.name !== "NotAllowedError") throw error;

    return new Promise((resolve, reject) => {
      const retry = () => {
        document.removeEventListener("pointerdown", retry);
        document.removeEventListener("keydown", retry);
        audio.play().then(resolve, reject);
      };

      document.addEventListener("pointerdown", retry, { once: true });
      document.addEventListener("keydown", retry, { once: true });
    });
  });
}
