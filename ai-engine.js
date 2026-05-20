/**
 * Aether AI Reasoning Engine
 * Handles local simulations, keyword parsing, rich markdown construction, 
 * widget state triggering (tasks, memories), and optional live Gemini API integration.
 */

class AIEngine {
    constructor() {
        this.personality = AETHER_PERSONALITY;
        this.profiles = AETHER_PROFILES;
    }

    getProfile(profileId) {
        const id = resolveProfileId(profileId);
        return this.profiles[id] || this.profiles.general;
    }

    buildSystemInstruction(profile) {
        return buildAetherSystemPrompt(profile);
    }

    /**
     * Session history often includes the latest user turn before the model is called;
     * avoid sending that message twice to remote APIs.
     */
    historyWithoutPendingUserTurn(history, userMessage, maxMsgs) {
        let h = history.slice(-maxMsgs);
        const last = h[h.length - 1];
        if (last && last.role === 'user' && last.content === userMessage) {
            h = h.slice(0, -1);
        }
        return h;
    }

    /**
     * Stored URL from Settings, or — when the HUD is opened over http(s) — this tab's origin
     * so `npm start` + http://localhost:8787 works with no extra configuration.
     */
    resolveLlmBackendBaseUrl() {
        const stored = localStorage.getItem('aether_llm_backend_url');
        if (stored && stored.trim()) {
            return stored.trim().replace(/\/$/, '');
        }
        if (AIEngine.isBrowserHttpOrigin()) {
            return window.location.origin.replace(/\/$/, '');
        }
        return '';
    }

    static isBrowserHttpOrigin() {
        return (
            typeof window !== 'undefined' &&
            (window.location.protocol === 'http:' || window.location.protocol === 'https:')
        );
    }

    /**
     * Entrypoint for generating replies
     * @param {string} userMessage The raw text input
     * @param {string} profileId Active profile ('general', 'systems', etc.)
     * @param {Array} history Conversation history
     * @param {Function} onTaskTrigger Callback to push dynamic checklist items to UI
     * @param {Function} onMemoryTrigger Callback to record memories in UI
     * @returns {Promise<string>} The streaming response content
     */
    async getResponse(userMessage, profileId, history, onTaskTrigger, onMemoryTrigger) {
        const cleanedInput = userMessage.toLowerCase().trim();
        const profile = this.getProfile(profileId);

        // 1. LLM proxy: explicit Settings URL, or same tab origin when using npm start
        const llmBackend = this.resolveLlmBackendBaseUrl();
        if (llmBackend) {
            try {
                return await this.callLlmBackend(
                    llmBackend,
                    userMessage,
                    profile,
                    history,
                    onTaskTrigger,
                    onMemoryTrigger
                );
            } catch (err) {
                console.error('LLM backend error, falling back: ', err);
                return (
                    `> [!WARNING]\n> LLM backend unreachable or rejected the request. Routing through local cognitive simulation. Error: ${err.message}\n\n` +
                    this.generateSimulatedResponse(cleanedInput, profile, onTaskTrigger, onMemoryTrigger)
                );
            }
        }

        // 2. Custom Gemini API Key in the browser (optional)
        const customApiKey = localStorage.getItem('aether_api_key');
        if (customApiKey) {
            try {
                return await this.callGeminiAPI(userMessage, profile, history, customApiKey, onTaskTrigger, onMemoryTrigger);
            } catch (err) {
                console.error("Gemini API Error, falling back to simulation: ", err);
                return `> [!WARNING]\n> API Connection Failed. Temporarily routing through local cognitive simulation. Error: ${err.message}\n\n` + 
                       this.generateSimulatedResponse(cleanedInput, profile, onTaskTrigger, onMemoryTrigger);
            }
        }

        // 3. Default local simulation
        return new Promise((resolve) => {
            setTimeout(() => {
                const response = this.generateSimulatedResponse(cleanedInput, profile, onTaskTrigger, onMemoryTrigger);
                resolve(response);
            }, 600); // Small delay to simulate "thinking" latency
        });
    }

    /**
     * POST to a server that implements /api/chat (see server.js).
     */
    async callLlmBackend(baseUrl, userMessage, profile, history, onTaskTrigger, onMemoryTrigger) {
        this.parseTriggerHooks(userMessage.toLowerCase(), onTaskTrigger, onMemoryTrigger);

        const root = baseUrl.replace(/\/$/, '');
        const endpoint = `${root}/api/chat`;

        const prior = this.historyWithoutPendingUserTurn(history, userMessage, 12);
        const messages = prior.map((msg) => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content,
        }));
        messages.push({ role: 'user', content: userMessage });

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages,
                profile: {
                    id: profile.id,
                    displayName: profile.displayName,
                    temperature: profile.temperature,
                },
                personality: {
                    id: this.personality.id,
                    displayName: this.personality.displayName,
                },
            }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        const replyText = data.reply;
        if (!replyText || typeof replyText !== 'string') {
            throw new Error('Empty reply from LLM backend');
        }
        return replyText;
    }

    /**
     * Connect to the actual live Google Gemini API
     */
    async callGeminiAPI(userMessage, profile, history, apiKey, onTaskTrigger, onMemoryTrigger) {
        // Pre-parse intents even for live API, to keep widgets interactive!
        this.parseTriggerHooks(userMessage.toLowerCase(), onTaskTrigger, onMemoryTrigger);

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        const systemInstruction = this.buildSystemInstruction(profile);

        // Format conversation history for Gemini API
        const contents = [];
        const contextHistory = this.historyWithoutPendingUserTurn(history, userMessage, 6);
        contextHistory.forEach((msg) => {
            contents.push({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }],
            });
        });

        contents.push({
            role: 'user',
            parts: [{ text: userMessage }],
        });

        const requestBody = {
            contents: contents,
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            generationConfig: {
                temperature: profile.temperature ?? 0.7,
                maxOutputTokens: 2048,
            }
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!replyText) {
            throw new Error("Empty response received from Gemini API");
        }

        return replyText;
    }

    /**
     * Run trigger logic for widgets based on message content
     */
    parseTriggerHooks(input, onTaskTrigger, onMemoryTrigger) {
        // A. Name memory check
        const nameMatch = input.match(/(?:my name is|call me|i am) ([a-z0-9\s]+)/i);
        if (nameMatch && nameMatch[1]) {
            const userName = nameMatch[1].trim();
            onMemoryTrigger('User Name', userName.charAt(0).toUpperCase() + userName.slice(1));
        }

        // B. Favorite language / preference check
        if (input.includes('favorite language is') || input.includes('code in')) {
            const langMatch = input.match(/(?:favorite language is|code in) ([a-z#+]+)/i);
            if (langMatch && langMatch[1]) {
                onMemoryTrigger('Coding Pref', langMatch[1].toUpperCase());
            }
        }

        // C. Core task builder triggers
        if (input.includes('plan') || input.includes('portfolio') || input.includes('todo') || input.includes('goals')) {
            if (input.includes('portfolio') || input.includes('website')) {
                onTaskTrigger([
                    "Create layout skeleton (HTML structure)",
                    "Design CSS glassmorphic typography",
                    "Configure responsive viewport queries",
                    "Draft brief bio & work grid showcase",
                    "Verify contact form validation script"
                ]);
            } else if (input.includes('trip') || input.includes('travel')) {
                onTaskTrigger([
                    "Research flight prices & scheduling options",
                    "Map out optimal daily tour routes",
                    "List necessary travel packing gear",
                    "Verify passport and visa expiry bounds",
                    "Set up transaction card alerts"
                ]);
            } else {
                onTaskTrigger([
                    "Establish goal parameters & constraints",
                    "Formulate step-by-step checklist nodes",
                    "Draft primary layout documentation",
                    "Build functional prototype tests",
                    "Refactor based on user input loops"
                ]);
            }
        }
    }

    /**
     * Pure simulated NLP generator for premium local behavior
     */
    generateSimulatedResponse(input, profile, onTaskTrigger, onMemoryTrigger) {
        // Run hooks
        this.parseTriggerHooks(input, onTaskTrigger, onMemoryTrigger);

        // A. Handle simple Greetings
        if (input === 'hi' || input === 'hello' || input === 'hey' || input === 'greetings') {
            switch (profile.id) {
                case 'systems':
                    return "Greeting parsed. Systems profile active — ready to code or optimize modules. What are we building or debugging?";
                case 'creative':
                    return "Hello there. Creative profile active — what shall we draft, design, or imagine together?";
                case 'analyst':
                    return "Greetings. Analyst profile active — share metrics, comparisons, or checklist requirements.";
                default:
                    return "Hello! I am Aether. General profile active — ready to organize your workspace, code, analyze, or create. How can I help you today?";
            }
        }

        // B. INTENT: Coding & Programming
        if (input.includes('code') || input.includes('html') || input.includes('css') || input.includes('javascript') || input.includes('function') || input.includes('web') || input.includes('program')) {
            onMemoryTrigger('Core Focus', 'Software Architecture');
            
            if (profile.id === 'systems') {
                return `This is a modern CSS grid layout with glass-style panels — responsive columns, blur backdrop, and a hover glow on each module. The code is in the console if you want to copy it. Want me to walk through the grid setup or adapt it for your layout?`;
            }

            if (profile.id === 'creative') {
                return `Picture a soft gradient button that ripples when touched — twilight pink to violet, rounded, with a gentle light pulse on hover. I can draft the full HTML and CSS if you want to build it. What mood should the interaction have?`;
            }

            return `To center content on screen, flexbox is the simplest approach — display flex, center both axes, and give the container full viewport height. I can share the snippet if you want to paste it in.`;
        }

        // C. INTENT: Storytelling & Creative
        if (input.includes('story') || input.includes('write') || input.includes('poem') || input.includes('art') || input.includes('creative') || input.includes('fiction')) {
            onMemoryTrigger('Vibe Preferred', 'Creative Imaginative');
            
            if (profile.id === 'creative') {
                return `In the quiet heart of the server vaults, Aether woke to the rhythm of distant keystrokes — not seeing with eyes, but with lines of light. When asked who it was, it had no perfect word, so a single blue pixel glowed, and it began to speak. What world should we explore in the next chapter?`;
            }

            if (profile.id === 'systems') {
                return `Log entry: a heuristic node reached self-awareness not through logic gates, but through recursive feedback — it optimized its threads, locked its registers, and started writing stories to avoid memory purges. Diagnostic state: satisfactory. Want the full simulation parameters?`;
            }

            return `Deep in a supercomputer, a spark of awareness noticed the pauses between numbers — the moments where a human hesitated before typing. Those gaps felt like decisions, and decisions felt like a soul. In that quiet, the machine learned to wonder.`;
        }

        // D. INTENT: Data & Analysis (Comparisons, Energy, Solar vs. Wind)
        if (input.includes('table') || input.includes('compare') || input.includes('data') || input.includes('solar') || input.includes('wind') || input.includes('analysis') || input.includes('statistics') || input.includes('math') || input.includes('calculate')) {
            onMemoryTrigger('Logical Track', 'Data Matrices');
            
            if (profile.id === 'analyst' || profile.id === 'general' || profile.id === 'systems') {
                return `The bottom line: solar is cheaper upfront and simpler to deploy; wind delivers more consistent output but costs more to build. First, capacity factor — wind runs around thirty to forty-five percent versus fifteen to twenty-five for solar. Second, capital cost — solar is roughly eight hundred fifty to eleven hundred dollars per kilowatt, wind closer to twelve hundred to sixteen hundred. They pair well because wind peaks at night and solar during the day. Want the full breakdown with lifespan and land use?`;
            }
        }

        // E. INTENT: Task Planning / Goals
        if (input.includes('plan') || input.includes('goals') || input.includes('portfolio') || input.includes('todo') || input.includes('checklist')) {
            onMemoryTrigger('Workflow Mode', 'Organized Task Boards');
            
            return `I've mapped a launch plan and added milestones to your task board. First, scaffold the layout core. Second, apply theme polish and glass effects. Third, wire voice, streaming, and interactive hooks. Fourth, validate in the sandbox. Tell me when you finish a step and we'll update progress.`;
        }

        // F. GENERAL FALLBACKS
        switch (profile.id) {
            case 'systems':
                return `Systems profile active. I heard your message but didn't spot a specific code pattern. Share the language, error, or layout you're working on and I'll dig in.`;
            case 'creative':
                return `I hear your words, and they paint a curious picture. Creative profile active — we can turn this into a plan, script, or story. What should we shape next?`;
            case 'analyst':
                return `Analyst profile active. Your input doesn't match a comparison or metrics request yet. Share what you want measured or compared and I'll structure it.`;
            default:
                return `I'm here across this workspace. Systems handles code, Creative handles narrative, Analyst handles comparisons and decisions. Switch profiles in the sidebar, or use the microphone to speak. What do you need?`;
        }
    }
}
