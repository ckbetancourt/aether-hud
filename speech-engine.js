/**
 * Aether Speech Recognition and Synthesis Engine
 * Harnesses standard Web Speech APIs to provide native Voice Mode.
 */

class SpeechEngine {
    constructor() {
        this.recognition = null;
        this.synth = window.speechSynthesis;
        this.voices = [];
        this.speechEnabled = true;
        
        // Voice configuration matches
        this.voiceMap = {
            aether: { pitch: 1.0, rate: 1.0, preferredVoiceKeywords: ['google us english', 'microsoft zira', 'en-us', 'female'] },
            nova: { pitch: 0.8, rate: 1.1, preferredVoiceKeywords: ['david', 'microsoft david', 'en-us', 'male', 'robotic'] },
            aria: { pitch: 1.15, rate: 0.95, preferredVoiceKeywords: ['natural', 'google uk english female', 'hazel', 'female'] },
            marcus: { pitch: 0.85, rate: 1.0, preferredVoiceKeywords: ['microsoft david', 'google us english male', 'en-gb', 'male'] }
        };

        this.initRecognition();
        this.loadVoices();
        
        // Chrome loads voices asynchronously
        if (this.synth) {
            this.synth.onvoiceschanged = () => this.loadVoices();
        }
    }

    /**
     * Set up Speech-to-Text Recognition
     */
    initRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Web Speech Recognition API is not supported in this browser. Voice-to-text is disabled.");
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';
    }

    /**
     * Start recording user voice
     */
    startListening(onStart, onResult, onEnd, onError) {
        if (!this.recognition) {
            onError("Speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.");
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
            console.error("Speech Recognition start failed: ", e);
            if (onError) onError("Microphone already active or permission denied.");
        }
    }

    /**
     * Halt voice recording
     */
    stopListening() {
        if (this.recognition) {
            this.recognition.stop();
        }
    }

    /**
     * Load list of native system voices
     */
    loadVoices() {
        if (!this.synth) return;
        this.voices = this.synth.getVoices();
        
        // Fire custom event to populate settings voice select
        const event = new CustomEvent('aetherVoicesLoaded', { detail: this.voices });
        window.dispatchEvent(event);
    }

    /**
     * Match a voice based on keyword priorities
     */
    findBestVoice(keywords) {
        if (this.voices.length === 0) return null;
        
        // Strip markdown, find matched strings
        for (let kw of keywords) {
            const match = this.voices.find(v => v.name.toLowerCase().includes(kw.toLowerCase()));
            if (match) return match;
        }
        
        // Fallback to english or first option
        const englishVoice = this.voices.find(v => v.lang.startsWith('en'));
        return englishVoice || this.voices[0];
    }

    /**
     * Speak response text aloud
     */
    speak(text, personalityId, onBoundary, onEnd) {
        if (!this.synth || !this.speechEnabled) {
            if (onEnd) onEnd();
            return;
        }

        // Cancel previous speaking tasks immediately
        this.synth.cancel();

        // Strip markdown syntax from speaking string (so the AI doesn't literally pronounce "asterisk code block hash")
        const cleanText = text
            .replace(/```[a-z]*\n[\s\S]*?\n```/g, '[Coding sequence skipped]') // Don't speak blocks of code
            .replace(/`([^`]+)`/g, '$1') // Strip inline code ticks
            .replace(/[#*_\->[\]()]/g, '') // Strip standard markdown punctuation
            .replace(/>/g, '') // Strip blockquotes
            .trim();

        if (!cleanText) {
            if (onEnd) onEnd();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(cleanText);
        
        // Find best voice config
        const voiceConfig = this.voiceMap[personalityId] || this.voiceMap.aether;
        const matchedVoice = this.findBestVoice(voiceConfig.preferredVoiceKeywords);
        
        if (matchedVoice) {
            utterance.voice = matchedVoice;
        }

        // User settings overrides
        const customVoiceName = localStorage.getItem('aether_voice_name');
        if (customVoiceName) {
            const userVoice = this.voices.find(v => v.name === customVoiceName);
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
            console.error("Speech Synthesis Utterance error: ", e);
            if (onEnd) onEnd();
        };

        this.synth.speak(utterance);
    }

    /**
     * Halt vocal synthesis
     */
    stopSpeaking() {
        if (this.synth) {
            this.synth.cancel();
        }
    }
}
