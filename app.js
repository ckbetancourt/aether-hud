/**
 * Aether Jarvis HUD Main Application Orchestrator
 * Coordinates interactive HUD states, Speech Engines, canvas parallax, and local archives.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Core State Definition
    const state = {
        activeModel: 'aether',
        sessions: JSON.parse(localStorage.getItem('aether_sessions') || '[]'),
        activeSessionId: localStorage.getItem('aether_active_session_id') || null,
        isVoiceActive: false,
        speechEnabled: JSON.parse(localStorage.getItem('aether_speech_enabled') ?? 'true'),
        memory: JSON.parse(localStorage.getItem('aether_memory') || '{}')
    };

    // 2. Instantiate Systems
    const ai = new AIEngine();
    const speech = new SpeechEngine();
    const visualizer = new JarvisHUD('jarvisCanvas');

    // Start Orb Rendering immediately
    visualizer.start();

    // 3. Select HUD DOM Elements
    const elements = {
        // Badges
        activeModelBadge: document.getElementById('activeModelBadge'),
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

        // Text Dialog Modals
        keyboardTrigger: document.getElementById('keyboardTrigger'),
        textInputOverlay: document.getElementById('textInputOverlay'),
        closeTextOverlayBtn: document.getElementById('closeTextOverlayBtn'),
        chatInput: document.getElementById('chatInput'),
        sendMessageBtn: document.getElementById('sendMessageBtn'),

        // Terminal Console Log widgets
        consoleLatency: document.getElementById('consoleLatency'),
        consoleScroller: document.getElementById('consoleScroller'),
        chatHistoryList: document.getElementById('chatHistoryList'),

        // Bottom Chat Deck widgets
        bottomChatDeck: document.getElementById('bottomChatDeck'),
        chatDeckToggle: document.getElementById('chatDeckToggle'),
        closeChatDeckBtn: document.getElementById('closeChatDeckBtn'),
        deckChatScroller: document.getElementById('deckChatScroller'),
        deckChatInputField: document.getElementById('deckChatInputField'),
        deckSendMessageBtn: document.getElementById('deckSendMessageBtn'),

        // Settings inputs
        apiKey: document.getElementById('apiKey'),
        llmBackendUrl: document.getElementById('llmBackendUrl'),
        synthVoice: document.getElementById('synthVoice'),
        synthSpeed: document.getElementById('synthSpeed'),
        synthSpeedVal: document.getElementById('synthSpeedVal'),
        simulationSpeed: document.getElementById('simulationSpeed'),
        simulationSpeedVal: document.getElementById('simulationSpeedVal')
    };

    // Initialize speech mute UI button state
    if (!state.speechEnabled) {
        elements.speechSynthesisToggle.classList.remove('active');
        elements.speechSynthesisToggle.querySelector('i').setAttribute('data-lucide', 'volume-x');
    }
    speech.speechEnabled = state.speechEnabled;

    // 4. UI Setup and Event Wiring
    setupEventListeners();
    renderHistorySessions();
    startLatencyTelemetryMock();

    // Load active session or spawn new
    if (!state.activeSessionId) {
        startNewSession();
    } else {
        loadSession(state.activeSessionId);
    }
    
    // Process icons
    lucide.createIcons();

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

        // Quick action text prompts inside drawer
        document.querySelectorAll('.drawer-quick-actions .action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const actionText = btn.getAttribute('data-action');
                submitDirectTextCommand(actionText);
                toggleSidebarDrawer();
            });
        });

        // Model selector buttons inside drawer
        document.querySelectorAll('.personality-card').forEach(card => {
            card.addEventListener('click', () => {
                const modelId = card.getAttribute('data-model');
                changeActiveModel(modelId);
            });
        });

        // Input Keyboard overlay triggers
        elements.keyboardTrigger.addEventListener('click', openTextOverlay);
        elements.closeTextOverlayBtn.addEventListener('click', closeTextOverlay);
        elements.textInputOverlay.addEventListener('click', (e) => {
            if (e.target === elements.textInputOverlay) closeTextOverlay();
        });
        
        // Listen to global key presses (Press Space to instantly open typewriter modal!)
        window.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement.tagName.toLowerCase();
            if (activeTag !== 'input' && activeTag !== 'textarea') {
                if (e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    openTextOverlay();
                } else if (e.key.length === 1) {
                    openTextOverlay();
                    elements.chatInput.value += e.key;
                }
            }
        });

        elements.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitUserCommand();
            }
        });
        elements.sendMessageBtn.addEventListener('click', submitUserCommand);

        // Disconnect reset session
        elements.disconnectBtn.addEventListener('click', () => {
            speech.stopSpeaking();
            speech.speak("Telemetry offline. Purging active registers.", state.activeModel);
            
            appendSystemConsoleLine("[ALERT] Disconnected. Session cleared.");
            
            // Clear messages
            const sessIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
            if (sessIndex !== -1) {
                state.sessions[sessIndex].messages = [];
                localStorage.setItem('aether_sessions', JSON.stringify(state.sessions));
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

        // Bottom Chat Deck triggers
        elements.chatDeckToggle.addEventListener('click', toggleChatDeck);
        elements.closeChatDeckBtn.addEventListener('click', toggleChatDeck);
        elements.deckChatInputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
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
    }

    /* ==========================================================================
       B. Typewriter Command Console Orchestrator
       ========================================================================== */
    function toggleSidebarDrawer() {
        elements.sidebarDrawer.classList.toggle('open');
        elements.historyDrawerToggle.classList.toggle('active');
    }

    function openTextOverlay() {
        elements.textInputOverlay.classList.add('open');
        elements.chatInput.focus();
    }

    function closeTextOverlay() {
        elements.textInputOverlay.classList.remove('open');
        elements.chatInput.value = '';
    }

    function submitUserCommand() {
        const text = elements.chatInput.value.trim();
        if (!text) return;
        
        closeTextOverlay();
        submitDirectTextCommand(text);
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

            // Query cognitive engine
            const aiResponse = await ai.getResponse(
                text, 
                state.activeModel, 
                history, 
                // Ignore checklist/memory overlay drawer triggers in minimalist screen, 
                // or just log task events to console!
                (tasks) => {
                    appendSystemConsoleLine(`[TASK TELEMETRY] Logged checklist: "${tasks.slice(0,2).join(', ')}..."`);
                }, 
                (k, v) => {
                    appendSystemConsoleLine(`[MEMORY BANK] Recorded ${k}: ${v}`);
                }
            );

            // Stream response typewriter style inside terminal log and chat bubble
            await streamResponseText(consoleLogNode, bubbleNode, aiResponse);
            saveMessageToSession('assistant', aiResponse);

        } catch (err) {
            console.error("Jarvis Telemetry failure: ", err);
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
        } else if (text.startsWith('[SYSTEM]') || text.startsWith('[TASK') || text.startsWith('[MEMORY')) {
            line.style.color = 'var(--accent-secondary)';
            line.style.fontSize = '0.7rem';
        }

        line.innerHTML = text;
        elements.consoleScroller.appendChild(line);
        scrollConsoleBottom();
        return line;
    }

    /**
     * Typewriter streaming logic to render text directly into terminal element
     */
    function streamResponseText(logNode, bubbleNode, fullText) {
        return new Promise((resolve) => {
            logNode.innerHTML = `<span style="color:#ffffff; font-weight:bold;">[${state.activeModel.toUpperCase()}]</span> `;

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
            speech.speak(fullText, state.activeModel, null, () => {
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
                submitDirectTextCommand(transcript);
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
            speech.speak("Vocal synthesis operational.", state.activeModel);
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
       D. AI Personality Themes Switcher
       ========================================================================== */
    function changeActiveModel(modelId) {
        state.activeModel = modelId;
        
        // Apply styling class overrides
        document.body.className = `theme-${modelId}`;
        
        // Toggle cards active state
        document.querySelectorAll('.personality-card').forEach(card => {
            card.classList.remove('active');
            if (card.getAttribute('data-model') === modelId) {
                card.classList.add('active');
            }
        });

        // Set top bar title
        const modelData = ai.personalities[modelId];
        elements.activeModelBadge.textContent = modelData.displayName.toUpperCase().replace(' ', '-');

        // Play vocal chime
        speech.stopSpeaking();
        speech.speak(modelData.greeting, modelId);
        
        appendSystemConsoleLine(`[SYSTEM] Loaded core module: ${modelData.displayName}`);
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
    function startNewSession() {
        const id = 'sess_' + Date.now();
        const newSession = {
            id: id,
            title: `Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            model: state.activeModel,
            messages: []
        };

        state.sessions.unshift(newSession);
        state.activeSessionId = id;
        
        localStorage.setItem('aether_sessions', JSON.stringify(state.sessions));
        localStorage.setItem('aether_active_session_id', id);

        // Wipe logs
        elements.consoleScroller.innerHTML = `<div class="console-log-line system-line">[SYSTEM] Client connection active. Telemetries initialized.</div>
        <div class="console-log-line">Welcome. I am Aether. Swipe your cursor to shift parallax or press Space to type prompt...</div>`;

        renderHistorySessions();
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
        
        changeActiveModel(session.model);

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
                    line.innerHTML = `<span style="color:#ffffff; font-weight:bold;">[${session.model.toUpperCase()}]</span> <span>${parseConsoleMarkdown(msg.content)}</span>`;
                }
            });
        }

        renderHistorySessions();
        scrollConsoleBottom();
    }

    function saveMessageToSession(role, content) {
        const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
        if (sessionIndex === -1) return;

        state.sessions[sessionIndex].messages.push({ role, content });
        
        // Title update
        if (state.sessions[sessionIndex].messages.length === 2) {
            const firstUserMessage = state.sessions[sessionIndex].messages.find(m => m.role === 'user');
            if (firstUserMessage) {
                const words = firstUserMessage.content.split(' ');
                state.sessions[sessionIndex].title = words.slice(0, 3).join(' ') + (words.length > 3 ? '...' : '');
            }
        }

        localStorage.setItem('aether_sessions', JSON.stringify(state.sessions));
        renderHistorySessions();
    }

    function renderHistorySessions() {
        elements.chatHistoryList.innerHTML = '';
        
        if (state.sessions.length === 0) {
            elements.chatHistoryList.innerHTML = `<div style="font-size:0.65rem; color:var(--text-dim); text-align:center; padding:10px;">Archive empty</div>`;
            return;
        }

        state.sessions.forEach(s => {
            const btn = document.createElement('button');
            btn.className = `history-item ${s.id === state.activeSessionId ? 'active' : ''}`;
            
            const icon = document.createElement('i');
            icon.setAttribute('data-lucide', 'database');
            icon.className = 'history-icon';
            icon.style.width = '12px';
            icon.style.height = '12px';
            
            const titleSpan = document.createElement('span');
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            titleSpan.style.whiteSpace = 'nowrap';
            titleSpan.textContent = s.title;

            btn.appendChild(icon);
            btn.appendChild(titleSpan);
            
            btn.addEventListener('click', () => {
                loadSession(s.id);
                toggleSidebarDrawer();
            });
            elements.chatHistoryList.appendChild(btn);
        });

        lucide.createIcons();
    }

    /* ==========================================================================
       G. Settings Dialog Form Controllers
       ========================================================================== */
    function toggleChatDeck() {
        elements.bottomChatDeck.classList.toggle('open');
        elements.chatDeckToggle.classList.toggle('active');
        lucide.createIcons();
    }

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
        if (!elements.bottomChatDeck.classList.contains('open')) {
            toggleChatDeck();
        }
        await submitDirectTextCommand(text);
    }

    function openSettingsModal() {
        elements.apiKey.value = localStorage.getItem('aether_api_key') || '';
        if (elements.llmBackendUrl) {
            elements.llmBackendUrl.value = localStorage.getItem('aether_llm_backend_url') || '';
        }
        elements.synthSpeed.value = localStorage.getItem('aether_voice_speed') || '1.0';
        elements.synthSpeedVal.textContent = elements.synthSpeed.value + 'x';
        
        const delayVal = localStorage.getItem('aether_stream_delay') || '5';
        elements.simulationSpeed.value = delayVal;
        
        const vals = ['Snail', 'Slow', 'Normal', 'Fast', 'Instant'];
        elements.simulationSpeedVal.textContent = vals[Math.min(4, Math.floor((delayVal - 1) / 2))];

        populateVoicesList();
        
        elements.settingsModal.classList.add('open');
    }

    function closeSettingsModal() {
        elements.settingsModal.classList.remove('open');
    }

    function saveSettings() {
        const key = elements.apiKey.value.trim();
        if (key) {
            localStorage.setItem('aether_api_key', key);
        } else {
            localStorage.removeItem('aether_api_key');
        }

        if (elements.llmBackendUrl) {
            const backend = elements.llmBackendUrl.value.trim().replace(/\/$/, '');
            if (backend) {
                localStorage.setItem('aether_llm_backend_url', backend);
            } else {
                localStorage.removeItem('aether_llm_backend_url');
            }
        }

        localStorage.setItem('aether_voice_speed', elements.synthSpeed.value);
        localStorage.setItem('aether_stream_delay', elements.simulationSpeed.value);

        if (elements.synthVoice.value) {
            localStorage.setItem('aether_voice_name', elements.synthVoice.value);
        }

        closeSettingsModal();
        
        speech.synth = window.speechSynthesis;
        speech.loadVoices();
        
        speech.speak("Parameters successfully updated.", state.activeModel);
        appendSystemConsoleLine("[SYSTEM] Settings updated.");
    }

    function populateVoicesList() {
        if (!elements.synthVoice) return;
        elements.synthVoice.innerHTML = '';
        
        const systemVoices = speech.voices;
        if (systemVoices.length === 0) {
            elements.synthVoice.innerHTML = '<option value="">No voices available</option>';
            return;
        }

        const savedVoiceName = localStorage.getItem('aether_voice_name');

        systemVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.textContent = `${v.name} (${v.lang})`;
            if (savedVoiceName && v.name === savedVoiceName) {
                opt.selected = true;
            }
            elements.synthVoice.appendChild(opt);
        });
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
