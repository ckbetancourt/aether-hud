/**
 * Aether Speech Recognition and Synthesis Engine
 * STT: Web Speech API. TTS: browser speechSynthesis.
 */

class SpeechEngine {
  constructor() {
    this.recognition = null;
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.speechEnabled = true;

    this.voiceConfig = {
      pitch: 1.0,
      rate: 1.0,
      preferredVoiceKeywords: ['google us english', 'microsoft zira', 'en-us', 'female'],
    };

    this.initRecognition();
    this.loadVoices();

    if (this.synth) {
      this.synth.onvoiceschanged = () => this.loadVoices();
    }
  }

  initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech Recognition API is not supported in this browser. Voice-to-text is disabled.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';
  }

  startListening(onStart, onResult, onEnd, onError) {
    if (!this.recognition) {
      onError('Speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return;
    }

    this.recognition.onstart = () => {
      if (onStart) onStart();
    };

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (onResult) onResult(transcript);
    };

    this.recognition.onerror = (event) => {
      if (onError) onError(event.error);
    };

    this.recognition.onend = () => {
      if (onEnd) onEnd();
    };

    try {
      this.recognition.start();
    } catch (e) {
      console.error('Speech Recognition start failed: ', e);
      if (onError) onError('Microphone already active or permission denied.');
    }
  }

  stopListening() {
    if (this.recognition) {
      this.recognition.stop();
    }
  }

  loadVoices() {
    if (!this.synth) return;
    this.voices = this.synth.getVoices();
    window.dispatchEvent(
      new CustomEvent('aetherVoicesLoaded', { detail: { voices: this.voices } })
    );
  }

  findBestVoice(keywords) {
    if (this.voices.length === 0) return null;

    for (const kw of keywords) {
      const match = this.voices.find((v) => v.name.toLowerCase().includes(kw.toLowerCase()));
      if (match) return match;
    }

    const englishVoice = this.voices.find((v) => v.lang.startsWith('en'));
    return englishVoice || this.voices[0];
  }

  static cleanTextForSpeech(text) {
    return text
      .replace(/```[a-z]*\n[\s\S]*?\n```/g, '[Coding sequence skipped]')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[#*_\->[\]()]/g, '')
      .replace(/>/g, '')
      .trim();
  }

  speak(text, _legacyProfileId, onBoundary, onEnd) {
    if (!this.speechEnabled) {
      if (onEnd) onEnd();
      return;
    }

    this.stopSpeaking();

    const cleanText = SpeechEngine.cleanTextForSpeech(text);
    if (!cleanText) {
      if (onEnd) onEnd();
      return;
    }

    if (!this.synth) {
      if (onEnd) onEnd();
      return;
    }

    this.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voiceConfig = this.voiceConfig;
    const matchedVoice = this.findBestVoice(voiceConfig.preferredVoiceKeywords);

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    const customVoiceName = localStorage.getItem('aether_voice_name');
    if (customVoiceName) {
      const userVoice = this.voices.find((v) => v.name === customVoiceName);
      if (userVoice) utterance.voice = userVoice;
    }

    const customSpeed = parseFloat(localStorage.getItem('aether_voice_speed') || '1.0');
    utterance.rate = voiceConfig.rate * customSpeed;
    utterance.pitch = voiceConfig.pitch;

    utterance.onboundary = (event) => {
      if (onBoundary) onBoundary(event);
    };

    utterance.onend = () => {
      if (onEnd) onEnd();
    };

    utterance.onerror = (e) => {
      console.error('Speech Synthesis Utterance error: ', e);
      if (onEnd) onEnd();
    };

    this.synth.speak(utterance);
  }

  stopSpeaking() {
    if (this.synth) {
      this.synth.cancel();
    }
  }

  previewVoice(voiceName, rate = 1.0) {
    if (!this.synth || !voiceName) return;

    this.stopSpeaking();

    const voice = this.voices.find((v) => v.name === voiceName);
    if (!voice) return;

    const utterance = new SpeechSynthesisUtterance('Hello. I am Aether. This is a voice preview.');
    utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = this.voiceConfig.pitch;

    utterance.onerror = (e) => {
      console.error('Voice preview error: ', e);
    };

    this.synth.speak(utterance);
  }
}

window.SpeechEngine = SpeechEngine;
