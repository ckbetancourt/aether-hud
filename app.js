/**
 * Aether HUD Main Application Orchestrator
 * Coordinates interactive HUD states, Speech Engines, canvas parallax, and local archives.
 */

document.addEventListener('DOMContentLoaded', () => {
    let resizeLoopInterval = null;
    let persistSessionsTimer = null;
    let historyRenderScheduled = false;

    const MAX_SESSIONS = 40;
    const MAX_MESSAGES_PER_SESSION = 100;
    const MAX_MESSAGE_CHARS = 32000;

    function loadSavedSessions() {
        try {
            return JSON.parse(localStorage.getItem('aether_sessions') || '[]').map(normalizeSession);
        } catch {
            return [];
        }
    }

    function normalizeSession(session) {
        const savedHermesProfile = localStorage.getItem('aether_hermes_profile') || null;
        return {
            id: session.id || `sess_${Date.now()}`,
            title: session.title || 'Untitled session',
            profile: session.profile || session.model || '',
            source: session.source || (session.hermesSessionId ? 'hermes' : 'local'),
            hermesSessionId: session.hermesSessionId || null,
            hermesProfile: session.hermesProfile || savedHermesProfile,
            hermesUpdatedAt: session.hermesUpdatedAt || null,
            messages: Array.isArray(session.messages) ? session.messages : [],
        };
    }

    function loadProfileAccents() {
        try {
            return JSON.parse(localStorage.getItem('aether_profile_accents') || '{}');
        } catch {
            return {};
        }
    }

    function loadGlobalAccentTheme() {
        const stored = localStorage.getItem('aether_accent_theme');
        if (stored && AETHER_ACCENT_THEMES[stored]) return stored;
        const fallback = 'jarvis-red';
        localStorage.setItem('aether_accent_theme', fallback);
        return fallback;
    }

    // 1. Core State Definition
    const state = {
        sessions: loadSavedSessions(),
        activeSessionId: localStorage.getItem('aether_active_session_id') || null,
        activeHermesProfile: localStorage.getItem('aether_hermes_profile') || '',
        hermesStatus: null,
        isVoiceActive: false,
        speechEnabled: JSON.parse(localStorage.getItem('aether_speech_enabled') ?? 'true'),
        memory: JSON.parse(localStorage.getItem('aether_memory') || '{}'),
        globalAccentTheme: null,
        activeAccentTheme: null,
    };
    state.globalAccentTheme = loadGlobalAccentTheme();

    // 2. Instantiate Systems
    const ai = new AIEngine();
    const speech = new SpeechEngine();
    const visualizer = new JarvisHUD('jarvisCanvas');

    // Start Orb Rendering immediately
    visualizer.start();

    // 3. Select HUD DOM Elements
    const elements = {
        // Badges
        activeProfileBadge: document.getElementById('activeProfileBadge'),
        activeStatusBadge: document.getElementById('activeStatusBadge'),
        hudOrbLabel: document.getElementById('hudOrbLabel'),
        
        // Buttons
        settingsBtn: document.getElementById('settingsBtn'),
        closeSettingsBtn: document.getElementById('closeSettingsBtn'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),
        settingsModal: document.getElementById('settingsModal'),
        
        voiceRecognitionBtn: document.getElementById('voiceRecognitionBtn'),
        disconnectBtn: document.getElementById('disconnectBtn'),
        speechSynthesisToggle: document.getElementById('speechSynthesisToggle'),
        historyDrawerToggle: document.getElementById('historyDrawerToggle'),
        historyDrawerCloseBtn: document.getElementById('historyDrawerCloseBtn'),
        sidebarDrawer: document.getElementById('sidebarDrawer'),
        newChatBtn: document.getElementById('newChatBtn'),

        hudShell: document.getElementById('hudShell'),

        // Terminal Console Log widgets
        consoleLatency: document.getElementById('consoleLatency'),
        consoleScroller: document.getElementById('consoleScroller'),
        chatHistoryList: document.getElementById('chatHistoryList'),

        // Right chat column
        chatColumn: document.getElementById('chatColumn'),
        chatDeckToggle: document.getElementById('chatDeckToggle'),
        closeChatDeckBtn: document.getElementById('closeChatDeckBtn'),
        deckChatScroller: document.getElementById('deckChatScroller'),
        deckChatInputField: document.getElementById('deckChatInputField'),
        deckSendMessageBtn: document.getElementById('deckSendMessageBtn'),

        // Settings inputs
        ttsProvider: document.getElementById('ttsProvider'),
        ttsProviderHint: document.getElementById('ttsProviderHint'),
        synthVoice: document.getElementById('synthVoice'),
        voicePreviewBtn: document.getElementById('voicePreviewBtn'),
        voiceInputBehavior: document.getElementById('voiceInputBehavior'),
        synthSpeed: document.getElementById('synthSpeed'),
        synthSpeedVal: document.getElementById('synthSpeedVal'),
        simulationSpeed: document.getElementById('simulationSpeed'),
        simulationSpeedVal: document.getElementById('simulationSpeedVal'),
        hermesProfileSelect: document.getElementById('hermesProfileSelect'),
        hermesStatusText: document.getElementById('hermesStatusText'),
    };

    // Initialize speech mute UI button state
    if (!state.speechEnabled) {
        elements.speechSynthesisToggle.classList.remove('active');
        elements.speechSynthesisToggle.querySelector('i').setAttribute('data-lucide', 'volume-x');
    }
    speech.speechEnabled = state.speechEnabled;

    // 4. UI Setup and Event Wiring
    setupEventListeners();
    applyAccentTheme(state.globalAccentTheme);
    updateHermesProfileBadge();
    renderHistorySessions();
    startLatencyTelemetryMock();
    refreshHermesIntegration();

    // Load active session or spawn new
    if (!state.activeSessionId) {
        startNewSession();
    } else {
        loadSession(state.activeSessionId);
    }
    
    // Process icons
    lucide.createIcons();

    const chatCollapsed =
        localStorage.getItem('aether_chat_column_collapsed') === 'true' ||
        (localStorage.getItem('aether_chat_column_collapsed') === null &&
            localStorage.getItem('aether_chat_column_open') === 'false');
    if (chatCollapsed) {
        collapseChatColumn();
    } else {
        expandChatColumn(false);
    }

    /* ==========================================================================
       A. HUD Control Event Listeners
       ========================================================================== */
    function setupEventListeners() {
        // Toggle slide-in Sidebar Drawer
        elements.historyDrawerToggle.addEventListener('click', toggleSidebarDrawer);
        elements.historyDrawerCloseBtn.addEventListener('click', toggleSidebarDrawer);
        
        // Settings triggers
        elements.settingsBtn.addEventListener('click', openSettingsModal);
        elements.closeSettingsBtn.addEventListener('click', closeSettingsModal);
        elements.saveSettingsBtn.addEventListener('click', saveSettings);
        elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === elements.settingsModal) closeSettingsModal();
        });

        document.querySelectorAll('.accent-swatch').forEach((swatch) => {
            swatch.addEventListener('click', () => {
                const themeId = swatch.getAttribute('data-accent-theme');
                if (themeId) selectAccentTheme(themeId);
            });
        });

        // Global shortcut: focus chat composer (expand column if collapsed)
        window.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement.tagName.toLowerCase();
            const typingInComposer = activeTag === 'textarea' && document.activeElement === elements.deckChatInputField;
            const collapsed = elements.hudShell?.classList.contains('chat-collapsed');

            if (activeTag !== 'input' && activeTag !== 'textarea') {
                if (e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    expandChatColumn();
                } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    expandChatColumn();
                    elements.deckChatInputField.value += e.key;
                    elements.deckChatInputField.focus();
                }
            } else if (!typingInComposer && e.key === 'Escape' && !collapsed) {
                collapseChatColumn();
            }
        });

        // Disconnect reset session
        elements.disconnectBtn.addEventListener('click', () => {
            speech.stopSpeaking();

            appendSystemConsoleLine("[ALERT] Disconnected. Session cleared.");

            const sessIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
            if (sessIndex !== -1) {
                state.sessions[sessIndex].messages = [];
                schedulePersistSessions();
            }

            elements.consoleScroller.innerHTML = `<div class="console-log-line system-line">[SYSTEM] Client connection active. Telemetries initialized.</div>
            <div class="console-log-line">Welcome back. Awaiting next command instructions...</div>`;

            elements.deckChatScroller.innerHTML = '';
            appendAssistantChatBubble("Active session cleared. Direct channel active. Awaiting inputs...");
        });

        // Voice mic recognition triggers
        elements.voiceRecognitionBtn.addEventListener('click', toggleVoiceMode);
        elements.speechSynthesisToggle.addEventListener('click', toggleSpeechOutput);
        elements.newChatBtn.addEventListener('click', () => {
            startNewSession();
            toggleSidebarDrawer();
        });

        // Right chat column triggers
        elements.chatDeckToggle.addEventListener('click', toggleChatColumn);
        elements.closeChatDeckBtn.addEventListener('click', collapseChatColumn);
        elements.deckChatInputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitDeckMessage();
            }
        });
        elements.deckSendMessageBtn.addEventListener('click', submitDeckMessage);

        // Sliders updates
        elements.synthSpeed.addEventListener('input', () => {
            elements.synthSpeedVal.textContent = elements.synthSpeed.value + 'x';
        });
        elements.simulationSpeed.addEventListener('input', () => {
            const vals = ['Snail', 'Slow', 'Normal', 'Fast', 'Instant'];
            const index = Math.min(4, Math.floor((elements.simulationSpeed.value - 1) / 2));
            elements.simulationSpeedVal.textContent = vals[index];
        });

        window.addEventListener('aetherVoicesLoaded', populateVoicesList);
        window.addEventListener('aetherElevenLabsVoicesLoaded', populateVoicesList);

        if (elements.ttsProvider) {
            elements.ttsProvider.addEventListener('change', () => {
                updateTtsProviderHint();
                populateVoicesList();
            });
        }

        if (elements.voicePreviewBtn) {
            elements.voicePreviewBtn.addEventListener('click', previewSelectedVoice);
        }

    }

    /* ==========================================================================
       B. Typewriter Command Console Orchestrator
       ========================================================================== */
    function toggleSidebarDrawer() {
        elements.sidebarDrawer.classList.toggle('open');
        elements.historyDrawerToggle.classList.toggle('active');
    }

    function runTransitionResizeLoop() {
        if (resizeLoopInterval) clearInterval(resizeLoopInterval);
        let elapsed = 0;
        resizeLoopInterval = setInterval(() => {
            if (visualizer && typeof visualizer.resize === 'function') {
                visualizer.resize();
            }
            elapsed += 16;
            if (elapsed >= 400) {
                clearInterval(resizeLoopInterval);
                resizeLoopInterval = null;
            }
        }, 16);
    }

    function expandChatColumn(focusInput = true) {
        elements.hudShell?.classList.remove('chat-collapsed');
        elements.chatDeckToggle.classList.add('active');
        localStorage.setItem('aether_chat_column_collapsed', 'false');
        if (focusInput) {
            elements.deckChatInputField.focus();
        }
        updateMicButtonTitle();
        runTransitionResizeLoop();
    }

    function collapseChatColumn() {
        elements.hudShell?.classList.add('chat-collapsed');
        elements.chatDeckToggle.classList.remove('active');
        localStorage.setItem('aether_chat_column_collapsed', 'true');
        updateMicButtonTitle();
        runTransitionResizeLoop();
    }

    function updateMicButtonTitle() {
        if (!elements.voiceRecognitionBtn) return;
        const behavior = localStorage.getItem('aether_voice_input_behavior') || 'auto';
        const isChatCollapsed = elements.hudShell?.classList.contains('chat-collapsed');
        
        if (behavior === 'llm' || (behavior === 'auto' && isChatCollapsed)) {
            elements.voiceRecognitionBtn.title = "Speak directly to Aether (Voice-to-LLM Mode)";
        } else {
            elements.voiceRecognitionBtn.title = "Speak to type in Chat input (Speech-to-Text Mode)";
        }
    }

    function toggleChatColumn() {
        if (elements.hudShell?.classList.contains('chat-collapsed')) {
            expandChatColumn();
        } else {
            collapseChatColumn();
        }
    }

    async function submitDirectTextCommand(text) {
        // Stop currently playing synthesis
        speech.stopSpeaking();
        visualizer.setState('idle');

        // Render input in diagnostic terminal logs and chat deck bubble
        appendSystemConsoleLine(`[USER] &gt; ${text}`);
        appendUserChatBubble(text);
        saveMessageToSession('user', text);

        // Spawn thinking state animations
        visualizer.setState('thinking');

        // Create placeholders in both logs
        const consoleLogNode = appendSystemConsoleLine(`[AETHER] ...`);
        const bubbleNode = appendAssistantChatBubble('...');

        try {
            const activeSession = state.sessions.find(s => s.id === state.activeSessionId);
            const history = activeSession ? activeSession.messages : [];
            if (state.hermesStatus?.enabled) {
                appendSystemConsoleLine(
                    state.hermesStatus.connected
                        ? `[AGENT] Routing command through Hermes${activeSession?.hermesSessionId ? ` session ${String(activeSession.hermesSessionId).slice(0, 18)}` : ''}.`
                        : '[AGENT] Hermes mode is enabled, but the bridge is offline. Attempting request for latest status.'
                );
            }

            // Query cognitive engine
            const aiResponse = await ai.getResponse(
                text, 
                null,
                history, 
                // Ignore checklist/memory overlay drawer triggers in minimalist screen, 
                // or just log task events to console!
                (tasks) => {
                    appendSystemConsoleLine(`[TASK TELEMETRY] Logged checklist: "${tasks.slice(0,2).join(', ')}..."`);
                }, 
                (k, v) => {
                    appendSystemConsoleLine(`[MEMORY BANK] Recorded ${k}: ${v}`);
                },
                {
                    sessionId: activeSession?.id,
                    hermesSessionId: activeSession?.hermesSessionId,
                    hermesProfile: activeSession?.hermesProfile || state.activeHermesProfile,
                }
            );
            const responseText = typeof aiResponse === 'string' ? aiResponse : aiResponse.text || '';
            const responseMeta = typeof aiResponse === 'object' && aiResponse !== null ? aiResponse : {};

            if (responseMeta.backend === 'hermes') {
                persistHermesSessionMetadata(responseMeta.hermes);
                appendAgentStatusLine(responseMeta.hermes);
                state.hermesStatus = {
                    ...(state.hermesStatus || {}),
                    enabled: true,
                    connected: true,
                    backend: 'hermes',
                    model: responseMeta.hermes?.model || state.hermesStatus?.model,
                    profile: responseMeta.hermes?.profile || state.hermesStatus?.profile,
                };
                updateHermesStatusUi(state.hermesStatus);
            }

            // Stream response typewriter style inside terminal log and chat bubble
            await streamResponseText(consoleLogNode, bubbleNode, responseText);
            saveMessageToSession('assistant', responseText, responseMeta);

        } catch (err) {
            console.error("Aether telemetry failure: ", err);
            const errMsg = `[AETHER ERROR] Telemetry routing failed. Error: ${err.message}`;
            consoleLogNode.innerHTML = `<span style="color:var(--error);">${errMsg}</span>`;
            bubbleNode.innerHTML = `<span style="color:var(--error);">${errMsg}</span>`;
            visualizer.setState('idle');
        }
    }

    function appendSystemConsoleLine(text) {
        const line = document.createElement('div');
        line.className = 'console-log-line';
        
        if (text.startsWith('[USER]')) {
            line.style.color = '#ffffff';
            line.style.fontWeight = 'bold';
        } else if (text.startsWith('[SYSTEM]') || text.startsWith('[TASK') || text.startsWith('[MEMORY') || text.startsWith('[AGENT')) {
            line.style.color = 'var(--accent-secondary)';
            line.style.fontSize = '0.7rem';
        }

        line.innerHTML = text;
        elements.consoleScroller.appendChild(line);
        scrollConsoleBottom();
        return line;
    }

    function hermesProfileLabel() {
        return state.activeHermesProfile || state.hermesStatus?.profile || 'default';
    }

    function appendAgentStatusLine(hermes) {
        if (!hermes) return;
        const parts = ['[AGENT] Hermes response received'];
        if (hermes.profile) parts.push(`profile=${hermes.profile}`);
        if (hermes.sessionId) parts.push(`session=${String(hermes.sessionId).slice(0, 18)}`);
        appendSystemConsoleLine(parts.join(' | '));
    }

    function persistHermesSessionMetadata(hermes) {
        const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
        if (sessionIndex === -1 || !hermes) return;
        state.sessions[sessionIndex].source = 'hermes';
        state.sessions[sessionIndex].hermesSessionId = hermes.sessionId || state.sessions[sessionIndex].hermesSessionId || null;
        state.sessions[sessionIndex].hermesProfile = hermes.profile || state.activeHermesProfile || null;
        state.sessions[sessionIndex].hermesUpdatedAt = new Date().toISOString();
        schedulePersistSessions();
        scheduleRenderHistorySessions();
    }

    /**
     * Typewriter streaming logic to render text directly into terminal element
     */
    function streamResponseText(logNode, bubbleNode, fullText) {
        return new Promise((resolve) => {
            logNode.innerHTML = `<span style="color:#ffffff; font-weight:bold;">[HERMES:${hermesProfileLabel().toUpperCase()}]</span> `;

            const textSpan = document.createElement('span');
            const cursorSpan = document.createElement('span');
            cursorSpan.className = 'typing-cursor';

            logNode.appendChild(textSpan);
            logNode.appendChild(cursorSpan);

            bubbleNode.className = 'chat-bubble assistant-bubble';
            bubbleNode.innerHTML = '';
            const bubbleText = document.createElement('div');
            bubbleText.className = 'assistant-stream-body';
            const bubbleCursor = document.createElement('span');
            bubbleCursor.className = 'typing-cursor';
            bubbleNode.appendChild(bubbleText);
            bubbleNode.appendChild(bubbleCursor);

            scrollConsoleBottom();
            elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;

            // Synthesis spoken feedback
            visualizer.setState('speaking');
            const speakableText = prepareSpeechText(fullText);
            speech.speak(speakableText, null, null, () => {
                if (visualizer.state === 'speaking') {
                    visualizer.setState('idle');
                }
            });

            // Delay calculations
            const multiplier = parseInt(elements.simulationSpeed.value || '5', 10);
            const intervalTime = Math.max(2, 35 - (multiplier * 3));

            let index = 0;
            let currentString = '';

            const interval = setInterval(() => {
                if (index < fullText.length) {
                    currentString += fullText[index];
                    textSpan.innerHTML = parseConsoleMarkdown(currentString);
                    bubbleText.innerHTML = parseConsoleMarkdown(currentString);
                    index++;

                    if (index % 5 === 0) {
                        scrollConsoleBottom();
                        elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;
                    }
                } else {
                    clearInterval(interval);
                    cursorSpan.remove();
                    bubbleCursor.remove();
                    textSpan.innerHTML = parseConsoleMarkdown(fullText);
                    bubbleText.innerHTML = parseConsoleMarkdown(fullText);
                    lucide.createIcons();
                    scrollConsoleBottom();
                    elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;
                    resolve();
                }
            }, intervalTime);
        });
    }

    function prepareSpeechText(text) {
        return String(text || '')
            .replace(/```[\s\S]*?```/g, 'I have included a code block in the chat.')
            .replace(/\[(AGENT|SYSTEM|TASK TELEMETRY|MEMORY BANK)\][^\n]*/g, '')
            .trim();
    }

    function scrollConsoleBottom() {
        elements.consoleScroller.scrollTop = elements.consoleScroller.scrollHeight;
    }

    /* ==========================================================================
       C. Native Web Voice Mode Control
       ========================================================================== */
    function toggleVoiceMode() {
        if (state.isVoiceActive) {
            stopVoiceMode();
        } else {
            startVoiceMode();
        }
    }

    function startVoiceMode() {
        state.isVoiceActive = true;
        elements.voiceRecognitionBtn.classList.add('active-mic');
        
        speech.stopSpeaking();
        visualizer.setState('listening');

        appendSystemConsoleLine("[VOICE] Activating speech recognition telemetries...");

        speech.startListening(
            // onStart
            () => {
                appendSystemConsoleLine("[VOICE] Microphone connected. Listening...");
            },
            // onResult
            (transcript) => {
                appendSystemConsoleLine(`[VOICE] Transcribed: "${transcript}"`);
                stopVoiceMode();

                const behavior = localStorage.getItem('aether_voice_input_behavior') || 'auto';
                const isChatCollapsed = elements.hudShell?.classList.contains('chat-collapsed');

                if (behavior === 'llm' || (behavior === 'auto' && isChatCollapsed)) {
                    submitDirectTextCommand(transcript);
                } else {
                    if (isChatCollapsed) {
                        expandChatColumn();
                    }
                    const currentVal = elements.deckChatInputField.value.trim();
                    if (currentVal) {
                        elements.deckChatInputField.value = currentVal + " " + transcript;
                    } else {
                        elements.deckChatInputField.value = transcript;
                    }
                    elements.deckChatInputField.focus();
                    appendSystemConsoleLine("[SYSTEM] Transcribed text inserted into chat composer.");
                }
            },
            // onEnd
            () => {
                stopVoiceMode();
            },
            // onError
            (err) => {
                console.error("Vocal recognition failure: ", err);
                appendSystemConsoleLine(`[VOICE ERROR] Capture failed: ${err}`);
                stopVoiceMode();
            }
        );
    }

    function stopVoiceMode() {
        state.isVoiceActive = false;
        elements.voiceRecognitionBtn.classList.remove('active-mic');
        speech.stopListening();
        visualizer.setState('idle');
    }

    function toggleSpeechOutput() {
        state.speechEnabled = !state.speechEnabled;
        localStorage.setItem('aether_speech_enabled', state.speechEnabled);
        speech.speechEnabled = state.speechEnabled;

        if (state.speechEnabled) {
            elements.speechSynthesisToggle.classList.add('active');
            elements.speechSynthesisToggle.querySelector('i').setAttribute('data-lucide', 'volume-2');
            appendSystemConsoleLine("[SYSTEM] Voice synthesis activated.");
        } else {
            elements.speechSynthesisToggle.classList.remove('active');
            elements.speechSynthesisToggle.querySelector('i').setAttribute('data-lucide', 'volume-x');
            speech.stopSpeaking();
            appendSystemConsoleLine("[SYSTEM] Voice synthesis muted.");
        }
        lucide.createIcons();
    }

    /* ==========================================================================
       C2. HUD accent themes (independent of activity profiles)
       ========================================================================== */
    function getAccentTheme(themeId) {
        return AETHER_ACCENT_THEMES[themeId] || AETHER_ACCENT_THEMES['jarvis-red'];
    }

    function applyAccentTheme(themeId) {
        const theme = getAccentTheme(themeId);
        state.activeAccentTheme = theme.id;

        visualizer.setAccentTheme(theme);

        document.querySelectorAll('.accent-swatch').forEach((swatch) => {
            swatch.classList.toggle(
                'active',
                swatch.getAttribute('data-accent-theme') === theme.id
            );
            swatch.setAttribute('aria-pressed', swatch.classList.contains('active') ? 'true' : 'false');
        });
    }

    function selectAccentTheme(themeId) {
        if (!AETHER_ACCENT_THEMES[themeId]) return;

        state.globalAccentTheme = themeId;
        localStorage.setItem('aether_accent_theme', themeId);

        applyAccentTheme(themeId);
    }

    function clearGlobalAccentOverrides() {
        document.body.removeAttribute('data-accent-theme');
        for (const prop of [
            '--accent-primary',
            '--accent-secondary',
            '--accent-glow',
            '--accent-glow-subtle',
            '--border-glow',
        ]) {
            document.body.style.removeProperty(prop);
        }
    }

    function updateHermesProfileBadge() {
        if (!elements.activeProfileBadge) return;
        elements.activeProfileBadge.textContent = `HERMES-${hermesProfileLabel().toUpperCase()}`;
    }

    /* ==========================================================================
       E. Latency Diagnostics Telemetry Mock
       ========================================================================== */
    function startLatencyTelemetryMock() {
        setInterval(() => {
            if (!elements.consoleLatency) return;
            
            let lat = 14 + Math.floor(Math.random() * 8);
            if (visualizer.state === 'thinking') {
                lat = 120 + Math.floor(Math.random() * 30);
            } else if (visualizer.state === 'speaking') {
                lat = 22 + Math.floor(Math.random() * 10);
            }
            
            elements.consoleLatency.textContent = `LATENCY: ${lat}ms`;
        }, 2000);
    }

    /* ==========================================================================
       F. Archives & Session Cache Persistence
       ========================================================================== */
    function pruneSessions(sessions) {
        return sessions.slice(0, MAX_SESSIONS).map((s) => ({
            ...s,
            messages: (s.messages || []).slice(-MAX_MESSAGES_PER_SESSION).map((m) => {
                if (m.content && m.content.length > MAX_MESSAGE_CHARS) {
                    return {
                        ...m,
                        content: m.content.slice(0, MAX_MESSAGE_CHARS),
                        truncated: true,
                    };
                }
                return m;
            }),
        }));
    }

    function flushPersistSessions() {
        persistSessionsTimer = null;
        const run = () => {
            state.sessions = pruneSessions(state.sessions);
            try {
                localStorage.setItem('aether_sessions', JSON.stringify(state.sessions));
            } catch (err) {
                console.error('Failed to persist sessions:', err);
            }
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 500 });
        } else {
            setTimeout(run, 0);
        }
    }

    function schedulePersistSessions() {
        if (persistSessionsTimer) clearTimeout(persistSessionsTimer);
        persistSessionsTimer = setTimeout(flushPersistSessions, 150);
    }

    function scheduleRenderHistorySessions() {
        if (historyRenderScheduled) return;
        historyRenderScheduled = true;
        requestAnimationFrame(() => {
            historyRenderScheduled = false;
            renderHistorySessions();
        });
    }

    function refreshHistoryIcons() {
        if (typeof lucide !== 'undefined' && elements.chatHistoryList) {
            lucide.createIcons({ root: elements.chatHistoryList });
        }
    }

    function startNewSession() {
        const id = 'sess_' + Date.now();
        const newSession = {
            id: id,
            title: `Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            profile: '',
            source: state.hermesStatus?.connected ? 'hermes' : 'local',
            hermesSessionId: null,
            hermesProfile: state.activeHermesProfile || state.hermesStatus?.profile || null,
            hermesUpdatedAt: null,
            messages: []
        };

        state.sessions.unshift(newSession);
        state.activeSessionId = id;
        
        localStorage.setItem('aether_active_session_id', id);
        schedulePersistSessions();

        // Wipe logs
        elements.consoleScroller.innerHTML = `<div class="console-log-line system-line">[SYSTEM] Client connection active. Telemetries initialized.</div>
        <div class="console-log-line">Welcome. I am Aether. Press Space to open chat or use the mic to coordinate telemetries.</div>`;

        elements.deckChatScroller.innerHTML = '';
        appendAssistantChatBubble('New session started. Awaiting inputs…');

        scheduleRenderHistorySessions();
        speech.stopSpeaking();
    }

    function loadSession(sessionId) {
        const session = state.sessions.find(s => s.id === sessionId);
        if (!session) {
            startNewSession();
            return;
        }

        state.activeSessionId = sessionId;
        localStorage.setItem('aether_active_session_id', sessionId);
        updateHermesProfileBadge();

        // Load logs
        elements.consoleScroller.innerHTML = `<div class="console-log-line system-line">[SYSTEM] Historical session re-loaded.</div>`;
        
        if (session.messages.length === 0) {
            elements.consoleScroller.innerHTML += `<div class="console-log-line">Active session log empty. Awaiting inputs...</div>`;
        } else {
            session.messages.forEach(msg => {
                if (msg.role === 'user') {
                    appendSystemConsoleLine(`[USER] &gt; ${msg.content}`);
                } else {
                    const line = appendSystemConsoleLine(`[AETHER] ...`);
                    const profileLabel = (session.profile || session.model || 'general').toUpperCase();
                    const agentLabel = session.source === 'hermes' ? ' HERMES' : '';
                    line.innerHTML = `<span style="color:#ffffff; font-weight:bold;">[${profileLabel}${agentLabel}]</span> <span>${parseConsoleMarkdown(msg.content)}</span>`;
                }
            });
        }

        elements.deckChatScroller.innerHTML = '';
        if (session.messages.length === 0) {
            appendAssistantChatBubble('Session loaded. Awaiting inputs…');
        } else {
            session.messages.forEach((msg) => {
                if (msg.role === 'user') {
                    appendUserChatBubble(msg.content);
                } else {
                    appendAssistantChatBubble(msg.content);
                }
            });
        }

        scheduleRenderHistorySessions();
        scrollConsoleBottom();
    }

    function saveMessageToSession(role, content, meta = {}) {
        const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
        if (sessionIndex === -1) return;

        const message = { role, content };
        if (meta.backend) message.backend = meta.backend;
        if (meta.hermes?.sessionId) message.hermesSessionId = meta.hermes.sessionId;
        state.sessions[sessionIndex].messages.push(message);
        
        // Title update
        if (state.sessions[sessionIndex].messages.length === 2) {
            const firstUserMessage = state.sessions[sessionIndex].messages.find(m => m.role === 'user');
            if (firstUserMessage) {
                const words = firstUserMessage.content.split(' ');
                state.sessions[sessionIndex].title = words.slice(0, 3).join(' ') + (words.length > 3 ? '...' : '');
            }
        }

        schedulePersistSessions();
        scheduleRenderHistorySessions();
    }

    function renderHistorySessions() {
        const list = elements.chatHistoryList;
        list.innerHTML = '';

        if (state.sessions.length === 0) {
            list.innerHTML = `<div style="font-size:0.65rem; color:var(--text-dim); text-align:center; padding:10px;">Archive empty</div>`;
            return;
        }

        const fragment = document.createDocumentFragment();

        state.sessions.forEach((s) => {
            const btn = document.createElement('button');
            btn.className = `history-item ${s.id === state.activeSessionId ? 'active' : ''}`;
            
            const icon = document.createElement('i');
            icon.setAttribute('data-lucide', s.source === 'hermes' ? 'radio-tower' : 'database');
            icon.className = 'history-icon';
            icon.style.width = '12px';
            icon.style.height = '12px';
            
            const titleSpan = document.createElement('span');
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            titleSpan.style.whiteSpace = 'nowrap';
            titleSpan.textContent = s.title;

            if (s.source === 'hermes') {
                btn.title = `Hermes profile: ${s.hermesProfile || 'default'}${s.hermesSessionId ? ` | Session: ${s.hermesSessionId}` : ''}`;
            }

            btn.appendChild(icon);
            btn.appendChild(titleSpan);
            
            btn.addEventListener('click', () => {
                loadSession(s.id);
                toggleSidebarDrawer();
            });
            fragment.appendChild(btn);
        });

        list.appendChild(fragment);
        refreshHistoryIcons();
    }

    async function refreshHermesIntegration() {
        try {
            const status = await ai.getBackendStatus();
            state.hermesStatus = status;
            updateHermesStatusUi(status);
            if (status.enabled && status.connected) {
                appendSystemConsoleLine(`[AGENT] Hermes bridge connected: ${status.model || 'default model'}`);
                syncHermesSessions();
            } else if (status.enabled) {
                appendSystemConsoleLine(`[AGENT] Hermes bridge unavailable: ${status.error || status.reason || 'status probe failed'}`);
                (status.setupSteps || []).forEach((step, i) => {
                    appendSystemConsoleLine(`[AGENT] Setup ${i + 1}/${status.setupSteps.length}: ${step}`);
                });
            }
        } catch (err) {
            state.hermesStatus = { enabled: false, connected: false, error: err.message };
            updateHermesStatusUi(state.hermesStatus);
        }
    }

    async function syncHermesSessions() {
        if (!state.hermesStatus?.capabilities?.sessions) return;
        try {
            const result = await ai.getHermesSessions();
            if (!result.available || !Array.isArray(result.items)) return;

            let imported = 0;
            result.items.forEach((item) => {
                const hermesSessionId = String(item.id || item.sessionId || item.session_id || item.uuid || '');
                if (!hermesSessionId) return;
                const existing = state.sessions.find(s => s.hermesSessionId === hermesSessionId);
                if (existing) {
                    existing.hermesUpdatedAt = item.updatedAt || item.updated_at || existing.hermesUpdatedAt;
                    return;
                }
                state.sessions.push(normalizeSession({
                    id: `hermes_${hermesSessionId}`,
                    title: item.title || item.name || `Hermes ${hermesSessionId.slice(0, 8)}`,
                    profile: '',
                    source: 'hermes',
                    hermesSessionId,
                    hermesProfile: item.profile || item.profileId || state.activeHermesProfile || state.hermesStatus.profile || null,
                    hermesUpdatedAt: item.updatedAt || item.updated_at || null,
                    messages: Array.isArray(item.messages) ? item.messages : [],
                }));
                imported++;
            });

            if (imported > 0) {
                schedulePersistSessions();
                scheduleRenderHistorySessions();
                appendSystemConsoleLine(`[AGENT] Imported ${imported} Hermes session${imported === 1 ? '' : 's'} into archives.`);
            }
        } catch (err) {
            appendSystemConsoleLine(`[AGENT] Hermes session listing unavailable: ${err.message}`);
        }
    }

    function updateHermesStatusUi(status) {
        updateHermesProfileBadge();
        if (!elements.activeStatusBadge) return;
        if (status?.enabled && status.connected) {
            elements.activeStatusBadge.innerHTML = '<span class="pulse-dot"></span> HERMES';
        } else if (status?.enabled) {
            elements.activeStatusBadge.innerHTML = '<span class="pulse-dot"></span> HERMES OFFLINE';
        } else {
            elements.activeStatusBadge.innerHTML = '<span class="pulse-dot"></span> CONNECTED';
        }

        if (elements.hermesStatusText) {
            if (status?.enabled && status.connected) {
                elements.hermesStatusText.textContent = `Connected to ${status.model || 'Hermes'} at ${status.baseUrl || 'configured API'}.`;
            } else if (status?.enabled) {
                const err = status.error || status.reason || 'Hermes mode is enabled, but the API is not reachable.';
                const steps = Array.isArray(status.setupSteps) ? status.setupSteps : [];
                elements.hermesStatusText.textContent = steps.length
                    ? `${err} Run: npm run hermes:doctor — ${steps[0]}`
                    : err;
            } else {
                elements.hermesStatusText.textContent = 'Hermes mode is disabled. Set AETHER_BACKEND=hermes on the server to use the bridge.';
            }
        }
    }

    async function populateHermesProfilesList() {
        if (!elements.hermesProfileSelect) return;
        const current = state.activeHermesProfile || state.hermesStatus?.profile || '';
        elements.hermesProfileSelect.innerHTML = '<option value="">Hermes default profile</option>';
        try {
            const result = await ai.getHermesProfiles();
            const seen = new Set(['']);
            (result.items || []).forEach((profile) => {
                const id = String(profile.id || profile.name || profile.slug || profile);
                if (!id || seen.has(id)) return;
                seen.add(id);
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = profile.displayName || profile.name || id;
                elements.hermesProfileSelect.appendChild(opt);
            });
            elements.hermesProfileSelect.value = current;
        } catch (err) {
            const opt = document.createElement('option');
            opt.value = current;
            opt.textContent = current ? `${current} (configured)` : 'Profiles unavailable';
            elements.hermesProfileSelect.appendChild(opt);
            elements.hermesProfileSelect.value = current;
        }
    }

    /* ==========================================================================
       G. Settings Dialog Form Controllers
       ========================================================================== */

    function appendUserChatBubble(text) {
        const div = document.createElement('div');
        div.className = 'chat-bubble user-bubble';
        div.textContent = text;
        elements.deckChatScroller.appendChild(div);
        elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;
        return div;
    }

    function appendAssistantChatBubble(initialText) {
        const div = document.createElement('div');
        div.className = 'chat-bubble assistant-bubble';
        if (initialText === '...') {
            div.innerHTML = '<em style="opacity:0.7">…</em>';
        } else {
            div.innerHTML = parseConsoleMarkdown(initialText);
        }
        elements.deckChatScroller.appendChild(div);
        elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;
        return div;
    }

    async function submitDeckMessage() {
        const text = elements.deckChatInputField.value.trim();
        if (!text) return;
        elements.deckChatInputField.value = '';
        if (elements.hudShell?.classList.contains('chat-collapsed')) {
            expandChatColumn(false);
        }
        await submitDirectTextCommand(text);
    }

    function getTtsProvider() {
        return localStorage.getItem('aether_tts_provider') || 'browser';
    }

    function updateTtsProviderHint() {
        if (!elements.ttsProviderHint) return;
        const provider = elements.ttsProvider?.value || getTtsProvider();
        if (provider === 'elevenlabs') {
            elements.ttsProviderHint.textContent =
                'Cloud voices via ElevenLabs. Set ELEVENLABS_API_KEY in .env.local on the Aether server, then restart npm start. Speed adjusts voice stability.';
        } else {
            elements.ttsProviderHint.textContent =
                "Uses your browser's built-in speech synthesis (no model download). Speed adjusts playback rate.";
        }
    }

    function openSettingsModal() {
        if (elements.ttsProvider) {
            elements.ttsProvider.value = getTtsProvider();
        }
        updateTtsProviderHint();

        elements.synthSpeed.value = localStorage.getItem('aether_voice_speed') || '1.0';
        elements.synthSpeedVal.textContent = elements.synthSpeed.value + 'x';
        
        const delayVal = localStorage.getItem('aether_stream_delay') || '5';
        elements.simulationSpeed.value = delayVal;
        
        const vals = ['Snail', 'Slow', 'Normal', 'Fast', 'Instant'];
        elements.simulationSpeedVal.textContent = vals[Math.min(4, Math.floor((delayVal - 1) / 2))];

        if (elements.voiceInputBehavior) {
            elements.voiceInputBehavior.value = localStorage.getItem('aether_voice_input_behavior') || 'auto';
        }

        if (elements.hermesProfileSelect) {
            elements.hermesProfileSelect.value = state.activeHermesProfile;
            populateHermesProfilesList();
        }

        refreshHermesIntegration();

        populateVoicesList();
        lucide.createIcons();

        elements.settingsModal.classList.add('open');
    }

    function closeSettingsModal() {
        elements.settingsModal.classList.remove('open');
    }

    function saveSettings() {
        localStorage.setItem('aether_voice_speed', elements.synthSpeed.value);
        localStorage.setItem('aether_stream_delay', elements.simulationSpeed.value);

        if (elements.ttsProvider) {
            localStorage.setItem('aether_tts_provider', elements.ttsProvider.value);
        }

        const providerToSave = elements.ttsProvider?.value || getTtsProvider();
        if (elements.synthVoice?.value) {
            if (providerToSave === 'elevenlabs') {
                localStorage.setItem('aether_elevenlabs_voice_id', elements.synthVoice.value);
            } else {
                localStorage.setItem('aether_voice_name', elements.synthVoice.value);
            }
        }

        if (elements.voiceInputBehavior) {
            localStorage.setItem('aether_voice_input_behavior', elements.voiceInputBehavior.value);
        }

        if (elements.hermesProfileSelect) {
            state.activeHermesProfile = elements.hermesProfileSelect.value.trim();
            if (state.activeHermesProfile) {
                localStorage.setItem('aether_hermes_profile', state.activeHermesProfile);
            } else {
                localStorage.removeItem('aether_hermes_profile');
            }
            const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
            if (sessionIndex !== -1) {
                state.sessions[sessionIndex].hermesProfile = state.activeHermesProfile || null;
                schedulePersistSessions();
            }
            updateHermesProfileBadge();
        }

        closeSettingsModal();
        updateMicButtonTitle();

        speech.loadVoices();

        appendSystemConsoleLine("[SYSTEM] Settings updated.");
    }

    function populateBrowserVoicesList() {
        const systemVoices = speech.voices;
        if (systemVoices.length === 0) {
            elements.synthVoice.innerHTML = '<option value="">No voices available</option>';
            if (elements.voicePreviewBtn) {
                elements.voicePreviewBtn.disabled = true;
            }
            return;
        }

        const savedVoiceName = localStorage.getItem('aether_voice_name');

        systemVoices.forEach((v) => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.textContent = `${v.name} (${v.lang})`;
            if (savedVoiceName && v.name === savedVoiceName) {
                opt.selected = true;
            }
            elements.synthVoice.appendChild(opt);
        });

        if (elements.voicePreviewBtn) {
            elements.voicePreviewBtn.disabled = false;
        }
    }

    async function populateElevenLabsVoicesList() {
        elements.synthVoice.innerHTML = '<option value="">Loading ElevenLabs voices…</option>';
        if (elements.voicePreviewBtn) {
            elements.voicePreviewBtn.disabled = true;
        }

        try {
            const res = await fetch('/api/tts/elevenlabs/voices');
            const data = await res.json().catch(() => ({}));
            const voices = Array.isArray(data.voices) ? data.voices : [];

            elements.synthVoice.innerHTML = '';

            if (!res.ok || voices.length === 0) {
                const message = data.error || 'ElevenLabs not configured';
                elements.synthVoice.innerHTML = `<option value="">${message}</option>`;
                return;
            }

            const savedVoiceId = localStorage.getItem('aether_elevenlabs_voice_id');

            voices.forEach((v) => {
                const opt = document.createElement('option');
                opt.value = v.id;
                const category = v.category ? ` · ${v.category}` : '';
                opt.textContent = `${v.name}${category}`;
                if (savedVoiceId && v.id === savedVoiceId) {
                    opt.selected = true;
                }
                elements.synthVoice.appendChild(opt);
            });

            if (elements.voicePreviewBtn) {
                elements.voicePreviewBtn.disabled = !elements.synthVoice.value;
            }
        } catch (e) {
            elements.synthVoice.innerHTML = '<option value="">Failed to load ElevenLabs voices</option>';
        }
    }

    function populateVoicesList() {
        if (!elements.synthVoice) return;
        elements.synthVoice.innerHTML = '';

        const provider = elements.ttsProvider?.value || getTtsProvider();
        if (provider === 'elevenlabs') {
            populateElevenLabsVoicesList();
            return;
        }

        populateBrowserVoicesList();
    }

    function previewSelectedVoice() {
        if (!elements.synthVoice || !elements.synthVoice.value) return;

        const rate = parseFloat(elements.synthSpeed?.value || '1.0');
        const provider = elements.ttsProvider?.value || getTtsProvider();
        speech.previewVoice(elements.synthVoice.value, rate, provider);
    }

    /* ==========================================================================
       H. Console Markdown Parser
       ========================================================================== */
    function parseConsoleMarkdown(md) {
        if (!md) return '';
        let html = md;

        // Escaping HTML to prevent code issues
        html = html
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Fenced Code Blocks (```javascript ... ```)
        html = html.replace(/```([a-z0-9\-]*)\n([\s\S]*?)\n```/gi, (match, lang, code) => {
            const cleanLang = lang || 'code';
            const cleanCode = code.trim();
            const copyId = 'copy_' + Math.random().toString(36).substr(2, 9);
            
            // Inline Clipboard copies
            window[copyId] = () => {
                navigator.clipboard.writeText(cleanCode);
                const btn = document.getElementById(copyId);
                if (btn) {
                    btn.innerHTML = `<i data-lucide="check" style="width:10px; height:10px;"></i> Copied`;
                    lucide.createIcons();
                    setTimeout(() => {
                        btn.innerHTML = `<i data-lucide="copy" style="width:10px; height:10px;"></i> Copy`;
                        lucide.createIcons();
                    }, 2000);
                }
            };

            return `<pre><div class="code-header" style="padding:4px 8px; font-size:0.6rem;">${cleanLang.toUpperCase()}<button class="copy-btn" id="${copyId}" onclick="window['${copyId}']()" style="font-size:0.6rem;"><i data-lucide="copy" style="width:10px; height:10px;"></i> Copy</button></div><code>${cleanCode}</code></pre>`;
        });

        // Inline Code ticks (`code`)
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Simple Markdown Tables
        const lines = html.split('\n');
        let inTable = false;
        let tableHTML = '';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.endsWith('|')) {
                if (line.includes('---')) continue;
                
                const cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
                
                if (!inTable) {
                    inTable = true;
                    tableHTML = '<table class="glass-table"><thead><tr>';
                    cells.forEach(c => tableHTML += `<th>${c}</th>`);
                    tableHTML += '</tr></thead><tbody>';
                } else {
                    tableHTML += '<tr>';
                    cells.forEach(c => tableHTML += `<td>${c}</td>`);
                    tableHTML += '</tr>';
                }
                lines[i] = '';
            } else {
                if (inTable) {
                    inTable = false;
                    tableHTML += '</tbody></table>';
                    lines[i] = tableHTML + '\n' + lines[i];
                }
            }
        }
        if (inTable) {
            tableHTML += '</tbody></table>';
            lines[lines.length - 1] += tableHTML;
        }
        html = lines.filter(l => l !== '').join('\n');

        // Bold (**text**) & Italic (*text*)
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Headings (### Title)
        html = html.replace(/^###\s+(.*?)$/gm, '<div style="color:var(--accent-primary); font-weight:bold; margin-top:8px;">$1</div>');
        html = html.replace(/^####\s+(.*?)$/gm, '<div style="color:#ffffff; font-weight:bold; margin-top:6px;">$1</div>');

        // Lists (- bullet)
        html = html.replace(/^\s*-\s+(.*?)$/gm, '&bull; $1');

        // Line breaks
        html = html.replace(/\n/g, '<br>');

        return html;
    }
});
