/**
 * Aether Speech Recognition and Synthesis Engine
 * STT: Web Speech API. TTS: browser speechSynthesis or ElevenLabs (server proxy).
 */

class SpeechEngine {
  constructor() {
    this.recognition = null;
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.speechEnabled = true;
    this.currentAudio = null;
    this.currentAudioUrl = null;

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

  getTtsProvider() {
    return localStorage.getItem('aether_tts_provider') || 'browser';
  }

  getElevenLabsVoiceId() {
    return localStorage.getItem('aether_elevenlabs_voice_id') || '';
  }

  getSpeechSpeed() {
    return parseFloat(localStorage.getItem('aether_voice_speed') || '1.0');
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

  async loadElevenLabsVoices() {
    try {
      const res = await fetch('/api/tts/elevenlabs/voices');
      const data = await res.json().catch(() => ({}));
      const voices = Array.isArray(data.voices) ? data.voices : [];
      window.dispatchEvent(
        new CustomEvent('aetherElevenLabsVoicesLoaded', {
          detail: { voices, configured: res.ok, error: data.error || null },
        })
      );
      return voices;
    } catch (e) {
      console.warn('Failed to load ElevenLabs voices:', e);
      window.dispatchEvent(
        new CustomEvent('aetherElevenLabsVoicesLoaded', {
          detail: { voices: [], configured: false, error: e.message },
        })
      );
      return [];
    }
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

  stopAudioPlayback() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio = null;
    }
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }

  stopSpeaking() {
    if (this.synth) {
      this.synth.cancel();
    }
    this.stopAudioPlayback();
  }

  speakWithBrowser(cleanText, onBoundary, onEnd) {
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

    const customSpeed = this.getSpeechSpeed();
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

  async speakWithElevenLabs(cleanText, voiceId, speed, onEnd) {
    try {
      const res = await fetch('/api/tts/elevenlabs/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          voiceId: voiceId || this.getElevenLabsVoiceId(),
          speed,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `ElevenLabs TTS failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      this.currentAudio = audio;
      this.currentAudioUrl = url;

      const finish = () => {
        if (this.currentAudio === audio) {
          this.stopAudioPlayback();
        }
        if (onEnd) onEnd();
      };

      audio.onended = finish;
      audio.onerror = (e) => {
        console.error('ElevenLabs audio playback error:', e);
        finish();
      };

      await audio.play();
    } catch (e) {
      console.warn('ElevenLabs TTS failed, falling back to browser:', e.message || e);
      this.speakWithBrowser(cleanText, null, onEnd);
    }
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

    if (this.getTtsProvider() === 'elevenlabs') {
      this.speakWithElevenLabs(cleanText, this.getElevenLabsVoiceId(), this.getSpeechSpeed(), onEnd);
      return;
    }

    this.speakWithBrowser(cleanText, onBoundary, onEnd);
  }

  previewVoice(voiceRef, rate = 1.0, providerOverride = null) {
    if (!voiceRef) return;

    this.stopSpeaking();

    const previewText = 'Hello. I am Aether. This is a voice preview.';
    const provider = providerOverride || this.getTtsProvider();

    if (provider === 'elevenlabs') {
      this.speakWithElevenLabs(previewText, voiceRef, rate, null);
      return;
    }

    if (!this.synth) return;

    const voice = this.voices.find((v) => v.name === voiceRef);
    if (!voice) return;

    const utterance = new SpeechSynthesisUtterance(previewText);
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
