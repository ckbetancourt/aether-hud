/**
 * Aether AI Reasoning Engine
 * Handles HUD-side request shaping and Hermes bridge calls.
 */

class AIEngine {
    constructor() {
        this.personality = { ...AETHER_PERSONALITY };
    }

    setDisplayName(name) {
        const trimmed = String(name || '').trim();
        this.personality.displayName = trimmed || AETHER_PERSONALITY.displayName;
    }

    buildSystemInstruction() {
        return buildAetherTtsPrompt();
    }

    /**
     * Session history often includes the latest user turn before the model is called;
     * avoid sending that message twice to remote APIs.
     */
    historyWithoutPendingUserTurn(history, userMessage, maxMsgs, attachments = []) {
        let h = history.slice(-maxMsgs);
        const last = h[h.length - 1];
        if (
            last
            && last.role === 'user'
            && last.content === userMessage
            && !(attachments?.length || last.attachments?.length)
        ) {
            h = h.slice(0, -1);
        }
        return h;
    }

    static buildUserMessageContent(text, attachments = []) {
        const parts = [];
        const trimmed = String(text || '').trim();
        if (trimmed) {
            parts.push({ type: 'text', text: trimmed });
        }

        for (const att of attachments) {
            if (att?.kind === 'image' && att.dataUrl) {
                parts.push({
                    type: 'image_url',
                    image_url: { url: String(att.dataUrl) },
                });
            } else if (att?.kind === 'text' && att.text != null) {
                const body = String(att.text);
                const clipped = body.length > 24000 ? `${body.slice(0, 24000)}\n… [truncated]` : body;
                parts.push({
                    type: 'text',
                    text: `\n\n[Attached file: ${att.name}]\n\`\`\`\n${clipped}\n\`\`\``,
                });
            }
        }

        if (parts.length === 0) return '';
        if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
        return parts;
    }

    static sessionMessageToApiContent(msg) {
        if (!msg) return '';
        if (msg.attachments?.length) {
            return AIEngine.buildUserMessageContent(msg.content || '', msg.attachments);
        }
        return msg.content ?? '';
    }

    /**
     * Stored URL from Settings, or — when the HUD is opened over http(s) — this tab's origin
     * so `npm start` + http://localhost:8787 works with no extra configuration.
     */
    resolveLlmBackendBaseUrl() {
        const stored = AetherUserData.getItem('aether_llm_backend_url');
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
     * @param {string} _profileId Legacy profile argument, ignored because Hermes owns profiles.
     * @param {Array} history Conversation history
     * @param {Function} onTaskTrigger Callback to push dynamic checklist items to UI
     * @param {Function} onMemoryTrigger Callback to record memories in UI
     * @returns {Promise<string>} The streaming response content
     */
    async getResponse(userMessage, _profileId, history, onTaskTrigger, onMemoryTrigger, options = {}) {
        // Hermes bridge: explicit Settings URL, or same tab origin when using npm start.
        const llmBackend = this.resolveLlmBackendBaseUrl();
        if (llmBackend) {
            return await this.callLlmBackend(
                llmBackend,
                userMessage,
                history,
                onTaskTrigger,
                onMemoryTrigger,
                options
            );
        }

        throw new Error('Aether requires the local Hermes bridge server. Start it with npm start or npm run hermes:launch.');
    }

    /**
     * POST to a server that implements /api/chat (see server.js).
     */
    async callLlmBackend(baseUrl, userMessage, history, onTaskTrigger, onMemoryTrigger, options = {}) {
        this.parseTriggerHooks(userMessage.toLowerCase(), onTaskTrigger, onMemoryTrigger);

        const root = baseUrl.replace(/\/$/, '');
        const endpoint = `${root}/api/chat`;
        const onToolProgress = typeof options.onToolProgress === 'function' ? options.onToolProgress : null;
        const attachments = Array.isArray(options.attachments) ? options.attachments : [];

        const prior = this.historyWithoutPendingUserTurn(history, userMessage, 12, attachments);
        const messages = prior.map((msg) => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: AIEngine.sessionMessageToApiContent(msg),
        }));
        messages.push({
            role: 'user',
            content: AIEngine.buildUserMessageContent(userMessage, attachments),
        });

        const payload = {
            messages,
            sessionId: options.sessionId || null,
            hermesProfile: options.hermesProfile || null,
            voiceSystemPrompt: this.buildSystemInstruction(),
            personality: {
                id: this.personality.id,
                displayName: this.personality.displayName,
            },
        };

        if (onToolProgress) {
            payload.progressStream = true;
            return await this.consumeProgressChatStream(endpoint, payload, onToolProgress);
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        const replyText = data.reply;
        if (!replyText || typeof replyText !== 'string') {
            throw new Error('Empty reply from LLM backend');
        }
        return {
            text: replyText,
            backend: data.backend || 'openai',
            hermes: data.hermes || null,
        };
    }

    async consumeProgressChatStream(endpoint, payload, onToolProgress) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Progress stream unavailable from LLM backend');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = null;
        let streamError = null;

        const dispatchSseBlock = (block) => {
            const lines = block.split('\n');
            let eventName = 'message';
            let dataLine = '';
            for (const line of lines) {
                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    dataLine += line.slice(5).trim();
                }
            }
            if (!dataLine) return;

            let parsed;
            try {
                parsed = JSON.parse(dataLine);
            } catch {
                return;
            }

            if (eventName === 'tool' && parsed?.name) {
                onToolProgress(parsed);
            } else if (eventName === 'done') {
                finalResult = parsed;
            } else if (eventName === 'error') {
                streamError = new Error(parsed.error || 'Server error');
            }
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let splitAt;
            while ((splitAt = buffer.indexOf('\n\n')) !== -1) {
                const block = buffer.slice(0, splitAt);
                buffer = buffer.slice(splitAt + 2);
                if (block.trim()) dispatchSseBlock(block);
            }
        }

        if (buffer.trim()) dispatchSseBlock(buffer);

        if (streamError) throw streamError;
        if (!finalResult?.reply || typeof finalResult.reply !== 'string') {
            throw new Error('Empty reply from LLM backend');
        }

        return {
            text: finalResult.reply,
            backend: finalResult.backend || 'openai',
            hermes: finalResult.hermes || null,
        };
    }

    async getBackendStatus() {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) {
            return { enabled: false, connected: false, reason: 'No local backend URL configured.' };
        }

        const response = await fetch(`${baseUrl}/api/hermes/status`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok && !data.error) {
            data.error = `HTTP ${response.status}`;
        }
        return data;
    }

    async getHermesProfiles() {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) return { available: false, items: [] };
        const response = await fetch(`${baseUrl}/api/hermes/profiles`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async getHermesSessions() {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) return { available: false, items: [] };
        const response = await fetch(`${baseUrl}/api/hermes/sessions`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async getHermesSessionMessages(sessionId) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl || !sessionId) return { available: false, messages: [] };
        const encoded = encodeURIComponent(String(sessionId));
        const response = await fetch(`${baseUrl}/api/hermes/sessions/${encoded}/messages`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async getHermesDashboardStatus() {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) {
            return {
                ok: false,
                dashboardReachable: false,
                kanbanInitialized: false,
                error: 'No local backend URL configured.',
            };
        }
        const response = await fetch(`${baseUrl}/api/hermes/dashboard/status`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok && data.ok === undefined) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async startHermesDashboard() {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) throw new Error('No local backend URL configured.');
        const response = await fetch(`${baseUrl}/api/hermes/dashboard/start`, { method: 'POST' });
        return response.json().catch(() => ({}));
    }

    _kanbanQuery(board, extra = {}) {
        const params = new URLSearchParams();
        if (board) params.set('board', board);
        Object.entries(extra).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
        });
        const qs = params.toString();
        return qs ? `?${qs}` : '';
    }

    async fetchKanbanNative(path, { method = 'GET', board, body, query = {} } = {}) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) throw new Error('No local backend URL configured.');
        const url = `${baseUrl}${path}${this._kanbanQuery(board, query)}`;
        const init = { method, headers: {} };
        if (body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const response = await fetch(url, init);
        const data = await response.json().catch(() => ({}));
        if (!response.ok && data.ok !== true && !data.columns) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    getNativeKanbanBoard(board, query = {}) {
        return this.fetchKanbanNative('/api/hermes/kanban/board', { board, query });
    }

    getNativeKanbanBootstrap(board, query = {}) {
        return this.fetchKanbanNative('/api/hermes/kanban/bootstrap', { board, query });
    }

    getNativeKanbanTask(board, taskId) {
        return this.fetchKanbanNative(`/api/hermes/kanban/tasks/${encodeURIComponent(taskId)}`, { board });
    }

    createNativeKanbanTask(board, body) {
        return this.fetchKanbanNative('/api/hermes/kanban/tasks', { method: 'POST', board, body });
    }

    patchNativeKanbanTask(board, taskId, body) {
        return this.fetchKanbanNative(`/api/hermes/kanban/tasks/${encodeURIComponent(taskId)}`, {
            method: 'PATCH',
            board,
            body,
        });
    }

    bulkNativeKanbanTasks(board, body) {
        return this.fetchKanbanNative('/api/hermes/kanban/tasks/bulk', { method: 'POST', board, body });
    }

    addNativeKanbanComment(board, taskId, body) {
        return this.fetchKanbanNative(`/api/hermes/kanban/tasks/${encodeURIComponent(taskId)}/comments`, {
            method: 'POST',
            board,
            body,
        });
    }

    specifyNativeKanbanTask(board, taskId, body = {}) {
        return this.fetchKanbanNative(`/api/hermes/kanban/tasks/${encodeURIComponent(taskId)}/specify`, {
            method: 'POST',
            board,
            body,
        });
    }

    decomposeNativeKanbanTask(board, taskId, body = {}) {
        return this.fetchKanbanNative(`/api/hermes/kanban/tasks/${encodeURIComponent(taskId)}/decompose`, {
            method: 'POST',
            board,
            body,
        });
    }

    dispatchNativeKanban(board, query = {}) {
        return this.fetchKanbanNative('/api/hermes/kanban/dispatch', { method: 'POST', board, query });
    }

    getNativeKanbanConfig() {
        return this.fetchKanbanNative('/api/hermes/kanban/config');
    }

    getNativeKanbanOrchestration() {
        return this.fetchKanbanNative('/api/hermes/kanban/orchestration');
    }

    setNativeKanbanOrchestration(body) {
        return this.fetchKanbanNative('/api/hermes/kanban/orchestration', { method: 'PUT', body });
    }

    listNativeKanbanBoards(query = {}) {
        return this.fetchKanbanNative('/api/hermes/kanban/boards-list', { query });
    }

    createNativeKanbanBoard(body) {
        return this.fetchKanbanNative('/api/hermes/kanban/boards-create', { method: 'POST', body });
    }

    switchNativeKanbanBoard(slug) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) throw new Error('No local backend URL configured.');
        return fetch(`${baseUrl}/api/hermes/kanban/boards/${encodeURIComponent(slug)}/switch`, {
            method: 'POST',
        }).then((r) => r.json());
    }

    subscribeNativeKanbanEvents(board, since, onEvent, onError) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) return () => {};
        const params = new URLSearchParams();
        if (board) params.set('board', board);
        if (since) params.set('since', String(since));
        const es = new EventSource(`${baseUrl}/api/hermes/kanban/events/stream?${params}`);
        es.addEventListener('message', (ev) => {
            try {
                onEvent(JSON.parse(ev.data));
            } catch (e) {
                if (onError) onError(e);
            }
        });
        es.addEventListener('error', () => {
            if (onError) onError(new Error('Kanban event stream disconnected'));
        });
        return () => es.close();
    }

    async getKanbanBoards() {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) return { available: false, boards: [] };
        const response = await fetch(`${baseUrl}/api/hermes/kanban/boards`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok && !data.boards) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async switchKanbanBoard(slug) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) throw new Error('No local backend URL configured.');
        const encoded = encodeURIComponent(String(slug));
        const response = await fetch(`${baseUrl}/api/hermes/kanban/boards/${encoded}/switch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async getKanbanWorkspaces(board) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) return { available: false, items: [] };
        const params = board ? `?board=${encodeURIComponent(String(board))}` : '';
        const response = await fetch(`${baseUrl}/api/hermes/kanban/workspaces${params}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok && !data.items) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async browseKanbanPath(pathValue, board) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl || !pathValue) return { available: false, entries: [] };
        const params = new URLSearchParams({ path: String(pathValue) });
        if (board) params.set('board', String(board));
        const response = await fetch(`${baseUrl}/api/hermes/kanban/browse?${params}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async revealKanbanPath(pathValue, board) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl || !pathValue) throw new Error('Path is required.');
        const response = await fetch(`${baseUrl}/api/hermes/kanban/reveal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: pathValue, board: board || null }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async getAgentWorkspaces() {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) return { available: false, items: [] };
        const response = await fetch(`${baseUrl}/api/hermes/workspaces/agent`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async switchAgentWorkspace(pathValue) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl || !pathValue) throw new Error('Path is required.');
        const response = await fetch(`${baseUrl}/api/hermes/workspaces/agent/switch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: pathValue }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            const err = new Error(data.error || data.message || `HTTP ${response.status}`);
            if (data.hint) err.hint = data.hint;
            throw err;
        }
        return data;
    }

    async getHermesModelOptions() {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) {
            return { available: false, providers: [], reason: 'No local backend URL configured.' };
        }
        const response = await fetch(`${baseUrl}/api/hermes/model/options`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok && !data.providers) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    async switchHermesModel({ provider, model, sessionId = null, lastHermesSessionId = null, sessionIds = null }) {
        const baseUrl = this.resolveLlmBackendBaseUrl();
        if (!baseUrl) {
            throw new Error('No local backend URL configured.');
        }
        const response = await fetch(`${baseUrl}/api/hermes/model/switch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider,
                model,
                sessionId: sessionId || null,
                lastHermesSessionId: lastHermesSessionId || null,
                sessionIds: Array.isArray(sessionIds) ? sessionIds : null,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            const err = new Error(data.error || data.message || `HTTP ${response.status}`);
            if (data.hint) err.hint = data.hint;
            throw err;
        }
        return data;
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

}
