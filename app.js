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

    let pendingAttachments = [];
    let chatDropDepth = 0;
    let attachmentUiVerified = false;

    function loadSavedSessions() {
        try {
            return JSON.parse(AetherUserData.getItem('aether_sessions') || '[]').map(normalizeSession);
        } catch {
            return [];
        }
    }

    function normalizeSession(session) {
        const savedHermesProfile = AetherUserData.getItem('aether_hermes_profile') || null;
        return {
            id: session.id || `sess_${Date.now()}`,
            title: session.title || 'Untitled session',
            profile: session.profile || session.model || '',
            source: session.source || (session.id && !session.id.startsWith('sess_') ? 'hermes' : 'local'),
            hermesProfile: session.hermesProfile || savedHermesProfile,
            hermesUpdatedAt: session.hermesUpdatedAt || null,
            startedAt: session.startedAt || session.hermesUpdatedAt || null,
            messages: Array.isArray(session.messages) ? session.messages : [],
        };
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
        sessions: loadSavedSessions(),
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
        chatCollapsedBeforeKanban: null,
        workspaceFiles: [],
        workspaceViewerPath: '',
        skillsItems: [],
        skillsSelectedName: '',
        skillsEditorBaseline: '',
        skillsDir: '',
        hermesStatus: null,
        isVoiceActive: false,
        speechEnabled: JSON.parse(AetherUserData.getItem('aether_speech_enabled') ?? 'true'),
        memory: JSON.parse(AetherUserData.getItem('aether_memory') || '{}'),
        globalAccentTheme: null,
        activeAccentTheme: null,
        globalColorMode: null,
        avatarForm: null,
    };
    state.globalAccentTheme = loadGlobalAccentTheme();
    state.globalColorMode = loadColorMode();
    state.avatarForm = loadAvatarForm();
    AetherUserData.removeItem('aether_session_model_prefs');

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
        closeSettingsBtn: document.getElementById('closeSettingsBtn'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),
        settingsModal: document.getElementById('settingsModal'),
        
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
        speechSynthesisToggle: document.getElementById('speechSynthesisToggle'),
        historyDrawerToggle: document.getElementById('historyDrawerToggle'),
        historyDrawerCloseBtn: document.getElementById('historyDrawerCloseBtn'),
        sidebarDrawer: document.getElementById('sidebarDrawer'),
        workspaceFilesBtn: document.getElementById('workspaceFilesBtn'),
        workspacesDrawerToggle: document.getElementById('workspacesDrawerToggle'),
        workspacesDrawerCloseBtn: document.getElementById('workspacesDrawerCloseBtn'),
        workspacesDrawer: document.getElementById('workspacesDrawer'),
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
        refreshHermesFilesBtn: document.getElementById('refreshHermesFilesBtn'),
        hermesFilesHint: document.getElementById('hermesFilesHint'),
        hermesFilesStatus: document.getElementById('hermesFilesStatus'),
        workspaceFileList: document.getElementById('workspaceFileList'),
        workspacePinBadge: document.getElementById('workspacePinBadge'),
        workspaceFileViewerModal: document.getElementById('workspaceFileViewerModal'),
        closeWorkspaceFileViewerBtn: document.getElementById('closeWorkspaceFileViewerBtn'),
        workspaceFileViewerCloseBtn: document.getElementById('workspaceFileViewerCloseBtn'),
        workspaceFileViewerRevealBtn: document.getElementById('workspaceFileViewerRevealBtn'),
        workspaceFileViewerTitle: document.getElementById('workspaceFileViewerTitle'),
        workspaceFileViewerPath: document.getElementById('workspaceFileViewerPath'),
        workspaceFileViewerBody: document.getElementById('workspaceFileViewerBody'),
        skillsBtn: document.getElementById('skillsBtn'),
        skillsModal: document.getElementById('skillsModal'),
        closeSkillsModalBtn: document.getElementById('closeSkillsModalBtn'),
        cancelSkillsBtn: document.getElementById('cancelSkillsBtn'),
        saveSkillsBtn: document.getElementById('saveSkillsBtn'),
        refreshSkillsBtn: document.getElementById('refreshSkillsBtn'),
        skillsSearch: document.getElementById('skillsSearch'),
        skillsList: document.getElementById('skillsList'),
        skillsEditor: document.getElementById('skillsEditor'),
        skillsEditorEmpty: document.getElementById('skillsEditorEmpty'),
        skillsModalPath: document.getElementById('skillsModalPath'),
        skillsStatus: document.getElementById('skillsStatus'),
        newChatBtn: document.getElementById('newChatBtn'),

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
        toastStack: document.getElementById('toastStack'),
    };

    // Initialize speech mute UI button state
    if (!state.speechEnabled) {
        elements.speechSynthesisToggle.classList.remove('active');
        elements.speechSynthesisToggle.querySelector('i').setAttribute('data-lucide', 'volume-x');
    }
    speech.speechEnabled = state.speechEnabled;

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
    setupEventListeners();
    applyAccentTheme(state.globalAccentTheme);
    applyDisplayName();
    updateHermesProfileBadge();
    updateWorkspacePinBadge();
    renderHistorySessions();
    startLatencyTelemetryMock();
    setBootStatus('Connecting to Hermes…');
    await refreshHermesIntegration();
    setBootStatus('Loading session archive…');

    // Load active session or spawn new (after Hermes sync so archives are current)
    if (!state.activeSessionId) {
        startNewSession();
    } else {
        loadSession(state.activeSessionId);
    }
    
    // Process icons
    lucide.createIcons();

    const chatCollapsed =
        AetherUserData.getItem('aether_chat_column_collapsed') === 'true' ||
        (AetherUserData.getItem('aether_chat_column_collapsed') === null &&
            AetherUserData.getItem('aether_chat_column_open') === 'false');
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

    // Auto-refresh chats when returning to the tab
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state.hermesStatus?.enabled && state.hermesStatus?.connected) {
            refreshHermesChats();
        }
    });

    /* ==========================================================================
       A. HUD Control Event Listeners
       ========================================================================== */
    function setupEventListeners() {
        // Toggle slide-in Sidebar Drawer
        elements.historyDrawerToggle.addEventListener('click', () => toggleSidebarDrawer());
        elements.historyDrawerCloseBtn.addEventListener('click', () => toggleSidebarDrawer(false));

        if (elements.workspacesDrawerToggle) {
            elements.workspacesDrawerToggle.addEventListener('click', () => toggleKanbanMode());
        }
        if (elements.settingsWorkspacesBtn) {
            elements.settingsWorkspacesBtn.addEventListener('click', () => {
                closeSettingsModal();
                openWorkspaceFileBrowser();
            });
        }
        if (elements.workspaceFilesBtn) {
            elements.workspaceFilesBtn.addEventListener('click', () => openWorkspaceFileBrowser());
        }
        if (elements.workspacesDrawerCloseBtn) {
            elements.workspacesDrawerCloseBtn.addEventListener('click', () => toggleWorkspacesDrawer(false));
        }
        if (elements.refreshHermesFilesBtn) {
            elements.refreshHermesFilesBtn.addEventListener('click', () => refreshHermesFiles());
        }
        if (elements.skillsBtn) {
            elements.skillsBtn.addEventListener('click', () => openSkillsModal());
        }
        if (elements.closeSkillsModalBtn) {
            elements.closeSkillsModalBtn.addEventListener('click', () => closeSkillsModal());
        }
        if (elements.cancelSkillsBtn) {
            elements.cancelSkillsBtn.addEventListener('click', () => closeSkillsModal());
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
        if (elements.skillsEditor) {
            elements.skillsEditor.addEventListener('input', () => updateSkillsSaveState());
        }
        if (elements.skillsModal) {
            elements.skillsModal.addEventListener('click', (e) => {
                if (e.target === elements.skillsModal) closeSkillsModal();
            });
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
                if (state.kanbanMode) exitKanbanMode();
            });
            elements.hudCoreVisualizer.addEventListener('keydown', (e) => {
                if (!state.kanbanMode) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    exitKanbanMode();
                }
            });
        }
        if (elements.closeWorkspaceFileViewerBtn) {
            elements.closeWorkspaceFileViewerBtn.addEventListener('click', closeWorkspaceFileViewer);
        }
        if (elements.workspaceFileViewerCloseBtn) {
            elements.workspaceFileViewerCloseBtn.addEventListener('click', closeWorkspaceFileViewer);
        }
        if (elements.workspaceFileViewerRevealBtn) {
            elements.workspaceFileViewerRevealBtn.addEventListener('click', () => {
                if (!state.workspaceViewerPath) return;
                ai.revealKanbanPath(state.workspaceViewerPath, state.activeKanbanBoard).catch((err) => {
                    showToast('Open failed', err.message || 'Could not open file.', { variant: 'error' });
                });
            });
        }
        if (elements.workspaceFileViewerModal) {
            elements.workspaceFileViewerModal.addEventListener('click', (e) => {
                if (e.target === elements.workspaceFileViewerModal) closeWorkspaceFileViewer();
            });
        }
        
        // Settings triggers
        elements.settingsBtn.addEventListener('click', openSettingsModal);
        elements.closeSettingsBtn.addEventListener('click', closeSettingsModal);
        elements.saveSettingsBtn.addEventListener('click', saveSettings);
        elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === elements.settingsModal) closeSettingsModal();
        });

        document.querySelectorAll('[data-settings-tab]').forEach((tab) => {
            tab.addEventListener('click', () => activateSettingsTab(tab.dataset.settingsTab));
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
                || !!activeEl?.closest?.('.model-picker-modal, .settings-modal, .ak-inline-create');

            if (state.kanbanMode || typingInKanban) {
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
            if (e.key === 'Escape' && elements.workspaceFileViewerModal?.classList.contains('open')) {
                e.preventDefault();
                closeWorkspaceFileViewer();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.skillsModal?.classList.contains('open')) {
                e.preventDefault();
                closeSkillsModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.modelPickerModal?.classList.contains('open')) {
                e.preventDefault();
                closeModelPicker();
            }
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
    function toggleSidebarDrawer(forceOpen) {
        const shouldOpen = forceOpen === undefined
            ? !elements.sidebarDrawer.classList.contains('open')
            : forceOpen;
        elements.sidebarDrawer.classList.toggle('open', shouldOpen);
        elements.historyDrawerToggle.classList.toggle('active', shouldOpen);
        if (shouldOpen && elements.workspacesDrawer?.classList.contains('open')) {
            toggleWorkspacesDrawer(false);
        }
    }

    function toggleWorkspacesDrawer(forceOpen) {
        if (!elements.workspacesDrawer) return;
        const shouldOpen = forceOpen === undefined
            ? !elements.workspacesDrawer.classList.contains('open')
            : forceOpen;
        elements.workspacesDrawer.classList.toggle('open', shouldOpen);
        elements.workspaceFilesBtn?.classList.toggle('active', shouldOpen);
        if (shouldOpen) {
            if (elements.sidebarDrawer?.classList.contains('open')) {
                toggleSidebarDrawer(false);
            }
            refreshHermesFiles();
        }
    }

    async function openWorkspaceFileBrowser() {
        if (elements.workspacesDrawer?.classList.contains('open')) {
            toggleWorkspacesDrawer(false);
            return;
        }
        toggleWorkspacesDrawer(true);
    }

    async function refreshHermesFiles() {
        const statusEl = elements.hermesFilesStatus;
        const hintEl = elements.hermesFilesHint;
        if (elements.refreshHermesFilesBtn) {
            elements.refreshHermesFilesBtn.classList.add('refreshing');
        }
        if (statusEl) statusEl.textContent = 'Loading files…';
        try {
            const result = await ai.getHermesFiles();
            state.workspaceFiles = result.files || [];
            renderWorkspaceFileList();
            if (statusEl) {
                const count = state.workspaceFiles.length;
                statusEl.textContent = count
                    ? `${count} file${count === 1 ? '' : 's'} from Hermes workspace`
                    : 'No files yet — ask Hermes to create one.';
            }
            if (hintEl && result.roots?.length) {
                hintEl.textContent = 'Files Hermes creates — markdown, notes, uploads, and task outputs.';
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = err.message || 'Could not load files.';
            if (hintEl) hintEl.textContent = err.message || 'Failed to load Hermes files.';
            appendSystemConsoleLine(`[FILES] ${err.message || 'Load failed'}`);
        } finally {
            elements.refreshHermesFilesBtn?.classList.remove('refreshing');
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
        if (!query) return state.skillsItems;
        return state.skillsItems.filter((skill) => {
            const haystack = [
                skill.name,
                skill.displayName,
                skill.description,
                ...(skill.tags || []),
            ].join(' ').toLowerCase();
            return haystack.includes(query);
        });
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

            const name = document.createElement('span');
            name.className = 'skill-row-name';
            name.textContent = skill.displayName || skill.name;

            const desc = document.createElement('span');
            desc.className = 'skill-row-desc';
            desc.textContent = skill.description || skill.name;

            main.appendChild(name);
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
                `${result.displayName || name} — run /reload-skills in Hermes to apply.`,
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
            state.skillsDir = result.skillsDir || '';
            if (elements.skillsModalPath) {
                elements.skillsModalPath.textContent = state.skillsDir || 'Skills directory unavailable';
            }
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

    function openSkillsModal() {
        elements.skillsModal?.classList.add('open');
        elements.skillsBtn?.classList.add('active');
        if (elements.skillsSearch) elements.skillsSearch.value = '';
        refreshHermesSkills();
    }

    function closeSkillsModal() {
        elements.skillsModal?.classList.remove('open');
        elements.skillsBtn?.classList.remove('active');
        setSkillsStatus('');
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
            el.setAttribute('aria-label', 'Return to chat mode');
            el.title = 'Return to chat';
        } else {
            el.removeAttribute('role');
            el.removeAttribute('tabindex');
            el.removeAttribute('aria-label');
            el.removeAttribute('title');
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
        runTransitionResizeLoop();
    }

    function collapseChatColumn() {
        elements.hudShell?.classList.add('chat-collapsed');
        elements.chatDeckToggle.classList.remove('active');
        AetherUserData.setItem('aether_chat_column_collapsed', 'true');
        updateMicButtonTitle();
        runTransitionResizeLoop();
    }

    function updateMicButtonTitle() {
        if (!elements.voiceRecognitionBtn) return;
        const behavior = AetherUserData.getItem('aether_voice_input_behavior') || 'auto';
        const isChatCollapsed = elements.hudShell?.classList.contains('chat-collapsed');
        
        if (behavior === 'llm' || (behavior === 'auto' && isChatCollapsed)) {
            elements.voiceRecognitionBtn.title = `Speak directly to ${getDisplayName()} (Voice-to-LLM Mode)`;
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

        // Stop currently playing synthesis
        speech.stopSpeaking();
        visualizer.setState('idle');

        // Render input in diagnostic terminal logs and chat deck bubble
        const userDisplayText = trimmedText || '(attachment)';
        appendSystemConsoleLine(`[USER] &gt; ${userDisplayText}${outgoingAttachments.length ? ` [${outgoingAttachments.length} file${outgoingAttachments.length === 1 ? '' : 's'}]` : ''}`);
        appendUserChatBubble(trimmedText, outgoingAttachments, state.activeWorkspacePath || null);
        saveMessageToSession('user', trimmedText, { attachments: serializeAttachmentsForSession(outgoingAttachments) });

        // Spawn thinking state animations
        visualizer.setState('thinking');

        // Create placeholders in both logs
        const consoleLogNode = appendSystemConsoleLine(`[AETHER] ...`);
        const bubbleNode = appendAssistantChatBubble('...');
        setAssistantBubbleToolPreview(bubbleNode, { name: '_thinking', label: 'Thinking…', status: 'thinking' });
        visualizer.setThinkingCaption('Thinking…');

        const messageForAi = buildMessageWithWorkspaceContext(trimmedText);

        try {
            const activeSession = state.sessions.find(s => s.id === state.activeSessionId);
            const history = activeSession ? activeSession.messages : [];
            if (state.hermesStatus?.enabled) {
                appendSystemConsoleLine(
                    state.hermesStatus.connected
                        ? `[AGENT] Routing command through Hermes${activeSession?.id && !activeSession.id.startsWith('sess_') ? ` session ${String(activeSession.id).slice(0, 18)}` : ''}.`
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
                    sessionId: activeSession?.id,
                    hermesProfile: activeSession?.hermesProfile || state.activeHermesProfile,
                    attachments: outgoingAttachments,
                    onToolProgress: (toolInfo) => {
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

            const activeIdx = state.sessions.findIndex((s) => s.id === state.activeSessionId);
            if (activeIdx !== -1) {
                tagAssistantBubbleMessageIndex(
                    bubbleNode,
                    state.sessions[activeIdx].messages.length - 1
                );
            }
            syncReplayButtonsForSession();

            if (elements.workspacesDrawer?.classList.contains('open')) {
                refreshHermesFiles();
            }

        } catch (err) {
            console.error("Aether telemetry failure: ", err);
            const errMsg = `[AETHER ERROR] Telemetry routing failed. Error: ${err.message}`;
            consoleLogNode.innerHTML = `<span style="color:var(--error);">${errMsg}</span>`;
            const errorContent = ensureAssistantBubbleStructure(bubbleNode);
            if (errorContent) {
                errorContent.innerHTML = `<span style="color:var(--error);">${errMsg}</span>`;
            }
            clearAssistantBubbleToolPreview(bubbleNode);
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
        const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
        if (sessionIndex === -1 || !hermes) return;
        
        const hermesSessionId = hermes.sessionId || hermes.conversationId || null;
        if (hermesSessionId) {
            state.lastHermesSessionId = hermesSessionId;
            AetherUserData.setItem('aether_last_hermes_session_id', hermesSessionId);
        }
        
        // If we got a Hermes session ID and the current session has a sess_ prefix,
        // replace the session ID with the canonical Hermes ID
        if (hermesSessionId && state.sessions[sessionIndex].id.startsWith('sess_')) {
            const oldId = state.sessions[sessionIndex].id;
            state.sessions[sessionIndex].id = hermesSessionId;
            if (state.activeSessionId === oldId) {
                state.activeSessionId = hermesSessionId;
                AetherUserData.setItem('aether_active_session_id', hermesSessionId);
            }
        }
        
        state.sessions[sessionIndex].source = 'hermes';
        state.sessions[sessionIndex].hermesProfile = hermes.profile || state.activeHermesProfile || null;
        state.sessions[sessionIndex].hermesUpdatedAt = new Date().toISOString();
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
        const session = state.sessions.find((s) => s.id === state.activeSessionId);
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
            speech.replayById(btn.dataset.replayId, btn.dataset.fallbackText || null, () => {
                visualizer.stopSpeechMouthCue();
                visualizer.enterPostTalk();
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
            }
            speech.speak(
                speakableText,
                null,
                (event) => visualizer.handleSpeechBoundary(event),
                () => {
                    visualizer.stopSpeechMouthCue();
                    visualizer.enterPostTalk();
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

                const behavior = AetherUserData.getItem('aether_voice_input_behavior') || 'auto';
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
                    resizeChatComposerInput();
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
        AetherUserData.setItem('aether_speech_enabled', state.speechEnabled);
        speech.speechEnabled = state.speechEnabled;

        if (state.speechEnabled) {
            elements.speechSynthesisToggle.classList.add('active');
            elements.speechSynthesisToggle.querySelector('i').setAttribute('data-lucide', 'volume-2');
            appendSystemConsoleLine("[SYSTEM] Voice synthesis activated.");
        } else {
            elements.speechSynthesisToggle.classList.remove('active');
            elements.speechSynthesisToggle.querySelector('i').setAttribute('data-lucide', 'volume-x');
            speech.stopSpeaking();
            visualizer.stopSpeechMouthCue();
            if (visualizer.state === 'speaking') {
                visualizer.setState('idle');
            }
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
            state.sessions = pruneSessions(state.sessions);
            try {
                AetherUserData.setItem('aether_sessions', JSON.stringify(state.sessions));
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
            hermesProfile: state.activeHermesProfile || state.hermesStatus?.profile || null,
            hermesUpdatedAt: null,
            messages: []
        };

        state.sessions.unshift(newSession);
        state.activeSessionId = id;
        
        AetherUserData.setItem('aether_active_session_id', id);
        schedulePersistSessions();

        // Wipe logs
        elements.consoleScroller.innerHTML = `<div class="console-log-line system-line">[SYSTEM] Client connection active. Telemetries initialized.</div>
        <div class="console-log-line">${getWelcomeConsoleMessage()}</div>`;

        elements.deckChatScroller.innerHTML = '';
        appendAssistantChatBubble('New session started. Awaiting inputs…');

        scheduleRenderHistorySessions();
        speech.stopSpeaking();
    }

    async function loadSession(sessionId) {
        const isHermesId = (id) => id && !String(id).startsWith('sess_');

        let session = state.sessions.find(s => s.id === sessionId);

        // If not found locally but it's a Hermes ID, try fetching from API and injecting into state
        if (!session && isHermesId(sessionId) && ai) {
            console.warn(`[loadSession] Session "${sessionId}" not in local state, attempting to fetch from Hermes state.db...`);
            try {
                const msgs = await ai.getHermesSessionMessages(sessionId);
                const freshMessages = (msgs.available && Array.isArray(msgs.messages))
                    ? normalizeHermesMessages(msgs.messages) : [];

                const newSession = normalizeSession({
                    id: sessionId,
                    title: `Session ${sessionId.slice(0, 8)}`,
                    source: 'hermes',
                    startedAt: null,
                    hermesProfile: state.activeHermesProfile || state.hermesStatus?.profile || null,
                    hermesUpdatedAt: null,
                    messages: freshMessages,
                });
                state.sessions.unshift(newSession);
                session = newSession;
                console.log(`[loadSession] Injected Hermes session "${sessionId}" with ${freshMessages.length} messages`);
            } catch (e) {
                console.warn('[loadSession] Failed to fetch session from state.db:', e);
                startNewSession();
                return;
            }
        }

        if (!session) {
            console.warn(`[loadSession] Session not found: "${sessionId}" — available IDs:`, state.sessions.map(s => s.id).slice(0, 10), state.sessions.length > 10 ? `... (${state.sessions.length} total)` : '');
            startNewSession();
            return;
        }

        state.activeSessionId = sessionId;
        AetherUserData.setItem('aether_active_session_id', sessionId);
        updateHermesProfileBadge();

        // For Hermes sessions, always fetch latest messages from state.db
        if (isHermesId(session.id) && ai) {
            try {
                console.log(`[loadSession] Fetching latest messages for Hermes session: ${session.id}`);
                const msgs = await ai.getHermesSessionMessages(session.id);
                if (msgs.available && Array.isArray(msgs.messages) && msgs.messages.length > 0) {
                    const freshMessages = normalizeHermesMessages(msgs.messages);
                    if (freshMessages.length > 0) {
                        session.messages = freshMessages;
                        session.source = 'hermes';
                        schedulePersistSessions();
                    }
                }
            } catch (e) {
                console.warn('[loadSession] Failed to fetch Hermes messages, falling back to cached:', e);
            }
        }

        // Load logs
        elements.consoleScroller.innerHTML = `<div class="console-log-line system-line">[SYSTEM] Historical session re-loaded.</div>`;
        
        if (session.messages.length === 0) {
            elements.consoleScroller.innerHTML += `<div class="console-log-line">Active session log empty. Awaiting inputs...</div>`;
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
        const sessionIndex = state.sessions.findIndex(s => s.id === state.activeSessionId);
        if (sessionIndex === -1) return;

        const message = { role, content };
        if (Array.isArray(meta.attachments) && meta.attachments.length) {
            message.attachments = meta.attachments;
        }
        if (meta.backend) message.backend = meta.backend;
        if (meta.audioReplayId) message.audioReplayId = meta.audioReplayId;
        state.sessions[sessionIndex].messages.push(message);
        
        // Title update
        if (state.sessions[sessionIndex].messages.length === 2) {
            const firstUserMessage = state.sessions[sessionIndex].messages.find(m => m.role === 'user');
            if (firstUserMessage) {
                const titleSeed = firstUserMessage.content
                    || firstUserMessage.attachments?.[0]?.name
                    || 'Attachment';
                const words = titleSeed.split(' ');
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
            list.innerHTML = `<div style="font-size:0.65rem; color:var(--text-dim); text-align:center; padding:10px;">No chats yet</div>`;
            return;
        }

        // Always sort most-recent-first by startedAt
        const sorted = [...state.sessions].sort((a, b) => {
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
                btn.title = `Hermes profile: ${s.hermesProfile || 'default'}`;
            }

            btn.appendChild(icon);
            btn.appendChild(titleSpan);
            
            btn.addEventListener('click', () => {
                loadSession(s.id);
                toggleSidebarDrawer();
            });
            fragment.appendChild(btn);
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

    async function refreshHermesIntegration() {
        try {
            const status = await ai.getBackendStatus();
            state.hermesStatus = status;
            updateHermesStatusUi(status);
            if (status.enabled && status.connected) {
                appendSystemConsoleLine(`[AGENT] Hermes bridge connected: ${status.model || 'default model'}`);
                // Fetch profiles and populate the dropdown
                populateHermesProfiles();
                if (elements.hudShell?.classList.contains('boot-loading')) {
                    setBootStatus('Syncing Hermes sessions…');
                }
                await syncHermesSessions();
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
        const name = String(file?.relativePath || file?.name || '').toLowerCase();
        if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(name)) return 'image';
        if (/\.(md|markdown|txt|log)$/.test(name)) return 'file-text';
        if (/\.(json|ya?ml|toml|xml|csv)$/.test(name)) return 'file-code';
        return 'file';
    }

    function renderWorkspaceFileList() {
        const list = elements.workspaceFileList;
        if (!list) return;
        list.replaceChildren();

        const files = state.workspaceFiles.filter((entry) => entry.path);
        if (!files.length) {
            const empty = document.createElement('div');
            empty.className = 'workspace-empty-hint';
            empty.textContent = 'No files yet. Ask Hermes to create a markdown file or upload something.';
            list.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const file of files) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'workspace-file-row';
            row.title = 'Open and read file';

            const icon = document.createElement('span');
            icon.innerHTML = `<i data-lucide="${workspaceFileIconName(file)}"></i>`;

            const meta = document.createElement('span');
            meta.className = 'workspace-file-meta';

            const label = document.createElement('span');
            label.className = 'workspace-file-name';
            label.textContent = file.relativePath || file.name;

            const size = document.createElement('span');
            size.className = 'workspace-file-size';
            size.textContent = formatWorkspaceFileSize(file.size);

            meta.appendChild(label);
            meta.appendChild(size);
            row.appendChild(icon);
            row.appendChild(meta);
            row.addEventListener('click', () => openWorkspaceFileViewer(file.path, file.relativePath || file.name));
            fragment.appendChild(row);
        }
        list.appendChild(fragment);
        refreshBubbleIcons(list);
    }

    function closeWorkspaceFileViewer() {
        elements.workspaceFileViewerModal?.classList.remove('open');
        state.workspaceViewerPath = '';
        if (elements.workspaceFileViewerBody) elements.workspaceFileViewerBody.replaceChildren();
    }

    async function openWorkspaceFileViewer(filePath, displayName) {
        if (!filePath) return;
        state.workspaceViewerPath = filePath;
        elements.workspaceFileViewerModal?.classList.add('open');
        if (elements.workspaceFileViewerTitle) {
            elements.workspaceFileViewerTitle.textContent = displayName || filePath.split('/').pop() || 'File';
        }
        if (elements.workspaceFileViewerPath) {
            elements.workspaceFileViewerPath.textContent = filePath;
        }
        if (elements.workspaceFileViewerBody) {
            elements.workspaceFileViewerBody.replaceChildren();
            const loading = document.createElement('div');
            loading.className = 'workspace-file-viewer-loading';
            loading.textContent = 'Loading file…';
            elements.workspaceFileViewerBody.appendChild(loading);
        }

        try {
            const result = await ai.readWorkspaceFile(filePath, state.activeKanbanBoard);
            renderWorkspaceFileViewerContent(result);
        } catch (err) {
            renderWorkspaceFileViewerError(err.message || 'Could not read file.');
        }
    }

    function renderWorkspaceFileViewerError(message) {
        const body = elements.workspaceFileViewerBody;
        if (!body) return;
        body.replaceChildren();
        const error = document.createElement('div');
        error.className = 'workspace-file-viewer-error';
        error.textContent = message;
        body.appendChild(error);
    }

    function renderWorkspaceFileViewerContent(result) {
        const body = elements.workspaceFileViewerBody;
        if (!body) return;
        body.replaceChildren();

        if (result.kind === 'image') {
            const img = document.createElement('img');
            img.className = 'workspace-file-viewer-image';
            img.alt = result.name || 'Workspace image';
            img.src = ai.workspaceFileUrl(result.path, state.activeKanbanBoard);
            body.appendChild(img);
            return;
        }

        if (result.kind === 'text') {
            const pre = document.createElement('pre');
            pre.className = 'workspace-file-viewer-text';
            pre.textContent = result.content || '';
            body.appendChild(pre);
            return;
        }

        const notice = document.createElement('div');
        notice.className = 'workspace-file-viewer-binary';
        notice.textContent = 'This file cannot be previewed in the HUD. Use Open in Finder to view it locally.';
        body.appendChild(notice);
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
            // Re-fetch Hermes sessions from state.db and merge into existing sessions
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
                const existing = state.sessions.find((s) => s.id === hermesSessionId);

                if (existing) {
                    existing.title = title;
                    existing.source = 'hermes';
                    existing.model = item.model || existing.model || '';
                    if (item.startedAt) existing.startedAt = item.startedAt;
                    refreshed++;
                } else {
                    state.sessions.push(normalizeSession({
                        id: hermesSessionId,
                        title,
                        profile: item.model || '',
                        source: 'hermes',
                        startedAt: item.startedAt || null,
                        hermesProfile: state.activeHermesProfile || state.hermesStatus?.profile || null,
                        hermesUpdatedAt: null,
                        messages: [],
                    }));
                    imported++;
                }
            }

            if (imported > 0 || refreshed > 0) {
                state._displayedSessionCount = SESSIONS_PAGE_SIZE;
                schedulePersistSessions();
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
                
                // Use the Hermes session ID as the canonical ID — no more two-ID system
                const title = item.title || `Session ${hermesSessionId.slice(0, 8)}`;

                const existing = state.sessions.find((s) => s.id === hermesSessionId);
                const shouldHydrate =
                    !existing ||
                    !existing.messages?.length;

                if (existing) {
                    existing.title = title;
                    existing.source = 'hermes';
                    existing.model = item.model || existing.model || '';
                    if (item.startedAt) existing.startedAt = item.startedAt;

                    if (shouldHydrate) {
                        try {
                            const msgs = await ai.getHermesSessionMessages(hermesSessionId);
                            if (msgs.available && Array.isArray(msgs.messages) && msgs.messages.length > 0) {
                                existing.messages = normalizeHermesMessages(msgs.messages);
                                refreshed++;
                                if (existing.id === state.activeSessionId) {
                                    activeSessionUpdated = true;
                                }
                            }
                        } catch (err) {
                            // skip this hydrate
                        }
                    }
                    continue;
                }

                // Import new session
                let messages = [];
                if (Array.isArray(item.messages) && item.messages.length > 0) {
                    messages = normalizeHermesMessages(item.messages);
                } else {
                    try {
                        const msgs = await ai.getHermesSessionMessages(hermesSessionId);
                        if (msgs.available && Array.isArray(msgs.messages)) {
                            messages = normalizeHermesMessages(msgs.messages);
                        }
                    } catch (err) {
                        // messages stay empty
                    }
                }

                state.sessions.unshift(normalizeSession({
                    id: hermesSessionId,
                    title,
                    profile: item.model || '',
                    source: 'hermes',
                    startedAt: item.startedAt || null,
                    hermesProfile: state.activeHermesProfile || state.hermesStatus?.profile || null,
                    hermesUpdatedAt: null,
                    messages,
                }));
                imported++;
            }

            if (imported > 0 || refreshed > 0) {
                // Reset pagination so fresh imports appear
                state._displayedSessionCount = SESSIONS_PAGE_SIZE;
                schedulePersistSessions();
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
    }

    function updateModelButton() {
        if (!elements.modelBtnLabel) return;
        const { model } = getResolvedHermesModel();
        elements.modelBtnLabel.textContent = truncateModelLabel(model);
        if (elements.modelBtn) {
            elements.modelBtn.title = `Switch model (Hermes) — ${model}`;
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

        return {
            prefix: isThinking ? '' : 'Calling',
            emoji: info.emoji ? String(info.emoji) : '',
            detail,
            isThinking,
        };
    }

    function setAssistantBubbleToolPreview(bubbleNode, toolInfo) {
        const formatted = formatToolPreviewLabel(toolInfo);
        if (!bubbleNode || !formatted) return;
        bubbleNode.classList.add('assistant-bubble-tool-active');

        const content = ensureAssistantBubbleStructure(bubbleNode);
        if (!content) return;
        content.replaceChildren();

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
        content.appendChild(preview);
        elements.deckChatScroller.scrollTop = elements.deckChatScroller.scrollHeight;
    }

    function clearAssistantBubbleToolPreview(bubbleNode) {
        if (!bubbleNode) return;
        bubbleNode.classList.remove('assistant-bubble-tool-active');
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

    function resizeChatComposerInput() {
        const field = elements.deckChatInputField;
        if (!field) return;

        const maxHeight = 120;
        field.style.height = 'auto';
        const nextHeight = Math.max(24, Math.min(field.scrollHeight, maxHeight));
        field.style.height = `${nextHeight}px`;
        field.style.overflowY = field.scrollHeight > maxHeight ? 'auto' : 'hidden';
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

    function activateSettingsTab(tabId) {
        const targetTab = tabId || 'appearance';
        document.querySelectorAll('[data-settings-tab]').forEach((tab) => {
            const active = tab.dataset.settingsTab === targetTab;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.tabIndex = active ? 0 : -1;
        });

        document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
            const active = panel.dataset.settingsPanel === targetTab;
            panel.classList.toggle('active', active);
            panel.hidden = !active;
        });
    }

    function openSettingsModal() {
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

        if (elements.voiceInputBehavior) {
            elements.voiceInputBehavior.value = AetherUserData.getItem('aether_voice_input_behavior') || 'auto';
        }

        if (elements.hermesProfileSelect) {
            elements.hermesProfileSelect.value = state.activeHermesProfile;
            populateHermesProfilesList();
        }

        refreshHermesIntegration();

        populateVoicesList();
        activateSettingsTab('appearance');
        lucide.createIcons();

        elements.settingsModal.classList.add('open');
    }

    function closeSettingsModal() {
        elements.settingsModal.classList.remove('open');
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

            return `<pre><div class="code-header">${cleanLang.toUpperCase()}<button type="button" class="copy-btn" id="${copyId}" onclick="window['${copyId}']()"><i data-lucide="copy" style="width:10px; height:10px;"></i> Copy</button></div><code>${cleanCode}</code></pre>`;
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
