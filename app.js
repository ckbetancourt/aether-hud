/**
 * Aether HUD Main Application Orchestrator
 * Coordinates interactive HUD states, Speech Engines, canvas parallax, and local archives.
 */

document.addEventListener('DOMContentLoaded', async () => {
    await window.AetherUserData.init();

    let resizeLoopInterval = null;
    let persistSessionsTimer = null;
    let historyRenderScheduled = false;

    const MAX_SESSIONS = 25;
    const SESSIONS_PAGE_SIZE = 25;
    const MAX_MESSAGES_PER_SESSION = 100;
    const MAX_MESSAGE_CHARS = 32000;
    const MAX_CHAT_ATTACHMENTS = 6;
    const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
    const MAX_ATTACHMENT_DATA_URL_CHARS = 7 * 1024 * 1024;
    const TEXT_ATTACHMENT_EXTENSIONS = new Set([
        '.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx', '.css',
        '.html', '.htm', '.xml', '.yaml', '.yml', '.csv', '.log', '.py', '.sh', '.rb',
        '.go', '.rs', '.sql', '.toml', '.env', '.ini', '.cfg', '.conf', '.vue', '.svelte',
    ]);
    const DEFAULT_DISPLAY_NAME = AETHER_PERSONALITY.displayName;
    const DEFAULT_CHAT_COLUMN_WIDTH_PX = 825;
    const CHAT_COLUMN_WIDTH_MIN = 400;
    const CHAT_COLUMN_WIDTH_MAX = 1200;
    const HUD_MAIN_MIN_WIDTH_PX = 400;
    const HUD_SHELL_CHAT_INSET_PX = 24;
    const CHAT_MAX_FRACTION = 0.5;

    let pendingAttachments = [];
    let chatDropDepth = 0;
    let attachmentUiVerified = false;
    let ephemeralSession = null;
    let aetherSessionsMigrationNeeded = false;

    function normalizeChatHistoryTab(tabId) {
        if (tabId === 'core') return 'aether';
        if (tabId === 'hermes') return 'all';
        if (tabId === 'all') return 'all';
        return 'aether';
    }

    function normalizeAetherSession(session) {
        const savedHermesProfile = AetherUserData.getItem('aether_hermes_profile') || null;
        const id = session.id || `sess_${Date.now()}`;
        const isSess = String(id).startsWith('sess_');
        let hermesSessionId = session.hermesSessionId || null;
        if (!hermesSessionId && !isSess) {
            hermesSessionId = id;
        }

        return {
            id,
            title: session.title || 'Untitled session',
            profile: session.profile || session.model || '',
            source: session.source || (isSess ? 'local' : 'hermes'),
            hermesProfile: session.hermesProfile || savedHermesProfile,
            hermesSessionId,
            hermesUpdatedAt: session.hermesUpdatedAt || null,
            startedAt: session.startedAt || session.hermesUpdatedAt || null,
            messages: Array.isArray(session.messages) ? session.messages : [],
        };
    }

    function isAetherHudSession(session) {
        return String(session?.id || '').startsWith('sess_');
    }

    function shouldKeepInAetherArchive(raw) {
        return String(raw.id || '').startsWith('sess_');
    }

    function migrateAetherSessions(rawSessions) {
        if (!Array.isArray(rawSessions)) return [];
        return rawSessions.filter(shouldKeepInAetherArchive);
    }

    function loadSavedSessions() {
        try {
            const raw = JSON.parse(AetherUserData.getItem('aether_sessions') || '[]');
            const migrated = migrateAetherSessions(raw);
            if (migrated.length !== raw.length) {
                aetherSessionsMigrationNeeded = true;
            }
            return migrated.map(normalizeAetherSession);
        } catch {
            return [];
        }
    }

    function loadProfileAccents() {
        try {
            return JSON.parse(AetherUserData.getItem('aether_profile_accents') || '{}');
        } catch {
            return {};
        }
    }

    function loadGlobalAccentTheme() {
        const stored = AetherUserData.getItem('aether_accent_theme');
        if (stored && AETHER_ACCENT_THEMES[stored]) return stored;
        const fallback = 'jarvis-red';
        AetherUserData.setItem('aether_accent_theme', fallback);
        return fallback;
    }

    function loadColorMode() {
        const stored = AetherUserData.getItem('aether_color_mode');
        if (stored && AETHER_COLOR_MODES[stored]) return stored;
        const fallback = 'dark';
        AetherUserData.setItem('aether_color_mode', fallback);
        return fallback;
    }

    function loadAvatarForm() {
        const stored = AetherUserData.getItem('aether_avatar_form');
        return ['classic-blob', 'nova', 'wisp', 'eve'].includes(stored) ? stored : 'classic-blob';
    }

    function getColorMode(modeId) {
        return AETHER_COLOR_MODES[modeId] || AETHER_COLOR_MODES.dark;
    }

    function applyColorMode(modeId) {
        const mode = getColorMode(modeId);
        document.documentElement.dataset.colorMode = mode.id;
        document.documentElement.style.colorScheme = mode.colorScheme;
    }

    function applyAccentCssVars(theme) {
        const root = document.documentElement;
        root.style.setProperty('--accent-primary', theme.primary);
        root.style.setProperty('--accent-secondary', theme.secondary);
        root.style.setProperty('--accent-glow', theme.accentGlow);
        root.style.setProperty('--accent-glow-subtle', theme.accentGlowSubtle);
        root.style.setProperty('--border-glow', theme.borderGlow);
    }

    function updateColorModePickerUi(modeId) {
        document.querySelectorAll('.color-mode-btn').forEach((btn) => {
            const active = btn.getAttribute('data-color-mode') === modeId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function updateAvatarFormUi(formId) {
        document.querySelectorAll('.avatar-form-btn').forEach((btn) => {
            const active = btn.getAttribute('data-avatar-form') === formId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function buildColorModePicker() {
        const row = document.getElementById('colorModeRow');
        if (!row) return;

        row.innerHTML = '';
        for (const mode of Object.values(AETHER_COLOR_MODES)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'color-mode-btn';
            btn.dataset.colorMode = mode.id;
            btn.title = mode.label;
            btn.setAttribute('aria-label', mode.label);
            btn.setAttribute('aria-pressed', 'false');
            btn.innerHTML = `
                <span class="color-mode-preview" style="--mode-bg: ${mode.previewBg};"></span>
                <span class="color-mode-label">${mode.label}</span>
            `;
            btn.addEventListener('click', () => selectColorMode(mode.id));
            row.appendChild(btn);
        }
    }

    function selectColorMode(modeId) {
        if (!AETHER_COLOR_MODES[modeId]) return;

        state.globalColorMode = modeId;
        AetherUserData.setItem('aether_color_mode', modeId);
        applyColorMode(modeId);
        updateColorModePickerUi(modeId);
        visualizer.setColorMode(modeId);
    }

    // 1. Core State Definition
    const state = {
        aetherSessions: loadSavedSessions(),
        hermesSessions: [],
        activeSessionId: AetherUserData.getItem('aether_active_session_id') || null,
        lastHermesSessionId: AetherUserData.getItem('aether_last_hermes_session_id') || null,
        activeHermesProfile: AetherUserData.getItem('aether_hermes_profile') || '',
        activeKanbanBoard: AetherUserData.getItem('aether_kanban_board') || '',
        activeWorkspacePath: AetherUserData.getItem('aether_active_workspace_path') || '',
        selectedWorkspacePath: '',
        selectedWorkspaceTitle: '',
        kanbanBoards: [],
        kanbanWorkspaces: [],
        kanbanMode: false,
        kanbanBoardInstance: null,
        kanbanDashboardStatus: null,
        dashboardBootstrapTimer: null,
        settingsMode: false,
        settingsSection: 'appearance',
        chatCollapsedBeforeSettings: null,
        vaultMode: false,
        vaultSearchQuery: AetherUserData.getItem('aether_vault_search') || '',
        vaultFilter: 'all',
        vaultViewMode: AetherUserData.getItem('aether_vault_view_mode') || 'recent',
        vaultCurrentSessionOnly: JSON.parse(AetherUserData.getItem('aether_vault_session_only') ?? 'false'),
        vaultSortBy: AetherUserData.getItem('aether_vault_sort') || 'date',
        vaultExpandedFolders: new Set(JSON.parse(AetherUserData.getItem('aether_vault_expanded_folders') || '[]')),
        vaultExpandedSessions: new Set(JSON.parse(AetherUserData.getItem('aether_vault_expanded_sessions') || '[]')),
        vaultFolderPath: '',
        vaultSessionsMeta: [],
        chatCollapsedBeforeVault: null,
        chatCollapsedBeforeKanban: null,
        workspaceFiles: [],
        workspaceViewerPath: '',
        vaultFiles: [],
        vaultPreviewId: '',
        vaultPreviewDirty: false,
        vaultPreviewEditable: false,
        vaultPreviewSavedContent: '',
        vaultPreviewSaving: false,
        skillsItems: [],
        skillsSelectedName: '',
        skillsEditorBaseline: '',
        skillsDir: '',
        skillsFilter: 'all',
        skillsCounts: null,
        hermesStatus: null,
        isVoiceActive: false,
        isVoiceConnecting: false,
        voiceSessionId: 0,
        voiceListenSession: null,
        voiceTranscriptParts: [],
        voiceInterimTranscript: '',
        isVoiceOutputSpeaking: false,
        speechEnabled: JSON.parse(AetherUserData.getItem('aether_speech_enabled') ?? 'true'),
        memory: JSON.parse(AetherUserData.getItem('aether_memory') || '{}'),
        globalAccentTheme: null,
        activeAccentTheme: null,
        globalColorMode: null,
        avatarForm: null,
        chatHistoryTab: normalizeChatHistoryTab(AetherUserData.getItem('aether_chat_history_tab')),
        archivesSearchQuery: '',
        contextSelectedFileId: null,
        chatInFlight: false,
        chatInterruptedByBackground: false,
        chatStopRequested: false,
        _displayedSessionCount: SESSIONS_PAGE_SIZE,
    };
    let pageHiddenAt = 0;
    let pageReturnRefreshPromise = null;
    state.globalAccentTheme = loadGlobalAccentTheme();
    state.globalColorMode = loadColorMode();
    state.avatarForm = loadAvatarForm();
    AetherUserData.removeItem('aether_session_model_prefs');

    const SETTINGS_SECTIONS = new Set([
        'appearance',
        'response',
        'speech',
        'microphone',
        'agent',
        'context',
        'skills',
        'jobs',
        'config',
        'vault',
    ]);

    const modelPickerState = {
        providers: [],
        currentModel: '',
        currentProvider: '',
        selectedSlug: '',
        selectedModel: '',
        query: '',
        loading: false,
        applying: false,
        source: '',
    };

    // 2. Instantiate Systems
    const ai = new AIEngine();
    const speech = new SpeechEngine();
    const visualizer = new JarvisHUD('jarvisCanvas');
    visualizer.setSpeechEngine(speech);

    // Start Orb Rendering immediately
    visualizer.start();
    visualizer.setColorMode(state.globalColorMode);
    visualizer.setAvatarForm(state.avatarForm);

    // 3. Select HUD DOM Elements
    const elements = {
        // Badges
        activeProfileBadge: document.getElementById('activeProfileBadge'),
        activeStatusBadge: document.getElementById('activeStatusBadge'),
        hudOrbLabel: document.getElementById('hudOrbLabel'),
        brandName: document.getElementById('brandName'),
        consoleText: document.getElementById('consoleText'),
        
        // Buttons
        settingsBtn: document.getElementById('settingsBtn'),
        settingsPillBtn: document.getElementById('settingsPillBtn'),
        homeBtn: document.getElementById('homeBtn'),
        closeSettingsBtn: document.getElementById('closeSettingsBtn'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),
        settingsPage: document.getElementById('settingsPage'),
        settingsAgentModelDisplay: document.getElementById('settingsAgentModelDisplay'),
        settingsChangeModelBtn: document.getElementById('settingsChangeModelBtn'),
        settingsHermesBadge: document.getElementById('settingsHermesBadge'),
        
        voiceRecognitionBtn: document.getElementById('voiceRecognitionBtn'),
        modelBtn: document.getElementById('modelBtn'),
        modelBtnLabel: document.getElementById('modelBtnLabel'),
        modelPickerModal: document.getElementById('modelPickerModal'),
        closeModelPickerBtn: document.getElementById('closeModelPickerBtn'),
        cancelModelPickerBtn: document.getElementById('cancelModelPickerBtn'),
        confirmModelPickerBtn: document.getElementById('confirmModelPickerBtn'),
        modelPickerSearch: document.getElementById('modelPickerSearch'),
        modelPickerCurrent: document.getElementById('modelPickerCurrent'),
        modelPickerHint: document.getElementById('modelPickerHint'),
        modelPickerError: document.getElementById('modelPickerError'),
        modelPickerProviders: document.getElementById('modelPickerProviders'),
        modelPickerModels: document.getElementById('modelPickerModels'),
        mediaLightbox: document.getElementById('mediaLightbox'),
        mediaLightboxImage: document.getElementById('mediaLightboxImage'),
        mediaLightboxCaption: document.getElementById('mediaLightboxCaption'),
        closeMediaLightboxBtn: document.getElementById('closeMediaLightboxBtn'),
        speechSynthesisToggle: document.getElementById('speechSynthesisToggle'),
        voiceRepliesToggle: document.getElementById('voiceRepliesToggle'),
        voiceRepliesHint: document.getElementById('voiceRepliesHint'),
        historyDrawerToggle: document.getElementById('historyDrawerToggle'),
        historyDrawerCloseBtn: document.getElementById('historyDrawerCloseBtn'),
        sidebarDrawer: document.getElementById('sidebarDrawer'),
        workspaceFilesBtn: document.getElementById('workspaceFilesBtn'),
        workspacesDrawerToggle: document.getElementById('workspacesDrawerToggle'),
        vaultPage: document.getElementById('vaultPage'),
        closeVaultBtn: document.getElementById('closeVaultBtn'),
        vaultScanBtn: document.getElementById('vaultScanBtn'),
        vaultCountBadge: document.getElementById('vaultCountBadge'),
        vaultSearchInput: document.getElementById('vaultSearchInput'),
        vaultViewMode: document.getElementById('vaultViewMode'),
        vaultCurrentSessionOnly: document.getElementById('vaultCurrentSessionOnly'),
        vaultSortSelect: document.getElementById('vaultSortSelect'),
        vaultBreadcrumbs: document.getElementById('vaultBreadcrumbs'),
        vaultFilesStatus: document.getElementById('vaultFilesStatus'),
        vaultFileList: document.getElementById('vaultFileList'),
        vaultPageBody: document.getElementById('vaultPageBody'),
        vaultPreviewPanel: document.getElementById('vaultPreviewPanel'),
        vaultPreviewEmpty: document.getElementById('vaultPreviewEmpty'),
        vaultPreviewContent: document.getElementById('vaultPreviewContent'),
        vaultPreviewBackBtn: document.getElementById('vaultPreviewBackBtn'),
        vaultPreviewTitle: document.getElementById('vaultPreviewTitle'),
        vaultPreviewPath: document.getElementById('vaultPreviewPath'),
        vaultPreviewBody: document.getElementById('vaultPreviewBody'),
        vaultPreviewSaveBtn: document.getElementById('vaultPreviewSaveBtn'),
        vaultPreviewFinderBtn: document.getElementById('vaultPreviewFinderBtn'),
        vaultPreviewPinBtn: document.getElementById('vaultPreviewPinBtn'),
        vaultPreviewCopyPathBtn: document.getElementById('vaultPreviewCopyPathBtn'),
        workspacePinBadge: document.getElementById('workspacePinBadge'),
        kanbanStage: document.getElementById('kanbanStage'),
        kanbanStageStatus: document.getElementById('kanbanStageStatus'),
        kanbanStageLoading: document.getElementById('kanbanStageLoading'),
        kanbanSplashSub: document.getElementById('kanbanSplashSub'),
        kanbanBoardRoot: document.getElementById('kanbanBoardRoot'),
        kanbanDrawerRoot: document.getElementById('kanbanDrawerRoot'),
        dashboardSplash: document.getElementById('dashboardSplash'),
        dashboardSplashText: document.getElementById('dashboardSplashText'),
        settingsWorkspacesBtn: document.getElementById('settingsWorkspacesBtn'),
        hudCoreVisualizer: document.querySelector('.hud-core-visualizer'),
        avatarPokeTarget: document.getElementById('avatarPokeTarget'),
        skillsBtn: document.getElementById('skillsBtn'),
        saveSkillsBtn: document.getElementById('saveSkillsBtn'),
        refreshSkillsBtn: document.getElementById('refreshSkillsBtn'),
        skillsSearch: document.getElementById('skillsSearch'),
        skillsList: document.getElementById('skillsList'),
        skillsEditor: document.getElementById('skillsEditor'),
        skillsEditorEmpty: document.getElementById('skillsEditorEmpty'),
        skillsModalPath: document.getElementById('skillsModalPath'),
        skillsStatus: document.getElementById('skillsStatus'),
        reloadSkillsBtn: document.getElementById('reloadSkillsBtn'),
        newChatBtn: document.getElementById('newChatBtn'),
        archivesSearchInput: document.getElementById('archivesSearchInput'),
        chatStopBtn: document.getElementById('chatStopBtn'),
        contextFileList: document.getElementById('contextFileList'),
        contextEditorGroup: document.getElementById('contextEditorGroup'),
        contextFileEditor: document.getElementById('contextFileEditor'),
        contextEditorLabel: document.getElementById('contextEditorLabel'),
        contextEditorHint: document.getElementById('contextEditorHint'),
        saveContextFileBtn: document.getElementById('saveContextFileBtn'),
        configSummaryPanel: document.getElementById('configSummaryPanel'),
        jobsListPanel: document.getElementById('jobsListPanel'),
        refreshJobsBtn: document.getElementById('refreshJobsBtn'),
        newJobBtn: document.getElementById('newJobBtn'),

        hudShell: document.getElementById('hudShell'),
        hudBootSplash: document.getElementById('hudBootSplash'),
        bootSplashTitle: document.getElementById('bootSplashTitle'),
        bootSplashSub: document.getElementById('bootSplashSub'),

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
        composerAttachBtn: document.getElementById('composerAttachBtn'),
        composerFileInput: document.getElementById('composerFileInput'),
        composerAttachmentDock: document.getElementById('composerAttachmentDock'),
        composerAttachments: document.getElementById('composerAttachments'),
        composerAttachmentCount: document.getElementById('composerAttachmentCount'),
        chatComposerBox: document.getElementById('chatComposerBox'),

        // Settings inputs
        ttsProvider: document.getElementById('ttsProvider'),
        ttsProviderHint: document.getElementById('ttsProviderHint'),
        omnivoiceInstructGroup: document.getElementById('omnivoiceInstructGroup'),
        omnivoiceInstruct: document.getElementById('omnivoiceInstruct'),
        synthVoice: document.getElementById('synthVoice'),
        voicePreviewBtn: document.getElementById('voicePreviewBtn'),
        voiceInputBehavior: document.getElementById('voiceInputBehavior'),
        synthSpeed: document.getElementById('synthSpeed'),
        synthSpeedVal: document.getElementById('synthSpeedVal'),
        simulationSpeed: document.getElementById('simulationSpeed'),
        simulationSpeedVal: document.getElementById('simulationSpeedVal'),
        ttsReplayCacheSize: document.getElementById('ttsReplayCacheSize'),
        ttsReplayCacheSizeVal: document.getElementById('ttsReplayCacheSizeVal'),
        hermesProfileSelect: document.getElementById('hermesProfileSelect'),
        hermesStatusText: document.getElementById('hermesStatusText'),
        refreshChatsBtn: document.getElementById('refreshChatsBtn'),
        composerRefreshBtn: document.getElementById('composerRefreshBtn'),
        avatarFormRow: document.getElementById('avatarFormRow'),
        displayNameInput: document.getElementById('displayNameInput'),
        chatColumnWidth: document.getElementById('chatColumnWidth'),
        chatColumnWidthVal: document.getElementById('chatColumnWidthVal'),
        toastStack: document.getElementById('toastStack'),
        drawerScrim: document.getElementById('drawerScrim'),
        chatScrim: document.getElementById('chatScrim'),
    };

    const COMPACT_MEDIA = window.matchMedia('(max-width: 900px)');

    function isCompactViewport() {
        return COMPACT_MEDIA.matches;
    }

    function getChatColumnWidthPx() {
        const stored = parseInt(AetherUserData.getItem('aether_chat_column_width') || '', 10);
        if (Number.isFinite(stored)) {
            return Math.min(CHAT_COLUMN_WIDTH_MAX, Math.max(CHAT_COLUMN_WIDTH_MIN, stored));
        }
        return DEFAULT_CHAT_COLUMN_WIDTH_PX;
    }

    function getMaxChatColumnWidthForViewport() {
        if (isCompactViewport()) {
            return CHAT_COLUMN_WIDTH_MAX;
        }
        const vw = window.innerWidth;
        const cap = Math.min(
            vw - HUD_MAIN_MIN_WIDTH_PX - HUD_SHELL_CHAT_INSET_PX,
            vw * CHAT_MAX_FRACTION
        );
        return Math.max(CHAT_COLUMN_WIDTH_MIN, cap);
    }

    function applyChatColumnWidth(px) {
        if (isCompactViewport()) return;
        const viewportCap = getMaxChatColumnWidthForViewport();
        const clamped = Math.min(
            CHAT_COLUMN_WIDTH_MAX,
            viewportCap,
            Math.max(CHAT_COLUMN_WIDTH_MIN, px)
        );
        document.documentElement.style.setProperty('--chat-column-width-px', String(clamped));
    }

    function updateOverlayScrims() {
        const compact = isCompactViewport();
        const drawerOpen = !!elements.sidebarDrawer?.classList.contains('open');
        if (elements.drawerScrim) {
            const showDrawer = compact && drawerOpen;
            elements.drawerScrim.hidden = !showDrawer;
            elements.drawerScrim.classList.toggle('is-visible', showDrawer);
        }
        if (elements.chatScrim) {
            // Compact uses split creature + chat layout; no fullscreen scrim.
            elements.chatScrim.hidden = true;
            elements.chatScrim.classList.remove('is-visible');
        }
    }

    function syncViewportMode() {
        document.documentElement.dataset.viewport = isCompactViewport() ? 'compact' : 'wide';
        updateOverlayScrims();
        applyChatColumnWidth(getChatColumnWidthPx());
        resizeChatComposerInput();
        if (typeof visualizer !== 'undefined' && visualizer && typeof visualizer.resize === 'function') {
            visualizer.resize();
        }
    }

    syncViewportMode();

    speech.speechEnabled = state.speechEnabled;
    syncSpeechToggleUi();
    syncMicButtonUi();

    function getDisplayName() {
        const stored = AetherUserData.getItem('aether_display_name');
        const trimmed = String(stored ?? DEFAULT_DISPLAY_NAME).trim();
        return trimmed || DEFAULT_DISPLAY_NAME;
    }

    function getWelcomeConsoleMessage() {
        return `Welcome. I am ${getDisplayName()}. Press Space to open chat or use the mic to coordinate telemetries.`;
    }

    function setBootStatus(subtitle, title = 'Starting Aether') {
        if (elements.bootSplashSub && subtitle) {
            elements.bootSplashSub.textContent = subtitle;
        }
        if (elements.bootSplashTitle && title) {
            elements.bootSplashTitle.textContent = title;
        }
        if (elements.activeStatusBadge) {
            elements.activeStatusBadge.classList.add('is-booting');
            elements.activeStatusBadge.innerHTML = '<span class="pulse-dot pulse-dot-boot"></span> INITIALIZING';
        }
        if (elements.hudOrbLabel) {
            elements.hudOrbLabel.textContent = 'STARTING UP';
            elements.hudOrbLabel.style.color = 'var(--text-muted)';
        }
    }

    setBootStatus('Loading your preferences…');

    function applyDisplayName() {
        const name = getDisplayName();
        if (elements.brandName) {
            elements.brandName.textContent = name.toUpperCase();
        }
        if (elements.deckChatInputField) {
            elements.deckChatInputField.placeholder = `Message ${name}…`;
        }
        if (elements.consoleText) {
            elements.consoleText.textContent = getWelcomeConsoleMessage();
        }
        visualizer.setDisplayName(name);
        ai.setDisplayName(name);
        updateMicButtonTitle();
    }

    // 4. UI Setup and Event Wiring
    buildColorModePicker();
    applyColorMode(state.globalColorMode);
    updateColorModePickerUi(state.globalColorMode);
    applyChatColumnWidth(getChatColumnWidthPx());
    setupEventListeners();
    applyAccentTheme(state.globalAccentTheme);
    applyDisplayName();
    updateHermesProfileBadge();
    updateWorkspacePinBadge();
    activateChatHistoryTab(state.chatHistoryTab);
    startLatencyTelemetryMock();
    setBootStatus('Connecting to Hermes…');
    await refreshHermesIntegration();
    setBootStatus('Loading session archive…');

    // Fresh session on every load/reload; saved history stays in the sidebar.
    startNewSession({ ephemeral: true, silent: true });
    if (aetherSessionsMigrationNeeded) {
        schedulePersistSessions();
    }
    
    // Process icons
    lucide.createIcons();

    const collapsedPref = AetherUserData.getItem('aether_chat_column_collapsed');
    const openPref = AetherUserData.getItem('aether_chat_column_open');
    let chatCollapsed;
    if (collapsedPref === 'true') {
        chatCollapsed = true;
    } else if (collapsedPref === 'false') {
        chatCollapsed = false;
    } else if (openPref === 'false') {
        chatCollapsed = true;
    } else if (openPref === 'true') {
        chatCollapsed = false;
    } else {
        chatCollapsed = isCompactViewport();
    }
    if (chatCollapsed) {
        collapseChatColumn();
    } else {
        expandChatColumn(false);
    }

    elements.hudBootSplash?.setAttribute('aria-busy', 'false');
    elements.hudShell?.classList.remove('boot-loading');
    elements.activeStatusBadge?.classList.remove('is-booting');
    updateHermesStatusUi(state.hermesStatus);
    visualizer.setState('idle');

    scheduleDeferredDashboardBootstrap();

    const initialSettingsRoute = parseSettingsRoute();
    if (initialSettingsRoute) {
        enterSettingsMode(initialSettingsRoute, { fromHash: true });
    } else {
        const initialVaultRoute = parseVaultRoute();
        if (initialVaultRoute) {
            enterVaultMode(initialVaultRoute, { fromHash: true });
        }
    }

    async function waitForPageReturnRefresh() {
        if (pageReturnRefreshPromise) {
            await pageReturnRefreshPromise;
        }
    }

    async function handlePageReturn() {
        pageHiddenAt = 0;

        // Drop stale client-side transport from a backgrounded SSE/fetch.
        ai.activeAbortController = null;
        ai.activeRunId = null;
        state.chatInterruptedByBackground = false;
        if (state.chatInFlight) {
            setChatInFlight(false);
            visualizer.setState('idle');
            visualizer.clearThinkingCaption();
        }

        pageReturnRefreshPromise = (async () => {
            await refreshHermesIntegration({ silent: true });
            if (state.activeSessionId) {
                await loadSession(state.activeSessionId, { silent: true });
            }
        })();
        try {
            await pageReturnRefreshPromise;
        } finally {
            pageReturnRefreshPromise = null;
        }
    }

    // Re-probe Hermes when returning to the tab (backgrounding kills in-flight SSE).
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            pageHiddenAt = Date.now();
            if (state.chatInFlight) {
                state.chatInterruptedByBackground = true;
            }
            return;
        }
        handlePageReturn();
    });

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            if (!pageHiddenAt) pageHiddenAt = Date.now();
            handlePageReturn();
        }
    });

    /* ==========================================================================
       A. HUD Control Event Listeners
       ========================================================================== */
    function setupEventListeners() {
        COMPACT_MEDIA.addEventListener('change', syncViewportMode);
        let chatWidthResizeTimer = null;
        window.addEventListener('resize', () => {
            if (chatWidthResizeTimer) clearTimeout(chatWidthResizeTimer);
            chatWidthResizeTimer = setTimeout(() => {
                chatWidthResizeTimer = null;
                if (!isCompactViewport()) {
                    applyChatColumnWidth(getChatColumnWidthPx());
                }
            }, 100);
        });
        if (elements.drawerScrim) {
            elements.drawerScrim.addEventListener('click', closeAllDrawers);
        }
        if (elements.chatScrim) {
            elements.chatScrim.addEventListener('click', () => collapseChatColumn());
        }

        if (elements.homeBtn) {
            elements.homeBtn.addEventListener('click', () => goHome());
        }

        // Toggle slide-in Sidebar Drawer
        elements.historyDrawerToggle.addEventListener('click', () => toggleSidebarDrawer());
        elements.historyDrawerCloseBtn.addEventListener('click', () => toggleSidebarDrawer(false));

        if (elements.workspacesDrawerToggle) {
            elements.workspacesDrawerToggle.addEventListener('click', () => toggleKanbanMode());
        }
        if (elements.settingsWorkspacesBtn) {
            elements.settingsWorkspacesBtn.addEventListener('click', () => {
                exitSettingsMode();
                enterVaultMode();
            });
        }
        if (elements.workspaceFilesBtn) {
            elements.workspaceFilesBtn.addEventListener('click', () => enterVaultMode());
        }
        if (elements.closeVaultBtn) {
            elements.closeVaultBtn.addEventListener('click', () => exitVaultMode());
        }
        if (elements.vaultScanBtn) {
            elements.vaultScanBtn.addEventListener('click', () => refreshVault({ ingest: true }));
        }
        if (elements.vaultSearchInput) {
            elements.vaultSearchInput.value = state.vaultSearchQuery;
            let vaultSearchTimer = null;
            elements.vaultSearchInput.addEventListener('input', () => {
                clearTimeout(vaultSearchTimer);
                vaultSearchTimer = setTimeout(() => {
                    state.vaultSearchQuery = elements.vaultSearchInput.value.trim();
                    AetherUserData.setItem('aether_vault_search', state.vaultSearchQuery);
                    renderVaultFileList();
                }, 200);
            });
        }
        if (elements.vaultViewMode) {
            elements.vaultViewMode.querySelectorAll('[data-vault-view]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    setVaultViewMode(btn.getAttribute('data-vault-view') || 'recent');
                });
            });
            updateVaultViewModeUi();
        }
        if (elements.vaultCurrentSessionOnly) {
            elements.vaultCurrentSessionOnly.checked = state.vaultCurrentSessionOnly;
            elements.vaultCurrentSessionOnly.addEventListener('change', () => {
                state.vaultCurrentSessionOnly = elements.vaultCurrentSessionOnly.checked;
                AetherUserData.setItem('aether_vault_session_only', JSON.stringify(state.vaultCurrentSessionOnly));
                refreshVault({ ingest: false });
            });
        }
        if (elements.vaultSortSelect) {
            elements.vaultSortSelect.value = state.vaultSortBy;
            elements.vaultSortSelect.addEventListener('change', () => {
                state.vaultSortBy = elements.vaultSortSelect.value || 'date';
                AetherUserData.setItem('aether_vault_sort', state.vaultSortBy);
                renderVaultFileList();
            });
        }
        document.querySelectorAll('[data-vault-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.vaultFilter = btn.dataset.vaultFilter || 'all';
                document.querySelectorAll('[data-vault-filter]').forEach((el) => {
                    const active = el.dataset.vaultFilter === state.vaultFilter;
                    el.classList.toggle('active', active);
                    el.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                renderVaultFileList();
            });
        });
        if (elements.vaultPreviewBackBtn) {
            elements.vaultPreviewBackBtn.addEventListener('click', () => closeVaultPreview());
        }
        if (elements.vaultPreviewSaveBtn) {
            elements.vaultPreviewSaveBtn.addEventListener('click', () => saveVaultPreview());
        }
        if (elements.vaultPreviewFinderBtn) {
            elements.vaultPreviewFinderBtn.addEventListener('click', () => revealSelectedVaultFile());
        }
        if (elements.vaultPreviewPinBtn) {
            elements.vaultPreviewPinBtn.addEventListener('click', () => pinSelectedVaultFolder());
        }
        if (elements.vaultPreviewCopyPathBtn) {
            elements.vaultPreviewCopyPathBtn.addEventListener('click', () => copySelectedVaultPath());
        }
        if (elements.skillsBtn) {
            elements.skillsBtn.addEventListener('click', () => enterSettingsMode('skills'));
        }
        if (elements.reloadSkillsBtn) {
            elements.reloadSkillsBtn.addEventListener('click', () => reloadHermesSkillsFromHud());
        }
        if (elements.archivesSearchInput) {
            let archivesSearchTimer = null;
            elements.archivesSearchInput.addEventListener('input', () => {
                clearTimeout(archivesSearchTimer);
                archivesSearchTimer = setTimeout(() => {
                    state.archivesSearchQuery = elements.archivesSearchInput.value.trim();
                    scheduleRenderHistorySessions();
                    if (state.archivesSearchQuery && state.hermesStatus?.connected) {
                        searchHermesSessionsRemote(state.archivesSearchQuery);
                    }
                }, 250);
            });
        }
        if (elements.chatStopBtn) {
            elements.chatStopBtn.addEventListener('click', () => stopActiveChatTurn());
        }
        if (elements.refreshJobsBtn) {
            elements.refreshJobsBtn.addEventListener('click', () => loadJobsPanel());
        }
        if (elements.newJobBtn) {
            elements.newJobBtn.addEventListener('click', () => promptNewHermesJob());
        }
        if (elements.saveContextFileBtn) {
            elements.saveContextFileBtn.addEventListener('click', () => saveSelectedContextFile());
        }
        if (elements.saveSkillsBtn) {
            elements.saveSkillsBtn.addEventListener('click', () => saveSelectedSkill());
        }
        if (elements.refreshSkillsBtn) {
            elements.refreshSkillsBtn.addEventListener('click', () => refreshHermesSkills());
        }
        if (elements.skillsSearch) {
            elements.skillsSearch.addEventListener('input', () => renderSkillsList());
        }
        document.querySelectorAll('[data-skills-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const filter = btn.getAttribute('data-skills-filter') || 'all';
                state.skillsFilter = filter;
                document.querySelectorAll('[data-skills-filter]').forEach((el) => {
                    const active = el.getAttribute('data-skills-filter') === filter;
                    el.classList.toggle('active', active);
                    el.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                renderSkillsList();
            });
        });
        if (elements.skillsEditor) {
            elements.skillsEditor.addEventListener('input', () => updateSkillsSaveState());
        }
        if (elements.dashboardSplash) {
            elements.dashboardSplash.addEventListener('click', () => bootstrapHermesDashboard());
        }
        if (elements.avatarPokeTarget) {
            elements.avatarPokeTarget.addEventListener('click', (e) => {
                e.stopPropagation();
                if (state.kanbanMode) return;
                visualizer.pokeAvatar();
            });
        }
        if (elements.hudCoreVisualizer) {
            elements.hudCoreVisualizer.addEventListener('click', () => {
                if (state.kanbanMode) activateKanbanCompanion();
            });
            elements.hudCoreVisualizer.addEventListener('keydown', (e) => {
                if (!state.kanbanMode) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activateKanbanCompanion();
                }
            });
        }
        
        // Settings triggers
        elements.settingsBtn.addEventListener('click', () => enterSettingsMode());
        if (elements.settingsPillBtn) {
            elements.settingsPillBtn.addEventListener('click', () => enterSettingsMode());
        }
        elements.closeSettingsBtn.addEventListener('click', () => exitSettingsMode());
        elements.saveSettingsBtn.addEventListener('click', saveSettings);
        if (elements.settingsChangeModelBtn) {
            elements.settingsChangeModelBtn.addEventListener('click', () => openModelPicker());
        }

        document.querySelectorAll('[data-settings-section]').forEach((item) => {
            item.addEventListener('click', () => {
                activateSettingsSection(item.dataset.settingsSection);
            });
        });

        window.addEventListener('hashchange', handleAppHashChange);

        document.querySelectorAll('[data-chat-history-tab]').forEach((tab) => {
            tab.addEventListener('click', () => activateChatHistoryTab(tab.dataset.chatHistoryTab));
        });

        document.querySelectorAll('.accent-swatch').forEach((swatch) => {
            swatch.addEventListener('click', () => {
                const themeId = swatch.getAttribute('data-accent-theme');
                if (themeId) selectAccentTheme(themeId);
            });
        });

        document.querySelectorAll('.avatar-form-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const formId = btn.getAttribute('data-avatar-form');
                state.avatarForm = ['classic-blob', 'nova', 'wisp', 'eve'].includes(formId) ? formId : 'classic-blob';
                updateAvatarFormUi(state.avatarForm);
                visualizer.setAvatarForm(state.avatarForm);
            });
        });

        // Global shortcut: focus chat composer (expand column if collapsed)
        window.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            const activeTag = activeEl?.tagName?.toLowerCase() || '';
            const typingInComposer = activeTag === 'textarea' && activeEl === elements.deckChatInputField;
            const collapsed = elements.hudShell?.classList.contains('chat-collapsed');
            const typingInKanban = !!activeEl?.closest?.('.aether-kanban, .kanban-drawer-root, .ak-inline-create');
            const typingInFormField = ['input', 'textarea', 'select'].includes(activeTag)
                || !!activeEl?.isContentEditable
                || !!activeEl?.closest?.('.model-picker-modal, .settings-page, .ak-inline-create');

            if (state.kanbanMode || state.settingsMode || state.vaultMode || typingInKanban) {
                return;
            }

            if (!typingInFormField) {
                if (e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    expandChatColumn();
                } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    expandChatColumn();
                    elements.deckChatInputField.value += e.key;
                    elements.deckChatInputField.focus();
                    resizeChatComposerInput();
                }
            } else if (!typingInComposer && e.key === 'Escape' && !collapsed) {
                collapseChatColumn();
            }
        });

        // Model picker
        elements.modelBtn?.addEventListener('click', openModelPicker);
        elements.closeModelPickerBtn?.addEventListener('click', closeModelPicker);
        elements.cancelModelPickerBtn?.addEventListener('click', closeModelPicker);
        elements.confirmModelPickerBtn?.addEventListener('click', confirmModelSwitch);
        elements.modelPickerModal?.addEventListener('click', (e) => {
            if (e.target === elements.modelPickerModal) closeModelPicker();
        });
        elements.modelPickerSearch?.addEventListener('input', () => {
            modelPickerState.query = elements.modelPickerSearch.value || '';
            modelPickerState.selectedModel = '';
            renderModelPickerProviders();
            renderModelPickerModels();
            updateModelPickerConfirmState();
        });

        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && state.vaultMode && state.vaultPreviewEditable) {
                e.preventDefault();
                saveVaultPreview();
            }
        });

        document.addEventListener('keydown', async (e) => {
            if (e.key === 'Escape' && state.vaultMode) {
                const activeEl = document.activeElement;
                const activeTag = activeEl?.tagName?.toLowerCase() || '';
                if (['input', 'textarea', 'select'].includes(activeTag)) return;
                if (elements.vaultPageBody?.classList.contains('show-preview')) {
                    e.preventDefault();
                    await closeVaultPreview();
                    return;
                }
                e.preventDefault();
                await exitVaultMode();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && state.settingsMode) {
                const activeEl = document.activeElement;
                const activeTag = activeEl?.tagName?.toLowerCase() || '';
                if (['input', 'textarea', 'select'].includes(activeTag)) return;
                if (elements.modelPickerModal?.classList.contains('open')) return;
                e.preventDefault();
                exitSettingsMode();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.modelPickerModal?.classList.contains('open')) {
                e.preventDefault();
                closeModelPicker();
            }
        });

        elements.closeMediaLightboxBtn?.addEventListener('click', closeMediaLightbox);
        elements.mediaLightbox?.addEventListener('click', (e) => {
            if (e.target === elements.mediaLightbox) closeMediaLightbox();
        });
        elements.deckChatScroller?.addEventListener('click', handleMediaImageActivate);
        elements.consoleScroller?.addEventListener('click', handleMediaImageActivate);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.mediaLightbox?.classList.contains('open')) {
                e.preventDefault();
                closeMediaLightbox();
                return;
            }
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const img = e.target?.closest?.('.bubble-media-image');
            if (!img) return;
            e.preventDefault();
            openMediaLightbox(img.currentSrc || img.src, img.alt);
        });

        // Voice mic recognition triggers
        elements.voiceRecognitionBtn.addEventListener('click', toggleVoiceMode);
        elements.speechSynthesisToggle.addEventListener('click', toggleSpeechOutput);
        if (elements.voiceRepliesToggle) {
            elements.voiceRepliesToggle.addEventListener('click', () => {
                setSpeechEnabled(!state.speechEnabled);
            });
        }
        elements.newChatBtn.addEventListener('click', () => {
            startNewSession({ ephemeral: true });
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
        elements.deckChatInputField.addEventListener('input', resizeChatComposerInput);
        resizeChatComposerInput();
        elements.deckSendMessageBtn.addEventListener('click', submitDeckMessage);

        if (elements.composerAttachBtn && elements.composerFileInput) {
            elements.composerAttachBtn.addEventListener('click', () => {
                if (!verifyAttachmentUi()) return;
                elements.composerFileInput.click();
            });
            elements.composerFileInput.addEventListener('change', () => {
                if (!elements.composerFileInput.files?.length) return;
                addComposerAttachmentFiles(elements.composerFileInput.files);
                elements.composerFileInput.value = '';
            });
        }

        verifyAttachmentUi();
        setupChatDropZone();

        // Sliders updates
        elements.synthSpeed.addEventListener('input', () => {
            elements.synthSpeedVal.textContent = elements.synthSpeed.value + 'x';
        });
        elements.simulationSpeed.addEventListener('input', () => {
            const vals = ['Snail', 'Slow', 'Normal', 'Fast', 'Instant'];
            const index = Math.min(4, Math.floor((elements.simulationSpeed.value - 1) / 2));
            elements.simulationSpeedVal.textContent = vals[index];
        });

        if (elements.ttsReplayCacheSize) {
            elements.ttsReplayCacheSize.addEventListener('input', () => {
                if (elements.ttsReplayCacheSizeVal) {
                    elements.ttsReplayCacheSizeVal.textContent = elements.ttsReplayCacheSize.value;
                }
            });
        }

        if (elements.chatColumnWidth) {
            elements.chatColumnWidth.addEventListener('input', () => {
                if (elements.chatColumnWidthVal) {
                    elements.chatColumnWidthVal.textContent = elements.chatColumnWidth.value + 'px';
                }
                applyChatColumnWidth(parseInt(elements.chatColumnWidth.value, 10));
            });
        }

        // Hermes profile selector
        if (elements.hermesProfileSelect) {
            elements.hermesProfileSelect.addEventListener('change', () => {
                const profile = elements.hermesProfileSelect.value;
                state.activeHermesProfile = profile;
                AetherUserData.setItem('aether_hermes_profile', profile);
                updateHermesProfileBadge();
                appendSystemConsoleLine(`[AGENT] Hermes profile changed to: ${profile || 'default'}.`);
            });
        }

        // Refresh chats button — drawer
        if (elements.refreshChatsBtn) {
            elements.refreshChatsBtn.addEventListener('click', () => {
                refreshHermesChats();
            });
        }

        // Refresh chats button — composer
        if (elements.composerRefreshBtn) {
            elements.composerRefreshBtn.addEventListener('click', () => {
                refreshHermesChats();
            });
        }

        window.addEventListener('aetherVoicesLoaded', populateVoicesList);
        window.addEventListener('aetherElevenLabsVoicesLoaded', populateVoicesList);

        if (elements.ttsProvider) {
            elements.ttsProvider.addEventListener('change', () => {
                updateTtsProviderHint();
                updateOmniVoiceInstructVisibility();
                populateVoicesList();
            });
        }

        if (elements.voicePreviewBtn) {
            elements.voicePreviewBtn.addEventListener('click', previewSelectedVoice);
        }

        if (elements.synthVoice) {
            elements.synthVoice.addEventListener('change', syncVoiceSelectTitle);
        }

    }

    /* ==========================================================================
       B. Typewriter Command Console Orchestrator
       ========================================================================== */
    function closeAllDrawers() {
        if (elements.sidebarDrawer?.classList.contains('open')) {
            toggleSidebarDrawer(false);
        }
    }

    async function goHome() {
        closeModelPicker();
        closeAllDrawers();

        state.chatCollapsedBeforeSettings = true;
        state.chatCollapsedBeforeVault = true;
        state.chatCollapsedBeforeKanban = true;

        if (state.kanbanMode) {
            exitKanbanMode();
        }
        if (state.settingsMode) {
            exitSettingsMode({ fromHash: true });
        }
        if (state.vaultMode) {
            await exitVaultMode({ fromHash: true });
        }

        state.chatCollapsedBeforeSettings = null;
        state.chatCollapsedBeforeVault = null;
        state.chatCollapsedBeforeKanban = null;

        collapseChatColumn();

        const hash = window.location.hash || '';
        if (hash.startsWith('#/settings') || hash.startsWith('#/vault')) {
            const base = window.location.pathname + window.location.search;
            history.replaceState(null, '', base);
        }

        if (typeof visualizer.setPresentationMode === 'function' && !state.kanbanMode) {
            visualizer.setPresentationMode('default');
        }

        runTransitionResizeLoop();
    }

    function toggleSidebarDrawer(forceOpen) {
        const shouldOpen = forceOpen === undefined
            ? !elements.sidebarDrawer.classList.contains('open')
            : forceOpen;
        elements.sidebarDrawer.classList.toggle('open', shouldOpen);
        elements.historyDrawerToggle.classList.toggle('active', shouldOpen);
        if (shouldOpen && state.activeSessionId) {
            activateChatHistoryTab(getChatHistoryTabForSession(state.activeSessionId));
        }
        updateOverlayScrims();
    }

    function setActiveWorkspacePath(pathValue) {
        if (!pathValue) return;
        state.activeWorkspacePath = pathValue;
        AetherUserData.setItem('aether_active_workspace_path', pathValue);
        updateWorkspacePinBadge();
    }

    function getSelectedVaultFile() {
        if (!state.vaultPreviewId) return null;
        return state.vaultFiles.find((f) => f.id === state.vaultPreviewId) || null;
    }

    function setVaultViewMode(mode) {
        const allowed = new Set(['recent', 'folder', 'session']);
        state.vaultViewMode = allowed.has(mode) ? mode : 'recent';
        AetherUserData.setItem('aether_vault_view_mode', state.vaultViewMode);
        if (state.vaultViewMode !== 'folder') {
            state.vaultFolderPath = '';
        }
        updateVaultViewModeUi();
        renderVaultBreadcrumbs();
        renderVaultFileList();
    }

    function updateVaultViewModeUi() {
        if (!elements.vaultViewMode) return;
        elements.vaultViewMode.querySelectorAll('[data-vault-view]').forEach((btn) => {
            const active = btn.getAttribute('data-vault-view') === state.vaultViewMode;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (elements.vaultBreadcrumbs) {
            elements.vaultBreadcrumbs.hidden = state.vaultViewMode !== 'folder';
        }
    }

    function persistVaultExpandedFolders() {
        AetherUserData.setItem('aether_vault_expanded_folders', JSON.stringify([...state.vaultExpandedFolders]));
    }

    function persistVaultExpandedSessions() {
        AetherUserData.setItem('aether_vault_expanded_sessions', JSON.stringify([...state.vaultExpandedSessions]));
    }

    function formatRelativeTime(iso) {
        if (!iso) return '';
        const diff = Date.now() - new Date(iso).getTime();
        if (!Number.isFinite(diff)) return '';
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(iso).toLocaleDateString();
    }

    function filterVaultFiles(files) {
        const q = state.vaultSearchQuery.trim().toLowerCase();
        if (!q) return files;
        return files.filter((file) => {
            const title = String(file.title || '').toLowerCase();
            const path = String(file.originalDisplayPath || file.originalPath || '').toLowerCase();
            const sessionId = String(file.sessionId || '').toLowerCase();
            return title.includes(q) || path.includes(q) || sessionId.includes(q);
        });
    }

    function sortVaultFiles(files) {
        const sorted = [...files];
        if (state.vaultSortBy === 'name') {
            return sorted.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
        }
        if (state.vaultSortBy === 'size') {
            return sorted.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
        }
        return sorted.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    }

    function getFilteredVaultFiles() {
        let files = sortVaultFiles(filterVaultFiles(state.vaultFiles.filter((f) => f.id)));

        if (state.vaultFilter === 'missing') {
            files = files.filter((file) => file.originalExists === false);
        } else if (state.vaultFilter === 'text') {
            files = files.filter((file) => /\.(md|markdown|txt|log|json|ya?ml|csv|ts|tsx|js|jsx|py|html|css|sql)$/i.test(file.title || ''));
        } else if (state.vaultFilter === 'image') {
            files = files.filter((file) => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(file.title || ''));
        }

        return files;
    }

    function vaultSessionTitle(sessionId) {
        if (!sessionId || sessionId === '__unknown__') return 'Unknown session';
        const session = findAetherSession(sessionId) || findHermesSession(sessionId);
        if (session?.title) return session.title;
        return `Session ${String(sessionId).slice(0, 8)}`;
    }

    function pathDirname(absPath) {
        const value = String(absPath || '');
        const idx = value.lastIndexOf('/');
        return idx > 0 ? value.slice(0, idx) : '';
    }

    function pathParts(dirPath) {
        if (!dirPath) return [];
        return dirPath.replace(/\/+$/, '').split('/').filter(Boolean);
    }

    function detectCommonPathPrefix(files) {
        const dirs = files.map((f) => pathDirname(f.originalPath)).filter(Boolean);
        if (!dirs.length) return '';
        const splitDirs = dirs.map((dir) => pathParts(dir));
        const minLen = Math.min(...splitDirs.map((parts) => parts.length));
        const common = [];
        for (let i = 0; i < minLen; i += 1) {
            const seg = splitDirs[0][i];
            if (splitDirs.every((parts) => parts[i] === seg)) common.push(seg);
            else break;
        }
        if (!common.length) return '';
        return `/${common.join('/')}`;
    }

    function buildVaultFolderTree(files) {
        const root = { name: '', path: '', children: new Map(), files: [] };
        for (const file of files) {
            const abs = file.originalPath || '';
            const dir = pathDirname(abs);
            if (!dir) {
                root.files.push(file);
                continue;
            }
            const parts = pathParts(dir);
            let node = root;
            let currentPath = '';
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
                if (!node.children.has(part)) {
                    node.children.set(part, { name: part, path: currentPath, children: new Map(), files: [] });
                }
                node = node.children.get(part);
            }
            node.files.push(file);
        }
        return root;
    }

    function buildVaultSessionGroups(files) {
        const groups = new Map();
        for (const file of files) {
            const sessionId = file.sessionId || '__unknown__';
            if (!groups.has(sessionId)) groups.set(sessionId, []);
            groups.get(sessionId).push(file);
        }
        return [...groups.entries()]
            .map(([sessionId, groupFiles]) => ({
                sessionId,
                files: sortVaultFiles(groupFiles),
                latestUpdated: groupFiles.reduce((latest, file) => {
                    const ts = new Date(file.updatedAt || 0).getTime();
                    return Number.isFinite(ts) && ts > latest ? ts : latest;
                }, 0),
            }))
            .sort((a, b) => b.latestUpdated - a.latestUpdated);
    }

    function renderVaultFileSubline(file, includePath = true) {
        const sub = document.createElement('span');
        sub.className = 'vault-file-sub';
        const parts = [];
        if (file.size != null) parts.push(formatWorkspaceFileSize(file.size));
        if (includePath && file.originalDisplayPath) parts.push(file.originalDisplayPath);
        const relative = formatRelativeTime(file.updatedAt);
        if (relative) parts.push(relative);
        sub.textContent = parts.join(' · ');
        if (!file.originalExists) {
            sub.appendChild(document.createTextNode(' · '));
            const missing = document.createElement('span');
            missing.className = 'vault-original-missing';
            missing.textContent = 'original missing';
            sub.appendChild(missing);
        }
        return sub;
    }

    function createVaultFileRow(file, depth = 0) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `vault-file-row${state.vaultPreviewId === file.id ? ' active' : ''}`;
        if (depth > 0) row.dataset.depth = String(depth);
        row.title = file.originalDisplayPath || file.originalPath || file.title;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', state.vaultPreviewId === file.id ? 'true' : 'false');

        const icon = document.createElement('span');
        icon.className = 'vault-file-icon';
        icon.innerHTML = `<i data-lucide="${workspaceFileIconName(file)}"></i>`;

        const meta = document.createElement('span');
        meta.className = 'vault-file-meta';
        const label = document.createElement('span');
        label.className = 'vault-file-name';
        label.textContent = file.title || file.originalDisplayPath || 'File';
        meta.appendChild(label);
        meta.appendChild(renderVaultFileSubline(file, state.vaultViewMode === 'recent'));
        row.appendChild(icon);
        row.appendChild(meta);
        row.addEventListener('click', () => openVaultPreview(file.id));
        return row;
    }

    function renderVaultBreadcrumbs() {
        const container = elements.vaultBreadcrumbs;
        if (!container) return;
        container.replaceChildren();
        if (state.vaultViewMode !== 'folder') {
            container.hidden = true;
            return;
        }
        container.hidden = false;
        const files = getFilteredVaultFiles();
        const prefix = detectCommonPathPrefix(files);
        const rootBtn = document.createElement('button');
        rootBtn.type = 'button';
        rootBtn.className = `workspace-breadcrumb-btn${state.vaultFolderPath ? '' : ' is-current'}`;
        rootBtn.textContent = prefix ? `${prefix.replace(/^\/Users\/[^/]+/, '~')}/` : 'All files';
        rootBtn.addEventListener('click', () => {
            state.vaultFolderPath = '';
            renderVaultBreadcrumbs();
            renderVaultFileList();
        });
        container.appendChild(rootBtn);
        if (!state.vaultFolderPath) return;

        const relativePath = prefix && state.vaultFolderPath.startsWith(prefix)
            ? state.vaultFolderPath.slice(prefix.length)
            : state.vaultFolderPath;
        const segments = pathParts(relativePath);
        let built = prefix;
        segments.forEach((segment, index) => {
            const sep = document.createElement('span');
            sep.className = 'workspace-breadcrumb-sep';
            sep.textContent = '/';
            container.appendChild(sep);
            built = built ? `${built}/${segment}` : `/${segment}`;
            const folderPath = built;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `workspace-breadcrumb-btn${index === segments.length - 1 ? ' is-current' : ''}`;
            btn.textContent = segment;
            btn.addEventListener('click', () => {
                state.vaultFolderPath = folderPath;
                state.vaultExpandedFolders.add(folderPath);
                persistVaultExpandedFolders();
                renderVaultBreadcrumbs();
                renderVaultFileList();
            });
            container.appendChild(btn);
        });
    }

    function findVaultFolderNode(root, folderPath) {
        if (!folderPath) return root;
        const parts = pathParts(folderPath);
        let node = root;
        for (const part of parts) {
            if (!node.children.has(part)) return null;
            node = node.children.get(part);
        }
        return node;
    }

    function countVaultFolderFiles(node) {
        let count = node.files.length;
        for (const child of node.children.values()) {
            count += countVaultFolderFiles(child);
        }
        return count;
    }

    function createVaultFolderRow(folder, depth, isExpanded, onClick) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `vault-file-row is-dir vault-folder-row${isExpanded ? ' is-expanded' : ''}`;
        if (depth > 0) row.dataset.depth = String(depth);
        const icon = document.createElement('span');
        icon.className = 'vault-file-icon';
        icon.innerHTML = '<i data-lucide="folder"></i>';
        const meta = document.createElement('span');
        meta.className = 'vault-file-meta';
        const label = document.createElement('span');
        label.className = 'vault-file-name';
        const chevron = document.createElement('span');
        chevron.className = 'vault-folder-chevron';
        chevron.textContent = '▸';
        label.appendChild(chevron);
        label.appendChild(document.createTextNode(folder.name));
        const sub = document.createElement('span');
        sub.className = 'vault-file-sub';
        const fileCount = countVaultFolderFiles(folder);
        sub.textContent = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
        meta.appendChild(label);
        meta.appendChild(sub);
        row.appendChild(icon);
        row.appendChild(meta);
        row.addEventListener('click', onClick);
        return row;
    }

    function renderVaultFolderTree(node, depth, fragment) {
        const childEntries = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
        for (const child of childEntries) {
            const isExpanded = state.vaultExpandedFolders.has(child.path);
            fragment.appendChild(createVaultFolderRow(child, depth, isExpanded, () => {
                if (isExpanded) state.vaultExpandedFolders.delete(child.path);
                else state.vaultExpandedFolders.add(child.path);
                persistVaultExpandedFolders();
                renderVaultFileList();
            }));
            if (isExpanded) {
                renderVaultFolderTree(child, depth + 1, fragment);
                for (const file of sortVaultFiles(child.files)) {
                    fragment.appendChild(createVaultFileRow(file, depth + 1));
                }
            }
        }
        for (const file of sortVaultFiles(node.files)) {
            fragment.appendChild(createVaultFileRow(file, depth));
        }
    }

    function renderVaultFolderContents(node, depth, fragment) {
        const childEntries = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
        for (const child of childEntries) {
            fragment.appendChild(createVaultFolderRow(child, depth, false, () => {
                state.vaultFolderPath = child.path;
                state.vaultExpandedFolders.add(child.path);
                persistVaultExpandedFolders();
                renderVaultBreadcrumbs();
                renderVaultFileList();
            }));
        }
        for (const file of sortVaultFiles(node.files)) {
            fragment.appendChild(createVaultFileRow(file, depth));
        }
    }

    function renderVaultRecentList(files, fragment) {
        for (const file of files) {
            fragment.appendChild(createVaultFileRow(file, 0));
        }
    }

    function renderVaultFolderList(files, fragment) {
        const tree = buildVaultFolderTree(files);
        if (state.vaultFolderPath) {
            const node = findVaultFolderNode(tree, state.vaultFolderPath);
            if (node) {
                renderVaultFolderContents(node, 0, fragment);
                return;
            }
            state.vaultFolderPath = '';
            renderVaultBreadcrumbs();
        }
        renderVaultFolderTree(tree, 0, fragment);
    }

    function renderVaultSessionList(files, fragment) {
        const groups = buildVaultSessionGroups(files);
        for (const group of groups) {
            const sessionId = group.sessionId;
            const isExpanded = state.vaultExpandedSessions.has(sessionId);
            const row = document.createElement('div');
            row.className = `vault-file-row is-dir vault-session-row${isExpanded ? ' is-expanded' : ''}`;

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'vault-session-toggle-btn';
            const icon = document.createElement('span');
            icon.className = 'vault-file-icon';
            icon.innerHTML = '<i data-lucide="messages-square"></i>';
            const meta = document.createElement('span');
            meta.className = 'vault-file-meta';
            const label = document.createElement('span');
            label.className = 'vault-file-name';
            const chevron = document.createElement('span');
            chevron.className = 'vault-folder-chevron';
            chevron.textContent = '▸';
            label.appendChild(chevron);
            label.appendChild(document.createTextNode(vaultSessionTitle(sessionId)));
            const sub = document.createElement('span');
            sub.className = 'vault-file-sub';
            sub.textContent = `${group.files.length} file${group.files.length === 1 ? '' : 's'}`;
            meta.appendChild(label);
            meta.appendChild(sub);
            toggle.appendChild(icon);
            toggle.appendChild(meta);
            toggle.addEventListener('click', () => {
                if (state.vaultExpandedSessions.has(sessionId)) {
                    state.vaultExpandedSessions.delete(sessionId);
                } else {
                    state.vaultExpandedSessions.add(sessionId);
                }
                persistVaultExpandedSessions();
                renderVaultFileList();
            });
            row.appendChild(toggle);

            if (sessionId !== '__unknown__') {
                const loadBtn = document.createElement('button');
                loadBtn.type = 'button';
                loadBtn.className = 'vault-session-load-btn';
                loadBtn.textContent = 'Open chat';
                loadBtn.title = 'Load this session';
                loadBtn.addEventListener('click', () => {
                    loadSession(sessionId);
                });
                row.appendChild(loadBtn);
            }
            fragment.appendChild(row);
            if (isExpanded) {
                for (const file of group.files) {
                    fragment.appendChild(createVaultFileRow(file, 1));
                }
            }
        }
    }

    function updateVaultCountBadge(count = state.vaultFiles.length) {
        if (!elements.vaultCountBadge) return;
        elements.vaultCountBadge.textContent = `${count} file${count === 1 ? '' : 's'}`;
    }

    async function refreshVault(options = {}) {
        const statusEl = elements.vaultFilesStatus;
        const { ingest = false } = options;
        elements.vaultScanBtn?.classList.add('refreshing');
        if (statusEl && options.showLoading !== false) {
            statusEl.textContent = ingest ? 'Scanning Hermes sessions…' : 'Loading vault…';
        }
        let ingestNote = '';
        if (ingest) {
            try {
                const ingestResult = await ai.ingestVault();
                if (ingestResult.scanned != null) {
                    ingestNote = `Indexed ${ingestResult.ingested || 0} new, ${ingestResult.updated || 0} updated`;
                    if (statusEl) statusEl.textContent = ingestNote;
                }
            } catch (err) {
                ingestNote = '';
                const msg = err.message || 'Vault scan failed';
                if (/method not allowed|404|405/i.test(msg)) {
                    appendSystemConsoleLine('[VAULT] Server needs a restart — run npm start to load vault routes.');
                }
                appendSystemConsoleLine(`[VAULT] Scan: ${msg}`);
            }
        }
        try {
            const sessionId = state.vaultCurrentSessionOnly ? state.activeSessionId : null;
            const result = await ai.getVaultFiles(sessionId || undefined);
            state.vaultFiles = result.files || [];
            try {
                const sessionsResult = await ai.getVaultSessions();
                state.vaultSessionsMeta = sessionsResult.sessions || [];
            } catch (_err) {
                state.vaultSessionsMeta = [];
            }
            updateVaultCountBadge(state.vaultFiles.length);
            if (statusEl) {
                const count = state.vaultFiles.length;
                const missingCount = state.vaultFiles.filter((f) => !f.originalExists).length;
                let statusText = '';
                if (ingestNote) {
                    statusText = `${ingestNote}${count ? ` · ${count} indexed` : ''}`;
                } else {
                    statusText = count
                        ? `${count} indexed file${count === 1 ? '' : 's'}`
                        : 'Vault empty — ask Hermes to create a file, then scan.';
                }
                if (missingCount > 0) {
                    statusText += ` · ${missingCount} missing`;
                }
                statusEl.textContent = statusText;
                if (missingCount > 0 && !statusEl.querySelector('.vault-cleanup-link')) {
                    const link = document.createElement('button');
                    link.type = 'button';
                    link.className = 'vault-cleanup-link';
                    link.textContent = ' Clean up';
                    link.title = 'Remove entries for deleted files';
                    link.addEventListener('click', async () => {
                        try {
                            const purgeResult = await ai.purgeMissingVaultFiles();
                            appendSystemConsoleLine(`[VAULT] Removed ${purgeResult.removed || 0} missing entries`);
                            refreshVault({ ingest: false });
                        } catch (err) {
                            appendSystemConsoleLine(`[VAULT] Cleanup: ${err.message || 'Failed'}`);
                        }
                    });
                    statusEl.appendChild(link);
                }
            }
            renderVaultBreadcrumbs();
            renderVaultFileList();
            if (state.vaultPreviewId && !state.vaultFiles.some((f) => f.id === state.vaultPreviewId)) {
                closeVaultPreview();
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = err.message || 'Could not load vault.';
            appendSystemConsoleLine(`[VAULT] ${err.message || 'Load failed'}`);
        } finally {
            elements.vaultScanBtn?.classList.remove('refreshing');
        }
    }

    function renderVaultFileList() {
        const list = elements.vaultFileList;
        if (!list) return;
        list.replaceChildren();
        const files = getFilteredVaultFiles();
        if (!files.length) {
            const empty = document.createElement('div');
            empty.className = 'vault-empty-hint';
            empty.textContent = state.vaultFiles.length
                ? (state.vaultSearchQuery ? 'No files match your search.' : 'No files match the current filter.')
                : 'No indexed files yet. Scan Hermes sessions to discover artifacts.';
            list.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        if (state.vaultViewMode === 'folder') {
            renderVaultFolderList(files, fragment);
        } else if (state.vaultViewMode === 'session') {
            renderVaultSessionList(files, fragment);
        } else {
            renderVaultRecentList(files, fragment);
        }
        list.appendChild(fragment);
        refreshBubbleIcons(list);
    }

    function resetVaultPreviewEditorState() {
        state.vaultPreviewDirty = false;
        state.vaultPreviewEditable = false;
        state.vaultPreviewSavedContent = '';
        state.vaultPreviewSaving = false;
        updateVaultPreviewSaveButton();
    }

    function getVaultPreviewEditor() {
        return elements.vaultPreviewBody?.querySelector('.vault-preview-editor') || null;
    }

    function updateVaultPreviewSaveButton() {
        const btn = elements.vaultPreviewSaveBtn;
        if (!btn) return;
        const show = state.vaultPreviewEditable;
        btn.hidden = !show;
        btn.disabled = state.vaultPreviewSaving || !state.vaultPreviewDirty;
        btn.classList.toggle('is-dirty', state.vaultPreviewDirty);
        btn.title = state.vaultPreviewDirty ? 'Save changes' : 'Saved';
    }

    function markVaultPreviewDirty() {
        const editor = getVaultPreviewEditor();
        if (!editor || !state.vaultPreviewEditable) return;
        state.vaultPreviewDirty = editor.value !== state.vaultPreviewSavedContent;
        updateVaultPreviewSaveButton();
    }

    async function confirmDiscardVaultPreviewChanges() {
        if (!state.vaultPreviewDirty) return true;
        return window.confirm('You have unsaved changes. Discard them?');
    }

    function setVaultPreviewFocus(active) {
        elements.vaultPage?.classList.toggle('show-preview', active);
        elements.vaultPageBody?.classList.toggle('show-preview', active);
    }

    async function closeVaultPreview({ skipConfirm = false } = {}) {
        if (!skipConfirm && !(await confirmDiscardVaultPreviewChanges())) return false;
        state.vaultPreviewId = '';
        resetVaultPreviewEditorState();
        setVaultPreviewFocus(false);
        if (elements.vaultPreviewEmpty) elements.vaultPreviewEmpty.hidden = false;
        if (elements.vaultPreviewContent) elements.vaultPreviewContent.hidden = true;
        if (elements.vaultPreviewBody) {
            elements.vaultPreviewBody.replaceChildren();
            elements.vaultPreviewBody.classList.remove('has-editor');
        }
        if (elements.vaultPreviewPath) elements.vaultPreviewPath.textContent = '';
        renderVaultFileList();
        if (state.vaultMode && !parseVaultRoute()?.fileId) {
            syncVaultRoute(null, { replace: true });
        }
        return true;
    }

    async function openVaultPreview(fileId) {
        if (!fileId) return;
        if (state.vaultPreviewId && state.vaultPreviewId !== fileId && state.vaultPreviewDirty) {
            const proceed = await confirmDiscardVaultPreviewChanges();
            if (!proceed) return;
        }
        resetVaultPreviewEditorState();
        state.vaultPreviewId = fileId;
        const file = state.vaultFiles.find((f) => f.id === fileId);
        setVaultPreviewFocus(true);
        if (elements.vaultPreviewEmpty) elements.vaultPreviewEmpty.hidden = true;
        if (elements.vaultPreviewContent) elements.vaultPreviewContent.hidden = false;
        if (typeof lucide !== 'undefined' && elements.vaultPreviewContent) {
            lucide.createIcons({ root: elements.vaultPreviewContent });
        }
        if (elements.vaultPreviewTitle) {
            elements.vaultPreviewTitle.textContent = file?.title || 'File';
        }
        if (elements.vaultPreviewPath) {
            const original = file?.originalDisplayPath || file?.originalPath || '';
            elements.vaultPreviewPath.textContent = original
                ? `${original}${file?.originalExists === false ? ' · no longer on disk' : ''}`
                : 'Original path unknown';
        }
        renderVaultFileList();

        const body = elements.vaultPreviewBody;
        if (!body) return;
        body.replaceChildren();
        const loading = document.createElement('div');
        loading.className = 'vault-preview-loading';
        loading.textContent = 'Loading file…';
        body.appendChild(loading);

        if (state.vaultMode) {
            syncVaultRoute(fileId, { replace: true });
        }

        try {
            const result = await ai.readVaultFile(fileId);
            renderVaultPreviewContent(result, fileId);
        } catch (err) {
            resetVaultPreviewEditorState();
            body.replaceChildren();
            const error = document.createElement('div');
            error.className = 'vault-preview-error';
            error.textContent = err.message || 'Could not read file.';
            body.appendChild(error);
        }
    }

    function renderVaultPreviewContent(result, fileId) {
        const body = elements.vaultPreviewBody;
        if (!body) return;
        body.replaceChildren();
        resetVaultPreviewEditorState();
        if (result.kind === 'image') {
            const img = document.createElement('img');
            img.className = 'vault-preview-image';
            img.alt = result.name || 'Image';
            img.src = ai.vaultFileUrl(fileId);
            body.appendChild(img);
            return;
        }
        if (result.kind === 'text') {
            body.classList.add('has-editor');
            const editor = document.createElement('textarea');
            editor.className = 'vault-preview-editor';
            editor.spellcheck = false;
            editor.value = result.content || '';
            editor.readOnly = !result.editable;
            editor.setAttribute('aria-label', result.name || 'File editor');
            editor.addEventListener('input', () => markVaultPreviewDirty());
            body.appendChild(editor);
            if (result.editable) {
                state.vaultPreviewEditable = true;
                state.vaultPreviewSavedContent = editor.value;
                updateVaultPreviewSaveButton();
                if (typeof lucide !== 'undefined' && elements.vaultPreviewContent) {
                    lucide.createIcons({ root: elements.vaultPreviewContent });
                }
            }
            return;
        }
        const notice = document.createElement('div');
        notice.className = 'vault-preview-binary';
        notice.textContent = 'Binary file — use Open in Finder to view it locally.';
        body.appendChild(notice);
    }

    async function saveVaultPreview() {
        const fileId = state.vaultPreviewId;
        const editor = getVaultPreviewEditor();
        if (!fileId || !editor || !state.vaultPreviewEditable || state.vaultPreviewSaving) return;
        if (!state.vaultPreviewDirty) return;

        state.vaultPreviewSaving = true;
        updateVaultPreviewSaveButton();
        try {
            const result = await ai.saveVaultFile(fileId, editor.value);
            state.vaultPreviewSavedContent = editor.value;
            state.vaultPreviewDirty = false;
            if (result.vault) {
                const index = state.vaultFiles.findIndex((f) => f.id === fileId);
                if (index >= 0) {
                    state.vaultFiles[index] = { ...state.vaultFiles[index], ...result.vault };
                }
            }
            renderVaultFileList();
            showToast('Saved', result.name || 'File updated', { durationMs: 2200 });
        } catch (err) {
            showToast('Save failed', err.message || 'Could not save file.', { variant: 'error' });
        } finally {
            state.vaultPreviewSaving = false;
            updateVaultPreviewSaveButton();
        }
    }

    async function revealSelectedVaultFile() {
        const file = getSelectedVaultFile();
        if (!file?.id) return;
        try {
            await ai.revealVaultFile(file.id);
        } catch (err) {
            showToast('Open failed', err.message || 'Could not reveal file.', { variant: 'error' });
        }
    }

    function pinSelectedVaultFolder() {
        const file = getSelectedVaultFile();
        if (!file?.originalPath) return;
        const dir = file.originalPath.replace(/[/\\][^/\\]+$/, '');
        if (!dir) return;
        setActiveWorkspacePath(dir);
        showToast('Workspace pinned', shortenWorkspacePath(dir), { durationMs: 2600 });
    }

    async function copySelectedVaultPath() {
        const file = getSelectedVaultFile();
        const pathValue = file?.originalDisplayPath || file?.originalPath;
        if (!pathValue) return;
        try {
            await navigator.clipboard.writeText(pathValue);
            showToast('Copied path', pathValue, { durationMs: 2200 });
        } catch (err) {
            showToast('Copy failed', err.message || 'Could not copy path.', { variant: 'error' });
        }
    }

    function parseVaultRoute() {
        const hash = window.location.hash || '';
        const match = hash.match(/^#\/vault(?:\/file\/([^/?#]+))?$/i);
        if (!match) return null;
        return { fileId: match[1] ? decodeURIComponent(match[1]) : null };
    }

    function syncVaultRoute(fileId, { replace = false } = {}) {
        const target = fileId ? `#/vault/file/${encodeURIComponent(fileId)}` : '#/vault';
        if (window.location.hash === target) return;
        if (replace) {
            history.replaceState(null, '', target);
        } else {
            window.location.hash = target;
        }
    }

    function clearVaultRoute({ replace = true } = {}) {
        if (!window.location.hash.startsWith('#/vault')) return;
        const base = window.location.pathname + window.location.search;
        if (replace) {
            history.replaceState(null, '', base);
        } else {
            history.pushState(null, '', base);
        }
    }

    function enterVaultMode(route = {}, { fromHash = false } = {}) {
        if (state.kanbanMode) {
            exitKanbanMode();
        }
        if (state.settingsMode) {
            exitSettingsMode({ fromHash: true });
        }

        const fileId = route?.fileId || null;

        if (state.vaultMode) {
            if (fileId) {
                openVaultPreview(fileId);
            }
            if (!fromHash) {
                syncVaultRoute(fileId, { replace: true });
            }
            return;
        }

        if (state.chatCollapsedBeforeVault === null) {
            state.chatCollapsedBeforeVault =
                elements.hudShell?.classList.contains('chat-collapsed') ?? true;
        }
        collapseChatColumn();

        state.vaultMode = true;
        elements.hudShell?.classList.add('vault-mode');
        elements.workspaceFilesBtn?.classList.add('active');
        if (elements.vaultPage) {
            elements.vaultPage.hidden = false;
        }
        if (elements.vaultSearchInput) {
            elements.vaultSearchInput.value = state.vaultSearchQuery;
        }

        refreshVault({ ingest: true }).then(() => {
            if (fileId) {
                openVaultPreview(fileId);
            }
        });

        if (!fromHash) {
            syncVaultRoute(fileId);
        }
        lucide.createIcons();
    }

    async function exitVaultMode({ fromHash = false } = {}) {
        if (!state.vaultMode) return;
        if (!(await confirmDiscardVaultPreviewChanges())) return;

        state.vaultMode = false;
        elements.hudShell?.classList.remove('vault-mode');
        elements.workspaceFilesBtn?.classList.remove('active');
        if (elements.vaultPage) {
            elements.vaultPage.hidden = true;
        }
        await closeVaultPreview({ skipConfirm: true });

        const restoreCollapsed = state.chatCollapsedBeforeVault;
        state.chatCollapsedBeforeVault = null;
        if (restoreCollapsed === false) {
            expandChatColumn(false);
        } else {
            collapseChatColumn();
        }

        if (!fromHash) {
            clearVaultRoute();
        }
    }

    function handleAppHashChange() {
        const settingsSection = parseSettingsRoute();
        if (settingsSection) {
            enterSettingsMode(settingsSection, { fromHash: true });
            return;
        }
        const vaultRoute = parseVaultRoute();
        if (vaultRoute) {
            enterVaultMode(vaultRoute, { fromHash: true });
            return;
        }
        if (state.settingsMode) {
            exitSettingsMode({ fromHash: true });
        }
        if (state.vaultMode) {
            exitVaultMode({ fromHash: true });
        }
    }

    function setSkillsStatus(message, isError = false) {
        const el = elements.skillsStatus;
        if (!el) return;
        if (!message) {
            el.hidden = true;
            el.textContent = '';
            el.classList.remove('is-error');
            return;
        }
        el.hidden = false;
        el.textContent = message;
        el.classList.toggle('is-error', !!isError);
    }

    function filteredSkillsItems() {
        const query = String(elements.skillsSearch?.value || '').trim().toLowerCase();
        let items = state.skillsItems;
        if (state.skillsFilter === 'native') {
            items = items.filter((skill) => skill.origin === 'native');
        } else if (state.skillsFilter === 'custom') {
            items = items.filter((skill) => skill.origin === 'custom');
        }
        if (!query) return items;
        return items.filter((skill) => {
            const haystack = [
                skill.name,
                skill.displayName,
                skill.category,
                skill.description,
                skill.sourceLabel,
                skill.source,
                skill.hubSource,
                ...(skill.tags || []),
            ].join(' ').toLowerCase();
            return haystack.includes(query);
        });
    }

    function formatSkillsSummary(counts) {
        if (!counts) return '';
        const parts = [`${counts.native || 0} native`, `${counts.custom || 0} custom`];
        if (counts.hub) parts.push(`${counts.hub} downloaded`);
        if (counts.local) parts.push(`${counts.local} self-created`);
        return parts.join(' · ');
    }

    function getSelectedSkillItem() {
        return state.skillsItems.find((skill) => skill.name === state.skillsSelectedName) || null;
    }

    function updateSkillsSaveState() {
        const selected = getSelectedSkillItem();
        const dirty = !!selected
            && elements.skillsEditor
            && elements.skillsEditor.value !== state.skillsEditorBaseline;
        if (elements.saveSkillsBtn) {
            elements.saveSkillsBtn.disabled = !selected || !dirty;
        }
    }

    function renderSkillsEditor() {
        const selected = getSelectedSkillItem();
        const editor = elements.skillsEditor;
        const empty = elements.skillsEditorEmpty;
        if (!editor || !empty) return;

        if (!selected) {
            editor.hidden = true;
            editor.value = '';
            state.skillsEditorBaseline = '';
            empty.hidden = false;
            updateSkillsSaveState();
            return;
        }

        empty.hidden = true;
        editor.hidden = false;
        if (Object.prototype.hasOwnProperty.call(selected, 'content')) {
            editor.value = selected.content ?? '';
            state.skillsEditorBaseline = editor.value;
        }
        updateSkillsSaveState();
    }

    function renderSkillsList() {
        const list = elements.skillsList;
        if (!list) return;

        const items = filteredSkillsItems();
        list.replaceChildren();

        if (!items.length) {
            const hint = document.createElement('div');
            hint.className = 'skills-empty-hint';
            hint.textContent = state.skillsItems.length
                ? 'No skills match your filter.'
                : 'No skills installed yet. Run npm run hermes:install-skill to add the Aether skill.';
            list.appendChild(hint);
            renderSkillsEditor();
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const skill of items) {
            const row = document.createElement('div');
            row.className = 'skill-row';
            row.classList.toggle('active', skill.name === state.skillsSelectedName);
            row.classList.toggle('is-disabled', !skill.enabled);

            const main = document.createElement('button');
            main.type = 'button';
            main.className = 'skill-row-main';
            main.title = skill.description || skill.displayName || skill.name;

            const nameRow = document.createElement('span');
            nameRow.className = 'skill-row-name-line';

            const name = document.createElement('span');
            name.className = 'skill-row-name';
            name.textContent = skill.displayName || skill.name;

            const badge = document.createElement('span');
            badge.className = `skill-source-badge is-${skill.source || 'local'}`;
            badge.textContent = skill.source === 'hub' && skill.hubSource
                ? skill.hubSource
                : (skill.sourceLabel || 'Custom');

            nameRow.appendChild(name);
            nameRow.appendChild(badge);

            const desc = document.createElement('span');
            desc.className = 'skill-row-desc';
            const descParts = [];
            if (skill.category) descParts.push(skill.category);
            if (skill.description) descParts.push(skill.description);
            else if (skill.name !== (skill.displayName || '')) descParts.push(skill.name);
            desc.textContent = descParts.join(' · ') || skill.name;

            main.appendChild(nameRow);
            main.appendChild(desc);
            main.addEventListener('click', () => selectSkill(skill.name));

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = `skill-toggle${skill.enabled ? ' is-on' : ''}`;
            toggle.title = skill.enabled ? 'Disable skill' : 'Enable skill';
            toggle.setAttribute('aria-label', `${skill.enabled ? 'Disable' : 'Enable'} ${skill.displayName || skill.name}`);
            toggle.setAttribute('aria-pressed', skill.enabled ? 'true' : 'false');
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSkillEnabled(skill.name, !skill.enabled);
            });

            row.appendChild(main);
            row.appendChild(toggle);
            fragment.appendChild(row);
        }

        list.appendChild(fragment);
        renderSkillsEditor();
    }

    async function selectSkill(name, options = {}) {
        const { forceReload = false } = options;
        if (!name) return;
        if (state.skillsSelectedName === name && !forceReload) {
            renderSkillsList();
            return;
        }

        state.skillsSelectedName = name;
        if (elements.skillsEditor) {
            elements.skillsEditor.value = '';
            state.skillsEditorBaseline = '';
        }
        setSkillsStatus('Loading skill…');
        renderSkillsList();

        try {
            const result = await ai.getHermesSkill(name);
            const index = state.skillsItems.findIndex((item) => item.name === name);
            const merged = {
                ...(index >= 0 ? state.skillsItems[index] : {}),
                ...result,
                content: result.content ?? '',
            };
            if (index >= 0) state.skillsItems[index] = merged;
            else state.skillsItems.push(merged);
            setSkillsStatus('');
            renderSkillsList();
        } catch (err) {
            setSkillsStatus(err.message || 'Could not load skill.', true);
        }
    }

    async function toggleSkillEnabled(name, enabled) {
        if (!name) return;
        setSkillsStatus(enabled ? 'Enabling skill…' : 'Disabling skill…');
        try {
            const result = await ai.setHermesSkillEnabled(name, enabled);
            const index = state.skillsItems.findIndex((item) => item.name === name);
            if (index >= 0) {
                state.skillsItems[index] = { ...state.skillsItems[index], ...result };
            }
            setSkillsStatus('');
            renderSkillsList();
            showToast(
                enabled ? 'Skill enabled' : 'Skill disabled',
                `${result.displayName || name} updated in Hermes config.`,
                { durationMs: 4200 }
            );
        } catch (err) {
            setSkillsStatus(err.message || 'Could not update skill.', true);
            showToast('Skill toggle failed', err.message || 'Could not update skill.', { variant: 'error' });
        }
    }

    async function saveSelectedSkill() {
        const selected = getSelectedSkillItem();
        if (!selected || !elements.skillsEditor) return;

        const content = elements.skillsEditor.value;
        if (elements.saveSkillsBtn) elements.saveSkillsBtn.disabled = true;
        setSkillsStatus('Saving skill…');

        try {
            const result = await ai.saveHermesSkill(selected.name, content);
            const index = state.skillsItems.findIndex((item) => item.name === selected.name);
            if (index >= 0) {
                state.skillsItems[index] = { ...state.skillsItems[index], ...result, content: result.content ?? content };
            }
            state.skillsEditorBaseline = content;
            setSkillsStatus('');
            updateSkillsSaveState();
            renderSkillsList();
            showToast('Skill saved', `${result.displayName || selected.name} updated — run /reload-skills in Hermes to apply.`, { durationMs: 4200 });
        } catch (err) {
            setSkillsStatus(err.message || 'Could not save skill.', true);
            showToast('Save failed', err.message || 'Could not save skill.', { variant: 'error' });
            updateSkillsSaveState();
        }
    }

    async function refreshHermesSkills() {
        if (elements.refreshSkillsBtn) {
            elements.refreshSkillsBtn.classList.add('refreshing');
        }
        setSkillsStatus('Loading skills…');
        try {
            const result = await ai.getHermesSkills();
            state.skillsItems = result.items || [];
            state.skillsCounts = result.counts || null;
            state.skillsDir = result.skillsDir || '';
            if (elements.skillsModalPath) {
                const count = state.skillsItems.length;
                const summary = formatSkillsSummary(state.skillsCounts);
                elements.skillsModalPath.textContent = count
                    ? `${count} skill${count === 1 ? '' : 's'}${summary ? ` · ${summary}` : ''}`
                    : (state.skillsDir || 'Skills directory unavailable');
            }
            document.querySelectorAll('[data-skills-filter]').forEach((btn) => {
                const key = btn.getAttribute('data-skills-filter');
                if (!key || key === 'all') return;
                const count = key === 'native'
                    ? state.skillsCounts?.native
                    : state.skillsCounts?.custom;
                if (typeof count === 'number') {
                    const base = key === 'native' ? 'Native' : 'Custom';
                    btn.textContent = `${base} (${count})`;
                }
            });
            if (state.skillsSelectedName && !state.skillsItems.some((item) => item.name === state.skillsSelectedName)) {
                state.skillsSelectedName = '';
            }
            setSkillsStatus('');
            renderSkillsList();
            if (state.skillsSelectedName) {
                await selectSkill(state.skillsSelectedName, { forceReload: true });
            }
        } catch (err) {
            setSkillsStatus(err.message || 'Could not load skills.', true);
            if (elements.skillsList) {
                elements.skillsList.replaceChildren();
                const hint = document.createElement('div');
                hint.className = 'skills-empty-hint';
                hint.textContent = err.message || 'Could not load skills.';
                elements.skillsList.appendChild(hint);
            }
        } finally {
            elements.refreshSkillsBtn?.classList.remove('refreshing');
        }
    }

    function prepareSkillsPanel() {
        if (elements.skillsSearch) elements.skillsSearch.value = '';
        state.skillsFilter = 'all';
        document.querySelectorAll('[data-skills-filter]').forEach((el) => {
            const active = el.getAttribute('data-skills-filter') === 'all';
            el.classList.toggle('active', active);
            el.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        refreshHermesSkills();
    }

    function setKanbanStageStatus(message, isError = false) {
        const el = elements.kanbanStageStatus;
        if (!el) return;
        if (!message) {
            el.hidden = true;
            el.textContent = '';
            el.classList.remove('is-error');
            return;
        }
        el.hidden = false;
        el.textContent = message;
        el.classList.toggle('is-error', !!isError);
    }

    function setKanbanStageLoading(visible, subtext = '') {
        if (elements.kanbanStageLoading) {
            elements.kanbanStageLoading.hidden = !visible;
        }
        if (elements.kanbanSplashSub && subtext) {
            elements.kanbanSplashSub.textContent = subtext;
        }
    }

    function updateKanbanCompanionAffordance(active) {
        const el = elements.hudCoreVisualizer;
        if (!el) return;
        if (active) {
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', 'Talk to Aether');
            el.title = 'Open chat';
        } else {
            el.removeAttribute('role');
            el.removeAttribute('tabindex');
            el.removeAttribute('aria-label');
            el.removeAttribute('title');
        }
    }

    function activateKanbanCompanion() {
        if (!state.kanbanMode) return;

        const chatCollapsed = elements.hudShell?.classList.contains('chat-collapsed');
        if (chatCollapsed) {
            elements.hudShell?.classList.add('kanban-chat-peek');
            expandChatColumn(true);
        }

        if (state.speechEnabled) {
            setSpeechEnabled(true, { announce: false });
            if (!state.isVoiceActive && !state.isVoiceConnecting) {
                startVoiceMode();
            }
        }

        if (!chatCollapsed) {
            runTransitionResizeLoop();
        }
    }

    function updateDashboardSplash(status) {
        const splash = elements.dashboardSplash;
        const textEl = elements.dashboardSplashText;
        if (!splash || !textEl) return;

        if (!status || status.dashboardReachable) {
            splash.hidden = true;
            splash.classList.remove('is-error', 'is-starting');
            return;
        }

        const stateName = status.state || 'stopped';
        if (stateName === 'starting') {
            splash.hidden = false;
            splash.classList.add('is-starting');
            splash.classList.remove('is-error');
            textEl.textContent = status.buildHint
                ? `Building web UI (first run may take a few minutes)…`
                : 'Starting Hermes dashboard…';
            return;
        }

        if (stateName === 'error') {
            splash.hidden = false;
            splash.classList.add('is-error');
            splash.classList.remove('is-starting');
            textEl.textContent = status.error || 'Dashboard failed — click to retry';
            return;
        }

        splash.hidden = true;
        splash.classList.remove('is-error', 'is-starting');
    }

    async function pollDashboardStatus(maxAttempts = 90, intervalMs = 2000) {
        for (let i = 0; i < maxAttempts; i += 1) {
            try {
                const status = await ai.getHermesDashboardStatus();
                state.kanbanDashboardStatus = status;
                updateDashboardSplash(status);
                if (status.dashboardReachable) {
                    if (state.hermesStatus?.enabled) {
                        await syncHermesSessions();
                    }
                    return status;
                }
                if (status.state === 'error') return status;
            } catch {
                /* keep polling */
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        return state.kanbanDashboardStatus;
    }

    async function bootstrapHermesDashboard() {
        if (state.dashboardBootstrapTimer) {
            clearInterval(state.dashboardBootstrapTimer);
            state.dashboardBootstrapTimer = null;
        }

        let status;
        try {
            status = await ai.getHermesDashboardStatus();
        } catch {
            return;
        }

        state.kanbanDashboardStatus = status;
        updateDashboardSplash(status);

        if (status.dashboardReachable) return;

        try {
            await ai.startHermesDashboard();
        } catch {
            /* splash will show error on next poll */
        }

        pollDashboardStatus();
    }

    function scheduleDeferredDashboardBootstrap() {
        const run = () => {
            if (document.hidden) return;
            bootstrapHermesDashboard();
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => setTimeout(run, 4000), { timeout: 20000 });
        } else {
            setTimeout(run, 12000);
        }
    }

    function mountNativeKanbanBoard() {
        if (!elements.kanbanBoardRoot || typeof AetherKanbanBoard !== 'function') return;
        if (state.kanbanBoardInstance) {
            state.kanbanBoardInstance.unmount();
        }
        state.kanbanBoardInstance = new AetherKanbanBoard(ai, {
            root: elements.kanbanBoardRoot,
            drawerRoot: elements.kanbanDrawerRoot,
            board: state.activeKanbanBoard,
            onStatus: (message, isError) => setKanbanStageStatus(message, isError),
            onReady: () => setKanbanStageLoading(false),
        });
        state.kanbanBoardInstance.mount();
    }

    function unmountNativeKanbanBoard() {
        if (state.kanbanBoardInstance) {
            state.kanbanBoardInstance.unmount();
            state.kanbanBoardInstance = null;
        }
        if (elements.kanbanDrawerRoot) {
            elements.kanbanDrawerRoot.hidden = true;
            elements.kanbanDrawerRoot.innerHTML = '';
        }
    }

    async function enterKanbanMode(options = {}) {
        const { restoreOnFailure = false } = options;
        if (state.settingsMode) {
            exitSettingsMode({ fromHash: true });
        }
        if (state.vaultMode) {
            exitVaultMode({ fromHash: true });
        }
        let kanbanReady = false;
        let kanbanHint = 'Run `hermes kanban init` once, then try again.';

        try {
            const boardsResult = await ai.getKanbanBoards();
            kanbanReady = !!boardsResult.available;
            kanbanHint = boardsResult.hint || kanbanHint;
        } catch (e) {
            if (restoreOnFailure) {
                AetherUserData.setItem('aether_kanban_mode', 'false');
                return false;
            }
            setKanbanStageStatus(e.message || 'Could not reach Aether server.', true);
        }

        if (!kanbanReady) {
            setKanbanStageStatus(`Kanban database not found. ${kanbanHint}`, true);
            if (restoreOnFailure) {
                AetherUserData.setItem('aether_kanban_mode', 'false');
                return false;
            }
        } else {
            setKanbanStageStatus('');
        }

        if (state.chatCollapsedBeforeKanban === null) {
            state.chatCollapsedBeforeKanban = elements.hudShell?.classList.contains('chat-collapsed') ?? true;
        }
        elements.hudShell?.classList.remove('kanban-chat-peek');
        collapseChatColumn();

        state.kanbanMode = true;
        AetherUserData.setItem('aether_kanban_mode', 'true');
        elements.hudShell?.classList.add('kanban-mode');
        elements.workspacesDrawerToggle?.classList.add('active');
        if (elements.kanbanStage) {
            elements.kanbanStage.hidden = false;
        }

        setKanbanStageLoading(true, 'Loading Kanban board…');
        updateKanbanCompanionAffordance(true);
        if (typeof visualizer.setPresentationMode === 'function') {
            visualizer.setPresentationMode('kanban');
        }
        if (kanbanReady) {
            mountNativeKanbanBoard();
        } else {
            setKanbanStageLoading(false);
        }
        runTransitionResizeLoop();
        return true;
    }

    function exitKanbanMode() {
        state.kanbanMode = false;
        AetherUserData.setItem('aether_kanban_mode', 'false');
        elements.hudShell?.classList.remove('kanban-mode');
        elements.workspacesDrawerToggle?.classList.remove('active');
        if (elements.kanbanStage) {
            elements.kanbanStage.hidden = true;
        }
        setKanbanStageStatus('');
        setKanbanStageLoading(false);
        unmountNativeKanbanBoard();
        updateKanbanCompanionAffordance(false);
        elements.hudShell?.classList.remove('kanban-chat-peek');

        const restoreCollapsed = state.chatCollapsedBeforeKanban;
        state.chatCollapsedBeforeKanban = null;
        if (restoreCollapsed === false) {
            expandChatColumn(false);
        } else {
            collapseChatColumn();
        }

        if (typeof visualizer.setPresentationMode === 'function') {
            visualizer.setPresentationMode('default');
        }
        runTransitionResizeLoop();
    }

    async function toggleKanbanMode() {
        if (state.kanbanMode) {
            exitKanbanMode();
            return;
        }
        await enterKanbanMode();
    }

    function runTransitionResizeLoop() {
        if (resizeLoopInterval) clearInterval(resizeLoopInterval);
        let elapsed = 0;
        resizeLoopInterval = setInterval(() => {
            if (visualizer && typeof visualizer.resize === 'function') {
                visualizer.resize();
            }
            resizeChatComposerInput();
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
        AetherUserData.setItem('aether_chat_column_collapsed', 'false');
        if (focusInput) {
            elements.deckChatInputField.focus();
        }
        updateMicButtonTitle();
        updateOverlayScrims();
        runTransitionResizeLoop();
        requestAnimationFrame(resizeChatComposerInput);
    }

    function collapseChatColumn() {
        if (state.kanbanMode) {
            elements.hudShell?.classList.remove('kanban-chat-peek');
        }
        elements.hudShell?.classList.add('chat-collapsed');
        elements.chatDeckToggle.classList.remove('active');
        AetherUserData.setItem('aether_chat_column_collapsed', 'true');
        updateMicButtonTitle();
        updateOverlayScrims();
        runTransitionResizeLoop();
    }

    function updateMicButtonTitle() {
        if (!elements.voiceRecognitionBtn || state.isVoiceActive || state.isVoiceConnecting) return;
        const behavior = AetherUserData.getItem('aether_voice_input_behavior') || 'auto';
        const isChatCollapsed = elements.hudShell?.classList.contains('chat-collapsed');
        const cancelHint = ' Tap again while listening to cancel.';

        if (behavior === 'llm' || (behavior === 'auto' && isChatCollapsed)) {
            elements.voiceRecognitionBtn.title =
                `Tap to speak to ${getDisplayName()} (sends when you finish)${cancelHint}`;
        } else {
            elements.voiceRecognitionBtn.title =
                `Tap to speak into chat (review before sending)${cancelHint}`;
        }
    }

    function toggleChatColumn() {
        if (elements.hudShell?.classList.contains('chat-collapsed')) {
            expandChatColumn();
        } else {
            collapseChatColumn();
        }
    }

    function formatAttachmentSize(bytes) {
        const size = Number(bytes) || 0;
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    function getFileExtension(name) {
        const match = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/i);
        return match ? match[1] : '';
    }

    function isTextAttachmentFile(file) {
        if (!file) return false;
        if (file.type.startsWith('text/')) return true;
        if (file.type === 'application/json' || file.type === 'application/xml') return true;
        return TEXT_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name));
    }

    function isImageAttachmentFile(file) {
        if (!file) return false;
        if (file.type.startsWith('image/')) return true;
        return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.avif'].includes(getFileExtension(file.name));
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    function attachmentFileKey(file) {
        return `${file.name}|${file.size}|${file.lastModified ?? 0}`;
    }

    function isDuplicateAttachment(file) {
        const key = attachmentFileKey(file);
        return pendingAttachments.some((att) => att.fileKey === key);
    }

    async function compressImageDataUrl(dataUrl, { maxDimension = 2048, quality = 0.88 } = {}) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                const scale = Math.min(1, maxDimension / Math.max(width, height));
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(dataUrl);
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    async function buildAttachmentFromFile(file) {
        if (!file) throw new Error('Missing file');

        if (isImageAttachmentFile(file)) {
            if (file.size > MAX_ATTACHMENT_BYTES) {
                throw new Error(`${file.name} is too large (max ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)}). Try a smaller image.`);
            }

            let dataUrl = await readFileAsDataUrl(file);
            const compressOpts = file.size > 4 * 1024 * 1024
                ? { maxDimension: 1280, quality: 0.72 }
                : file.size > 1024 * 1024
                    ? { maxDimension: 1600, quality: 0.78 }
                    : file.size > 128 * 1024
                        ? { maxDimension: 2048, quality: 0.85 }
                        : null;

            if (compressOpts) {
                dataUrl = await compressImageDataUrl(dataUrl, compressOpts);
            }

            if (dataUrl.length > MAX_ATTACHMENT_DATA_URL_CHARS) {
                dataUrl = await compressImageDataUrl(dataUrl, { maxDimension: 1024, quality: 0.65 });
            }
            if (dataUrl.length > MAX_ATTACHMENT_DATA_URL_CHARS) {
                throw new Error(`${file.name} is still too large after compression. Try a smaller image.`);
            }

            return {
                id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                fileKey: attachmentFileKey(file),
                name: file.name,
                mimeType: file.type || 'image/jpeg',
                kind: 'image',
                dataUrl,
                size: file.size,
            };
        }

        if (file.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`${file.name} is too large (max ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)})`);
        }

        if (isTextAttachmentFile(file)) {
            const text = await readFileAsText(file);
            return {
                id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                fileKey: attachmentFileKey(file),
                name: file.name,
                mimeType: file.type || 'text/plain',
                kind: 'text',
                text,
                size: file.size,
            };
        }

        throw new Error(`${file.name} isn't supported yet — use images or text files.`);
    }

    function verifyAttachmentUi() {
        if (attachmentUiVerified) return true;
        const missing = [];
        if (!elements.composerFileInput) missing.push('#composerFileInput');
        if (!elements.composerAttachments) missing.push('#composerAttachments');
        if (!elements.composerAttachmentDock) missing.push('#composerAttachmentDock');
        if (missing.length) {
            showToast(
                'Attachment UI unavailable',
                'Hard refresh the page (Cmd+Shift+R) and try again.',
                { variant: 'error', durationMs: 8000 }
            );
            return false;
        }
        attachmentUiVerified = true;
        return true;
    }

    let attachmentIngestBusy = false;

    async function addComposerAttachmentFiles(fileList) {
        if (!verifyAttachmentUi()) return;
        const files = Array.from(fileList || []);
        if (!files.length) return;

        if (attachmentIngestBusy) return;
        attachmentIngestBusy = true;

        if (elements.hudShell?.classList.contains('chat-collapsed')) {
            expandChatColumn(false);
        }

        let addedCount = 0;
        try {
            for (const file of files) {
                if (pendingAttachments.length >= MAX_CHAT_ATTACHMENTS) {
                    showToast(
                        'Attachment limit reached',
                        `You can attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`,
                        { variant: 'warning', durationMs: 4200 }
                    );
                    break;
                }
                if (isDuplicateAttachment(file)) {
                    continue;
                }

                const fileKey = attachmentFileKey(file);
                const placeholderId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                pendingAttachments.push({
                    id: placeholderId,
                    fileKey,
                    name: file.name,
                    size: file.size,
                    kind: 'loading',
                    status: 'loading',
                });
                renderComposerAttachments();

                try {
                    const attachment = await buildAttachmentFromFile(file);
                    const idx = pendingAttachments.findIndex((att) => att.id === placeholderId);
                    if (idx !== -1) {
                        pendingAttachments[idx] = { ...attachment, status: 'ready' };
                        addedCount += 1;
                    }
                } catch (err) {
                    pendingAttachments = pendingAttachments.filter((att) => att.id !== placeholderId);
                    showToast(
                        'Could not attach file',
                        err.message || `Could not attach ${file.name}.`,
                        { variant: 'error', durationMs: 5200 }
                    );
                }
                renderComposerAttachments();
            }
        } finally {
            attachmentIngestBusy = false;
        }

        if (addedCount > 0) {
            const lastReady = [...pendingAttachments].reverse().find((att) => att.status === 'ready');
            if (lastReady) {
                showToast('Attachment added', `${lastReady.name} ready to send`, { durationMs: 2200 });
            }
        }
        elements.deckChatInputField?.focus();
    }

    function removeComposerAttachment(id) {
        pendingAttachments = pendingAttachments.filter((att) => att.id !== id);
        renderComposerAttachments();
    }

    function clearComposerAttachments() {
        pendingAttachments = [];
        renderComposerAttachments();
    }

    function renderComposerAttachments() {
        const container = elements.composerAttachments;
        const dock = elements.composerAttachmentDock;
        const countEl = elements.composerAttachmentCount;
        if (!container || !dock) return;

        const items = pendingAttachments;
        const hasItems = items.length > 0;
        dock.hidden = !hasItems;
        if (countEl) countEl.textContent = String(items.length);

        container.replaceChildren();
        if (!hasItems) return;

        for (const att of items) {
            const isLoading = att.status === 'loading' || att.kind === 'loading';
            const card = document.createElement('div');
            card.className = `composer-attachment-card composer-attachment-card-${isLoading ? 'loading' : att.kind}`;

            if (!isLoading) {
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'composer-attachment-remove';
                removeBtn.title = `Remove ${att.name}`;
                removeBtn.setAttribute('aria-label', `Remove ${att.name}`);
                removeBtn.innerHTML = '<i data-lucide="x"></i>';
                removeBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    removeComposerAttachment(att.id);
                });
                card.appendChild(removeBtn);
            }

            if (isLoading) {
                const loadingBody = document.createElement('div');
                loadingBody.className = 'composer-attachment-loading';
                loadingBody.textContent = 'Reading…';
                card.appendChild(loadingBody);
            } else if (att.kind === 'image' && att.dataUrl) {
                const img = document.createElement('img');
                img.className = 'composer-attachment-preview-image';
                img.src = att.dataUrl;
                img.alt = att.name;
                card.appendChild(img);
            } else {
                const fileBody = document.createElement('div');
                fileBody.className = 'composer-attachment-file-body';

                const icon = document.createElement('span');
                icon.className = 'composer-attachment-file-icon';
                icon.innerHTML = '<i data-lucide="file-text"></i>';
                fileBody.appendChild(icon);

                if (att.kind === 'text' && att.text) {
                    const snippet = document.createElement('span');
                    snippet.className = 'composer-attachment-text-snippet';
                    const previewText = String(att.text).trim();
                    snippet.textContent = previewText.slice(0, 48) + (previewText.length > 48 ? '…' : '');
                    fileBody.appendChild(snippet);
                }

                card.appendChild(fileBody);
            }

            const caption = document.createElement('div');
            caption.className = 'composer-attachment-caption';
            caption.textContent = att.name;
            caption.title = `${att.name} · ${formatAttachmentSize(att.size)}`;
            card.appendChild(caption);

            container.appendChild(card);
        }

        refreshBubbleIcons(container);
        requestAnimationFrame(() => {
            container.scrollLeft = container.scrollWidth;
            dock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    }

    function setChatDropActive(active) {
        elements.chatColumn?.classList.toggle('chat-drop-active', active);
    }

    function setupChatDropZone() {
        const dropTarget = elements.chatColumn;
        if (!dropTarget) return;

        const dragTargets = [
            elements.chatColumn,
            elements.deckChatScroller,
            elements.chatComposerBox,
            elements.composerAttachmentDock,
        ].filter(Boolean);

        const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

        const onDragEnter = (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            chatDropDepth += 1;
            setChatDropActive(true);
        };

        const onDragOver = (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setChatDropActive(true);
        };

        const onDragLeave = (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            chatDropDepth = Math.max(0, chatDropDepth - 1);
            if (chatDropDepth === 0) setChatDropActive(false);
        };

        const onDrop = async (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.stopPropagation();
            chatDropDepth = 0;
            setChatDropActive(false);
            if (event.dataTransfer?.files?.length) {
                await addComposerAttachmentFiles(event.dataTransfer.files);
            }
        };

        for (const target of dragTargets) {
            target.addEventListener('dragenter', onDragEnter);
            target.addEventListener('dragover', onDragOver);
            target.addEventListener('dragleave', onDragLeave);
        }

        dropTarget.addEventListener('drop', onDrop);
    }

    function serializeAttachmentsForSession(attachments) {
        return (attachments || []).map((att) => ({
            id: att.id,
            name: att.name,
            mimeType: att.mimeType,
            kind: att.kind,
            size: att.size,
            dataUrl: att.kind === 'image' ? att.dataUrl : undefined,
            text: att.kind === 'text' ? att.text : undefined,
        }));
    }

    function cloneAttachmentsForSend(attachments) {
        return serializeAttachmentsForSession(
            (attachments || []).filter((att) => att.status !== 'loading' && att.kind !== 'loading')
        );
    }

    async function submitDirectTextCommand(text, attachments = []) {
        const trimmedText = String(text || '').trim();
        const outgoingAttachments = cloneAttachmentsForSend(attachments);
        if (!trimmedText && !outgoingAttachments.length) return;

        await waitForPageReturnRefresh();

        // Stop currently playing synthesis
        speech.stopSpeaking();
        setVoiceOutputSpeaking(false);
        visualizer.setState('idle');

        // Render input in diagnostic terminal logs and chat deck bubble
        const userDisplayText = trimmedText || '(attachment)';
        appendSystemConsoleLine(`[USER] &gt; ${userDisplayText}${outgoingAttachments.length ? ` [${outgoingAttachments.length} file${outgoingAttachments.length === 1 ? '' : 's'}]` : ''}`);
        appendUserChatBubble(trimmedText, outgoingAttachments, state.activeWorkspacePath || null);
        saveMessageToSession('user', trimmedText, { attachments: serializeAttachmentsForSession(outgoingAttachments) });

        // Spawn thinking state animations
        visualizer.setState('thinking');
        setChatInFlight(true);

        // Create placeholders in both logs
        const consoleLogNode = appendSystemConsoleLine(`[AETHER] ...`);
        const bubbleNode = appendAssistantChatBubble('...');
        bubbleNode._toolTimeline = [];
        setAssistantBubbleToolPreview(bubbleNode, { name: '_thinking', label: 'Thinking…', status: 'thinking' });
        visualizer.setThinkingCaption('Thinking…');

        const messageForAi = buildMessageWithWorkspaceContext(trimmedText);

        setChatInFlight(true);
        try {
            const activeSession = getActiveSession();
            const history = activeSession ? activeSession.messages : [];
            if (state.hermesStatus?.enabled) {
                appendSystemConsoleLine(
                    state.hermesStatus.connected
                        ? `[AGENT] Routing command through Hermes${getHermesBridgeSessionId(activeSession) ? ` session ${String(getHermesBridgeSessionId(activeSession)).slice(0, 18)}` : ''}.`
                        : '[AGENT] Hermes mode is enabled, but the bridge is offline. Attempting request for latest status.'
                );
            }

            // Query cognitive engine
            const aiResponse = await ai.getResponse(
                messageForAi,
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
                    sessionId: getHermesBridgeSessionId(activeSession) || activeSession?.id,
                    hermesProfile: activeSession?.hermesProfile || state.activeHermesProfile,
                    attachments: outgoingAttachments,
                    onToolProgress: (toolInfo) => {
                        appendToolTimelineEntry(bubbleNode, toolInfo);
                        setAssistantBubbleToolPreview(bubbleNode, toolInfo);
                        const label = typeof toolInfo === 'object' && toolInfo?.label
                            ? toolInfo.label
                            : String(toolInfo?.name || toolInfo || '');
                        if (toolInfo?.status === 'thinking') {
                            visualizer.setThinkingCaption(`${label}…`);
                        } else {
                            visualizer.setThinkingCaption(`Running ${label}…`);
                            visualizer.triggerThinkingToolBurst(toolInfo?.name || toolInfo);
                        }
                    },
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

            const replayState = { id: null };
            clearAssistantBubbleToolPreview(bubbleNode);
            await streamResponseText(consoleLogNode, bubbleNode, responseText, replayState);
            saveMessageToSession('assistant', responseText, {
                ...responseMeta,
                audioReplayId: replayState.id,
            });

            const sessionForReplay = getActiveSession();
            if (sessionForReplay?.messages?.length) {
                tagAssistantBubbleMessageIndex(
                    bubbleNode,
                    sessionForReplay.messages.length - 1
                );
            }
            syncReplayButtonsForSession();

            if (state.vaultMode) {
                refreshVault({ ingest: true, showLoading: false });
            }

        } catch (err) {
            const backgroundInterrupted = state.chatInterruptedByBackground;
            state.chatInterruptedByBackground = false;

            if (AIEngine.isAbortError(err)) {
                if (state.chatStopRequested) {
                    state.chatStopRequested = false;
                    consoleLogNode.innerHTML = '<span style="color:var(--muted);">[AETHER] Stopped.</span>';
                    const stoppedContent = ensureAssistantBubbleStructure(bubbleNode);
                    if (stoppedContent) stoppedContent.textContent = '[Stopped]';
                    clearAssistantBubbleToolPreview(bubbleNode);
                    return;
                }
            }

            const backgroundNetworkFailure = backgroundInterrupted
                && (AIEngine.isAbortError(err) || AIEngine.isTransientNetworkError(err));
            if (backgroundNetworkFailure || (AIEngine.isAbortError(err) && document.hidden)) {
                console.warn('[AETHER] Chat request interrupted (tab backgrounded).', err);
                consoleLogNode.innerHTML = '<span style="color:var(--muted);">[AETHER] Request interrupted — tab was in background.</span>';
                const interruptedContent = ensureAssistantBubbleStructure(bubbleNode);
                if (interruptedContent) {
                    interruptedContent.textContent =
                        'Response interrupted while this tab was in the background. Hermes may still have finished — check session history or resend.';
                }
                clearAssistantBubbleToolPreview(bubbleNode);
                return;
            }

            console.error("Aether telemetry failure: ", err);
            const errMsg = `[AETHER ERROR] Telemetry routing failed. Error: ${err.message}`;
            consoleLogNode.innerHTML = `<span style="color:var(--error);">${errMsg}</span>`;
            const errorContent = ensureAssistantBubbleStructure(bubbleNode);
            if (errorContent) {
                errorContent.textContent = err.message || 'Request failed';
            }
            clearAssistantBubbleToolPreview(bubbleNode);
            showToast('Request failed', err.message || 'Could not reach Aether.', {
                variant: 'error',
                durationMs: 5200,
            });
        } finally {
            setChatInFlight(false);
            visualizer.setState('idle');
        }
    }

    function showToast(title, message = '', options = {}) {
        const stack = elements.toastStack;
        if (!stack || !title) return null;

        const {
            variant = 'info',
            durationMs = 4200,
        } = options;

        const toast = document.createElement('div');
        toast.className = `toast ${variant}`;
        toast.setAttribute('role', 'status');

        const iconName = variant === 'error'
            ? 'alert-circle'
            : variant === 'warning'
                ? 'alert-triangle'
                : 'sparkles';

        toast.innerHTML = `
            <i data-lucide="${iconName}" class="toast-icon" aria-hidden="true"></i>
            <div class="toast-body">
                <div class="toast-title">${escapeHtml(title)}</div>
                ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
            </div>
        `;

        stack.appendChild(toast);
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [toast] });

        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        const hideTimer = window.setTimeout(() => {
            toast.classList.add('hiding');
            toast.classList.remove('visible');
            window.setTimeout(() => toast.remove(), 240);
        }, durationMs);

        toast.addEventListener('click', () => {
            window.clearTimeout(hideTimer);
            toast.classList.add('hiding');
            toast.classList.remove('visible');
            window.setTimeout(() => toast.remove(), 240);
        });

        return toast;
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
        if (!hermes) return;

        const hermesSessionId = hermes.sessionId || hermes.conversationId || null;
        let sessionIndex = state.aetherSessions.findIndex((s) => s.id === state.activeSessionId);
        if (sessionIndex === -1) {
            sessionIndex = archiveEphemeralSession();
        }

        if (sessionIndex === -1) {
            const hermesSession = findHermesSession(state.activeSessionId);
            if (!hermesSession) return;
            if (hermesSessionId) {
                hermesSession.hermesSessionId = hermesSessionId;
                state.lastHermesSessionId = hermesSessionId;
                AetherUserData.setItem('aether_last_hermes_session_id', hermesSessionId);
            }
            hermesSession.source = 'hermes';
            hermesSession.hermesProfile = hermes.profile || state.activeHermesProfile || null;
            hermesSession.hermesUpdatedAt = new Date().toISOString();
            if (!hermesSession.startedAt) {
                hermesSession.startedAt = hermesSession.hermesUpdatedAt;
            }
            scheduleRenderHistorySessions();
            return;
        }

        if (hermesSessionId) {
            state.aetherSessions[sessionIndex].hermesSessionId = hermesSessionId;
            state.lastHermesSessionId = hermesSessionId;
            AetherUserData.setItem('aether_last_hermes_session_id', hermesSessionId);
        }

        state.aetherSessions[sessionIndex].source = state.aetherSessions[sessionIndex].source || 'local';
        state.aetherSessions[sessionIndex].hermesProfile = hermes.profile || state.activeHermesProfile || null;
        state.aetherSessions[sessionIndex].hermesUpdatedAt = new Date().toISOString();
        if (!state.aetherSessions[sessionIndex].startedAt) {
            state.aetherSessions[sessionIndex].startedAt = state.aetherSessions[sessionIndex].hermesUpdatedAt;
        }
        schedulePersistSessions();
        scheduleRenderHistorySessions();
    }

    function getTtsReplayCacheLimit() {
        const raw = parseInt(AetherUserData.getItem('aether_tts_replay_cache_size') || '5', 10);
        if (!Number.isFinite(raw)) return 5;
        return Math.min(20, Math.max(1, raw));
    }

    function ensureAssistantBubbleRow(bubbleNode) {
        if (!bubbleNode) return null;
        const existing = bubbleNode.closest('.assistant-bubble-row');
        if (existing) return existing;
        const row = document.createElement('div');
        row.className = 'chat-bubble-row assistant-bubble-row';
        const parent = bubbleNode.parentNode;
        if (!parent) return null;
        parent.insertBefore(row, bubbleNode);
        row.appendChild(bubbleNode);
        return row;
    }

    function tagAssistantBubbleMessageIndex(bubbleNode, messageIndex) {
        const row = ensureAssistantBubbleRow(bubbleNode);
        if (row && Number.isFinite(messageIndex)) {
            row.dataset.messageIndex = String(messageIndex);
        }
    }

    function syncReplayButtonsForSession() {
        const session = getActiveSession();
        if (!session || !elements.deckChatScroller) return;

        const limit = getTtsReplayCacheLimit();
        const eligibleIndices = new Set(
            session.messages
                .map((m, i) => ({ m, i }))
                .filter(({ m }) => m.role === 'assistant')
                .slice(-limit)
                .map(({ i }) => i)
        );

        elements.deckChatScroller.querySelectorAll('.assistant-bubble-row').forEach((row) => {
            const idx = parseInt(row.dataset.messageIndex, 10);
            const btn = row.querySelector('.replay-tts-btn');
            if (!Number.isFinite(idx) || !eligibleIndices.has(idx)) {
                if (btn) btn.remove();
                return;
            }

            const msg = session.messages[idx];
            if (!msg || msg.role !== 'assistant') return;

            const bubble = row.querySelector('.chat-bubble.assistant-bubble');
            if (!bubble) return;

            if (msg.audioReplayId || msg.content) {
                attachReplayButton(bubble, msg.audioReplayId || '', msg.content);
            }
        });
    }

    function attachReplayButton(bubbleNode, replayId, fallbackText) {
        if (!bubbleNode || (!replayId && !fallbackText)) return;
        const row = ensureAssistantBubbleRow(bubbleNode);
        if (!row) return;

        const footer = bubbleNode.querySelector('.bubble-footer') || createBubbleFooter();
        if (!footer.parentNode) {
            bubbleNode.appendChild(footer);
        }

        row.querySelectorAll(':scope > .replay-tts-btn').forEach((outsideBtn) => outsideBtn.remove());

        let btn = footer.querySelector('.replay-tts-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'replay-tts-btn';
            btn.title = 'Replay spoken audio';
            btn.innerHTML = '<i data-lucide="volume-2" style="width:14px;height:14px;"></i>';
            footer.prepend(btn);
        }

        btn.dataset.replayId = replayId;
        btn.dataset.fallbackText = fallbackText || '';
            btn.onclick = (e) => {
            e.stopPropagation();
            visualizer.setState('speaking');
            visualizer.startSpeechMouthCue(btn.dataset.fallbackText || '');
            visualizer.markSpeechPlaybackStarted();
            beginVoiceOutputPlayback();
            speech.replayById(btn.dataset.replayId, btn.dataset.fallbackText || null, () => {
                visualizer.stopSpeechMouthCue();
                visualizer.enterPostTalk();
                setVoiceOutputSpeaking(false);
            });
        };

        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ root: bubbleNode });
        }
    }

    /**
     * Typewriter streaming logic to render text directly into terminal element
     */
    function streamResponseText(logNode, bubbleNode, fullText, replayState = null) {
        return new Promise((resolve) => {
            logNode.innerHTML = `<span style="color:#ffffff; font-weight:bold;">[HERMES:${hermesProfileLabel().toUpperCase()}]</span> `;

            const textSpan = document.createElement('span');
            const cursorSpan = document.createElement('span');
            cursorSpan.className = 'typing-cursor';

            logNode.appendChild(textSpan);
            logNode.appendChild(cursorSpan);

            ensureAssistantBubbleRow(bubbleNode);

            const contentEl = ensureAssistantBubbleStructure(bubbleNode);
            contentEl.replaceChildren();
            const bubbleText = document.createElement('div');
            bubbleText.className = 'assistant-stream-body';
            const bubbleCursor = document.createElement('span');
            bubbleCursor.className = 'typing-cursor';
            contentEl.appendChild(bubbleText);
            contentEl.appendChild(bubbleCursor);

            scrollConsoleBottom();
            elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;

            const speakableText = prepareSpeechText(fullText);
            const onReplayId = replayState
                ? (id) => {
                      replayState.id = id;
                  }
                : null;

            if (speech.speechEnabled && speakableText.length > 0) {
                visualizer.setState('speaking');
                visualizer.startSpeechMouthCue(speakableText);
                visualizer.markSpeechPlaybackStarted();
                beginVoiceOutputPlayback();
            }
            speech.speak(
                speakableText,
                null,
                (event) => visualizer.handleSpeechBoundary(event),
                () => {
                    visualizer.stopSpeechMouthCue();
                    visualizer.enterPostTalk();
                    setVoiceOutputSpeaking(false);
                },
                { onReplayId }
            );

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
                    if (visualizer.state === 'thinking') {
                        visualizer.setState('idle');
                    }
                    resolve();
                }
            }, intervalTime);
        });
    }

    function prepareSpeechText(text) {
        return String(text || '')
            .replace(/```[\s\S]*?```/g, 'I have included a code block in the chat.')
            .replace(/\[(AGENT|SYSTEM|TASK TELEMETRY|MEMORY BANK)\][^\n]*/g, '')
            .replace(/(?:\*\*|`)??MEDIA:\s*(?:https?:\/\/\S+|~\/\S+|\/\S+|[A-Za-z]:[/\\]\S+)(?:\*\*|`)??/gi, '')
            .trim();
    }

    function scrollConsoleBottom() {
        elements.consoleScroller.scrollTop = elements.consoleScroller.scrollHeight;
    }

    /* ==========================================================================
       C. Native Web Voice Mode Control
       ========================================================================== */
    function toggleVoiceMode() {
        if (state.isVoiceActive || state.isVoiceConnecting) {
            requestStopVoiceMode();
        } else {
            startVoiceMode();
        }
    }

    function syncMicButtonUi() {
        const btn = elements.voiceRecognitionBtn;
        if (!btn) return;

        const connecting = state.isVoiceConnecting;
        const listening = state.isVoiceActive;
        btn.classList.toggle('is-listening', listening);
        btn.classList.toggle('is-connecting', connecting && !listening);
        btn.classList.toggle('is-off', !listening && !connecting);
        btn.setAttribute('aria-pressed', listening ? 'true' : 'false');
        btn.setAttribute(
            'aria-label',
            listening
                ? 'Listening — tap to stop'
                : (connecting ? 'Starting microphone' : 'Tap to speak'),
        );

        const label = btn.querySelector('.hud-voice-input-label');
        if (label) {
            if (listening) label.textContent = 'Listening';
            else if (connecting) label.textContent = 'Starting';
            else label.textContent = 'Speak';
        }

        const icon = btn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', listening ? 'audio-lines' : 'mic');
        }

        if (listening) {
            btn.title = 'Listening… tap again to stop and send';
        } else if (connecting) {
            btn.title = 'Starting microphone…';
        } else {
            updateMicButtonTitle();
        }

        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ root: btn });
        }
    }

    function getVoiceTranscriptText() {
        const finals = state.voiceTranscriptParts.join(' ').trim();
        const interim = String(state.voiceInterimTranscript || '').trim();
        return (finals && interim) ? `${finals} ${interim}`.trim() : (finals || interim);
    }

    function clearVoiceTranscriptState() {
        state.voiceTranscriptParts = [];
        state.voiceInterimTranscript = '';
    }

    function deliverVoiceTranscript(transcript) {
        const trimmed = String(transcript || '').trim();
        if (!trimmed) {
            showToast('No speech detected', 'Tap Speak and try again.', { durationMs: 2600 });
            return;
        }

        appendSystemConsoleLine(`[VOICE] Transcribed: "${trimmed}"`);

        const behavior = AetherUserData.getItem('aether_voice_input_behavior') || 'auto';
        const isChatCollapsed = elements.hudShell?.classList.contains('chat-collapsed');

        if (behavior === 'llm' || (behavior === 'auto' && isChatCollapsed)) {
            submitDirectTextCommand(trimmed);
        } else {
            if (isChatCollapsed) {
                expandChatColumn();
            }
            const currentVal = elements.deckChatInputField.value.trim();
            if (currentVal) {
                elements.deckChatInputField.value = `${currentVal} ${trimmed}`;
            } else {
                elements.deckChatInputField.value = trimmed;
            }
            elements.deckChatInputField.focus();
            resizeChatComposerInput();
            appendSystemConsoleLine('[SYSTEM] Transcribed text inserted into chat composer.');
        }
    }

    function finishVoiceSession(sessionId, { cancelled = false, error = '' } = {}) {
        if (sessionId !== state.voiceSessionId) return;
        state.voiceSessionId += 1;

        const transcript = getVoiceTranscriptText();
        clearVoiceTranscriptState();

        state.voiceListenSession = null;
        state.isVoiceActive = false;
        state.isVoiceConnecting = false;
        syncMicButtonUi();

        if (visualizer.state === 'listening') {
            visualizer.setState('idle');
        }

        const err = String(error || '');
        if (err && err !== 'aborted') {
            if (err === 'no-speech') {
                showToast('No speech detected', 'Tap Speak and try again.', { durationMs: 2600 });
            } else if (err === 'not-allowed') {
                showToast('Microphone blocked', 'Allow mic access for this site in browser settings.', {
                    variant: 'error',
                    durationMs: 4200,
                });
            } else if (err !== 'unsupported') {
                appendSystemConsoleLine(`[VOICE ERROR] Capture failed: ${err}`);
                showToast('Voice input failed', err, { variant: 'error', durationMs: 3200 });
            }
            return;
        }

        if (cancelled) {
            if (transcript) appendSystemConsoleLine('[VOICE] Listening cancelled.');
            return;
        }

        deliverVoiceTranscript(transcript);
    }

    function requestStopVoiceMode() {
        if (!state.isVoiceActive && !state.isVoiceConnecting) return;
        speech.stopListening();
    }

    function startVoiceMode() {
        const sessionId = state.voiceSessionId + 1;
        state.voiceSessionId = sessionId;
        state.isVoiceConnecting = true;
        state.isVoiceActive = false;
        clearVoiceTranscriptState();
        syncMicButtonUi();

        speech.stopSpeaking();
        setVoiceOutputSpeaking(false);

        appendSystemConsoleLine('[VOICE] Activating speech recognition telemetries...');

        const listenSession = speech.startListening({
            onStart: () => {
                if (sessionId !== state.voiceSessionId) return;
                state.isVoiceConnecting = false;
                state.isVoiceActive = true;
                syncMicButtonUi();
                visualizer.setState('listening');
                appendSystemConsoleLine('[VOICE] Microphone connected. Listening…');
            },
            onFinal: (chunk) => {
                if (sessionId !== state.voiceSessionId) return;
                const piece = String(chunk || '').trim();
                if (piece) state.voiceTranscriptParts.push(piece);
            },
            onInterim: (interim) => {
                if (sessionId !== state.voiceSessionId) return;
                state.voiceInterimTranscript = interim || '';
            },
            onEnd: () => {
                finishVoiceSession(sessionId);
            },
            onError: (err) => {
                if (sessionId !== state.voiceSessionId) return;
                const code = String(err || '');
                if (code === 'aborted') {
                    finishVoiceSession(sessionId, { cancelled: true });
                    return;
                }
                finishVoiceSession(sessionId, { error: code });
            },
        });
        state.voiceListenSession = listenSession;

        if (listenSession === null) {
            finishVoiceSession(sessionId, { error: 'unsupported' });
        }
    }

    function stopVoiceMode() {
        requestStopVoiceMode();
    }

    function syncSpeechToggleUi() {
        const enabled = state.speechEnabled;
        const speaking = state.isVoiceOutputSpeaking;
        const btn = elements.speechSynthesisToggle;
        if (btn) {
            btn.classList.toggle('is-on', enabled);
            btn.classList.toggle('is-off', !enabled);
            btn.classList.toggle('is-speaking', speaking);
            btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');

            const icon = btn.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', speaking ? 'audio-lines' : (enabled ? 'volume-2' : 'volume-x'));
            }

            const label = btn.querySelector('.hud-voice-reply-label');
            if (label) {
                label.textContent = speaking ? 'Speaking' : (enabled ? 'Voice' : 'Text only');
            }

            btn.title = speaking
                ? 'Speaking…'
                : (enabled ? 'Voice replies on' : 'No voice replies — text only');
        }

        if (elements.voiceRepliesToggle) {
            elements.voiceRepliesToggle.classList.toggle('is-on', enabled);
            elements.voiceRepliesToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            elements.voiceRepliesToggle.setAttribute(
                'aria-label',
                enabled ? 'Voice replies on' : 'Voice replies off — text only'
            );
        }

        if (elements.voiceRepliesHint) {
            elements.voiceRepliesHint.textContent = enabled
                ? 'Assistant replies are spoken aloud.'
                : 'Text-only mode — no voice synthesis or ElevenLabs credits used.';
        }

        if (!enabled) {
            syncReplayButtonsForSession();
        }

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    function beginVoiceOutputPlayback() {
        setVoiceOutputSpeaking(true);
    }

    function setVoiceOutputSpeaking(isActive) {
        state.isVoiceOutputSpeaking = Boolean(isActive);
        syncSpeechToggleUi();
    }

    function setSpeechEnabled(enabled, { announce = true } = {}) {
        state.speechEnabled = Boolean(enabled);
        AetherUserData.setItem('aether_speech_enabled', state.speechEnabled);
        speech.speechEnabled = state.speechEnabled;
        syncSpeechToggleUi();

        if (!state.speechEnabled) {
            speech.stopSpeaking();
            setVoiceOutputSpeaking(false);
            visualizer.stopSpeechMouthCue();
            if (visualizer.state === 'speaking') {
                visualizer.setState('idle');
            }
            if (announce) {
                appendSystemConsoleLine('[SYSTEM] Text-only mode — voice replies disabled.');
            }
            return;
        }

        syncReplayButtonsForSession();
        if (announce) {
            appendSystemConsoleLine('[SYSTEM] Voice replies enabled.');
        }
    }

    function toggleSpeechOutput() {
        setSpeechEnabled(!state.speechEnabled);
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

        applyAccentCssVars(theme);
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
        AetherUserData.setItem('aether_accent_theme', themeId);

        applyAccentTheme(themeId);
    }

    function clearGlobalAccentOverrides() {
        document.documentElement.removeAttribute('data-accent-theme');
        for (const prop of [
            '--accent-primary',
            '--accent-secondary',
            '--accent-glow',
            '--accent-glow-subtle',
            '--border-glow',
        ]) {
            document.documentElement.style.removeProperty(prop);
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
        // Always keep the active session (if any) regardless of position
        const activeId = state?.activeSessionId || AetherUserData?.getItem?.('aether_active_session_id');
        const activeSession = activeId ? sessions.find(s => s.id === activeId) : null;

        let pruned = sessions.slice(0, MAX_SESSIONS).map((s) => ({
            ...s,
            messages: (s.messages || []).slice(-MAX_MESSAGES_PER_SESSION).map((m) => {
                let next = { ...m };
                if (typeof next.content === 'string' && next.content.length > MAX_MESSAGE_CHARS) {
                    next = {
                        ...next,
                        content: next.content.slice(0, MAX_MESSAGE_CHARS),
                        truncated: true,
                    };
                }
                if (Array.isArray(next.attachments)) {
                    next.attachments = next.attachments.map((att) => {
                        const slim = {
                            id: att.id,
                            name: att.name,
                            mimeType: att.mimeType,
                            kind: att.kind,
                            size: att.size,
                        };
                        if (att.kind === 'image' && att.dataUrl && att.dataUrl.length <= 120000) {
                            slim.dataUrl = att.dataUrl;
                        }
                        if (att.kind === 'text' && att.text && att.text.length <= 8000) {
                            slim.text = att.text;
                        }
                        return slim;
                    });
                }
                return next;
            }),
        }));

        // If active session was outside the top-40 slice, append it
        if (activeSession && !pruned.find(s => s.id === activeSession.id)) {
            pruned.push(activeSession);
        }

        return pruned;
    }

    function flushPersistSessions() {
        persistSessionsTimer = null;
        const run = () => {
            state.aetherSessions = pruneSessions(
                state.aetherSessions.filter(isAetherHudSession)
            );
            try {
                AetherUserData.setItem('aether_sessions', JSON.stringify(state.aetherSessions));
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

    function getActiveSession() {
        const aether = findAetherSession(state.activeSessionId);
        if (aether) return aether;
        const hermes = findHermesSession(state.activeSessionId);
        if (hermes) return hermes;
        if (ephemeralSession && ephemeralSession.id === state.activeSessionId) return ephemeralSession;
        return null;
    }

    function clearEphemeralSession() {
        ephemeralSession = null;
    }

    function archiveEphemeralSession() {
        if (!ephemeralSession || ephemeralSession.id !== state.activeSessionId) return -1;
        const existingIndex = state.aetherSessions.findIndex((s) => s.id === ephemeralSession.id);
        if (existingIndex >= 0) {
            ephemeralSession = null;
            return existingIndex;
        }
        state.aetherSessions.unshift(ephemeralSession);
        ephemeralSession = null;
        return 0;
    }

    function startNewSession({ ephemeral = false, silent = false } = {}) {
        clearEphemeralSession();
        const id = 'sess_' + Date.now();
        const newSession = {
            id: id,
            title: `Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            profile: '',
            source: state.hermesStatus?.connected ? 'hermes' : 'local',
            hermesProfile: state.activeHermesProfile || state.hermesStatus?.profile || null,
            hermesUpdatedAt: null,
            startedAt: new Date().toISOString(),
            messages: [],
        };

        state.activeSessionId = id;
        state.lastHermesSessionId = null;

        AetherUserData.setItem('aether_active_session_id', id);
        AetherUserData.removeItem('aether_last_hermes_session_id');

        if (ephemeral) {
            ephemeralSession = newSession;
        } else {
            state.aetherSessions.unshift(newSession);
            schedulePersistSessions();
        }

        // Wipe logs
        elements.consoleScroller.innerHTML = `<div class="console-log-line system-line">[SYSTEM] Client connection active. Telemetries initialized.</div>
        <div class="console-log-line">${getWelcomeConsoleMessage()}</div>`;

        elements.deckChatScroller.innerHTML = '';
        if (!silent) {
            appendAssistantChatBubble('New session started. Awaiting inputs…');
        }

        activateChatHistoryTab('aether');
        speech.stopSpeaking();
        setVoiceOutputSpeaking(false);
        scheduleRenderHistorySessions();
    }

    async function loadSession(sessionId, { silent = false } = {}) {
        clearEphemeralSession();
        const isHermesId = (id) => id && !String(id).startsWith('sess_');

        let session = findAetherSession(sessionId) || findHermesSession(sessionId);

        // Hermes-only: fetch from state.db into in-memory cache, not SQL archive
        if (!session && isHermesId(sessionId) && ai) {
            console.warn(`[loadSession] Session "${sessionId}" not cached, fetching from Hermes state.db...`);
            try {
                const msgs = await ai.getHermesSessionMessages(sessionId);
                const freshMessages = (msgs.available && Array.isArray(msgs.messages))
                    ? normalizeHermesMessages(msgs.messages) : [];

                session = normalizeHermesSession({
                    id: sessionId,
                    title: `Session ${sessionId.slice(0, 8)}`,
                    messages: freshMessages,
                });
                const existingIdx = state.hermesSessions.findIndex((s) => s.id === sessionId);
                if (existingIdx >= 0) {
                    state.hermesSessions[existingIdx] = {
                        ...state.hermesSessions[existingIdx],
                        ...session,
                        messages: freshMessages,
                    };
                    session = state.hermesSessions[existingIdx];
                } else {
                    state.hermesSessions.unshift(session);
                }
                console.log(`[loadSession] Cached Hermes session "${sessionId}" with ${freshMessages.length} messages`);
            } catch (e) {
                console.warn('[loadSession] Failed to fetch session from state.db:', e);
                startNewSession({ ephemeral: true });
                return;
            }
        }

        if (!session) {
            console.warn(
                `[loadSession] Session not found: "${sessionId}" — aether:`,
                state.aetherSessions.map((s) => s.id).slice(0, 5),
                'hermes:',
                state.hermesSessions.map((s) => s.id).slice(0, 5)
            );
            startNewSession({ ephemeral: true });
            return;
        }

        const loadId = session.aetherArchiveId || session.id;
        state.activeSessionId = loadId;
        AetherUserData.setItem('aether_active_session_id', loadId);
        updateHermesProfileBadge();

        const inAetherArchive = !!findAetherSession(loadId);

        // For Hermes-linked sessions, fetch latest messages from state.db
        const hermesFetchId = getHermesBridgeSessionId(session);
        if (hermesFetchId && ai) {
            try {
                console.log(`[loadSession] Fetching latest messages for Hermes session: ${hermesFetchId}`);
                const msgs = await ai.getHermesSessionMessages(hermesFetchId);
                if (msgs.available && Array.isArray(msgs.messages) && msgs.messages.length > 0) {
                    const freshMessages = normalizeHermesMessages(msgs.messages);
                    if (freshMessages.length > 0) {
                        // Only hydrate if local cache is empty — never overwrite
                        // an in-memory session that may have newer turns than state.db
                        if (!session.messages || session.messages.length === 0) {
                            session.messages = freshMessages;
                            session.source = 'hermes';
                            if (inAetherArchive) {
                                schedulePersistSessions();
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[loadSession] Failed to fetch Hermes messages, falling back to cached:', e);
            }
        }

        // Load logs
        if (silent) {
            elements.consoleScroller.innerHTML = '';
        } else {
            elements.consoleScroller.innerHTML = `<div class="console-log-line system-line">[SYSTEM] Historical session re-loaded.</div>`;
        }

        if (session.messages.length === 0) {
            if (!silent) {
                elements.consoleScroller.innerHTML += `<div class="console-log-line">Active session log empty. Awaiting inputs...</div>`;
            }
        } else {
            session.messages.forEach(msg => {
                if (msg.role === 'user') {
                    const attachmentNote = msg.attachments?.length
                        ? ` [${msg.attachments.length} file${msg.attachments.length === 1 ? '' : 's'}]`
                        : '';
                    appendSystemConsoleLine(`[USER] &gt; ${msg.content || '(attachment)'}${attachmentNote}`);
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
            session.messages.forEach((msg, i) => {
                if (msg.role === 'user') {
                    appendUserChatBubble(msg.content, msg.attachments || []);
                } else {
                    appendAssistantChatBubble(msg.content, i);
                }
            });
            syncReplayButtonsForSession();
        }

        scheduleRenderHistorySessions();
        scrollConsoleBottom();
    }

    function saveMessageToSession(role, content, meta = {}) {
        let sessionIndex = state.aetherSessions.findIndex((s) => s.id === state.activeSessionId);
        let hermesSession = null;

        if (sessionIndex === -1) {
            sessionIndex = archiveEphemeralSession();
        }
        if (sessionIndex === -1) {
            hermesSession = findHermesSession(state.activeSessionId);
            if (!hermesSession) return;
        }

        const message = { role, content };
        if (Array.isArray(meta.attachments) && meta.attachments.length) {
            message.attachments = meta.attachments;
        }
        if (meta.backend) message.backend = meta.backend;
        if (meta.audioReplayId) message.audioReplayId = meta.audioReplayId;

        const target = hermesSession || state.aetherSessions[sessionIndex];
        target.messages.push(message);

        // Title update
        if (target.messages.length === 2) {
            const firstUserMessage = target.messages.find(m => m.role === 'user');
            if (firstUserMessage) {
                const titleSeed = firstUserMessage.content
                    || firstUserMessage.attachments?.[0]?.name
                    || 'Attachment';
                const words = titleSeed.split(' ');
                target.title = words.slice(0, 3).join(' ') + (words.length > 3 ? '...' : '');
            }
        }

        if (hermesSession) {
            scheduleRenderHistorySessions();
            return;
        }

        schedulePersistSessions();
        scheduleRenderHistorySessions();
    }

    function findAetherSession(id) {
        if (!id) return null;
        return state.aetherSessions.find((s) => s.id === id || s.hermesSessionId === id) || null;
    }

    function findHermesSession(id) {
        if (!id) return null;
        return state.hermesSessions.find((s) => s.id === id) || null;
    }

    function findSessionByHermesId(hermesSessionId) {
        if (!hermesSessionId) return null;
        return findAetherSession(hermesSessionId) || findHermesSession(hermesSessionId);
    }

    function getHermesBridgeSessionId(session) {
        if (!session) return null;
        if (session.hermesSessionId) return session.hermesSessionId;
        if (!String(session.id || '').startsWith('sess_')) return session.id;
        return null;
    }

    function sessionHasHistory(session) {
        return (session?.messages?.length || 0) > 0 || (session?.messageCount || 0) > 0;
    }

    function isSessionActive(session) {
        const activeId = state.activeSessionId;
        if (!activeId || !session) return false;
        return session.id === activeId
            || session.aetherArchiveId === activeId
            || session.hermesSessionId === activeId;
    }

    function getSessionLoadId(session) {
        if (session.aetherArchiveId) return session.aetherArchiveId;
        return session.id;
    }

    function buildAllSessionsList() {
        const map = new Map();

        for (const h of state.hermesSessions) {
            map.set(h.id, {
                ...h,
                hermesSessionId: h.id,
                listSource: 'hermes',
            });
        }

        for (const a of state.aetherSessions) {
            if (!isAetherHudSession(a)) continue;
            const linkKey = a.hermesSessionId;
            if (linkKey && map.has(linkKey)) {
                const existing = map.get(linkKey);
                map.set(linkKey, {
                    ...existing,
                    ...a,
                    id: linkKey,
                    aetherArchiveId: a.id,
                    messages: a.messages?.length ? a.messages : existing.messages,
                    title: a.title || existing.title,
                    listSource: 'merged',
                });
            } else if ((a.messages?.length || 0) > 0) {
                map.set(a.id, {
                    ...a,
                    listSource: 'aether',
                });
            }
        }

        return [...map.values()].filter(sessionHasHistory);
    }

    function getSessionsForHistoryTab(tabId) {
        if (normalizeChatHistoryTab(tabId) === 'aether') {
            return state.aetherSessions.filter(
                (s) => isAetherHudSession(s) && (s.messages?.length || 0) > 0
            );
        }
        return buildAllSessionsList();
    }

    function getChatHistoryTabForSession(sessionId) {
        const aether = findAetherSession(sessionId);
        if (aether && isAetherHudSession(aether)) return 'aether';
        return 'all';
    }

    function activateChatHistoryTab(tabId) {
        const targetTab = normalizeChatHistoryTab(tabId);
        state.chatHistoryTab = targetTab;
        state._displayedSessionCount = SESSIONS_PAGE_SIZE;
        AetherUserData.setItem('aether_chat_history_tab', targetTab);

        document.querySelectorAll('[data-chat-history-tab]').forEach((tab) => {
            const active = tab.dataset.chatHistoryTab === targetTab;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.tabIndex = active ? 0 : -1;
        });

        scheduleRenderHistorySessions();
    }

    async function reloadHermesSkillsFromHud() {
        try {
            const result = await ai.reloadHermesSkills();
            showToast('Skills reload', result.message || 'Reload requested.', { durationMs: 3500 });
        } catch (err) {
            showToast('Skills reload failed', err.message, { durationMs: 4200 });
        }
    }

    async function searchHermesSessionsRemote(query) {
        try {
            const result = await ai.searchHermesSessions(query);
            if (!result.available || !Array.isArray(result.items)) return;
            for (const item of result.items) {
                if (findHermesSession(item.id) || findAetherSession(item.id)) continue;
                state.hermesSessions.push(normalizeHermesSession(item));
            }
            scheduleRenderHistorySessions();
        } catch (err) {
            console.warn('[archives search]', err.message);
        }
    }

    async function renameSessionFromArchives(session) {
        const next = window.prompt('Rename session', session.title || '');
        if (next == null || !String(next).trim()) return;
        const title = String(next).trim();
        session.title = title;

        const aetherId = session.aetherArchiveId
            || (String(session.id).startsWith('sess_') ? session.id : findAetherSession(session.id)?.id);
        if (aetherId) {
            const aether = findAetherSession(aetherId);
            if (aether) aether.title = title;
        }

        const hermesId = getHermesBridgeSessionId(session);
        if (hermesId) {
            const hermes = findHermesSession(hermesId);
            if (hermes) hermes.title = title;
            try {
                await ai.updateHermesSessionTitle(hermesId, title);
            } catch (err) {
                showToast('Rename failed', err.message, { durationMs: 4000 });
            }
        }

        if (aetherId) schedulePersistSessions();
        scheduleRenderHistorySessions();
    }

    async function deleteSessionFromArchives(session) {
        if (!window.confirm(`Delete "${session.title}"?`)) return;
        const hermesId = getHermesBridgeSessionId(session);
        const aetherId = session.aetherArchiveId
            || (String(session.id).startsWith('sess_') ? session.id : findAetherSession(session.id)?.id);

        if (hermesId) {
            try {
                await ai.deleteHermesSession(hermesId);
            } catch (err) {
                showToast('Delete failed', err.message, { durationMs: 4000 });
                return;
            }
        }

        if (aetherId) {
            state.aetherSessions = state.aetherSessions.filter((s) => s.id !== aetherId);
        }
        if (hermesId) {
            state.hermesSessions = state.hermesSessions.filter((s) => s.id !== hermesId);
        } else if (!aetherId) {
            state.hermesSessions = state.hermesSessions.filter((s) => s.id !== session.id);
        }

        const activeIds = [session.id, session.aetherArchiveId, session.hermesSessionId].filter(Boolean);
        if (activeIds.includes(state.activeSessionId)) {
            startNewSession({ ephemeral: true });
        } else {
            if (aetherId) schedulePersistSessions();
            scheduleRenderHistorySessions();
        }
    }

    function setChatInFlight(active) {
        state.chatInFlight = !!active;
        if (elements.chatStopBtn) {
            elements.chatStopBtn.hidden = !state.chatInFlight;
        }
    }

    async function stopActiveChatTurn() {
        state.chatStopRequested = true;
        try {
            await ai.stopActiveChat();
            showToast('Stopped', 'Agent run cancelled.');
        } catch (err) {
            showToast('Stop failed', err.message || 'Could not stop run', { variant: 'error' });
        } finally {
            state.chatStopRequested = false;
            setChatInFlight(false);
            visualizer.setState('idle');
            visualizer.clearThinkingCaption();
        }
    }

    async function loadContextPanel() {
        if (!elements.contextFileList) return;
        elements.contextFileList.innerHTML = '<div class="form-hint">Loading context files…</div>';
        try {
            const data = await ai.listHermesContextFiles(state.activeWorkspacePath || null);
            const items = data.items || [];
            elements.contextFileList.innerHTML = '';
            if (!items.length) {
                elements.contextFileList.innerHTML = '<div class="form-hint">No context files found.</div>';
                return;
            }
            for (const item of items) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `context-file-btn${state.contextSelectedFileId === item.id ? ' active' : ''}`;
                btn.innerHTML = `<strong>${item.name}</strong><small>${item.description || item.scope}${item.exists ? '' : ' · not created yet'}</small>`;
                btn.addEventListener('click', () => selectContextFile(item.id));
                elements.contextFileList.appendChild(btn);
            }
        } catch (err) {
            elements.contextFileList.innerHTML = `<div class="form-hint">${err.message}</div>`;
        }
    }

    async function selectContextFile(fileId) {
        state.contextSelectedFileId = fileId;
        if (elements.contextEditorGroup) elements.contextEditorGroup.hidden = false;
        if (elements.contextFileEditor) elements.contextFileEditor.value = 'Loading…';
        try {
            const data = await ai.readHermesContextFile(fileId, state.activeWorkspacePath || null);
            const file = data.file || {};
            if (elements.contextEditorLabel) elements.contextEditorLabel.textContent = file.name || fileId;
            if (elements.contextEditorHint) {
                elements.contextEditorHint.textContent = file.path || '';
            }
            if (elements.contextFileEditor) {
                elements.contextFileEditor.value = file.content || '';
                elements.contextFileEditor.onchange = () => saveContextFileDebounced(fileId);
                elements.contextFileEditor.oninput = () => saveContextFileDebounced(fileId);
            }
            loadContextPanel();
        } catch (err) {
            if (elements.contextFileEditor) elements.contextFileEditor.value = '';
            showToast('Context read failed', err.message, { durationMs: 4000 });
        }
    }

    let contextSaveTimer = null;
    function saveContextFileDebounced(fileId) {
        clearTimeout(contextSaveTimer);
        contextSaveTimer = setTimeout(async () => {
            if (!elements.contextFileEditor) return;
            try {
                await ai.writeHermesContextFile(
                    fileId,
                    elements.contextFileEditor.value,
                    state.activeWorkspacePath || null
                );
                showToast('Saved', `${fileId} updated`, { durationMs: 2200 });
            } catch (err) {
                showToast('Save failed', err.message, { durationMs: 4000 });
            }
        }, 700);
    }

    async function saveSelectedContextFile() {
        const fileId = state.contextSelectedFileId;
        if (!fileId || !elements.contextFileEditor) return;
        clearTimeout(contextSaveTimer);
        try {
            await ai.writeHermesContextFile(
                fileId,
                elements.contextFileEditor.value,
                state.activeWorkspacePath || null,
            );
            showToast('Context saved', 'Hermes will pick this up on the next turn.');
            loadContextPanel();
        } catch (err) {
            showToast('Save failed', err.message || 'Could not write file', { variant: 'error' });
        }
    }

    async function loadConfigPanel() {
        if (!elements.configSummaryPanel) return;
        elements.configSummaryPanel.innerHTML = '<div class="form-hint">Loading config…</div>';
        try {
            const data = await ai.getHermesConfigSummary();
            const s = data.summary || {};
            if (!data.available) {
                elements.configSummaryPanel.innerHTML = `<div class="form-hint">${s.error || 'config.yaml not found'}</div>`;
                return;
            }
            const mcp = (s.mcpServers || []).map((srv) =>
                `<li><strong>${srv.name}</strong> — ${srv.command || srv.url || 'configured'}${srv.enabled === false ? ' (disabled)' : ''}</li>`
            ).join('') || '<li>No MCP servers configured</li>';
            const toolsets = [
                ...(s.toolsets?.enabled || []).map((t) => `<li>enabled: ${t}</li>`),
                ...(s.toolsets?.disabled || []).map((t) => `<li>disabled: ${t}</li>`),
            ].join('') || '<li>Default toolsets</li>';
            elements.configSummaryPanel.innerHTML = `
                <div class="config-summary-block"><h4>Terminal</h4><ul>
                    <li>Backend: ${s.terminal?.backend || 'local'}</li>
                    <li>CWD: ${s.terminal?.cwd || '(default)'}</li>
                </ul></div>
                <div class="config-summary-block"><h4>Security</h4><ul>
                    <li>Require approval: ${s.security?.requireApproval ?? 'default'}</li>
                    <li>Container mode: ${s.security?.containerMode ?? 'default'}</li>
                </ul></div>
                <div class="config-summary-block"><h4>MCP servers</h4><ul>${mcp}</ul></div>
                <div class="config-summary-block"><h4>Toolsets</h4><ul>${toolsets}</ul></div>
                <div class="form-hint">${s.configPath || ''}</div>`;
        } catch (err) {
            elements.configSummaryPanel.innerHTML = `<div class="form-hint">${err.message}</div>`;
        }
    }

    async function loadJobsPanel() {
        if (!elements.jobsListPanel) return;
        elements.jobsListPanel.innerHTML = '<div class="form-hint">Loading jobs…</div>';
        try {
            const data = await ai.listHermesJobs();
            const jobs = data.jobs || data.items || (Array.isArray(data) ? data : []);
            if (!jobs.length) {
                elements.jobsListPanel.innerHTML = '<div class="form-hint">No scheduled jobs. Create one with New job.</div>';
                return;
            }
            elements.jobsListPanel.innerHTML = '';
            for (const job of jobs) {
                const card = document.createElement('div');
                card.className = 'job-card';
                const id = job.id || job.job_id || job.name;
                card.innerHTML = `
                    <div class="job-card-head">
                        <div>
                            <div class="job-card-title">${job.name || id}</div>
                            <div class="job-card-meta">${job.schedule || job.cron || 'manual'} · ${job.status || job.state || 'unknown'}</div>
                        </div>
                    </div>
                    <div class="job-card-meta">${(job.prompt || job.input || '').slice(0, 120)}</div>
                    <div class="job-card-actions">
                        <button type="button" class="action-btn btn-secondary" data-job-run="${id}">Run now</button>
                        <button type="button" class="action-btn btn-secondary" data-job-pause="${id}">Pause</button>
                        <button type="button" class="action-btn btn-secondary" data-job-resume="${id}">Resume</button>
                        <button type="button" class="action-btn btn-secondary" data-job-delete="${id}">Delete</button>
                    </div>`;
                card.querySelector(`[data-job-run="${id}"]`)?.addEventListener('click', () => ai.runHermesJobNow(id).then(() => loadJobsPanel()));
                card.querySelector(`[data-job-pause="${id}"]`)?.addEventListener('click', () => ai.pauseHermesJob(id).then(() => loadJobsPanel()));
                card.querySelector(`[data-job-resume="${id}"]`)?.addEventListener('click', () => ai.resumeHermesJob(id).then(() => loadJobsPanel()));
                card.querySelector(`[data-job-delete="${id}"]`)?.addEventListener('click', () => {
                    if (window.confirm('Delete this job?')) {
                        ai.deleteHermesJob(id).then(() => loadJobsPanel());
                    }
                });
                elements.jobsListPanel.appendChild(card);
            }
        } catch (err) {
            elements.jobsListPanel.innerHTML = `<div class="form-hint">${err.message}. Jobs API requires Hermes gateway with cron enabled.</div>`;
        }
    }

    async function promptNewHermesJob() {
        const name = window.prompt('Job name');
        if (!name) return;
        const schedule = window.prompt('Schedule (cron expression or natural language)', '0 9 * * *');
        if (schedule == null) return;
        const prompt = window.prompt('Prompt for the agent');
        if (prompt == null) return;
        try {
            await ai.createHermesJob({ name, schedule, prompt });
            loadJobsPanel();
        } catch (err) {
            showToast('Create job failed', err.message, { durationMs: 4000 });
        }
    }

    function renderHistorySessions() {
        const list = elements.chatHistoryList;
        list.innerHTML = '';

        const filtered = getSessionsForHistoryTab(state.chatHistoryTab)
            .filter((s) => {
                const q = state.archivesSearchQuery.trim().toLowerCase();
                if (!q) return true;
                return String(s.title || '').toLowerCase().includes(q)
                    || String(s.id || '').toLowerCase().includes(q);
            });

        if (filtered.length === 0) {
            const emptyMessage = state.chatHistoryTab === 'all'
                ? 'No saved sessions yet.'
                : 'No Aether sessions yet.';
            list.innerHTML = `<div style="font-size:0.65rem; color:var(--text-dim); text-align:center; padding:10px;">${emptyMessage}</div>`;
            return;
        }

        // Always sort most-recent-first by startedAt
        const sorted = [...filtered].sort((a, b) => {
            const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
            const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
            if (aTime !== bTime) return bTime - aTime;
            // Fallback: local sessions (sess_ prefix) go after Hermes sessions
            const aPriority = String(a.id).startsWith('sess_') ? 1 : 0;
            const bPriority = String(b.id).startsWith('sess_') ? 1 : 0;
            return aPriority - bPriority;
        });

        const showCount = Math.min(state._displayedSessionCount || SESSIONS_PAGE_SIZE, sorted.length);
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < showCount; i++) {
            const s = sorted[i];
            const row = document.createElement('div');
            row.className = `history-item ${isSessionActive(s) ? 'active' : ''}`;

            const mainBtn = document.createElement('button');
            mainBtn.type = 'button';
            mainBtn.className = 'history-item-main';
            
            const icon = document.createElement('i');
            const isAetherTab = state.chatHistoryTab === 'aether';
            const showDatabaseIcon = isAetherTab || s.aetherArchiveId || String(s.id).startsWith('sess_');
            icon.setAttribute('data-lucide', showDatabaseIcon ? 'database' : 'radio-tower');
            icon.className = 'history-icon';
            icon.style.width = '12px';
            icon.style.height = '12px';
            
            const titleSpan = document.createElement('span');
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            titleSpan.style.whiteSpace = 'nowrap';
            titleSpan.textContent = s.title;

            if (s.source === 'hermes' || s.listSource === 'hermes' || s.listSource === 'merged') {
                row.title = `Hermes profile: ${s.hermesProfile || 'default'}`;
            }

            mainBtn.appendChild(icon);
            mainBtn.appendChild(titleSpan);
            mainBtn.addEventListener('click', () => {
                loadSession(getSessionLoadId(s));
                toggleSidebarDrawer();
            });

            const actions = document.createElement('div');
            actions.className = 'history-item-actions';

            const renameBtn = document.createElement('button');
            renameBtn.type = 'button';
            renameBtn.className = 'history-item-action';
            renameBtn.title = 'Rename';
            renameBtn.innerHTML = '<i data-lucide="pencil" style="width:12px;height:12px"></i>';
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                renameSessionFromArchives(s);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'history-item-action';
            deleteBtn.title = 'Delete';
            deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width:12px;height:12px"></i>';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSessionFromArchives(s);
            });

            actions.appendChild(renameBtn);
            actions.appendChild(deleteBtn);

            const inner = document.createElement('div');
            inner.className = 'history-item-row';
            inner.appendChild(mainBtn);
            inner.appendChild(actions);
            row.appendChild(inner);
            fragment.appendChild(row);
        }

        // "Load more" button if there are more sessions
        if (showCount < sorted.length) {
            const moreBtn = document.createElement('button');
            moreBtn.className = 'history-item history-load-more';
            moreBtn.style.cssText = 'font-size:0.65rem; color:var(--accent-secondary); text-align:center; border:1px dashed var(--border-glow); opacity:0.7;';
            moreBtn.textContent = `Load ${Math.min(SESSIONS_PAGE_SIZE, sorted.length - showCount)} more...`;
            moreBtn.addEventListener('click', () => {
                state._displayedSessionCount = (state._displayedSessionCount || SESSIONS_PAGE_SIZE) + SESSIONS_PAGE_SIZE;
                scheduleRenderHistorySessions();
            });
            fragment.appendChild(moreBtn);
        }

        list.appendChild(fragment);
        refreshHistoryIcons();
    }

    async function refreshHermesIntegration({ silent = false } = {}) {
        const logAgent = (line) => {
            if (!silent) appendSystemConsoleLine(line);
        };
        try {
            const status = await ai.getBackendStatus();
            state.hermesStatus = status;
            updateHermesStatusUi(status);
            if (status.enabled && status.connected) {
                logAgent(`[AGENT] Hermes bridge connected: ${status.model || 'default model'}`);
                // Fetch profiles and populate the dropdown
                populateHermesProfiles();
                if (elements.hudShell?.classList.contains('boot-loading')) {
                    setBootStatus('Syncing Hermes sessions…');
                }
                await syncHermesSessions();
            } else if (status.enabled) {
                logAgent(`[AGENT] Hermes bridge unavailable: ${status.error || status.reason || 'status probe failed'}`);
                if (!silent) {
                    (status.setupSteps || []).forEach((step, i) => {
                        appendSystemConsoleLine(`[AGENT] Setup ${i + 1}/${status.setupSteps.length}: ${step}`);
                    });
                }
            }
        } catch (err) {
            state.hermesStatus = { enabled: false, connected: false, error: err.message };
            updateHermesStatusUi(state.hermesStatus);
        }
    }

    async function populateHermesProfiles() {
        const select = elements.hermesProfileSelect;
        if (!select) return;
        try {
            const result = await ai.getHermesProfiles();
            if (!result.available || !Array.isArray(result.items)) return;
            // Keep the default option
            select.innerHTML = '<option value="">Hermes default profile</option>';
            let hasActive = false;
            for (const p of result.items) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name + (p.alias ? ` (${p.alias})` : '') + (p.running ? ' ●' : '');
                if (p.isCurrent) {
                    opt.selected = true;
                    // If no stored profile preference, set it
                    if (!state.activeHermesProfile) {
                        state.activeHermesProfile = p.id;
                        AetherUserData.setItem('aether_hermes_profile', p.id);
                    }
                    hasActive = true;
                }
                select.appendChild(opt);
            }
            // Apply the saved profile selection
            if (state.activeHermesProfile) {
                const match = Array.from(select.options).find(o => o.value === state.activeHermesProfile);
                if (match) {
                    select.value = state.activeHermesProfile;
                }
            }
            updateHermesProfileBadge();
        } catch (err) {
            // Silently skip — the dropdown just shows the default option
        }
    }

    function shortenWorkspacePath(fullPath) {
        const home = (typeof window !== 'undefined' && window.location?.hostname === 'localhost')
            ? fullPath.replace(/^\/Users\/[^/]+/, '~')
            : fullPath;
        if (home.length <= 42) return home;
        return `…${home.slice(-39)}`;
    }

    function updateWorkspacePinBadge() {
        const badge = elements.workspacePinBadge;
        if (!badge) return;
        const path = state.activeWorkspacePath;
        if (!path) {
            badge.hidden = true;
            badge.textContent = '';
            return;
        }
        badge.hidden = false;
        badge.textContent = `WORKSPACE ${shortenWorkspacePath(path)}`;
        badge.title = path;
    }

    function formatWorkspaceFileSize(bytes) {
        const size = Number(bytes);
        if (!Number.isFinite(size) || size < 0) return '';
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10240 ? 0 : 1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    function workspaceFileIconName(file) {
        const name = String(file?.relativePath || file?.name || file?.title || '').toLowerCase();
        if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(name)) return 'image';
        if (/\.(md|markdown|txt|log)$/.test(name)) return 'file-text';
        if (/\.(json|ya?ml|toml|xml|csv)$/.test(name)) return 'file-code';
        return 'file';
    }

    function buildMessageWithWorkspaceContext(text) {
        const trimmed = String(text || '').trim();
        if (!state.activeWorkspacePath) return trimmed;
        if (!trimmed) return `[Workspace: ${state.activeWorkspacePath}]`;
        return `[Workspace: ${state.activeWorkspacePath}]\n${trimmed}`;
    }

    async function refreshHermesChats() {
        if (!state.hermesStatus?.enabled || !state.hermesStatus?.connected) {
            appendSystemConsoleLine(`[AGENT] Cannot refresh chats — Hermes bridge is offline.`);
            return;
        }
        const btn = elements.refreshChatsBtn;
        const composerBtn = elements.composerRefreshBtn;
        if (btn) btn.classList.add('refreshing');
        if (composerBtn) composerBtn.classList.add('refreshing');
        try {
            const result = await ai.getHermesSessions();
            if (!result.available || !Array.isArray(result.items)) {
                appendSystemConsoleLine(`[AGENT] Chat refresh: no sessions available from state.db.`);
                return;
            }

            let imported = 0;
            let refreshed = 0;

            for (const item of result.items) {
                const hermesSessionId = String(item.id || item.sessionId || item.session_id || '');
                if (!hermesSessionId) continue;

                const title = item.title || `Session ${hermesSessionId.slice(0, 8)}`;
                const existing = findHermesSession(hermesSessionId);

                if (existing) {
                    existing.title = title;
                    existing.source = 'hermes';
                    existing.profile = item.model || existing.profile || '';
                    if (item.startedAt) existing.startedAt = item.startedAt;
                    if (item.messageCount != null) existing.messageCount = item.messageCount;
                    refreshed++;
                } else {
                    state.hermesSessions.push(normalizeHermesSession({
                        ...item,
                        title,
                    }));
                    imported++;
                }
            }

            if (imported > 0 || refreshed > 0) {
                state._displayedSessionCount = SESSIONS_PAGE_SIZE;
                scheduleRenderHistorySessions();
                appendSystemConsoleLine(`[AGENT] Chats refreshed: ${imported} new, ${refreshed} updated.`);
            } else {
                appendSystemConsoleLine(`[AGENT] Chats are up to date.`);
            }
        } catch (err) {
            appendSystemConsoleLine(`[AGENT] Chat refresh failed: ${err.message}`);
        } finally {
            if (btn) btn.classList.remove('refreshing');
            if (composerBtn) composerBtn.classList.remove('refreshing');
        }
    }

    function normalizeHermesMessages(rawMessages) {
        if (!Array.isArray(rawMessages)) return [];
        return rawMessages
            .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
            .map((msg) => ({
                role: msg.role,
                content: String(msg.content ?? msg.text ?? ''),
                backend: 'hermes',
            }))
            .filter((msg) => msg.content.trim().length > 0);
    }

    function normalizeHermesSession(item) {
        const id = String(item.id || item.sessionId || item.session_id || '');
        return {
            id,
            title: item.title || `Session ${id.slice(0, 8)}`,
            profile: item.model || item.profile || '',
            source: 'hermes',
            hermesSessionId: id,
            hermesProfile: state.activeHermesProfile || state.hermesStatus?.profile || null,
            hermesUpdatedAt: null,
            startedAt: item.startedAt || null,
            messageCount: item.messageCount ?? item.message_count ?? 0,
            messages: Array.isArray(item.messages) ? normalizeHermesMessages(item.messages) : [],
        };
    }

    async function syncHermesSessions() {
        if (!state.hermesStatus?.capabilities?.sessions) {
            if (state.hermesStatus?.enabled && state.hermesStatus?.connected && state.hermesStatus?.sessionsProbe?.hint) {
                appendSystemConsoleLine(`[AGENT] ${state.hermesStatus.sessionsProbe.hint}`);
            }
            return;
        }
        try {
            const result = await ai.getHermesSessions();
            if (!result.available || !Array.isArray(result.items)) return;

            let imported = 0;
            let refreshed = 0;
            let activeSessionUpdated = false;

            for (const item of result.items) {
                const hermesSessionId = String(item.id || item.sessionId || item.session_id || '');
                if (!hermesSessionId) continue;

                const title = item.title || `Session ${hermesSessionId.slice(0, 8)}`;
                const aetherLinked = findAetherSession(hermesSessionId);
                let existing = findHermesSession(hermesSessionId);
                const shouldHydrate =
                    !aetherLinked?.messages?.length &&
                    (!existing || !existing.messages?.length);

                if (existing) {
                    existing.title = title;
                    existing.source = 'hermes';
                    existing.profile = item.model || existing.profile || '';
                    if (item.startedAt) existing.startedAt = item.startedAt;
                    if (item.messageCount != null) existing.messageCount = item.messageCount;

                    if (shouldHydrate) {
                        try {
                            const msgs = await ai.getHermesSessionMessages(hermesSessionId);
                            if (msgs.available && Array.isArray(msgs.messages) && msgs.messages.length > 0) {
                                existing.messages = normalizeHermesMessages(msgs.messages);
                                refreshed++;
                                if (existing.id === state.activeSessionId || aetherLinked?.id === state.activeSessionId) {
                                    activeSessionUpdated = true;
                                }
                            }
                        } catch (err) {
                            // skip this hydrate
                        }
                    }
                    continue;
                }

                let messages = [];
                if (Array.isArray(item.messages) && item.messages.length > 0) {
                    messages = normalizeHermesMessages(item.messages);
                } else if (shouldHydrate) {
                    try {
                        const msgs = await ai.getHermesSessionMessages(hermesSessionId);
                        if (msgs.available && Array.isArray(msgs.messages)) {
                            messages = normalizeHermesMessages(msgs.messages);
                        }
                    } catch (err) {
                        // messages stay empty
                    }
                }

                state.hermesSessions.unshift(normalizeHermesSession({
                    ...item,
                    title,
                    messages,
                }));
                imported++;
            }

            if (imported > 0 || refreshed > 0) {
                state._displayedSessionCount = SESSIONS_PAGE_SIZE;
                scheduleRenderHistorySessions();
            }
            if (imported > 0) {
                appendSystemConsoleLine(`[AGENT] Imported ${imported} Hermes session${imported === 1 ? '' : 's'}.`);
            }
            if (refreshed > 0) {
                appendSystemConsoleLine(`[AGENT] Refreshed ${refreshed} Hermes session${refreshed === 1 ? '' : 's'} messages from state.db.`);
            }
            if (activeSessionUpdated && state.activeSessionId) {
                loadSession(state.activeSessionId);
            }
        } catch (err) {
            appendSystemConsoleLine(`[AGENT] Hermes session listing unavailable: ${err.message}`);
        }
    }

    function truncateModelLabel(model, maxLen = 22) {
        const text = String(model || 'hermes-agent').trim() || 'hermes-agent';
        if (text.length <= maxLen) return text;
        return `${text.slice(0, maxLen - 1)}…`;
    }

    function getResolvedHermesModel() {
        return {
            model: state.hermesStatus?.model || modelPickerState.currentModel || 'hermes-agent',
            provider: state.hermesStatus?.provider || modelPickerState.currentProvider || '',
        };
    }

    function syncHermesModelDisplay(model, provider) {
        if (model) {
            modelPickerState.currentModel = String(model);
        }
        if (provider) {
            modelPickerState.currentProvider = String(provider);
        }
        if (model || provider) {
            state.hermesStatus = {
                ...(state.hermesStatus || {}),
                ...(model ? { model: String(model) } : {}),
                ...(provider ? { provider: String(provider) } : {}),
            };
        }
        updateModelPickerCurrentLine();
        updateModelButton();
        updateSettingsAgentModelDisplay();
    }

    function updateModelButton() {
        if (!elements.modelBtnLabel) return;
        const { model } = getResolvedHermesModel();
        elements.modelBtnLabel.textContent = truncateModelLabel(model);
        if (elements.modelBtn) {
            elements.modelBtn.title = `Switch model (Hermes) — ${model}`;
        }
    }

    function updateSettingsAgentModelDisplay() {
        if (!elements.settingsAgentModelDisplay) return;
        const { model, provider } = getResolvedHermesModel();
        elements.settingsAgentModelDisplay.textContent = provider ? `${model} (${provider})` : model;
    }

    function updateSettingsHermesBadge(status) {
        if (!elements.settingsHermesBadge) return;
        const resolved = status || state.hermesStatus;
        if (resolved?.enabled && resolved.connected) {
            elements.settingsHermesBadge.innerHTML = '<span class="pulse-dot"></span> HERMES';
        } else if (resolved?.enabled) {
            elements.settingsHermesBadge.innerHTML = '<span class="pulse-dot"></span> HERMES OFFLINE';
        } else {
            elements.settingsHermesBadge.innerHTML = '<span class="pulse-dot"></span> CONNECTED';
        }
    }

    function setModelPickerError(message) {
        if (!elements.modelPickerError) return;
        if (message) {
            elements.modelPickerError.hidden = false;
            elements.modelPickerError.textContent = message;
        } else {
            elements.modelPickerError.hidden = true;
            elements.modelPickerError.textContent = '';
        }
    }

    function setModelPickerHint(message) {
        if (!elements.modelPickerHint) return;
        if (message) {
            elements.modelPickerHint.hidden = false;
            elements.modelPickerHint.textContent = message;
        } else {
            elements.modelPickerHint.hidden = true;
            elements.modelPickerHint.textContent = '';
        }
    }

    function getFilteredProviders() {
        const needle = modelPickerState.query.trim().toLowerCase();
        if (!needle) return modelPickerState.providers;
        return modelPickerState.providers.filter((p) => {
            return (
                p.name?.toLowerCase().includes(needle) ||
                p.slug?.toLowerCase().includes(needle) ||
                (p.models || []).some((m) => m.toLowerCase().includes(needle))
            );
        });
    }

    function getSelectedProvider() {
        return modelPickerState.providers.find((p) => p.slug === modelPickerState.selectedSlug) || null;
    }

    function getFilteredModels(provider) {
        const models = provider?.models || [];
        const needle = modelPickerState.query.trim().toLowerCase();
        if (!needle) return models;
        return models.filter((m) => m.toLowerCase().includes(needle));
    }

    function getCustomModelCandidate(provider) {
        const query = modelPickerState.query.trim();
        if (!query || !provider) return '';
        const exact = (provider.models || []).some((m) => m === query);
        if (exact) return '';
        return query;
    }

    function renderModelPickerProviders() {
        if (!elements.modelPickerProviders) return;
        const providers = getFilteredProviders();
        if (modelPickerState.loading) {
            elements.modelPickerProviders.innerHTML = '<div class="model-picker-empty">loading…</div>';
            return;
        }
        if (!providers.length) {
            elements.modelPickerProviders.innerHTML = '<div class="model-picker-empty">no providers match</div>';
            return;
        }
        elements.modelPickerProviders.innerHTML = providers
            .map((p) => {
                const active = p.slug === modelPickerState.selectedSlug ? ' active' : '';
                const currentTag = p.is_current ? '<span class="model-picker-tag">current</span>' : '';
                const count = p.total_models ?? p.models?.length ?? 0;
                const needsSetup = p.authenticated === false;
                const suffix = needsSetup
                    ? (p.auth_type === 'api_key' && p.key_env ? '(no key)' : '(needs setup)')
                    : `${count} models`;
                return `<button type="button" class="model-picker-item${active}" data-provider-slug="${escapeHtml(p.slug)}">
                    <div class="model-picker-item-title">${escapeHtml(p.name || p.slug)} ${currentTag}</div>
                    <div class="model-picker-item-meta">${escapeHtml(p.slug)} · ${escapeHtml(String(suffix))}</div>
                </button>`;
            })
            .join('');

        elements.modelPickerProviders.querySelectorAll('[data-provider-slug]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const slug = btn.getAttribute('data-provider-slug') || '';
                const provider = modelPickerState.providers.find((p) => p.slug === slug);
                if (provider?.authenticated === false && !provider?.models?.length) {
                    setModelPickerHint(
                        provider.warning ||
                            `Run \`hermes model\` to configure ${provider.name || slug}.`
                    );
                    return;
                }
                modelPickerState.selectedSlug = slug;
                modelPickerState.selectedModel = '';
                if (provider?.warning) setModelPickerHint(provider.warning);
                renderModelPickerProviders();
                renderModelPickerModels();
                updateModelPickerConfirmState();
            });
        });
    }

    function renderModelPickerModels() {
        if (!elements.modelPickerModels) return;
        const provider = getSelectedProvider();
        if (!provider) {
            elements.modelPickerModels.innerHTML = '<div class="model-picker-empty">pick a provider →</div>';
            return;
        }
        if (provider.warning) {
            setModelPickerHint(provider.warning);
        }

        const models = getFilteredModels(provider);
        const customModel = getCustomModelCandidate(provider);
        let html = '';

        if (customModel) {
            const active = modelPickerState.selectedModel === customModel ? ' active' : '';
            html += `<button type="button" class="model-picker-item model-picker-item-model model-picker-custom${active}" data-model-id="${escapeHtml(customModel)}">
                <div class="model-picker-item-title">Use "${escapeHtml(customModel)}" as custom model</div>
            </button>`;
        }

        if (!models.length && !customModel) {
            html += '<div class="model-picker-empty">no models listed for this provider</div>';
        } else {
            html += models
                .map((m) => {
                    const active = m === modelPickerState.selectedModel ? ' active' : '';
                    const isCurrent =
                        m === modelPickerState.currentModel &&
                        provider.slug === modelPickerState.currentProvider;
                    const currentTag = isCurrent ? '<span class="model-picker-tag">current</span>' : '';
                    return `<button type="button" class="model-picker-item model-picker-item-model${active}" data-model-id="${escapeHtml(m)}">
                        <div class="model-picker-item-title">${escapeHtml(m)} ${currentTag}</div>
                    </button>`;
                })
                .join('');
        }

        elements.modelPickerModels.innerHTML = html;
        elements.modelPickerModels.querySelectorAll('[data-model-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
                modelPickerState.selectedModel = btn.getAttribute('data-model-id') || '';
                renderModelPickerModels();
                updateModelPickerConfirmState();
            });
            btn.addEventListener('dblclick', () => {
                modelPickerState.selectedModel = btn.getAttribute('data-model-id') || '';
                renderModelPickerModels();
                updateModelPickerConfirmState();
                confirmModelSwitch();
            });
        });
    }

    function updateModelPickerConfirmState() {
        const provider = getSelectedProvider();
        const canConfirm = Boolean(provider && modelPickerState.selectedModel && !modelPickerState.applying);
        if (elements.confirmModelPickerBtn) {
            elements.confirmModelPickerBtn.disabled = !canConfirm;
        }
    }

    function updateModelPickerCurrentLine() {
        if (!elements.modelPickerCurrent) return;
        const { model, provider } = getResolvedHermesModel();
        const providerSuffix = provider ? ` · ${provider}` : '';
        elements.modelPickerCurrent.textContent = `current: ${model || '(unknown)'}${providerSuffix}`;
    }

    async function loadModelPickerOptions() {
        modelPickerState.loading = true;
        setModelPickerError('');
        renderModelPickerProviders();
        renderModelPickerModels();

        try {
            const data = await ai.getHermesModelOptions();
            modelPickerState.providers = Array.isArray(data.providers) ? data.providers : [];
            modelPickerState.currentModel = String(data.model || state.hermesStatus?.model || '');
            modelPickerState.currentProvider = String(data.provider || state.hermesStatus?.provider || '');
            modelPickerState.source = data.source || '';
            modelPickerState.selectedSlug =
                modelPickerState.providers.find((p) => p.is_current)?.slug ||
                modelPickerState.providers[0]?.slug ||
                '';
            modelPickerState.selectedModel = '';

            if (data.hint || data.dashboardError) {
                if (data.source === 'hermes-cli') {
                    setModelPickerHint(
                        data.dashboardError
                            ? 'Full lists loaded from Hermes CLI (dashboard offline).'
                            : ''
                    );
                } else {
                    setModelPickerHint(data.hint || data.dashboardError);
                }
            } else if (data.source === 'status-fallback') {
                setModelPickerHint('Limited list from gateway status. Run `hermes dashboard` for full provider lists.');
            } else {
                setModelPickerHint('');
            }

            if (!data.available && !modelPickerState.providers.length) {
                setModelPickerError(data.error || 'Model options unavailable.');
            }

            syncHermesModelDisplay(modelPickerState.currentModel, modelPickerState.currentProvider);
        } catch (err) {
            setModelPickerError(err.message || 'Failed to load model options.');
            elements.modelPickerProviders.innerHTML = '<div class="model-picker-empty">failed to load</div>';
            elements.modelPickerModels.innerHTML = '<div class="model-picker-empty">—</div>';
        } finally {
            modelPickerState.loading = false;
            renderModelPickerProviders();
            renderModelPickerModels();
            updateModelPickerConfirmState();
        }
    }

    async function openModelPicker() {
        if (!elements.modelPickerModal) return;
        bootstrapHermesDashboard();
        modelPickerState.query = '';
        modelPickerState.applying = false;
        if (elements.modelPickerSearch) elements.modelPickerSearch.value = '';
        setModelPickerError('');
        setModelPickerHint('');
        updateModelPickerCurrentLine();
        elements.modelPickerModal.classList.add('open');
        await loadModelPickerOptions();
        elements.modelPickerSearch?.focus();
    }

    function closeModelPicker() {
        elements.modelPickerModal?.classList.remove('open');
        modelPickerState.applying = false;
        updateModelPickerConfirmState();
    }

    async function confirmModelSwitch() {
        const provider = getSelectedProvider();
        if (!provider || !modelPickerState.selectedModel || modelPickerState.applying) return;

        modelPickerState.applying = true;
        setModelPickerError('');
        updateModelPickerConfirmState();

        const sessionIds = [...new Set([
            state.activeSessionId,
            state.lastHermesSessionId,
        ].filter(Boolean))];
        try {
            const result = await ai.switchHermesModel({
                provider: provider.slug,
                model: modelPickerState.selectedModel,
                sessionId: state.activeSessionId,
                lastHermesSessionId: state.lastHermesSessionId,
                sessionIds,
            });

            syncHermesModelDisplay(
                result.model || modelPickerState.selectedModel,
                result.provider || provider.slug,
            );
            const switchedModel = result.model || modelPickerState.selectedModel;
            const switchedProvider = result.provider || provider.slug;
            const switchLine = `[AGENT] Model switched: ${switchedModel} · Provider: ${switchedProvider}`;
            appendSystemConsoleLine(switchLine);
            showToast(
                `Switched to ${switchedModel}`,
                'Session cache refreshed. Ask again on your next message to confirm.',
            );
            if (result.sessionInvalidated !== false) {
                appendSystemConsoleLine('[AGENT] Session prompt cache cleared — new model active on your next message.');
            } else if (sessionIds.length) {
                appendSystemConsoleLine('[AGENT] Model saved, but no matching Hermes session row was found to refresh.');
            }
            if (result.warning) {
                appendSystemConsoleLine(`[AGENT] ${result.warning}`);
                showToast('Model switch warning', result.warning, { variant: 'warning', durationMs: 5200 });
            }
            closeModelPicker();
        } catch (err) {
            const hint = err.hint ? ` ${err.hint}` : '';
            setModelPickerError(`${err.message || 'Model switch failed.'}${hint}`);
        } finally {
            modelPickerState.applying = false;
            updateModelPickerConfirmState();
        }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function updateHermesStatusUi(status) {
        updateHermesProfileBadge();
        if (!elements.activeStatusBadge) return;
        if (elements.hudShell?.classList.contains('boot-loading')) return;
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

        updateModelButton();
        updateSettingsHermesBadge(status);
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

    function formatBubbleTimestamp(date = new Date()) {
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function createBubbleFooter(options = {}) {
        const { showReadReceipt = false, timestamp = formatBubbleTimestamp() } = options;
        const footer = document.createElement('div');
        footer.className = 'bubble-footer';

        const time = document.createElement('span');
        time.className = 'bubble-timestamp';
        time.textContent = timestamp;
        footer.appendChild(time);

        if (showReadReceipt) {
            const receipt = document.createElement('span');
            receipt.className = 'bubble-read-receipt';
            receipt.innerHTML = '<i data-lucide="check-check"></i>';
            footer.appendChild(receipt);
        }

        return footer;
    }

    function createAssistantBubbleIcon() {
        const icon = document.createElement('div');
        icon.className = 'bubble-icon';
        icon.innerHTML = '<i data-lucide="hexagon"></i>';
        return icon;
    }

    function ensureAssistantBubbleStructure(bubbleNode) {
        if (!bubbleNode) return null;

        let content = bubbleNode.querySelector('.bubble-content');
        if (content) return content;

        bubbleNode.className = 'chat-bubble assistant-bubble';
        bubbleNode.replaceChildren();
        bubbleNode.appendChild(createAssistantBubbleIcon());

        content = document.createElement('div');
        content.className = 'bubble-content';
        bubbleNode.appendChild(content);
        bubbleNode.appendChild(createBubbleFooter());
        return content;
    }

    function refreshBubbleIcons(root) {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ root: root || elements.deckChatScroller });
        }
    }

    function appendUserChatBubble(text, attachments = [], workspacePath = null) {
        const div = document.createElement('div');
        div.className = 'chat-bubble user-bubble';

        const content = document.createElement('div');
        content.className = 'bubble-content';

        if (workspacePath) {
            const wsChip = document.createElement('div');
            wsChip.className = 'bubble-workspace-chip';
            wsChip.textContent = shortenWorkspacePath(workspacePath);
            wsChip.title = workspacePath;
            content.appendChild(wsChip);
        }

        if (attachments.length) {
            const attachmentRow = document.createElement('div');
            attachmentRow.className = 'bubble-attachments';
            for (const att of attachments) {
                const chip = document.createElement('div');
                chip.className = `bubble-attachment-chip bubble-attachment-chip-${att.kind}`;

                if (att.kind === 'image' && att.dataUrl) {
                    const img = document.createElement('img');
                    img.className = 'bubble-attachment-image';
                    img.src = att.dataUrl;
                    img.alt = att.name;
                    chip.appendChild(img);
                } else {
                    const icon = document.createElement('span');
                    icon.className = 'bubble-attachment-file-icon';
                    icon.innerHTML = '<i data-lucide="file-text"></i>';
                    chip.appendChild(icon);
                }

                const label = document.createElement('span');
                label.className = 'bubble-attachment-label';
                label.textContent = att.name;
                label.title = att.name;
                chip.appendChild(label);
                attachmentRow.appendChild(chip);
            }
            content.appendChild(attachmentRow);
        }

        if (text) {
            const textNode = document.createElement('div');
            textNode.className = 'bubble-text';
            textNode.textContent = text;
            content.appendChild(textNode);
        }

        div.appendChild(content);
        div.appendChild(createBubbleFooter({ showReadReceipt: true }));

        elements.deckChatScroller.appendChild(div);
        elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;
        refreshBubbleIcons(div);
        return div;
    }

    function appendAssistantChatBubble(initialText, messageIndex = null) {
        const row = document.createElement('div');
        row.className = 'chat-bubble-row assistant-bubble-row';
        if (messageIndex !== null && messageIndex !== undefined) {
            row.dataset.messageIndex = String(messageIndex);
        }

        const div = document.createElement('div');
        div.className = 'chat-bubble assistant-bubble';
        div.appendChild(createAssistantBubbleIcon());

        const content = document.createElement('div');
        content.className = 'bubble-content';
        if (initialText === '...') {
            content.innerHTML = '<em style="opacity:0.7">…</em>';
        } else {
            content.innerHTML = parseConsoleMarkdown(initialText);
        }
        div.appendChild(content);
        div.appendChild(createBubbleFooter());

        row.appendChild(div);
        elements.deckChatScroller.appendChild(row);
        elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;
        refreshBubbleIcons(row);
        return div;
    }

    function appendToolTimelineEntry(bubbleNode, toolInfo) {
        if (!bubbleNode) return;
        if (!Array.isArray(bubbleNode._toolTimeline)) bubbleNode._toolTimeline = [];
        const info = typeof toolInfo === 'string'
            ? { name: toolInfo, label: toolInfo, status: 'running' }
            : (toolInfo || {});
        const name = info.name || info.tool;
        if (!name || name === '_thinking') return;
        const last = bubbleNode._toolTimeline[bubbleNode._toolTimeline.length - 1];
        if (last && last.name === name && last.status === info.status) return;
        bubbleNode._toolTimeline.push({
            name: String(name),
            label: String(info.label || name),
            status: info.status || 'running',
            args: info.args ?? null,
            output: info.output ?? null,
            at: Date.now(),
        });
        if (bubbleNode._toolTimeline.length > 12) {
            bubbleNode._toolTimeline.shift();
        }
    }

    function renderToolTimeline(bubbleNode) {
        const timeline = bubbleNode?._toolTimeline || [];
        if (!timeline.length) return null;
        const wrap = document.createElement('div');
        wrap.className = 'chat-tool-timeline';
        for (const entry of timeline) {
            const item = document.createElement('div');
            item.className = `chat-tool-timeline-item${entry.status === 'thinking' ? ' is-thinking' : ''}`;
            const nameEl = document.createElement('div');
            nameEl.className = 'chat-tool-timeline-name';
            nameEl.textContent = entry.label || entry.name;
            item.appendChild(nameEl);
            if (entry.args) {
                const argsEl = document.createElement('div');
                argsEl.className = 'chat-tool-timeline-meta';
                argsEl.textContent = typeof entry.args === 'string' ? entry.args : JSON.stringify(entry.args).slice(0, 240);
                item.appendChild(argsEl);
            }
            if (entry.output) {
                const outEl = document.createElement('div');
                outEl.className = 'chat-tool-timeline-meta';
                outEl.textContent = typeof entry.output === 'string' ? entry.output.slice(0, 240) : JSON.stringify(entry.output).slice(0, 240);
                item.appendChild(outEl);
            }
            wrap.appendChild(item);
        }
        return wrap;
    }

    function formatToolPreviewLabel(toolInfo) {
        const info = typeof toolInfo === 'string'
            ? { name: toolInfo, label: toolInfo, status: 'running' }
            : (toolInfo || {});
        const name = String(info.name || '').trim();
        if (!name) return null;

        const rawLabel = String(info.label || name).trim();
        const isThinking = info.status === 'thinking' || name === '_thinking';
        const detail = (!isThinking && rawLabel && rawLabel !== '*' && rawLabel !== name)
            ? rawLabel
            : (isThinking ? 'Thinking…' : name);

        const argsSnippet = info.args != null
            ? (typeof info.args === 'string' ? info.args : JSON.stringify(info.args)).slice(0, 120)
            : '';
        const outputSnippet = info.output != null
            ? (typeof info.output === 'string' ? info.output : JSON.stringify(info.output)).slice(0, 120)
            : '';

        return {
            prefix: isThinking ? '' : 'Calling',
            emoji: info.emoji ? String(info.emoji) : '',
            detail,
            isThinking,
            argsSnippet,
            outputSnippet,
            status: info.status || 'running',
        };
    }

    function setAssistantBubbleToolPreview(bubbleNode, toolInfo) {
        const formatted = formatToolPreviewLabel(toolInfo);
        if (!bubbleNode || !formatted) return;
        bubbleNode.classList.add('assistant-bubble-tool-active');

        const content = ensureAssistantBubbleStructure(bubbleNode);
        if (!content) return;
        content.replaceChildren();

        const timeline = renderToolTimeline(bubbleNode);
        if (timeline) content.appendChild(timeline);

        const preview = document.createElement('div');
        preview.className = `chat-tool-preview${formatted.isThinking ? ' chat-tool-preview-thinking' : ''}`;
        preview.setAttribute('aria-live', 'polite');

        if (formatted.prefix) {
            const prefix = document.createElement('span');
            prefix.className = 'chat-tool-preview-label';
            prefix.textContent = formatted.prefix;
            preview.appendChild(prefix);
        }

        if (formatted.emoji) {
            const emoji = document.createElement('span');
            emoji.className = 'chat-tool-preview-emoji';
            emoji.textContent = formatted.emoji;
            preview.appendChild(emoji);
        }

        const detail = document.createElement(formatted.isThinking ? 'span' : 'code');
        detail.className = formatted.isThinking ? 'chat-tool-preview-thinking-text' : 'chat-tool-preview-name';
        detail.textContent = formatted.detail;

        preview.appendChild(detail);

        if (formatted.argsSnippet) {
            const argsEl = document.createElement('div');
            argsEl.className = 'chat-tool-preview-meta';
            argsEl.textContent = `args: ${formatted.argsSnippet}${formatted.argsSnippet.length >= 120 ? '…' : ''}`;
            preview.appendChild(argsEl);
        }
        if (formatted.outputSnippet && formatted.status === 'completed') {
            const outEl = document.createElement('div');
            outEl.className = 'chat-tool-preview-meta chat-tool-preview-output';
            outEl.textContent = `out: ${formatted.outputSnippet}${formatted.outputSnippet.length >= 120 ? '…' : ''}`;
            preview.appendChild(outEl);
        }

        content.appendChild(preview);
        elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;
    }

    function clearAssistantBubbleToolPreview(bubbleNode) {
        if (!bubbleNode) return;
        bubbleNode.classList.remove('assistant-bubble-tool-active');
        bubbleNode._toolTimeline = [];
        visualizer.clearThinkingCaption();
    }

    async function submitDeckMessage() {
        const text = elements.deckChatInputField.value.trim();
        const attachments = cloneAttachmentsForSend(pendingAttachments);
        if (!text && !attachments.length) return;

        elements.deckChatInputField.value = '';
        clearComposerAttachments();
        resizeChatComposerInput();
        if (elements.hudShell?.classList.contains('chat-collapsed')) {
            expandChatColumn(false);
        }
        await submitDirectTextCommand(text, attachments);
    }

    function getChatComposerSingleLineHeight(field) {
        const style = window.getComputedStyle(field);
        const fontSize = parseFloat(style.fontSize) || 16;
        const lineHeight = Number.isFinite(parseFloat(style.lineHeight))
            ? parseFloat(style.lineHeight)
            : fontSize * 1.45;
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        return Math.ceil(lineHeight + padding + border);
    }

    function resizeChatComposerInput() {
        const field = elements.deckChatInputField;
        if (!field) return;

        const compact = isCompactViewport();
        const maxHeight = compact
            ? Math.min(Math.round(window.innerHeight * 0.28), 120)
            : 120;
        const singleLineHeight = getChatComposerSingleLineHeight(field);
        const value = field.value || '';

        if (!value.trim()) {
            field.style.height = `${singleLineHeight}px`;
            field.style.overflowY = 'hidden';
            return;
        }

        const previousMaxHeight = field.style.maxHeight;
        field.style.maxHeight = 'none';
        field.style.height = '0px';
        const measuredHeight = field.scrollHeight;
        field.style.maxHeight = previousMaxHeight;

        const nextHeight = Math.max(singleLineHeight, Math.min(measuredHeight, maxHeight));
        field.style.height = `${nextHeight}px`;
        field.style.overflowY = measuredHeight > maxHeight ? 'auto' : 'hidden';
    }

    function getTtsProvider() {
        return AetherUserData.getItem('aether_tts_provider') || 'browser';
    }

    function truncateVoiceLabel(text, maxLen = 44) {
        const s = String(text || '').trim();
        if (s.length <= maxLen) return s;
        return `${s.slice(0, maxLen - 1)}…`;
    }

    function syncVoiceSelectTitle() {
        if (!elements.synthVoice) return;
        const selected = elements.synthVoice.selectedOptions[0];
        elements.synthVoice.title = selected?.title || selected?.textContent || '';
    }

    function updateTtsProviderHint() {
        if (!elements.ttsProviderHint) return;
        const provider = elements.ttsProvider?.value || getTtsProvider();
        if (provider === 'elevenlabs') {
            elements.ttsProviderHint.textContent =
                'Cloud voices via ElevenLabs. Set ELEVENLABS_API_KEY in .env.local on the Aether server, then restart npm start. Speed adjusts voice stability.';
        } else if (provider === 'omnivoice') {
            elements.ttsProviderHint.textContent =
                'Local OmniVoice via OMNIVOICE_BASE_URL (default http://127.0.0.1:8000). Run OmniVoice-local, add samples to its samples/ folder, then restart npm start. First generation may take 1–2 minutes.';
        } else {
            elements.ttsProviderHint.textContent =
                "Uses your browser's built-in speech synthesis (no model download). Speed adjusts playback rate.";
        }
    }

    function updateOmniVoiceInstructVisibility() {
        if (!elements.omnivoiceInstructGroup) return;
        const provider = elements.ttsProvider?.value || getTtsProvider();
        elements.omnivoiceInstructGroup.hidden = provider !== 'omnivoice';
    }

    function normalizeSettingsSection(section) {
        const id = String(section || '').trim().toLowerCase();
        return SETTINGS_SECTIONS.has(id) ? id : 'appearance';
    }

    function parseSettingsRoute() {
        const hash = window.location.hash || '';
        const match = hash.match(/^#\/settings(?:\/([a-z]+))?$/i);
        if (!match) return null;
        return normalizeSettingsSection(match[1]);
    }

    function syncSettingsRoute(section, { replace = false } = {}) {
        const target = `#/settings/${normalizeSettingsSection(section)}`;
        if (window.location.hash === target) return;
        if (replace) {
            history.replaceState(null, '', target);
        } else {
            window.location.hash = target;
        }
    }

    function clearSettingsRoute({ replace = true } = {}) {
        if (!window.location.hash.startsWith('#/settings')) return;
        const base = window.location.pathname + window.location.search;
        if (replace) {
            history.replaceState(null, '', base);
        } else {
            history.pushState(null, '', base);
        }
    }

    function loadSettingsSectionData(section) {
        const target = normalizeSettingsSection(section);
        if (target === 'context') loadContextPanel();
        if (target === 'config') loadConfigPanel();
        if (target === 'jobs') loadJobsPanel();
        if (target === 'skills') prepareSkillsPanel();
    }

    function activateSettingsSection(section, { fromHash = false } = {}) {
        const targetSection = normalizeSettingsSection(section);
        state.settingsSection = targetSection;
        AetherUserData.setItem('aether_settings_section', targetSection);

        document.querySelectorAll('[data-settings-section]').forEach((item) => {
            const active = item.dataset.settingsSection === targetSection;
            item.classList.toggle('active', active);
            item.setAttribute('aria-current', active ? 'page' : 'false');
        });

        document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
            const active = panel.dataset.settingsPanel === targetSection;
            panel.classList.toggle('active', active);
            panel.hidden = !active;
        });

        loadSettingsSectionData(targetSection);

        if (!fromHash && state.settingsMode) {
            syncSettingsRoute(targetSection, { replace: true });
        }
    }

    function hydrateSettingsForm() {
        if (elements.ttsProvider) {
            elements.ttsProvider.value = getTtsProvider();
        }
        updateTtsProviderHint();
        updateOmniVoiceInstructVisibility();
        updateAvatarFormUi(state.avatarForm);

        if (elements.displayNameInput) {
            elements.displayNameInput.value = getDisplayName();
        }

        if (elements.omnivoiceInstruct) {
            elements.omnivoiceInstruct.value =
                AetherUserData.getItem('aether_omnivoice_instruct') || '';
        }

        elements.synthSpeed.value = AetherUserData.getItem('aether_voice_speed') || '1.0';
        elements.synthSpeedVal.textContent = elements.synthSpeed.value + 'x';

        const delayVal = AetherUserData.getItem('aether_stream_delay') || '5';
        elements.simulationSpeed.value = delayVal;

        const vals = ['Snail', 'Slow', 'Normal', 'Fast', 'Instant'];
        elements.simulationSpeedVal.textContent = vals[Math.min(4, Math.floor((delayVal - 1) / 2))];

        if (elements.ttsReplayCacheSize) {
            const replaySize = AetherUserData.getItem('aether_tts_replay_cache_size') || '5';
            elements.ttsReplayCacheSize.value = replaySize;
            if (elements.ttsReplayCacheSizeVal) {
                elements.ttsReplayCacheSizeVal.textContent = replaySize;
            }
        }

        if (elements.chatColumnWidth) {
            const chatWidth = String(getChatColumnWidthPx());
            elements.chatColumnWidth.value = chatWidth;
            if (elements.chatColumnWidthVal) {
                elements.chatColumnWidthVal.textContent = chatWidth + 'px';
            }
        }

        if (elements.voiceInputBehavior) {
            elements.voiceInputBehavior.value = AetherUserData.getItem('aether_voice_input_behavior') || 'auto';
        }

        if (elements.hermesProfileSelect) {
            elements.hermesProfileSelect.value = state.activeHermesProfile;
            populateHermesProfilesList();
        }

        refreshHermesIntegration();
        populateVoicesList();
        updateSettingsAgentModelDisplay();
        updateSettingsHermesBadge();
    }

    function enterSettingsMode(section, { fromHash = false } = {}) {
        if (state.kanbanMode) {
            exitKanbanMode();
        }
        if (state.vaultMode) {
            exitVaultMode({ fromHash: true });
        }

        const targetSection = normalizeSettingsSection(
            section || AetherUserData.getItem('aether_settings_section') || 'appearance',
        );

        if (state.settingsMode) {
            activateSettingsSection(targetSection, { fromHash });
            return;
        }

        if (state.chatCollapsedBeforeSettings === null) {
            state.chatCollapsedBeforeSettings =
                elements.hudShell?.classList.contains('chat-collapsed') ?? true;
        }
        collapseChatColumn();

        state.settingsMode = true;
        elements.hudShell?.classList.add('settings-mode');
        elements.settingsBtn?.classList.add('active');
        elements.settingsPillBtn?.classList.add('active');
        if (elements.settingsPage) {
            elements.settingsPage.hidden = false;
        }

        hydrateSettingsForm();
        activateSettingsSection(targetSection, { fromHash: true });
        lucide.createIcons();

        if (!fromHash) {
            syncSettingsRoute(targetSection);
        }
    }

    function exitSettingsMode({ fromHash = false } = {}) {
        if (!state.settingsMode) return;

        state.settingsMode = false;
        elements.hudShell?.classList.remove('settings-mode');
        elements.settingsBtn?.classList.remove('active');
        elements.settingsPillBtn?.classList.remove('active');
        if (elements.settingsPage) {
            elements.settingsPage.hidden = true;
        }
        setSkillsStatus('');

        applyChatColumnWidth(getChatColumnWidthPx());

        const restoreCollapsed = state.chatCollapsedBeforeSettings;
        state.chatCollapsedBeforeSettings = null;
        if (restoreCollapsed === false) {
            expandChatColumn(false);
        } else {
            collapseChatColumn();
        }

        if (!fromHash) {
            clearSettingsRoute();
        }
    }

    function saveSettings() {
        const displayName = elements.displayNameInput?.value.trim() || DEFAULT_DISPLAY_NAME;
        AetherUserData.setItem('aether_display_name', displayName);
        applyDisplayName();

        AetherUserData.setItem('aether_voice_speed', elements.synthSpeed.value);
        AetherUserData.setItem('aether_stream_delay', elements.simulationSpeed.value);
        AetherUserData.setItem('aether_avatar_form', state.avatarForm || 'classic-blob');
        visualizer.setAvatarForm(state.avatarForm || 'classic-blob');

        if (elements.ttsReplayCacheSize) {
            AetherUserData.setItem('aether_tts_replay_cache_size', elements.ttsReplayCacheSize.value);
            syncReplayButtonsForSession();
        }

        if (elements.chatColumnWidth) {
            AetherUserData.setItem('aether_chat_column_width', elements.chatColumnWidth.value);
            applyChatColumnWidth(parseInt(elements.chatColumnWidth.value, 10));
        }

        if (elements.ttsProvider) {
            AetherUserData.setItem('aether_tts_provider', elements.ttsProvider.value);
        }

        const providerToSave = elements.ttsProvider?.value || getTtsProvider();
        if (elements.synthVoice?.value !== undefined) {
            if (providerToSave === 'elevenlabs') {
                if (elements.synthVoice.value) {
                    AetherUserData.setItem('aether_elevenlabs_voice_id', elements.synthVoice.value);
                }
            } else if (providerToSave === 'omnivoice') {
                if (elements.synthVoice.value) {
                    AetherUserData.setItem('aether_omnivoice_sample', elements.synthVoice.value);
                } else {
                    AetherUserData.removeItem('aether_omnivoice_sample');
                }
            } else if (elements.synthVoice.value) {
                AetherUserData.setItem('aether_voice_name', elements.synthVoice.value);
            }
        }

        if (elements.omnivoiceInstruct) {
            const instruct = elements.omnivoiceInstruct.value.trim();
            if (instruct) {
                AetherUserData.setItem('aether_omnivoice_instruct', instruct);
            } else {
                AetherUserData.removeItem('aether_omnivoice_instruct');
            }
        }

        if (elements.voiceInputBehavior) {
            AetherUserData.setItem('aether_voice_input_behavior', elements.voiceInputBehavior.value);
        }

        if (elements.hermesProfileSelect) {
            state.activeHermesProfile = elements.hermesProfileSelect.value.trim();
            if (state.activeHermesProfile) {
                AetherUserData.setItem('aether_hermes_profile', state.activeHermesProfile);
            } else {
                AetherUserData.removeItem('aether_hermes_profile');
            }
            const sessionIndex = state.aetherSessions.findIndex(s => s.id === state.activeSessionId);
            if (sessionIndex !== -1) {
                state.aetherSessions[sessionIndex].hermesProfile = state.activeHermesProfile || null;
                schedulePersistSessions();
            }
            updateHermesProfileBadge();
        }

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

        const savedVoiceName = AetherUserData.getItem('aether_voice_name');

        systemVoices.forEach((v) => {
            const opt = document.createElement('option');
            const fullLabel = `${v.name} (${v.lang})`;
            opt.value = v.name;
            opt.textContent = truncateVoiceLabel(fullLabel);
            opt.title = fullLabel;
            if (savedVoiceName && v.name === savedVoiceName) {
                opt.selected = true;
            }
            elements.synthVoice.appendChild(opt);
        });

        if (elements.voicePreviewBtn) {
            elements.voicePreviewBtn.disabled = false;
        }
        syncVoiceSelectTitle();
    }

    async function populateOmniVoiceSamplesList() {
        elements.synthVoice.innerHTML = '<option value="">Loading OmniVoice samples…</option>';
        if (elements.voicePreviewBtn) {
            elements.voicePreviewBtn.disabled = true;
        }

        try {
            const res = await fetch('/api/tts/omnivoice/samples');
            const data = await res.json().catch(() => ({}));
            const samples = Array.isArray(data.samples) ? data.samples : [];

            elements.synthVoice.innerHTML = '';

            const autoOpt = document.createElement('option');
            autoOpt.value = '';
            autoOpt.textContent = 'Auto voice (no sample)';
            autoOpt.title = 'Let OmniVoice choose a voice automatically';
            elements.synthVoice.appendChild(autoOpt);

            if (!res.ok) {
                let message = data.error || 'OmniVoice not configured';
                if (res.status === 503) {
                    message = 'OmniVoice model not ready — wait for /health, or set OMNIVOICE_BASE_URL';
                } else if (res.status === 502) {
                    message = 'Cannot reach OmniVoice server — is OmniVoice-local running?';
                }
                const errOpt = document.createElement('option');
                errOpt.value = '';
                errOpt.textContent = message;
                errOpt.disabled = true;
                elements.synthVoice.appendChild(errOpt);
                return;
            }

            const savedSample = AetherUserData.getItem('aether_omnivoice_sample');

            samples.forEach((s) => {
                const opt = document.createElement('option');
                opt.value = s.id || s.name;
                const transcript = s.hasTranscript ? '' : ' · no transcript';
                const fullLabel = `${s.name}${transcript}`;
                opt.textContent = truncateVoiceLabel(fullLabel);
                opt.title = fullLabel;
                if (savedSample && (s.id === savedSample || s.name === savedSample)) {
                    opt.selected = true;
                }
                elements.synthVoice.appendChild(opt);
            });

            if (!savedSample) {
                autoOpt.selected = true;
            }

            if (elements.voicePreviewBtn) {
                elements.voicePreviewBtn.disabled = false;
            }
            syncVoiceSelectTitle();
        } catch (e) {
            elements.synthVoice.innerHTML = '<option value="">Failed to load OmniVoice samples</option>';
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
                let message = data.error || 'ElevenLabs not configured';
                if (res.status === 405) {
                    message = 'Restart Aether server (npm start) to load ElevenLabs routes';
                } else if (res.status === 503) {
                    message = 'Set ELEVENLABS_API_KEY in .env.local and restart npm start';
                }
                elements.synthVoice.innerHTML = `<option value="">${message}</option>`;
                return;
            }

            const savedVoiceId = AetherUserData.getItem('aether_elevenlabs_voice_id');

            voices.forEach((v) => {
                const opt = document.createElement('option');
                opt.value = v.id;
                const category = v.category ? ` · ${v.category}` : '';
                const fullLabel = `${v.name}${category}`;
                opt.textContent = truncateVoiceLabel(fullLabel);
                opt.title = fullLabel;
                if (savedVoiceId && v.id === savedVoiceId) {
                    opt.selected = true;
                }
                elements.synthVoice.appendChild(opt);
            });

            if (elements.voicePreviewBtn) {
                elements.voicePreviewBtn.disabled = !elements.synthVoice.value;
            }
            syncVoiceSelectTitle();
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
        if (provider === 'omnivoice') {
            populateOmniVoiceSamplesList();
            return;
        }

        populateBrowserVoicesList();
    }

    function previewSelectedVoice() {
        if (!elements.synthVoice) return;

        const rate = parseFloat(elements.synthSpeed?.value || '1.0');
        const provider = elements.ttsProvider?.value || getTtsProvider();

        if (provider === 'omnivoice') {
            speech.previewVoice(elements.synthVoice.value || '', rate, provider);
            return;
        }

        if (!elements.synthVoice.value) return;
        speech.previewVoice(elements.synthVoice.value, rate, provider);
    }

    /* ==========================================================================
       H. Console Markdown Parser
       ========================================================================== */
    const MEDIA_IMAGE_EXTENSIONS = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.ico',
    ]);

    function escapeHtmlText(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeHtmlAttr(value) {
        return escapeHtmlText(value).replace(/"/g, '&quot;');
    }

    function cleanMediaTokenPath(raw) {
        let candidate = String(raw || '').trim();
        if (!candidate) return '';
        candidate = candidate.replace(/^[`"'*]+/, '').replace(/[`"'*,.;:)}]+$/, '');
        return candidate;
    }

    function isImageMediaPath(mediaPath) {
        const cleaned = cleanMediaTokenPath(mediaPath).split('?')[0].split('#')[0];
        if (/^https?:\/\//i.test(cleaned)) {
            const dot = cleaned.lastIndexOf('.');
            if (dot < 0) return true;
            return MEDIA_IMAGE_EXTENSIONS.has(cleaned.slice(dot).toLowerCase());
        }
        const dot = cleaned.lastIndexOf('.');
        if (dot < 0) return false;
        return MEDIA_IMAGE_EXTENSIONS.has(cleaned.slice(dot).toLowerCase());
    }

    function mediaPathBasename(mediaPath) {
        const cleaned = cleanMediaTokenPath(mediaPath);
        if (!cleaned) return 'Image';
        const withoutQuery = cleaned.split('?')[0].split('#')[0];
        const parts = withoutQuery.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || 'Image';
    }

    function buildMediaImageHtml(mediaPath) {
        const cleaned = cleanMediaTokenPath(mediaPath);
        if (!cleaned || !isImageMediaPath(cleaned)) {
            return escapeHtmlText(`MEDIA:${mediaPath}`);
        }
        const alt = escapeHtmlAttr(mediaPathBasename(cleaned));
        const src = /^https?:\/\//i.test(cleaned)
            ? escapeHtmlAttr(cleaned)
            : escapeHtmlAttr(ai.mediaUrl(cleaned));
        if (!src) return escapeHtmlText(`MEDIA:${mediaPath}`);
        return `<img class="bubble-media-image" src="${src}" alt="${alt}" loading="lazy" tabindex="0" role="button" title="Click to expand">`;
    }

    function openMediaLightbox(src, alt) {
        if (!elements.mediaLightbox || !elements.mediaLightboxImage || !src) return;
        elements.mediaLightboxImage.src = src;
        elements.mediaLightboxImage.alt = alt || 'Expanded image';
        if (elements.mediaLightboxCaption) {
            elements.mediaLightboxCaption.textContent = alt || '';
            elements.mediaLightboxCaption.hidden = !alt;
        }
        elements.mediaLightbox.classList.add('open');
        elements.mediaLightbox.setAttribute('aria-hidden', 'false');
    }

    function closeMediaLightbox() {
        if (!elements.mediaLightbox) return;
        elements.mediaLightbox.classList.remove('open');
        elements.mediaLightbox.setAttribute('aria-hidden', 'true');
        if (elements.mediaLightboxImage) {
            elements.mediaLightboxImage.removeAttribute('src');
        }
    }

    function handleMediaImageActivate(e) {
        const img = e.target?.closest?.('.bubble-media-image');
        if (!img?.src) return;
        e.preventDefault();
        openMediaLightbox(img.currentSrc || img.src, img.alt);
    }

    function parseConsoleMarkdown(md) {
        if (!md) return '';
        let html = md;
        const codeStash = [];
        const mediaStash = [];

        html = html.replace(/```([a-z0-9\-]*)\n([\s\S]*?)\n```/gi, (match, lang, code) => {
            const id = codeStash.length;
            codeStash.push({ lang: lang || 'code', code: code.trim(), kind: 'block' });
            return `\x00CODE${id}\x00`;
        });

        html = html.replace(/`([^`\n]+)`/g, (match, code) => {
            const id = codeStash.length;
            codeStash.push({ lang: null, code, kind: 'inline' });
            return `\x00CODE${id}\x00`;
        });

        const MEDIA_TOKEN_RE = /(?:\*\*|`)??MEDIA:\s*((?:https?:\/\/[^\s`"'<>]+)|(?:~\/[^\s`"'<>]+)|(?:\/[^\s`"'<>]+)|(?:[A-Za-z]:[/\\][^\s`"'<>]+))(?:\*\*|`)??/gi;
        html = html.replace(MEDIA_TOKEN_RE, (match, rawPath) => {
            const id = mediaStash.length;
            mediaStash.push(rawPath);
            return `\x00MEDIA${id}\x00`;
        });

        html = escapeHtmlText(html);

        html = html.replace(/\x00CODE(\d+)\x00/g, (match, idStr) => {
            const entry = codeStash[Number(idStr)];
            if (!entry) return match;
            if (entry.kind === 'inline') {
                return `<code>${escapeHtmlText(entry.code)}</code>`;
            }

            const cleanLang = entry.lang || 'code';
            const cleanCode = escapeHtmlText(entry.code);
            const copyId = 'copy_' + Math.random().toString(36).substr(2, 9);

            window[copyId] = () => {
                navigator.clipboard.writeText(entry.code);
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

            return `<pre><div class="code-header">${cleanLang.toUpperCase()}<button type="button" class="copy-btn" id="${copyId}" onclick="window['${copyId}']()"><i data-lucide="copy" style="width:10px; height:10px;"></i> Copy</button></div><code>${cleanCode}</code></pre>`;
        });

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

        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        html = html.replace(/^###\s+(.*?)$/gm, '<div class="bubble-heading-h3">$1</div>');
        html = html.replace(/^####\s+(.*?)$/gm, '<div class="bubble-heading-h4">$1</div>');

        html = html.replace(/^\s*-\s+(.*?)$/gm, '&bull; $1');

        html = html.replace(/\n/g, '<br>');

        html = html.replace(/\x00MEDIA(\d+)\x00/g, (match, idStr) => {
            const rawPath = mediaStash[Number(idStr)];
            if (!rawPath) return match;
            return buildMediaImageHtml(rawPath);
        });

        return html;
    }
});
