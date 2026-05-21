/**
 * Aether Speech Recognition and Synthesis Engine
 * STT: Web Speech API. TTS: browser, ElevenLabs, or OmniVoice (server proxy).
 */

class SpeechEngine {
  constructor() {
    this.recognition = null;
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.speechEnabled = true;
    this.currentAudio = null;
    this.currentAudioUrl = null;
    this._replayRegisterInFlight = false;

    this.audioContext = null;
    this.analyser = null;
    this._audioSource = null;
    this._audioSourceElement = null;
    this.frequencyData = null;
    this.timeDomainData = null;
    this.voiceAudioActive = false;
    this._voiceLevelSmooth = 0;
    this._mouthLevel = 0;
    this._lastAudioAnalysisAt = 0;

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
    return AetherUserData.getItem('aether_tts_provider') || 'browser';
  }

  getElevenLabsVoiceId() {
    return AetherUserData.getItem('aether_elevenlabs_voice_id') || '';
  }

  getOmniVoiceSample() {
    return AetherUserData.getItem('aether_omnivoice_sample') || '';
  }

  getOmniVoiceInstruct() {
    return AetherUserData.getItem('aether_omnivoice_instruct') || '';
  }

  getSpeechSpeed() {
    return parseFloat(AetherUserData.getItem('aether_voice_speed') || '1.0');
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

  _initAudioAnalysis() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.72;
      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeDomainData = new Uint8Array(this.analyser.fftSize);
    }
    return this.analyser;
  }

  _connectAnalyser(audio) {
    const analyser = this._initAudioAnalysis();
    if (!analyser) return;

    if (this._audioSourceElement !== audio) {
      this._teardownAnalyserSource(false);
      this._audioSource = this.audioContext.createMediaElementSource(audio);
      this._audioSourceElement = audio;
      this._audioSource.connect(analyser);
      analyser.connect(this.audioContext.destination);
    }

    this.voiceAudioActive = true;
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  _teardownAnalyserSource(resetSmoothing = true) {
    if (this._audioSource) {
      try {
        this._audioSource.disconnect();
      } catch (_) {
        /* already disconnected */
      }
      this._audioSource = null;
      this._audioSourceElement = null;
    }
    this.voiceAudioActive = false;
    if (resetSmoothing) {
      this._voiceLevelSmooth = 0;
      this._mouthLevel = 0;
      this._lastAudioAnalysisAt = 0;
    }
  }

  /**
   * Sample live voice audio for the HUD visualizer (frequency + envelope).
   * Returns null when no analyzed audio element is playing.
   */
  updateVoiceAudioAnalysis() {
    if (!this.voiceAudioActive || !this.analyser) return null;

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeDomainData);

    let sumSq = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      const sample = (this.timeDomainData[i] - 128) / 128;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / this.timeDomainData.length);
    let voicedBand = 0;
    const startBin = 2;
    const endBin = Math.min(36, this.frequencyData.length);
    for (let i = startBin; i < endBin; i++) {
      voicedBand += this.frequencyData[i] / 255;
    }
    voicedBand = voicedBand / Math.max(1, endBin - startBin);

    this._voiceLevelSmooth = this._voiceLevelSmooth * 0.78 + rms * 0.22;

    const mouthInput = Math.min(1, rms * 3.1 + voicedBand * 0.28);
    const mouthAttack = 0.62;
    const mouthRelease = 0.16;
    const mouthEase = mouthInput > this._mouthLevel ? mouthAttack : mouthRelease;
    this._mouthLevel += (mouthInput - this._mouthLevel) * mouthEase;
    if (this._mouthLevel < 0.025) this._mouthLevel = 0;
    this._lastAudioAnalysisAt = performance.now();

    return {
      frequency: this.frequencyData,
      envelope: this._voiceLevelSmooth,
      rawRms: rms,
      voicedBand,
      mouthEnvelope: this._mouthLevel,
      hasLiveMouthAudio: true,
    };
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
    this._teardownAnalyserSource();
  }

  stopSpeaking() {
    if (this.synth) {
      this.synth.cancel();
    }
    this.stopAudioPlayback();
  }

  async _registerBrowserReplay(cleanText, onReplayId) {
    if (!onReplayId || this._replayRegisterInFlight) return;
    this._replayRegisterInFlight = true;
    try {
      const res = await fetch('/api/tts/replay-cache/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, provider: 'browser' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) onReplayId(data.id);
    } catch (e) {
      console.warn('Failed to register browser TTS replay:', e.message || e);
    } finally {
      this._replayRegisterInFlight = false;
    }
  }

  async _playAudioBlob(blob, onEnd, onReplayId, replayIdFromHeader) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    this.currentAudio = audio;
    this.currentAudioUrl = url;
    this._connectAnalyser(audio);

    const speed = this.getSpeechSpeed();
    if (Number.isFinite(speed) && speed > 0 && speed !== 1) {
      audio.playbackRate = speed;
    }

    if (onReplayId && replayIdFromHeader) {
      onReplayId(replayIdFromHeader);
    }

    const finish = () => {
      if (this.currentAudio === audio) {
        this.stopAudioPlayback();
      }
      if (onEnd) onEnd();
    };

    audio.onended = finish;
    audio.onerror = (e) => {
      console.error('Audio playback error:', e);
      finish();
    };

    await audio.play();
  }

  speakWithBrowser(cleanText, onBoundary, onEnd, options = {}) {
    const { onReplayId, skipReplayCache } = options;

    if (!this.synth) {
      if (onEnd) onEnd();
      return;
    }

    this.synth.cancel();
    this._teardownAnalyserSource();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voiceConfig = this.voiceConfig;
    const matchedVoice = this.findBestVoice(voiceConfig.preferredVoiceKeywords);

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    const customVoiceName = AetherUserData.getItem('aether_voice_name');
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

    if (!skipReplayCache && onReplayId) {
      this._registerBrowserReplay(cleanText, onReplayId);
    }
  }

  async speakWithOmniVoice(cleanText, sample, instruct, speed, onEnd, options = {}) {
    const { onReplayId } = options;
    try {
      const resolvedSample = (sample || this.getOmniVoiceSample() || '').trim();
      const resolvedInstruct = String(instruct ?? this.getOmniVoiceInstruct() ?? '').trim();
      const payload = { text: cleanText, speed };
      if (resolvedSample) payload.sample = resolvedSample;
      else if (resolvedInstruct) payload.instruct = resolvedInstruct;

      const res = await fetch('/api/tts/omnivoice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `OmniVoice TTS failed (${res.status})`);
      }

      const replayId = res.headers.get('X-Aether-Replay-Id');
      const blob = await res.blob();
      await this._playAudioBlob(blob, onEnd, onReplayId, replayId);
    } catch (e) {
      console.warn('OmniVoice TTS failed, falling back to browser:', e.message || e);
      this.speakWithBrowser(cleanText, null, onEnd, options);
    }
  }

  async speakWithElevenLabs(cleanText, voiceId, speed, onEnd, options = {}) {
    const { onReplayId } = options;
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

      const replayId = res.headers.get('X-Aether-Replay-Id');
      const blob = await res.blob();
      await this._playAudioBlob(blob, onEnd, onReplayId, replayId);
    } catch (e) {
      console.warn('ElevenLabs TTS failed, falling back to browser:', e.message || e);
      this.speakWithBrowser(cleanText, null, onEnd, options);
    }
  }

  speak(text, _legacyProfileId, onBoundary, onEnd, options = {}) {
    const opts = typeof options === 'object' && options !== null ? options : {};
    const finish = onEnd;
    const skipReplayCache = Boolean(opts.skipReplayCache);

    if (!this.speechEnabled && !opts.forcePlay) {
      if (finish) finish();
      return;
    }

    this.stopSpeaking();

    const cleanText = SpeechEngine.cleanTextForSpeech(text);
    if (!cleanText) {
      if (finish) finish();
      return;
    }

    const speakOpts = {
      onReplayId: opts.onReplayId,
      skipReplayCache,
    };

    if (this.getTtsProvider() === 'elevenlabs') {
      this.speakWithElevenLabs(
        cleanText,
        this.getElevenLabsVoiceId(),
        this.getSpeechSpeed(),
        finish,
        speakOpts
      );
      return;
    }

    if (this.getTtsProvider() === 'omnivoice') {
      this.speakWithOmniVoice(
        cleanText,
        this.getOmniVoiceSample(),
        this.getOmniVoiceInstruct(),
        this.getSpeechSpeed(),
        finish,
        speakOpts
      );
      return;
    }

    this.speakWithBrowser(cleanText, onBoundary, finish, speakOpts);
  }

  async replayById(replayId, fallbackText, onEnd) {
    if (!replayId) {
      if (fallbackText) {
        this.speak(fallbackText, null, null, onEnd, { forcePlay: true, skipReplayCache: true });
      } else if (onEnd) onEnd();
      return;
    }

    this.stopSpeaking();

    try {
      const res = await fetch(`/api/tts/replay-cache/${encodeURIComponent(replayId)}`);
      const contentType = (res.headers.get('content-type') || '').toLowerCase();

      if (res.ok && contentType.includes('audio')) {
        const blob = await res.blob();
        await this._playAudioBlob(blob, onEnd, null, null);
        return;
      }

      if (res.ok && contentType.includes('json')) {
        const data = await res.json();
        if (data.text) {
          this.speak(data.text, null, null, onEnd, { forcePlay: true, skipReplayCache: true });
          return;
        }
      }
    } catch (e) {
      console.warn('Replay fetch failed:', e.message || e);
    }

    if (fallbackText) {
      this.speak(fallbackText, null, null, onEnd, { forcePlay: true, skipReplayCache: true });
    } else if (onEnd) onEnd();
  }

  previewVoice(voiceRef, rate = 1.0, providerOverride = null) {
    if (!voiceRef) return;

    this.stopSpeaking();

    const previewText = 'Hello. I am Aether. This is a voice preview.';
    const provider = providerOverride || this.getTtsProvider();
    const previewOpts = { skipReplayCache: true };

    if (provider === 'elevenlabs') {
      this.speakWithElevenLabs(previewText, voiceRef, rate, null, previewOpts);
      return;
    }

    if (provider === 'omnivoice') {
      const sample = voiceRef || this.getOmniVoiceSample();
      const instruct = sample ? '' : this.getOmniVoiceInstruct();
      this.speakWithOmniVoice(previewText, sample, instruct, rate, null, previewOpts);
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
