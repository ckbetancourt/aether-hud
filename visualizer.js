/**
 * Aether HUD Visualization Engine
 * Renders a full-screen, high-performance sci-fi hologram:
 * - A 3D-like liquid morphing plasma orb using harmonic math curves
 * - Concentric rotating orbital tracks, tick mark gauges, and dashed segments
 * - A 3D Parallax stardust field responsive to mouse coordinates
 * - Audio active warping and pulsing scaling states
 */

const DEFAULT_WEB_LABELS = {
    0: ['IN_TOKN', 'POS_EMB', 'VOC_IN', 'ATT_IN', 'CTX_VEC', 'SEN_EMB', 'LAT_IN', 'SRC_VEC'],
    1: ['Q_PROJ', 'K_PROJ', 'V_PROJ', 'FFN_UP', 'FFN_GAT', 'RE_LU', 'GEL_U', 'LN_RMS', 'SOFT_M', 'DOT_PR', 'MHA_01', 'MHA_02'],
    2: ['FFN_DN', 'O_PROJ', 'ATT_OUT', 'RES_ADD', 'LN_RMS2', 'DROPOUT', 'CONV_1D', 'ATT_H2', 'ATT_H3', 'MHA_03', 'MHA_04', 'OUT_PROJ'],
    3: ['TOK_OUT', 'LOGITS', 'PROB_S', 'DEC_OUT', 'SOFT_MX', 'OUT_VEC', 'LAT_OUT', 'END_TOK'],
};

const DEFAULT_WEB_PROFILE = {
    topology: 'feedforward',
    layers: [8, 12, 12, 8],
    layerXPositions: [-1.8, -0.6, 0.6, 1.8],
    labels: DEFAULT_WEB_LABELS,
    stateMultipliers: {
        idle: { expansion: 1, opacity: 1 },
        listening: { expansion: 1, opacity: 1 },
        thinking: { expansion: 1, opacity: 1 },
        'post-talk': { expansion: 1, opacity: 1 },
    },
    lineStyle: 'solid',
    lineAlpha: 0.08,
    lineWidth: 0.35,
    nodeGlow: 6,
    colorMix: { primary: 1, secondary: 1, white: 0 },
    showLabels: true,
    showTelemetry: true,
    connectionMode: 'layered',
    nodeDrift: 0,
    sweepMode: 'feedforward',
    sweepSpeed: 0.038,
    sweepIntervalMs: 2000,
    thinkingPulseRate: 18,
    randomFlicker: 0.025,
    proximityLinks: false,
    proximityDistance: 0.55,
    verticalSpread: 2.4,
};

class JarvisHUD {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.avatarLayer = document.getElementById('avatarLayer');
        this.renderedAvatarForm = null;
        this.state = 'idle'; // 'idle', 'listening', 'thinking', 'speaking'
        this.thinkingCaption = '';
        // 3D Parallax Anchors
        this.mouseX = 0;
        this.mouseY = 0;
        this.parallaxX = 0;
        this.parallaxY = 0;
        
        // Time and Animation counters
        this.time = 0;
        this.animationId = null;
        this.orbPulseScale = 1.0;
        this.ringRotationAngle = 0;
        this.coreBaseRadius = 110;
        
        // Background Ambient Constellation Web
        this.bgNodes = [];
        this.initBackgroundNodes();

        // Neural Plexus Web & Jarvis Dynamics
        this.webNodes = [];
        this.feedforwardSignals = [];
        this.shockwaves = [];
        this.webExpansion = 1.0;
        this.webOpacity = 0.25;
        this.sweepY = 0;
        this.sweepDirection = 1;

        // Dynamic Shape Morphing parameters (lobes, weights, squash/stretch)
        this.harmonicLobe1 = 3.0;
        this.harmonicLobe2 = 5.0;
        this.harmonicLobe3 = 2.0;
        this.harmonicLobe4 = 7.0;
        
        this.harmonicWeight1 = 0.35;
        this.harmonicWeight2 = 0.28;
        this.harmonicWeight3 = 0.25;
        this.harmonicWeight4 = 0.22;
        
        this.stretchX = 1.0;
        this.stretchY = 1.0;
        this.morphPhase = 0;
        this.activationTick = 0;
        this.blobCoreShimmer = 0;
        this.blobRingPulse = 0;
        this.blobLaserBoost = 0;
        this._speechPlaybackActive = false;
        this._lastThinkingSweepAt = 0;
        this.stageMotion = { x: 0, y: 0, rotate: 0, scale: 1 };
        this._stageRoamSeed = Math.random() * Math.PI * 2;

        this.postTalkVariants = [
            { id: 'pt-stage-soft-return', layer: 'stage', intensity: 'subtle', weight: 1.5, durationScale: 0.88 },
            { id: 'pt-stage-glide', layer: 'stage', intensity: 'subtle', weight: 1.3, durationScale: 0.92 },
            { id: 'pt-stage-drift-up', layer: 'stage', intensity: 'subtle', weight: 1.2, durationScale: 0.9 },
            { id: 'pt-stage-hop', layer: 'stage', intensity: 'dynamic', weight: 1.1, durationScale: 1.05 },
            { id: 'pt-stage-spiral', layer: 'stage', intensity: 'dynamic', weight: 1.0, durationScale: 1.08 },
            { id: 'pt-stage-slide', layer: 'stage', intensity: 'dynamic', weight: 1.0, durationScale: 1.06 },
            { id: 'pt-stage-orbit', layer: 'stage', intensity: 'dynamic', weight: 1.0, durationScale: 1.1 },
            { id: 'pt-stage-arc', layer: 'stage', intensity: 'dynamic', weight: 0.95, durationScale: 1.12 },
            { id: 'pt-stage-bounce', layer: 'stage', intensity: 'dynamic', weight: 0.9, durationScale: 1.04 },
            { id: 'pt-body-soft-settle', layer: 'body', target: 'float', intensity: 'subtle', weight: 1.6, forms: ['nova', 'wisp', 'eve'], durationScale: 0.9 },
            { id: 'pt-body-gentle-sway', layer: 'body', target: 'float', intensity: 'subtle', weight: 1.4, forms: ['nova', 'wisp', 'eve'], durationScale: 0.92 },
            { id: 'pt-body-exhale', layer: 'body', target: 'float', intensity: 'subtle', weight: 1.3, forms: ['nova', 'wisp', 'eve'], durationScale: 0.88 },
            { id: 'pt-body-bounce-roam', layer: 'body', target: 'float', intensity: 'dynamic', weight: 1.2, forms: ['nova', 'wisp', 'eve'], durationScale: 1.05 },
            { id: 'pt-body-spiral-lift', layer: 'body', target: 'float', intensity: 'dynamic', weight: 1.1, forms: ['wisp', 'nova'], durationScale: 1.08 },
            { id: 'pt-body-sway-wide', layer: 'body', target: 'float', intensity: 'dynamic', weight: 1.0, forms: ['nova', 'eve'], durationScale: 1.06 },
            { id: 'pt-body-power-dip', layer: 'body', target: 'float', intensity: 'dynamic', weight: 1.0, forms: ['eve'], durationScale: 1.04 },
            { id: 'pt-body-triple-bob', layer: 'body', target: 'float', intensity: 'dynamic', weight: 0.95, forms: ['nova', 'wisp'], durationScale: 1.02 },
            { id: 'pt-accent-cheek-fade', layer: 'accent', target: 'cheeks', intensity: 'subtle', weight: 1.2, forms: ['nova'], durationScale: 0.9 },
            { id: 'pt-accent-ear-droop', layer: 'accent', target: 'ears', intensity: 'subtle', weight: 1.1, forms: ['nova'], durationScale: 0.92 },
            { id: 'pt-accent-glow-fade', layer: 'accent', target: 'core', intensity: 'subtle', weight: 1.3, forms: ['nova', 'wisp', 'eve'], durationScale: 0.88 },
            { id: 'pt-accent-limb-loosen', layer: 'accent', target: 'limbs', intensity: 'subtle', weight: 1.0, forms: ['nova'], durationScale: 0.9 },
            { id: 'pt-accent-spark-trail', layer: 'accent', target: 'sparks', intensity: 'dynamic', weight: 1.2, forms: ['wisp'], durationScale: 1.05 },
            { id: 'pt-accent-spark-burst', layer: 'accent', target: 'sparks', intensity: 'dynamic', weight: 0.9, forms: ['wisp'], durationScale: 1.0 },
            { id: 'pt-accent-visor-dim', layer: 'accent', target: 'eyes', intensity: 'subtle', weight: 1.2, forms: ['eve'], durationScale: 0.9 },
            { id: 'pt-accent-head-lower', layer: 'accent', target: 'head', intensity: 'dynamic', weight: 1.1, forms: ['eve'], durationScale: 1.04 },
            { id: 'pt-accent-ring-collapse', layer: 'accent', target: 'ground', intensity: 'dynamic', weight: 1.0, forms: ['eve'], durationScale: 1.02 },
            { id: 'pt-accent-arm-tuck', layer: 'accent', target: 'arms', intensity: 'subtle', weight: 1.0, forms: ['eve'], durationScale: 0.92 },
            { id: 'pt-blob-soft-sigh', layer: 'blob', target: 'blob', intensity: 'subtle', weight: 1.4, forms: ['classic-blob'], durationScale: 0.9 },
            { id: 'pt-blob-web-fade', layer: 'blob', target: 'blob', intensity: 'subtle', weight: 1.2, forms: ['classic-blob'], durationScale: 0.92 },
            { id: 'pt-blob-ring-pulse', layer: 'blob', target: 'blob', intensity: 'dynamic', weight: 1.1, forms: ['classic-blob'], durationScale: 1.05 },
            { id: 'pt-blob-orbit-compress', layer: 'blob', target: 'blob', intensity: 'dynamic', weight: 1.0, forms: ['classic-blob'], durationScale: 1.08 },
        ];

        this.thinkingVariants = [
            { id: 'th-stage-orbit', layer: 'stage', intensity: 'subtle', weight: 1.4 },
            { id: 'th-stage-figure-eight', layer: 'stage', intensity: 'subtle', weight: 1.2 },
            { id: 'th-stage-pendulum', layer: 'stage', intensity: 'subtle', weight: 1.15 },
            { id: 'th-stage-slow-scan', layer: 'stage', intensity: 'subtle', weight: 1.1 },
            { id: 'th-stage-spiral-drift', layer: 'stage', intensity: 'dynamic', weight: 1.05 },
            { id: 'th-stage-bob-weave', layer: 'stage', intensity: 'dynamic', weight: 0.55 },
            { id: 'th-stage-wide-sweep', layer: 'stage', intensity: 'dynamic', weight: 0.95 },
            { id: 'th-stage-orbit-fast', layer: 'stage', intensity: 'dynamic', weight: 0.35 },
            { id: 'th-body-soft-drift', layer: 'body', target: 'float', intensity: 'subtle', weight: 1.5, forms: ['nova', 'wisp', 'eve'] },
            { id: 'th-body-gentle-pulse', layer: 'body', target: 'float', intensity: 'subtle', weight: 1.3, forms: ['nova', 'wisp', 'eve'] },
            { id: 'th-body-compute-rock', layer: 'body', target: 'float', intensity: 'subtle', weight: 1.2, forms: ['nova', 'eve'] },
            { id: 'th-body-wide-orbit', layer: 'body', target: 'float', intensity: 'dynamic', weight: 1.2, forms: ['nova', 'wisp', 'eve'] },
            { id: 'th-body-agitated-bob', layer: 'body', target: 'float', intensity: 'dynamic', weight: 1.1, forms: ['nova', 'wisp'] },
            { id: 'th-body-nova-roam', layer: 'body', target: 'float', intensity: 'dynamic', weight: 1.0, forms: ['nova'] },
            { id: 'th-body-wisp-swirl', layer: 'body', target: 'float', intensity: 'dynamic', weight: 1.0, forms: ['wisp'] },
            { id: 'th-body-eve-hover', layer: 'body', target: 'float', intensity: 'subtle', weight: 1.0, forms: ['eve'] },
            { id: 'th-accent-nova-hum', layer: 'accent', target: 'nova-hum', intensity: 'subtle', weight: 1.2, forms: ['nova'] },
            { id: 'th-accent-ear-scan', layer: 'accent', target: 'ears', intensity: 'dynamic', weight: 1.1, forms: ['nova'] },
            { id: 'th-accent-limb-twitch', layer: 'accent', target: 'limbs', intensity: 'dynamic', weight: 0.95, forms: ['nova'] },
            { id: 'th-accent-cheek-glow', layer: 'accent', target: 'cheeks', intensity: 'subtle', weight: 1.0, forms: ['nova'] },
            { id: 'th-accent-spark-hum', layer: 'accent', target: 'sparks', intensity: 'subtle', weight: 1.2, forms: ['wisp'] },
            { id: 'th-accent-spark-orbit', layer: 'accent', target: 'sparks', intensity: 'dynamic', weight: 1.0, forms: ['wisp'] },
            { id: 'th-accent-hem-ripple', layer: 'accent', target: 'hem', intensity: 'subtle', weight: 1.0, forms: ['wisp'] },
            { id: 'th-accent-eve-hum', layer: 'accent', target: 'eve-hum', intensity: 'subtle', weight: 1.2, forms: ['eve'] },
            { id: 'th-accent-visor-sweep', layer: 'accent', target: 'eyes', intensity: 'dynamic', weight: 1.1, forms: ['eve'] },
            { id: 'th-accent-ring-spin', layer: 'accent', target: 'ground', intensity: 'dynamic', weight: 1.0, forms: ['eve'] },
            { id: 'th-accent-arm-fold-pulse', layer: 'accent', target: 'arms', intensity: 'subtle', weight: 0.95, forms: ['eve'] },
            { id: 'th-accent-core-flare', layer: 'accent', target: 'core', intensity: 'subtle', weight: 1.1, forms: ['nova', 'wisp', 'eve'] },
            { id: 'th-blob-web-pulse', layer: 'blob', target: 'blob', intensity: 'subtle', weight: 1.3, forms: ['classic-blob'] },
            { id: 'th-blob-lobe-surge', layer: 'blob', target: 'blob', intensity: 'dynamic', weight: 1.1, forms: ['classic-blob'] },
            { id: 'th-blob-scan-sweep', layer: 'blob', target: 'blob', intensity: 'dynamic', weight: 1.0, forms: ['classic-blob'] },
            { id: 'th-blob-node-dance', layer: 'blob', target: 'blob', intensity: 'dynamic', weight: 0.95, forms: ['classic-blob'] },
        ];

        this.accentTheme = {
            primary: '#ff4436',
            secondary: '#ff6e40',
            glow: 'rgba(255, 68, 54, 0.4)',
        };

        this.colorMode = 'dark';
        this.colorModeOpacityScale = 1;

        this.speechEngine = null;
        this._audioReactive = null;
        this.avatarForm = 'classic-blob';
        this.displayName = 'Aether';
        this.speechCue = null;
        this.avatarBehaviorProfiles = {
            'classic-blob': {
                idleActionRange: [3500, 7500],
                thinkingActionRange: [800, 1800],
                speakingActionRange: [500, 1200],
                postTalkAction: 'settle-sigh',
                postTalkDuration: 4200,
                stageRoam: { thinkAmp: 1.0, thinkSpeed: 0.58, thinkRotate: 0.45, thinkMotionScale: 0.52 },
                idleActions: [
                    ['soft-pulse', 1.6],
                    ['lobe-drift', 1.4],
                    ['web-flicker', 1.2],
                    ['core-shimmer', 1.0],
                    ['ring-tick', 0.8],
                    ['settle-sigh', 1.1],
                    ['orbit-wobble', 1.3],
                    ['node-cluster', 1.1],
                    ['halo-breathe', 1.4],
                ],
                thinkingActions: [
                    ['web-surge', 1.8],
                    ['scan-sweep', 1.5],
                    ['lobe-compute', 1.6],
                    ['soft-pulse', 1.4],
                    ['node-cluster', 1.3],
                    ['halo-breathe', 1.2],
                ],
                speakingActions: [
                    ['rim-flare', 1.6],
                    ['micro-pulse', 1.2],
                ],
                webProfile: {},
            },
            nova: {
                blinkRange: [70, 165],
                doubleBlinkChance: 0.22,
                eyeAttention: { idle: 0.38, listening: 1.08, thinking: 0.82, speaking: 0.74 },
                eyeRange: { x: 6.2, y: 3.2 },
                mouthScale: 1.15,
                roundScale: 1,
                speechGlowScale: 1,
                idleActionRange: [3500, 7500],
                thinkingActionRange: [800, 1800],
                speakingActionRange: [500, 1200],
                postTalkAction: 'exhale-settle',
                postTalkDuration: 3200,
                stageRoam: { thinkAmp: 0.95, thinkSpeed: 0.62, thinkRotate: 0.75, thinkMotionScale: 0.52 },
                idleActions: [
                    ['glance', 1.8],
                    ['ear-perk', 1.6],
                    ['bounce', 1.25],
                    ['cheek-pulse', 1.25],
                    ['arm-wiggle', 1],
                    ['double-blink', 1.2],
                    ['tail-swish', 1.3],
                    ['stretch-yawn', 1.1],
                    ['look-around', 1.4],
                ],
                thinkingActions: [
                    ['ear-flick', 1.7],
                    ['weight-shift', 1.5],
                    ['paw-tap', 1.3],
                    ['look-around', 1.4],
                    ['ear-perk', 1.2],
                    ['glance', 1.1],
                ],
                speakingActions: [
                    ['nod-beat', 1.5],
                    ['ear-twitch', 1.2],
                ],
                webProfile: {
                    layers: [7, 10, 10, 7],
                    layerXPositions: [-1.6, -0.55, 0.55, 1.6],
                    verticalSpread: 2.7,
                    stateMultipliers: {
                        idle: { expansion: 1.05, opacity: 0.82 },
                        thinking: { expansion: 1.08, opacity: 0.85 },
                        listening: { expansion: 1.02, opacity: 0.78 },
                    },
                    lineAlpha: 0.065,
                    nodeGlow: 8,
                    showTelemetry: false,
                    nodeDrift: 0.04,
                    sweepMode: 'radial',
                    sweepSpeed: 0.032,
                    sweepIntervalMs: 2400,
                    thinkingPulseRate: 14,
                    randomFlicker: 0.045,
                },
            },
            wisp: {
                blinkRange: [95, 220],
                doubleBlinkChance: 0.12,
                eyeAttention: { idle: 0.24, listening: 0.68, thinking: 0.55, speaking: 0.45 },
                eyeRange: { x: 3.6, y: 2.1 },
                mouthScale: 0.88,
                roundScale: 0.82,
                speechGlowScale: 1.25,
                idleActionRange: [3500, 7500],
                thinkingActionRange: [800, 1800],
                speakingActionRange: [500, 1200],
                postTalkAction: 'spark-fade',
                postTalkDuration: 3400,
                stageRoam: { thinkAmp: 1.05, thinkSpeed: 0.65, thinkRotate: 0.85, thinkMotionScale: 0.5 },
                idleActions: [
                    ['spark-burst', 2.1],
                    ['slow-swirl', 1.4],
                    ['hem-wave', 1.35],
                    ['shy-blink', 1.25],
                    ['glow-pulse', 1.5],
                    ['float-drift', 1.3],
                    ['spark-trail', 1.2],
                    ['hem-flutter', 1.15],
                ],
                thinkingActions: [
                    ['swirl-think', 1.7],
                    ['dim-gather', 1.4],
                    ['spark-orbit', 1.5],
                    ['hem-flutter', 1.2],
                    ['glow-pulse', 1.3],
                    ['float-drift', 1.1],
                ],
                speakingActions: [
                    ['spark-accent', 1.6],
                ],
                webProfile: {
                    topology: 'scatter',
                    ghostRender: true,
                    layers: [14, 18, 18, 14],
                    verticalSpread: 3.1,
                    stateMultipliers: {
                        idle: { expansion: 1.25, opacity: 0.88 },
                        thinking: { expansion: 1.45, opacity: 0.92 },
                        listening: { expansion: 1.15, opacity: 0.78 },
                        'post-talk': { expansion: 1.0, opacity: 0.65 },
                    },
                    lineStyle: 'dashed',
                    lineAlpha: 0.14,
                    lineWidth: 0.35,
                    nodeGlow: 24,
                    colorMix: { primary: 0.45, secondary: 0.65, white: 0.62 },
                    showLabels: false,
                    showTelemetry: false,
                    connectionMode: 'proximity',
                    nodeDrift: 0.14,
                    sweepMode: 'radial',
                    sweepSpeed: 0.028,
                    sweepIntervalMs: 2200,
                    thinkingPulseRate: 22,
                    randomFlicker: 0.07,
                    proximityLinks: true,
                    proximityDistance: 1.05,
                    ghostAmbient: 0.28,
                },
            },
            eve: {
                blinkRange: [110, 240],
                doubleBlinkChance: 0.08,
                eyeAttention: { idle: 0.3, listening: 0.78, thinking: 0.92, speaking: 0.55 },
                eyeRange: { x: 4.2, y: 1.5 },
                mouthScale: 0.78,
                roundScale: 0.35,
                speechGlowScale: 1.45,
                idleActionRange: [3500, 7500],
                thinkingActionRange: [800, 1800],
                speakingActionRange: [500, 1200],
                postTalkAction: 'power-down',
                postTalkDuration: 3600,
                stageRoam: { thinkAmp: 0.88, thinkSpeed: 0.55, thinkRotate: 0.5, thinkMotionScale: 0.54 },
                idleActions: [
                    ['head-tilt', 1.8],
                    ['visor-scan', 1.8],
                    ['ring-calibrate', 1.4],
                    ['arm-adjust', 1],
                    ['focus-squint', 1.1],
                    ['shoulder-roll', 1.3],
                    ['visor-blink', 1.2],
                    ['ring-spin', 1.15],
                    ['gyro-wobble', 1.5],
                    ['pedestal-hum', 1.4],
                    ['stabilizer-kick', 1.2],
                    ['visor-flare', 1.3],
                    ['sync-tick', 1.1],
                ],
                thinkingActions: [
                    ['calibrate', 1.7],
                    ['scan-pulse', 1.6],
                    ['arm-fold', 1.3],
                    ['gyro-spin', 1.8],
                    ['data-stream', 1.6],
                    ['head-tilt', 1.4],
                    ['visor-scan', 1.3],
                    ['ring-calibrate', 1.2],
                ],
                speakingActions: [
                    ['bar-flash', 1.5],
                    ['ring-echo', 1.2],
                ],
                webProfile: {
                    topology: 'grid',
                    layers: [8, 10, 10, 8],
                    layerXPositions: [-1.5, -0.5, 0.5, 1.5],
                    verticalSpread: 2.1,
                    labels: {
                        0: ['VISOR', 'GYRO', 'SYNC', 'SCAN', 'LIDAR', 'BEAM', 'TRACE', 'LOCK'],
                        1: ['CAL_01', 'CAL_02', 'AXIS_X', 'AXIS_Y', 'FOV', 'RPM', 'TILT', 'YAW', 'PITCH', 'ROLL'],
                        2: ['PROC_A', 'PROC_B', 'HUD_01', 'HUD_02', 'DATA', 'SYNC', 'BEAM', 'FOCUS', 'LOCK', 'TARGET'],
                        3: ['OUT_A', 'OUT_B', 'STATUS', 'ALERT', 'MODE', 'HOLD', 'ARM', 'READY'],
                    },
                    stateMultipliers: {
                        thinking: { expansion: 1.05, opacity: 0.9 },
                    },
                    lineAlpha: 0.1,
                    lineWidth: 0.4,
                    nodeGlow: 3,
                    colorMix: { primary: 1, secondary: 0.85, white: 0.08 },
                    sweepMode: 'scanline',
                    sweepSpeed: 0.048,
                    sweepIntervalMs: 1600,
                    thinkingPulseRate: 12,
                    randomFlicker: 0.018,
                },
            },
        };
        this.activeWebProfile = null;
        this.avatarBehavior = this.createAvatarBehavior(this.avatarForm);
        this.rebuildWebForForm();
        this.creatureBlinkTimer = this.randomInRange(40, 120);
        this.creatureBlinkAmount = 0;
        this.creatureEyeDrift = { x: 0, y: 0 };
        this.creatureMouthShape = 'closed';
        this.creatureMouthOpen = 0;
        this.creatureMouthRound = 0;
        this.creatureSpeechEnergy = 0;
        this.creatureExpression = 'neutral';
        this.creatureAction = 'none';
        this.creatureActionIntensity = 0;
        this.novaBlinkTimer = this.creatureBlinkTimer;
        this.novaBlinkAmount = this.creatureBlinkAmount;
        this.novaEyeDrift = this.creatureEyeDrift;
        this.novaMouthShape = this.creatureMouthShape;
        this.novaMouthOpen = this.creatureMouthOpen;
        this.novaMouthRound = this.creatureMouthRound;

        // Canvas scaling and bindings
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        // Bind mouse movement for Jarvis "move around" parallax!
        window.addEventListener('mousemove', (e) => {
            // Normalize mouse coords from -1 to 1 based on center of screen
            this.mouseX = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
            this.mouseY = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
        });
    }

    /**
     * Set orb / animation accent colors (does not affect app chrome).
     */
    setAccentTheme(theme) {
        if (!theme) return;
        this.accentTheme = {
            primary: theme.primary,
            secondary: theme.secondary,
            glow: theme.accentGlow,
        };
        this.setState(this.state);
    }

    /**
     * Adjust orb halo intensity for light / high-contrast GUI modes.
     */
    setSpeechEngine(speechEngine) {
        this.speechEngine = speechEngine || null;
    }

    setColorMode(modeId) {
        this.colorMode = modeId || 'dark';
        if (modeId === 'light') {
            this.colorModeOpacityScale = 0.65;
        } else if (modeId === 'high-contrast') {
            this.colorModeOpacityScale = 0.7;
        } else {
            this.colorModeOpacityScale = 1;
        }
    }

    setAvatarForm(formId) {
        const allowedForms = ['classic-blob', 'nova', 'wisp', 'eve'];
        const nextForm = allowedForms.includes(formId) ? formId : 'classic-blob';
        const formChanged = this.avatarForm !== nextForm;
        this.avatarForm = nextForm;
        if (formChanged) {
            this.resetAvatarBehavior();
            this.rebuildWebForForm();
        }
        this.syncCreatureAvatarShell();
        this.syncAvatarLabelPlacement(document.getElementById('hudOrbLabel'));
        this.setState(this.state);
    }

    setDisplayName(name) {
        const trimmed = String(name || '').trim();
        this.displayName = trimmed || 'Aether';
        this.setState(this.state);
    }

    randomInRange(min, max) {
        return min + Math.random() * (max - min);
    }

    getAvatarBehaviorProfile(form = this.avatarForm) {
        return this.avatarBehaviorProfiles?.[form] || this.avatarBehaviorProfiles?.nova || null;
    }

    getWebProfile(form = this.avatarForm) {
        const profile = this.getAvatarBehaviorProfile(form);
        const overrides = profile?.webProfile || {};
        const merged = {
            ...DEFAULT_WEB_PROFILE,
            ...overrides,
            colorMix: { ...DEFAULT_WEB_PROFILE.colorMix, ...(overrides.colorMix || {}) },
            stateMultipliers: {
                ...DEFAULT_WEB_PROFILE.stateMultipliers,
                ...(overrides.stateMultipliers || {}),
            },
        };
        if (overrides.labels) {
            merged.labels = overrides.labels;
        }
        return merged;
    }

    rebuildWebForForm() {
        this.initWebNodes(this.getWebProfile());
    }

    mixWebColor(themeColor, secondaryColor, colorMix = DEFAULT_WEB_PROFILE.colorMix) {
        const mix = colorMix || DEFAULT_WEB_PROFILE.colorMix;
        const parse = (hex) => {
            let c = String(hex || '#ffffff').replace('#', '');
            if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
            const num = parseInt(c, 16) || 0xffffff;
            return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
        };
        const [pr, pg, pb] = parse(themeColor);
        const [sr, sg, sb] = parse(secondaryColor);
        const wr = 255;
        const wg = 255;
        const wb = 255;
        const primaryW = mix.primary ?? 1;
        const secondaryW = mix.secondary ?? 1;
        const whiteW = mix.white ?? 0;
        const total = primaryW + secondaryW + whiteW || 1;
        const r = Math.round((pr * primaryW + sr * secondaryW + wr * whiteW) / total);
        const g = Math.round((pg * primaryW + sg * secondaryW + wg * whiteW) / total);
        const b = Math.round((pb * primaryW + sb * secondaryW + wb * whiteW) / total);
        return `${r}, ${g}, ${b}`;
    }

    pushWebNode(nodeIndexRef, layer, baseX, baseY, labels, l, i, profile) {
        let size = Math.random() * 2.5 + 1.8;
        if (profile.topology !== 'scatter' && (l === 1 || l === 2)) {
            if (i % 4 === 0) size = Math.random() * 2.5 + 4.5;
            else if (i % 3 === 0) size = Math.random() * 1.0 + 1.2;
        } else if (profile.topology === 'scatter') {
            size = Math.random() * 3.2 + 2.4;
        }

        const layerLabels = labels[l] || [];
        const nodeAlpha = profile.topology === 'scatter'
            ? Math.random() * 0.25 + 0.72
            : Math.random() * 0.35 + 0.55;
        this.webNodes.push({
            index: nodeIndexRef.value++,
            layer: l,
            baseX,
            baseY,
            x: baseX,
            y: baseY,
            baseSize: size,
            size,
            alpha: nodeAlpha,
            activation: 0,
            targetActivation: 0,
            bias: (Math.random() * 2.0 - 1.0).toFixed(3),
            label: profile.showLabels === false ? '' : (i < layerLabels.length ? layerLabels[i] : `NEUR_${l}_${i}`),
            labelTimer: Math.random() * 100,
            driftPhase: Math.random() * Math.PI * 2,
        });
    }

    getProfileActionsForState(state = this.state, profile = this.getAvatarBehaviorProfile()) {
        if (state === 'thinking') return profile?.thinkingActions || [];
        if (state === 'speaking') return profile?.speakingActions || [];
        return profile?.idleActions || profile?.actions || [];
    }

    getActionRangeForState(state = this.state, profile = this.getAvatarBehaviorProfile()) {
        if (state === 'thinking') return profile?.thinkingActionRange || [800, 1800];
        if (state === 'speaking') return profile?.speakingActionRange || [500, 1200];
        return profile?.idleActionRange || [3500, 7500];
    }

    markSpeechPlaybackStarted() {
        this._speechPlaybackActive = true;
    }

    enterPostTalk() {
        if (this.state === 'post-talk') return;
        if (!this._speechPlaybackActive && this.state !== 'speaking') return;
        this._speechPlaybackActive = false;
        this.setState('post-talk');
    }

    getStageRoamScale(w, h) {
        return Math.min(w, h) * 0.24;
    }

    getThinkingStageTarget(form = this.avatarForm, stageId = null) {
        const profile = this.getAvatarBehaviorProfile(form);
        const roam = profile?.stageRoam || { thinkAmp: 1, thinkSpeed: 1, thinkRotate: 1, thinkMotionScale: 0.52 };
        const seed = this._stageRoamSeed;
        const motionScale = roam.thinkMotionScale ?? 0.52;
        const t = this.time * motionScale;
        const amp = roam.thinkAmp || 1;
        const speed = roam.thinkSpeed || 1;
        const rot = roam.thinkRotate || 1;
        const id = stageId || this.avatarBehavior?.thinkingLayers?.stage || 'th-stage-orbit';

        switch (id) {
            case 'th-stage-figure-eight':
                return {
                    x: (Math.sin(t * 0.48 * speed + seed) * 0.95 + Math.cos(t * 0.24 * speed) * 0.18) * amp,
                    y: (Math.sin(t * 0.96 * speed + seed * 0.8) * 0.58) * amp,
                    rotate: Math.sin(t * 0.35 * speed) * 8 * rot,
                    scale: 1 + Math.sin(t * 0.6 * speed) * 0.04 * amp,
                };
            case 'th-stage-pendulum':
                return {
                    x: Math.sin(t * 0.38 * speed + seed) * 1.12 * amp,
                    y: Math.cos(t * 0.22 * speed + seed * 0.5) * 0.18 * amp,
                    rotate: Math.sin(t * 0.38 * speed + seed) * 5 * rot,
                    scale: 1 + Math.cos(t * 0.45 * speed) * 0.025,
                };
            case 'th-stage-slow-scan':
                return {
                    x: (Math.sin(t * 0.28 * speed + seed) * 1.05 + Math.sin(t * 0.09 * speed) * 0.35) * amp,
                    y: Math.cos(t * 0.18 * speed) * 0.22 * amp,
                    rotate: Math.sin(t * 0.2 * speed) * 4 * rot,
                    scale: 1 + Math.sin(t * 0.35 * speed) * 0.02,
                };
            case 'th-stage-spiral-drift':
                return {
                    x: Math.sin(t * 0.62 * speed + seed) * (0.72 + Math.sin(t * 0.15 * speed) * 0.28) * amp,
                    y: Math.cos(t * 0.58 * speed + seed * 1.1) * (0.68 + Math.cos(t * 0.12 * speed) * 0.24) * amp,
                    rotate: (Math.sin(t * 0.5 * speed) * 12 + t * 2.8 * rot) ,
                    scale: 1 + Math.sin(t * 0.85 * speed) * 0.05 * amp,
                };
            case 'th-stage-bob-weave':
                return {
                    x: (Math.sin(t * 0.32 * speed + seed) * 0.82 + Math.sin(t * 0.85 * speed) * 0.22) * amp,
                    y: (Math.sin(t * 0.58 * speed + seed) * 0.62 + Math.cos(t * 0.72 * speed) * 0.28) * amp,
                    rotate: Math.sin(t * 0.38 * speed) * 12 * rot,
                    scale: 1 + Math.abs(Math.sin(t * 0.62 * speed)) * 0.055 * amp,
                };
            case 'th-stage-wide-sweep':
                return {
                    x: (Math.sin(t * 0.28 * speed + seed) * 1.18 + Math.sin(t * 0.48 * speed + seed * 1.3) * 0.48) * amp,
                    y: (Math.cos(t * 0.32 * speed + seed * 0.7) * 0.88 + Math.sin(t * 0.22 * speed) * 0.32) * amp,
                    rotate: (Math.sin(t * 0.26 * speed) * 10 + Math.cos(t * 0.42 * speed + seed) * 8) * rot,
                    scale: 1 + Math.sin(t * 0.5 * speed) * 0.055 * amp,
                };
            case 'th-stage-orbit-fast':
                return {
                    x: (Math.sin(t * 0.58 * speed + seed) * 0.92 + Math.sin(t * 1.1 * speed + seed * 1.4) * 0.38) * amp,
                    y: (Math.cos(t * 0.52 * speed + seed * 0.65) * 0.82 + Math.cos(t * 0.95 * speed + seed * 1.1) * 0.34) * amp,
                    rotate: (Math.sin(t * 0.42 * speed) * 14 + Math.cos(t * 0.68 * speed + seed) * 9) * rot,
                    scale: 1 + Math.sin(t * 0.72 * speed) * 0.05 * amp,
                };
            case 'th-stage-orbit':
            default:
                return {
                    x: (Math.sin(t * 0.42 * speed + seed) * 1.05 + Math.sin(t * 0.82 * speed + seed * 1.4) * 0.42 + Math.cos(t * 0.24 * speed) * 0.28) * amp,
                    y: (Math.cos(t * 0.36 * speed + seed * 0.65) * 0.95 + Math.cos(t * 0.74 * speed + seed * 1.1) * 0.38 + Math.sin(t * 0.2 * speed) * 0.24) * amp,
                    rotate: (Math.sin(t * 0.26 * speed) * 10 + Math.cos(t * 0.45 * speed + seed) * 6) * rot,
                    scale: 1 + Math.sin(t * 0.55 * speed) * 0.045 * amp,
                };
        }
    }

    getThinkingVariants(form = this.avatarForm) {
        return (this.thinkingVariants || []).filter((variant) => {
            if (!variant.forms) return true;
            return variant.forms.includes(form);
        });
    }

    pickThinkingLayers(form = this.avatarForm) {
        const variants = this.getThinkingVariants(form);
        const stages = variants.filter((v) => v.layer === 'stage');
        const parts = variants.filter((v) => v.layer !== 'stage');
        const selected = [];
        const usedTargets = new Set();

        const stage = this.pickWeightedPostTalkVariant(stages) || { id: 'th-stage-orbit' };
        selected.push(stage);
        usedTargets.add('stage');

        const pickPart = (pool) => {
            const available = pool.filter((v) => !usedTargets.has(v.target));
            if (!available.length) return null;
            const variant = this.pickWeightedPostTalkVariant(available);
            if (variant) {
                selected.push(variant);
                usedTargets.add(variant.target);
            }
            return variant;
        };

        pickPart(parts.filter((v) => v.intensity === 'subtle'));
        pickPart(parts.filter((v) => v.intensity === 'dynamic'));
        if (Math.random() < 0.42) {
            pickPart(parts.filter((v) => !selected.includes(v)));
        }

        let partIds = selected.filter((v) => v.layer !== 'stage').map((v) => v.id);
        if (form === 'classic-blob' && !partIds.some((id) => id.startsWith('th-blob'))) {
            partIds.push(Math.random() < 0.5 ? 'th-blob-web-pulse' : 'th-blob-lobe-surge');
        } else if (form !== 'classic-blob' && !partIds.length) {
            partIds.push('th-body-soft-drift');
        }

        return {
            stage: stage.id,
            parts: partIds,
            cycleMs: Math.round(this.randomInRange(3200, 5200)),
        };
    }

    startThinkingLayers(now = performance.now()) {
        if (!this.avatarBehavior) return;
        this.avatarBehavior.thinkingLayers = this.pickThinkingLayers(this.avatarForm);
        this.avatarBehavior.nextThinkingLayerRefreshAt = now + this.randomInRange(5500, 9500);
        if (this.isCreatureAvatar()) {
            this.syncCreatureAvatarShell();
        }
    }

    refreshThinkingLayersIfDue(now = performance.now()) {
        if (this.state !== 'thinking' || !this.avatarBehavior) return;
        if (now < (this.avatarBehavior.nextThinkingLayerRefreshAt || 0)) return;
        this.avatarBehavior.thinkingLayers = this.pickThinkingLayers(this.avatarForm);
        this.avatarBehavior.nextThinkingLayerRefreshAt = now + this.randomInRange(5500, 9500);
        if (this.isCreatureAvatar()) {
            this.syncCreatureAvatarShell();
        }
    }

    applyBlobThinkingLayerOverlay(targets) {
        const parts = this.avatarBehavior?.thinkingLayers?.parts || [];
        if (!parts.length) return;
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.2);
        const surge = 0.5 + 0.5 * Math.sin(this.time * 6.8);

        if (parts.includes('th-blob-web-pulse')) {
            targets.targetWebOp += 0.08 * pulse;
            targets.targetWebExp += 0.06 * pulse;
        }
        if (parts.includes('th-blob-lobe-surge')) {
            targets.targetLobe1 += 1.8 * surge;
            targets.targetLobe3 += 1.4 * surge;
            targets.targetWeight1 += 0.04 * surge;
        }
        if (parts.includes('th-blob-scan-sweep')) {
            this.blobLaserBoost = Math.max(this.blobLaserBoost, surge * 0.85);
            targets.targetWebOp += 0.1 * surge;
        }
        if (parts.includes('th-blob-node-dance')) {
            targets.targetWebOp += 0.14 * pulse;
            targets.targetScale += 0.03 * surge;
            this.blobCoreShimmer = Math.max(this.blobCoreShimmer, pulse * 0.45);
        }
    }

    getPostTalkStageTarget(progress, stageId = null, form = this.avatarForm) {
        const id = stageId || this.getDefaultPostTalkStage(form);
        const p = Math.min(1, Math.max(0, progress));
        const ease = (t) => 1 - Math.pow(1 - t, 2.4);
        const soft = (v) => v * 0.34;

        switch (id) {
            case 'pt-stage-glide': {
                const t = Math.sin(p * Math.PI);
                return { x: t * 0.62, y: Math.sin(p * Math.PI * 2) * 0.08, rotate: t * 4, scale: 1 - t * 0.02 };
            }
            case 'pt-stage-drift-up': {
                const t = Math.sin(p * Math.PI);
                return { x: Math.sin(p * Math.PI * 1.5) * 0.22, y: -0.42 * t, rotate: t * 3, scale: 1 - t * 0.03 };
            }
            case 'pt-stage-soft-return': {
                const base = this.getPostTalkStageTarget(p, this.getDefaultPostTalkStage(form), form);
                return { x: soft(base.x), y: soft(base.y), rotate: base.rotate * 0.35, scale: 1 - (1 - base.scale) * 0.4 };
            }
            case 'pt-stage-hop': {
                if (p < 0.42) {
                    const t = ease(p / 0.42);
                    return { x: t * 0.82, y: t * 0.58 - t * t * 0.12, rotate: t * 14, scale: 1 + t * 0.07 };
                }
                if (p < 0.68) {
                    const t = (p - 0.42) / 0.26;
                    return { x: 0.82 - t * 0.18, y: 0.46 + Math.sin(t * Math.PI) * 0.22, rotate: 14 - t * 6, scale: 1.07 - t * 0.03 };
                }
                const t = ease((p - 0.68) / 0.32);
                return { x: 0.64 * (1 - t), y: 0.46 * (1 - t), rotate: 8 * (1 - t), scale: 1.04 - t * 0.04 };
            }
            case 'pt-stage-spiral': {
                const loop = p * Math.PI * 2.4;
                const lift = Math.sin(p * Math.PI);
                return {
                    x: Math.sin(loop) * 0.62 * (1 - p * 0.25),
                    y: -0.72 * lift + 0.28 * p,
                    rotate: Math.sin(loop * 1.2) * 16,
                    scale: 1.04 - p * 0.06,
                };
            }
            case 'pt-stage-slide': {
                if (p < 0.55) {
                    const t = ease(p / 0.55);
                    return { x: -0.78 * t, y: 0.12 * t + Math.sin(t * Math.PI) * 0.08, rotate: -10 * t, scale: 1 - 0.05 * t };
                }
                const t = ease((p - 0.55) / 0.45);
                return { x: -0.78 * (1 - t), y: 0.12 * (1 - t), rotate: -10 * (1 - t), scale: 1 - 0.05 * (1 - t) };
            }
            case 'pt-stage-arc': {
                const t = Math.sin(p * Math.PI);
                return {
                    x: Math.sin(p * Math.PI * 1.2) * 0.88,
                    y: (1 - Math.cos(p * Math.PI)) * 0.52 - 0.18,
                    rotate: Math.sin(p * Math.PI * 2) * 12,
                    scale: 1 + t * 0.05,
                };
            }
            case 'pt-stage-bounce': {
                const bounce = Math.abs(Math.sin(p * Math.PI * 2.2)) * (1 - p * 0.35);
                return {
                    x: Math.sin(p * Math.PI) * 0.38,
                    y: -0.78 * bounce + 0.22 * p,
                    rotate: Math.sin(p * Math.PI * 3) * 8,
                    scale: 1 + bounce * 0.06,
                };
            }
            case 'pt-stage-orbit':
            default: {
                const angle = p * Math.PI * 1.65;
                const fade = Math.sin(p * Math.PI);
                return {
                    x: Math.cos(angle) * 0.72 * fade,
                    y: Math.sin(angle) * 0.56 * fade,
                    rotate: Math.sin(angle) * 8,
                    scale: 1 - p * 0.1,
                };
            }
        }
    }

    getDefaultPostTalkStage(form = this.avatarForm) {
        const defaults = {
            nova: 'pt-stage-hop',
            wisp: 'pt-stage-spiral',
            eve: 'pt-stage-slide',
            'classic-blob': 'pt-stage-orbit',
        };
        return defaults[form] || 'pt-stage-orbit';
    }

    getPostTalkVariants(form = this.avatarForm) {
        return (this.postTalkVariants || []).filter((variant) => {
            if (!variant.forms) return true;
            return variant.forms.includes(form);
        });
    }

    pickWeightedPostTalkVariant(variants = []) {
        if (!variants.length) return null;
        const total = variants.reduce((sum, variant) => sum + (variant.weight || 1), 0);
        let cursor = Math.random() * total;
        for (const variant of variants) {
            cursor -= variant.weight || 1;
            if (cursor <= 0) return variant;
        }
        return variants[variants.length - 1];
    }

    pickPostTalkLayers(form = this.avatarForm) {
        const variants = this.getPostTalkVariants(form);
        const stages = variants.filter((v) => v.layer === 'stage');
        const parts = variants.filter((v) => v.layer !== 'stage');
        const selected = [];
        const usedTargets = new Set();

        const stage = this.pickWeightedPostTalkVariant(stages) || { id: this.getDefaultPostTalkStage(form), durationScale: 1 };
        selected.push(stage);
        usedTargets.add('stage');

        const pickPart = (pool) => {
            const available = pool.filter((v) => !usedTargets.has(v.target));
            if (!available.length) return null;
            const variant = this.pickWeightedPostTalkVariant(available);
            if (variant) {
                selected.push(variant);
                usedTargets.add(variant.target);
            }
            return variant;
        };

        pickPart(parts.filter((v) => v.intensity === 'subtle'));
        pickPart(parts.filter((v) => v.intensity === 'dynamic'));

        if (Math.random() < 0.38) {
            pickPart(parts.filter((v) => !selected.includes(v)));
        }

        const profile = this.getAvatarBehaviorProfile(form);
        const baseDuration = profile?.postTalkDuration || 3200;
        const durationScale = selected.reduce((max, variant) => Math.max(max, variant.durationScale || 1), 1);
        let partIds = selected.filter((v) => v.layer !== 'stage').map((v) => v.id);

        if (form === 'classic-blob' && !partIds.some((id) => id.startsWith('pt-blob'))) {
            partIds.push(Math.random() < 0.5 ? 'pt-blob-soft-sigh' : 'pt-blob-web-fade');
        } else if (form !== 'classic-blob' && !partIds.length) {
            partIds.push('pt-body-soft-settle');
        }

        return {
            stage: stage.id,
            parts: partIds,
            duration: Math.round(baseDuration * durationScale),
        };
    }

    updateAvatarStageMotion(w, h) {
        const roamScale = this.getStageRoamScale(w, h) * (this.state === 'thinking' ? 0.72 : 1);
        let target = { x: 0, y: 0, rotate: 0, scale: 1 };
        const behavior = this.avatarBehavior;

        if (this.state === 'thinking') {
            const stageId = behavior?.thinkingLayers?.stage || 'th-stage-orbit';
            target = this.getThinkingStageTarget(this.avatarForm, stageId);
        } else if (this.state === 'post-talk' && behavior?.actionStartedAt) {
            const duration = Math.max(1, behavior.actionDuration || this.getAvatarBehaviorProfile()?.postTalkDuration || 3000);
            const progress = Math.min(1, (performance.now() - behavior.actionStartedAt) / duration);
            const stageId = behavior.postTalkLayers?.stage || this.getDefaultPostTalkStage();
            target = this.getPostTalkStageTarget(progress, stageId);
        }

        const ease = this.state === 'post-talk' ? 0.16 : this.state === 'thinking' ? 0.06 : this.state === 'idle' ? 0.05 : 0.08;
        target.x *= roamScale;
        target.y *= roamScale;

        this.stageMotion.x += (target.x - this.stageMotion.x) * ease;
        this.stageMotion.y += (target.y - this.stageMotion.y) * ease;
        this.stageMotion.rotate += (target.rotate - this.stageMotion.rotate) * ease;
        this.stageMotion.scale += (target.scale - this.stageMotion.scale) * ease;
    }

    createAvatarBehavior(form = this.avatarForm) {
        const profile = this.getAvatarBehaviorProfile(form);
        const idleRange = this.getActionRangeForState('idle', profile);
        const now = performance.now();
        return {
            form,
            state: this.state,
            stateStartedAt: now,
            idleStartedAt: now,
            nextPhaseActionAt: now + this.randomInRange(idleRange[0], idleRange[1]),
            nextIdleActionAt: now + this.randomInRange(idleRange[0], idleRange[1]),
            action: 'none',
            actionStartedAt: 0,
            actionDuration: 0,
            actionIntensity: 0,
            postTalkEndsAt: 0,
            postTalkLayers: null,
            thinkingLayers: null,
            nextThinkingLayerRefreshAt: 0,
            expression: 'neutral',
            eyeTarget: { x: 0, y: 0 },
            eyeTargetChangedAt: 0,
            nextEyeTargetAt: now + this.randomInRange(1200, 3500),
            doubleBlinkPending: 0,
        };
    }

    resetAvatarBehavior() {
        this.avatarBehavior = this.createAvatarBehavior(this.avatarForm);
        const profile = this.getAvatarBehaviorProfile();
        const blinkRange = profile?.blinkRange || [70, 165];
        this.creatureBlinkTimer = this.randomInRange(blinkRange[0], blinkRange[1]);
        this.creatureBlinkAmount = 0;
        this.creatureEyeDrift = { x: 0, y: 0 };
        this.creatureMouthShape = 'closed';
        this.creatureMouthOpen = 0;
        this.creatureMouthRound = 0;
        this.creatureSpeechEnergy = 0;
        this.creatureExpression = 'neutral';
        this.creatureAction = 'none';
        this.creatureActionIntensity = 0;
        this.syncLegacyCreatureFields();
    }

    syncLegacyCreatureFields() {
        this.novaBlinkTimer = this.creatureBlinkTimer;
        this.novaBlinkAmount = this.creatureBlinkAmount;
        this.novaEyeDrift = this.creatureEyeDrift;
        this.novaMouthShape = this.creatureMouthShape;
        this.novaMouthOpen = this.creatureMouthOpen;
        this.novaMouthRound = this.creatureMouthRound;
    }

    isCreatureAvatar() {
        return this.avatarForm !== 'classic-blob';
    }

    syncAvatarLabelPlacement(statusLabel) {
        if (!statusLabel) return;
        statusLabel.classList.toggle('nova-label', this.isCreatureAvatar());
    }

    getAvatarName() {
        return this.displayName || 'Aether';
    }

    startSpeechMouthCue(text) {
        const cleanText = String(text || '').trim();
        const words = cleanText ? cleanText.split(/\s+/).filter(Boolean) : [];
        this.speechCue = {
            text: cleanText,
            words,
            syllables: words.map(word => this.estimateSyllableCount(word)),
            startTime: performance.now(),
            boundaryTime: 0,
            wordIndex: 0,
            shape: words.length ? this.pickCreatureMouthShape(words[0], 0) : 'small',
            boundaryShape: words.length ? this.pickCreatureMouthShape(words[0], 0) : 'small',
            lastShapeAt: 0,
            lastBoundaryAt: 0,
            shapeIndex: 0,
            shapeHoldUntil: 0,
        };
    }

    stopSpeechMouthCue() {
        this.speechCue = null;
        this.creatureMouthShape = 'closed';
        this.creatureMouthOpen = 0;
        this.creatureMouthRound = 0;
        this.creatureSpeechEnergy = 0;
        this.syncLegacyCreatureFields();
        this.syncCreatureAvatarShell();
    }

    handleSpeechBoundary(event) {
        if (!this.speechCue || !this.isCreatureAvatar()) return;
        const now = performance.now();
        const elapsed = now - this.speechCue.startTime;
        let wordIndex = this.speechCue.wordIndex;

        if (Number.isFinite(event?.charIndex)) {
            const spokenPrefix = this.speechCue.text.slice(0, event.charIndex);
            wordIndex = Math.max(0, spokenPrefix.split(/\s+/).filter(Boolean).length - 1);
        } else {
            wordIndex += 1;
        }

        wordIndex = Math.min(Math.max(0, wordIndex), Math.max(0, this.speechCue.words.length - 1));
        const shape = this.pickCreatureMouthShape(this.speechCue.words[wordIndex] || '', wordIndex);
        this.speechCue.boundaryTime = elapsed;
        this.speechCue.wordIndex = wordIndex;
        this.speechCue.shape = shape;
        this.speechCue.boundaryShape = shape;
        this.speechCue.lastShapeAt = elapsed;
        this.speechCue.lastBoundaryAt = elapsed;
        this.speechCue.shapeIndex = 0;
        this.speechCue.shapeHoldUntil = elapsed + 120;
        this.syncCreatureAvatarShell();
    }

    /**
     * Set visualizer operational status
     */
    setState(state) {
        if (this.state !== state) {
            if (state !== 'thinking') {
                this.thinkingCaption = '';
            }
            if (state !== 'speaking') {
                this.stopSpeechMouthCue();
            }
            if (this.avatarBehavior) {
                const now = performance.now();
                const profile = this.getAvatarBehaviorProfile();
                this.avatarBehavior.state = state;
                this.avatarBehavior.stateStartedAt = now;
                this.avatarBehavior.expression = this.getExpressionForState(state);
                this.avatarBehavior.action = 'none';
                this.avatarBehavior.actionStartedAt = 0;
                this.avatarBehavior.actionDuration = 0;
                this.avatarBehavior.actionIntensity = 0;
                this.avatarBehavior.postTalkEndsAt = 0;
                this.avatarBehavior.postTalkLayers = null;
                this.avatarBehavior.thinkingLayers = null;
                this.avatarBehavior.nextThinkingLayerRefreshAt = 0;
                if (state === 'idle') {
                    this.avatarBehavior.idleStartedAt = now;
                    const idleRange = this.getActionRangeForState('idle', profile);
                    this.avatarBehavior.nextPhaseActionAt = now + this.randomInRange(idleRange[0], idleRange[1]);
                    this.avatarBehavior.nextIdleActionAt = this.avatarBehavior.nextPhaseActionAt;
                } else if (state === 'thinking' || state === 'speaking') {
                    const phaseRange = this.getActionRangeForState(state, profile);
                    this.avatarBehavior.nextPhaseActionAt = now + this.randomInRange(phaseRange[0], phaseRange[1]);
                    this.avatarBehavior.nextIdleActionAt = this.avatarBehavior.nextPhaseActionAt;
                    if (state === 'thinking') {
                        this.startThinkingLayers(now);
                    }
                } else if (state === 'post-talk') {
                    this.startPostTalkAction(now);
                }
            }
            // Trigger transition energy shockwaves
            this.shockwaves.push({
                radius: 10,
                maxRadius: 360,
                speed: 12,
                alpha: 1.0,
                width: 3.5
            });
            this.shockwaves.push({
                radius: 5,
                maxRadius: 300,
                speed: 8,
                alpha: 0.7,
                width: 1.5
            });

            // Trigger dynamic feedforward attention sweeps (thinking only)
            if (state === 'thinking') {
                this.triggerLayerSweep();
                setTimeout(() => { if (this.state === 'thinking') this.triggerLayerSweep(); }, 250);
                setTimeout(() => { if (this.state === 'thinking') this.triggerLayerSweep(); }, 500);
            }

            // Speaking: clear node network activity so only the morphing blob shows
            if (state === 'speaking') {
                this.feedforwardSignals = [];
                this.webNodes.forEach(n => {
                    n.targetActivation = 0;
                    n.activation = 0;
                    n.size = n.baseSize;
                });
            }
        }

        this.state = state;
        this.syncCreatureAvatarShell();
        const statusLabel = document.getElementById('hudOrbLabel');
        
        if (statusLabel) {
            const { primary, secondary } = this.accentTheme;
            const avatarName = this.getAvatarName();
            this.syncAvatarLabelPlacement(statusLabel);
            switch (state) {
                case 'listening':
                    statusLabel.textContent = `${avatarName} is listening...`;
                    statusLabel.style.color = primary;
                    break;
                case 'thinking':
                    statusLabel.textContent = this.thinkingCaption || `${avatarName} is thinking...`;
                    statusLabel.style.color = secondary;
                    break;
                case 'speaking':
                    statusLabel.textContent = `${avatarName} speaking...`;
                    statusLabel.style.color = '#ffffff';
                    break;
                case 'post-talk':
                    statusLabel.textContent = `${avatarName} ...`;
                    statusLabel.style.color = 'var(--text-muted)';
                    break;
                case 'idle':
                default:
                    statusLabel.textContent = `${avatarName.toUpperCase()} ACTIVE`;
                    statusLabel.style.color = 'var(--text-muted)';
                    break;
            }
        }
    }

    setThinkingCaption(caption) {
        this.thinkingCaption = caption || '';
        if (this.state === 'thinking') {
            const statusLabel = document.getElementById('hudOrbLabel');
            if (statusLabel) {
                statusLabel.textContent = this.thinkingCaption || `${this.getAvatarName()} is thinking...`;
            }
        }
    }

    clearThinkingCaption() {
        this.thinkingCaption = '';
    }


    /**
     * Trigger a profile-specific neural web sweep
     */
    triggerLayerSweep(profile = this.getWebProfile()) {
        const mode = profile?.sweepMode || 'feedforward';
        const speed = profile?.sweepSpeed ?? DEFAULT_WEB_PROFILE.sweepSpeed;

        if (mode === 'feedforward') {
            this.feedforwardSignals.push({
                mode,
                layer: 0,
                progress: 0,
                speed,
                intensity: 1.0,
            });
            this.webNodes.filter(n => n.layer === 0).forEach(n => {
                n.targetActivation = Math.max(n.targetActivation, 0.85);
            });
            return;
        }

        if (mode === 'radial') {
            this.feedforwardSignals.push({ mode, progress: 0, speed, intensity: 1.0 });
            this.webNodes.filter(n => n.layer === 1 || n.layer === 2).forEach(n => {
                if (Math.random() < 0.35) n.targetActivation = 0.65 + Math.random() * 0.35;
            });
            return;
        }

        if (mode === 'scanline') {
            this.feedforwardSignals.push({ mode, progress: 0, speed, intensity: 1.0 });
        }
    }

    triggerWebBurst(profile = this.getWebProfile(), intensity = 1) {
        if (!this.webNodes?.length) return;
        const burstCount = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < burstCount; i++) {
            const node = this.webNodes[Math.floor(Math.random() * this.webNodes.length)];
            node.targetActivation = 0.55 + Math.random() * 0.4 * intensity;
        }
    }

    applyWebSignalActivations() {
        const profile = this.activeWebProfile || this.getWebProfile();

        for (let idx = this.feedforwardSignals.length - 1; idx >= 0; idx--) {
            const signal = this.feedforwardSignals[idx];
            signal.progress += signal.speed;

            if (signal.mode === 'radial') {
                if (signal.progress >= 1.0) {
                    this.feedforwardSignals.splice(idx, 1);
                    continue;
                }
                const radius = signal.progress * 2.6;
                this.webNodes.forEach(node => {
                    const dist = Math.sqrt(node.baseX * node.baseX + node.baseY * node.baseY);
                    if (Math.abs(dist - radius) < 0.34) {
                        node.targetActivation = Math.max(
                            node.targetActivation,
                            signal.intensity * (1 - Math.abs(dist - radius) / 0.34)
                        );
                    }
                });
                continue;
            }

            if (signal.mode === 'scanline') {
                if (signal.progress >= 1.0) {
                    this.feedforwardSignals.splice(idx, 1);
                    continue;
                }
                const bandY = (signal.progress - 0.5) * (profile.verticalSpread || 2.4);
                this.webNodes.forEach(node => {
                    if (Math.abs(node.baseY - bandY) < 0.24) {
                        node.targetActivation = Math.max(node.targetActivation, signal.intensity * 0.95);
                    }
                });
                continue;
            }

            if (signal.progress >= 1.0) {
                const maxLayer = (profile.layers?.length || 4) - 2;
                if (signal.layer < maxLayer) {
                    signal.layer += 1;
                    signal.progress = 0;
                } else {
                    this.feedforwardSignals.splice(idx, 1);
                }
                continue;
            }

            const boost = 0.45 + (1 - signal.progress) * 0.55;
            this.webNodes.forEach(node => {
                if (node.layer === signal.layer || node.layer === signal.layer + 1) {
                    node.targetActivation = Math.max(node.targetActivation, boost * signal.intensity);
                }
            });
        }
    }

    /**
     * Drive node activation levels (movement lives on nodes, not orb bounce)
     */
    updateNodeActivations() {
        const profile = this.activeWebProfile || this.getWebProfile();
        this.activationTick += 1;

        this.webNodes.forEach(node => {
            node.activation += (node.targetActivation - node.activation) * 0.12;
            node.targetActivation *= 0.965;
            if (node.targetActivation < 0.02) node.targetActivation = 0;

            const act = node.activation;
            node.size = node.baseSize * (1 + act * 0.55);

            const drift = profile.nodeDrift || 0;
            if (drift > 0) {
                const t = this.time + node.driftPhase;
                node.x = node.baseX + Math.sin(t * 0.7 + node.index * 0.13) * drift;
                node.y = node.baseY + Math.cos(t * 0.55 + node.index * 0.11) * drift * 0.85;
            } else {
                node.x = node.baseX;
                node.y = node.baseY;
            }
            node.labelTimer += 0.035;

            const ghostAmbient = profile.ghostAmbient || 0;
            if (ghostAmbient > 0) {
                const breathe = ghostAmbient + Math.sin(this.time * 0.85 + node.index * 0.19) * (ghostAmbient * 0.45);
                node.targetActivation = Math.max(node.targetActivation, breathe);
            }
        });

        this.applyWebSignalActivations();

        const st = this.state;
        const pulseRate = profile.thinkingPulseRate || DEFAULT_WEB_PROFILE.thinkingPulseRate;
        const randomFlicker = profile.randomFlicker ?? DEFAULT_WEB_PROFILE.randomFlicker;
        const layerCount = profile.layers?.length || 4;

        if (st === 'thinking') {
            if (this.activationTick % pulseRate === 0) {
                const layer = Math.floor(this.activationTick / pulseRate) % layerCount;
                this.webNodes.filter(n => n.layer === layer).forEach(n => {
                    if (Math.random() < 0.4) n.targetActivation = 0.75 + Math.random() * 0.25;
                });
            }
            if (Math.random() < randomFlicker) {
                const hub = this.webNodes[Math.floor(Math.random() * this.webNodes.length)];
                hub.targetActivation = 1.0;
            }
            if (profile.proximityLinks && Math.random() < 0.012) {
                const anchor = this.webNodes[Math.floor(Math.random() * this.webNodes.length)];
                this.webNodes.forEach(node => {
                    const dx = node.baseX - anchor.baseX;
                    const dy = node.baseY - anchor.baseY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < (profile.proximityDistance || 0.55) && dist > 0.01) {
                        node.targetActivation = Math.max(node.targetActivation, 0.35 + Math.random() * 0.35);
                    }
                });
            }
        } else if (st === 'listening') {
            if (this.activationTick % 22 === 0) {
                this.webNodes.filter(n => n.layer === 0).forEach(n => {
                    if (Math.random() < 0.5) n.targetActivation = 0.8;
                });
            }
        } else if (st === 'idle' && Math.random() < (profile.topology === 'scatter' ? 0.018 : 0.004)) {
            const n = this.webNodes[Math.floor(Math.random() * this.webNodes.length)];
            n.targetActivation = 0.45 + Math.random() * 0.35;
        }
    }

    /**
     * Generate 45 ambient background nodes for low-opacity 3D parallax web
     */
    initBackgroundNodes() {
        this.bgNodes = [];
        for (let i = 0; i < 45; i++) {
            this.bgNodes.push({
                x: Math.random() * 2 - 1, // Normalized coordinates (-1 to 1)
                y: Math.random() * 2 - 1,
                z: Math.random() * 4.5 + 1.2, // 3D Depth parameter
                size: Math.random() * 1.0 + 0.6,
                alpha: Math.random() * 0.22 + 0.1,
                angle: Math.random() * Math.PI * 2,
                orbitSpeed: (Math.random() * 0.0003 + 0.0001) * (Math.random() > 0.5 ? 1 : -1),
                hasMarker: Math.random() < 0.15 // 15% will draw with scifi ticks
            });
        }
    }

    /**
     * Generate structured neural network nodes for the active avatar web profile
     */
    initWebNodes(profile = this.getWebProfile()) {
        this.webNodes = [];
        this.feedforwardSignals = [];
        this.activeWebProfile = profile;

        const layers = profile.layers || DEFAULT_WEB_PROFILE.layers;
        const layerXPositions = profile.layerXPositions || DEFAULT_WEB_PROFILE.layerXPositions;
        const labels = profile.labels || DEFAULT_WEB_LABELS;
        const verticalSpread = profile.verticalSpread ?? DEFAULT_WEB_PROFILE.verticalSpread;
        const nodeIndexRef = { value: 0 };
        const layerCount = layers.length;
        const arcBulge = profile.topology === 'grid' ? 0.02 : 0.1;

        if (profile.topology === 'scatter') {
            const totalNodes = layers.reduce((sum, count) => sum + count, 0);
            for (let i = 0; i < totalNodes; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.sqrt(Math.random()) * 2.45;
                const baseX = Math.cos(angle) * radius;
                const baseY = Math.sin(angle) * radius * 0.88;
                const layer = Math.min(
                    layerCount - 1,
                    Math.floor(((baseX + 2.45) / 4.9) * layerCount)
                );
                this.pushWebNode(nodeIndexRef, layer, baseX, baseY, labels, layer, i, profile);
            }
            return;
        }

        for (let l = 0; l < layerCount; l++) {
            const count = layers[l];
            const baseX = layerXPositions[l] ?? layerXPositions[layerXPositions.length - 1];
            for (let i = 0; i < count; i++) {
                const baseY = count > 1 ? (i / (count - 1) - 0.5) * verticalSpread : 0;
                const arcX = baseX * (1.0 + (1.0 - Math.abs(baseY) * 0.15) * arcBulge);
                this.pushWebNode(nodeIndexRef, l, arcX, baseY, labels, l, i, profile);
            }
        }
    }

    /**
     * Scale canvas to viewport width and height
     */
    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    /**
     * Start the canvas render loop
     */
    start() {
        if (this.animationId) return;
        this.animate();
    }

    /**
     * Stop the loop
     */
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Simulated pseudo-noise using multiple dynamic sine/cosine overlays.
     * Blends between integer harmonics so the shape stays seamless and morphs smoothly.
     */
    harmonicNoise(angle, time, speedModifier, frequencyModifier) {
        const t = time * speedModifier;
        const a = angle * frequencyModifier;
        const mp = this.morphPhase;

        const waveAt = (lobe, weight, timeScale, phaseScale, useCos = false) => {
            const lo = Math.floor(lobe);
            const hi = lo + 1;
            const blend = lobe - lo;
            const phase = mp * phaseScale;
            const sample = (n) => (
                useCos
                    ? Math.cos(a * n - t * timeScale + phase)
                    : Math.sin(a * n + t * timeScale + phase)
            );
            return (sample(lo) * (1 - blend) + sample(hi) * blend) * weight;
        };

        return waveAt(this.harmonicLobe1, this.harmonicWeight1, 1, 1)
            + waveAt(this.harmonicLobe2, this.harmonicWeight2, 1.4, 0.7, true)
            + waveAt(this.harmonicLobe3, this.harmonicWeight3, 0.8, -0.5)
            + waveAt(this.harmonicLobe4, this.harmonicWeight4, 1.1, 1.2, true);
    }

    getBlobMorphEase() {
        if (this.state === 'idle' || this.state === 'post-talk') {
            return { lobe: 0.032, weight: 0.038, stretch: 0.038 };
        }
        if (this.state === 'listening') {
            return { lobe: 0.048, weight: 0.05, stretch: 0.044 };
        }
        return { lobe: 0.055, weight: 0.06, stretch: 0.05 };
    }

    sampleBlobRadius(angle, stepIndex, stepCount, time, speed, noiseAmplitude, frequency) {
        let offset = this.harmonicNoise(angle, time, speed, frequency) * noiseAmplitude;
        const audio = this._audioReactive;
        if (this.state === 'speaking' && audio?.frequency) {
            const freq = audio.frequency;
            const voiceBins = Math.min(56, freq.length);
            if (voiceBins > 0) {
                const binPos = (stepIndex / stepCount) * voiceBins;
                const binIdx = Math.floor(binPos) % voiceBins;
                const nextIdx = (binIdx + 1) % voiceBins;
                const blend = binPos - Math.floor(binPos);
                const band = freq[binIdx] * (1 - blend) + freq[nextIdx] * blend;
                const envelope = audio.envelope ?? 0;
                const audioOffset = (band / 255) * noiseAmplitude * (0.85 + envelope * 1.6);
                offset = audioOffset + offset * 0.18;
            }
        }
        return offset;
    }

    traceSmoothBlobPath(cx, cy, baseRadius, time, speed, noiseAmplitude, frequency) {
        const steps = this.state === 'idle' || this.state === 'post-talk' ? 168 : 200;
        const tension = this.state === 'idle' || this.state === 'post-talk' ? 9 : 6;
        const points = [];

        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const offset = this.sampleBlobRadius(angle, i, steps, time, speed, noiseAmplitude, frequency);
            const radius = baseRadius + offset;
            points.push({
                x: cx + Math.cos(angle) * radius * this.stretchX,
                y: cy + Math.sin(angle) * radius * this.stretchY,
            });
        }

        this.ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < steps; i++) {
            const p0 = points[(i - 1 + steps) % steps];
            const p1 = points[i];
            const p2 = points[(i + 1) % steps];
            const p3 = points[(i + 2) % steps];
            this.ctx.bezierCurveTo(
                p1.x + (p2.x - p0.x) / tension,
                p1.y + (p2.y - p0.y) / tension,
                p2.x - (p3.x - p1.x) / tension,
                p2.y - (p3.y - p1.y) / tension,
                p2.x,
                p2.y
            );
        }
        this.ctx.closePath();
    }

    /**
     * Render Step Loop
     */
    animate() {
        if (!this.canvas) return;

        const w = this.canvas.width / window.devicePixelRatio;
        const h = this.canvas.height / window.devicePixelRatio;
        
        // Easing interpolation for parallax coordinates (lag effect makes it feel organic!)
        this.parallaxX = this.parallaxX * 0.92 + this.mouseX * 0.08;
        this.parallaxY = this.parallaxY * 0.92 + this.mouseY * 0.08;

        const sceneCenterX = w / 2 + this.parallaxX * 25;
        const sceneCenterY = h / 2 + this.parallaxY * 25;

        this.updateAvatarStageMotion(w, h);

        let avatarCenterX = sceneCenterX;
        let avatarCenterY = sceneCenterY;
        if (!this.isCreatureAvatar()) {
            avatarCenterX += this.stageMotion.x;
            avatarCenterY += this.stageMotion.y;
        }

        // Clear canvas
        this.ctx.clearRect(0, 0, w, h);
        
        this.time += 0.04;
        this.morphPhase += 0.018;

        this._audioReactive = null;
        if (this.state === 'speaking' && this.speechEngine?.voiceAudioActive) {
            this._audioReactive = this.speechEngine.updateVoiceAudioAnalysis();
        }

        this.updateAvatarBehavior();
        
        const primaryColor = this.accentTheme.primary;
        const secondaryColor = this.accentTheme.secondary;
        const glowColor = this.accentTheme.glow;
        
        // RENDER STEP 1: Drawing 3D Parallax Constellation Lattice
        this.drawBackgroundWeb(w, h, primaryColor);

        // Calculate dynamic orb sizes & undulation metrics based on state with smooth interpolation
        let targetScale = 1.0;
        let targetWebExp = 1.0;
        let targetWebOp = 0.22;
        let scaleSpeed = 0.08;
        let noiseAmp = 18;

        let targetLobe1 = 3.0, targetLobe2 = 5.0, targetLobe3 = 2.0, targetLobe4 = 7.0;
        let targetWeight1 = 0.35, targetWeight2 = 0.28, targetWeight3 = 0.25, targetWeight4 = 0.22;
        let targetStretchX = 1.0;
        let targetStretchY = 1.0;
        const mp = this.morphPhase;
        
        switch (this.state) {
            case 'listening':
                targetScale = 1.06;
                targetWebExp = 1.35;
                targetWebOp = 0.75;
                scaleSpeed = 0.2;
                noiseAmp = 38;

                targetLobe1 = 4.5 + Math.sin(mp * 0.4) * 1.2;
                targetLobe2 = 6.5 + Math.cos(mp * 0.35) * 1.0;
                targetLobe3 = 3.5 + Math.sin(mp * 0.5) * 0.8;
                targetLobe4 = 9.0 + Math.cos(mp * 0.45) * 1.5;
                targetWeight1 = 0.48;
                targetWeight2 = 0.32;
                targetWeight3 = 0.28;
                targetWeight4 = 0.26;
                targetStretchX = 1.04;
                targetStretchY = 0.98;
                break;
            case 'thinking':
                targetScale = 0.98;
                targetWebExp = 2.15;
                targetWebOp = 0.95;
                scaleSpeed = 0.14;
                noiseAmp = 22;

                targetLobe1 = 11.0 + Math.sin(mp * 0.55) * 2.5 + Math.sin(mp * 1.8) * 1.4;
                targetLobe2 = 9.0 + Math.cos(mp * 0.48) * 2.0 + Math.cos(mp * 1.6) * 1.2;
                targetLobe3 = 14.0 + Math.sin(mp * 0.62) * 2.8 + Math.sin(mp * 2.1) * 1.0;
                targetLobe4 = 16.0 + Math.cos(mp * 0.5) * 3.0 + Math.cos(mp * 1.9) * 1.1;
                targetWeight1 = 0.55;
                targetWeight2 = 0.42;
                targetWeight3 = 0.38;
                targetWeight4 = 0.32;
                targetStretchX = 1.02 + Math.sin(mp * 1.4) * 0.04;
                targetStretchY = 0.99 + Math.cos(mp * 1.3) * 0.03;
                break;
            case 'speaking': {
                const voiceEnvelope = this._audioReactive?.envelope ?? 0;
                const audioReactive = Boolean(this._audioReactive?.frequency);
                targetScale = 1.04 + voiceEnvelope * (audioReactive ? 0.14 : 0);
                targetWebExp = 1.0;
                targetWebOp = 0;
                scaleSpeed = audioReactive ? 0.22 + voiceEnvelope * 0.35 : 0.16;
                noiseAmp = audioReactive
                    ? 22 + voiceEnvelope * 42
                    : 32;

                targetLobe1 = 7.0 + Math.sin(mp * 0.5) * 1.8;
                targetLobe2 = 6.0 + Math.cos(mp * 0.42) * 1.5;
                targetLobe3 = 9.0 + Math.sin(mp * 0.58) * 2.0;
                targetLobe4 = 11.0 + Math.cos(mp * 0.48) * 2.2;
                targetWeight1 = 0.45;
                targetWeight2 = 0.4;
                targetWeight3 = 0.35;
                targetWeight4 = 0.3;
                targetStretchX = 1.1;
                targetStretchY = 0.92;
                break;
            }
            case 'post-talk':
                targetScale = 0.98;
                targetWebExp = 0.92;
                targetWebOp = 0.14;
                scaleSpeed = 0.04;
                noiseAmp = 12;

                targetLobe1 = 3.0 + Math.sin(mp * 0.2) * 0.4;
                targetLobe2 = 5.0 + Math.cos(mp * 0.18) * 0.35;
                targetLobe3 = 2.0 + Math.sin(mp * 0.22) * 0.3;
                targetLobe4 = 6.8 + Math.cos(mp * 0.2) * 0.45;
                targetWeight1 = 0.34;
                targetWeight2 = 0.28;
                targetWeight3 = 0.24;
                targetWeight4 = 0.22;
                targetStretchX = 1.0;
                targetStretchY = 1.0;
                break;
            case 'idle':
            default:
                targetScale = 1.0;
                targetWebExp = 1.0;
                targetWebOp = 0.22;
                scaleSpeed = 0.04;
                noiseAmp = 14;

                targetLobe1 = 3.0 + Math.sin(mp * 0.22) * 0.35;
                targetLobe2 = 5.0 + Math.cos(mp * 0.2) * 0.3;
                targetLobe3 = 2.0 + Math.sin(mp * 0.24) * 0.25;
                targetLobe4 = 7.0 + Math.cos(mp * 0.21) * 0.4;
                targetWeight1 = 0.38;
                targetWeight2 = 0.3;
                targetWeight3 = 0.26;
                targetWeight4 = 0.24;
                targetStretchX = 1.0;
                targetStretchY = 1.0;
                break;
        }

        const blobTargets = {
            targetScale,
            targetWebExp,
            targetWebOp,
            targetLobe1,
            targetLobe2,
            targetLobe3,
            targetLobe4,
            targetWeight1,
            targetWeight2,
            targetWeight3,
            targetWeight4,
            targetStretchX,
            targetStretchY,
            noiseAmpBoost: 0,
        };
        this.applyBlobActionOverlay(blobTargets);
        if (this.state === 'thinking') {
            this.applyBlobThinkingLayerOverlay(blobTargets);
        }
        targetScale = blobTargets.targetScale;
        targetWebExp = blobTargets.targetWebExp;
        targetWebOp = blobTargets.targetWebOp;
        targetLobe1 = blobTargets.targetLobe1;
        targetLobe2 = blobTargets.targetLobe2;
        targetLobe3 = blobTargets.targetLobe3;
        targetLobe4 = blobTargets.targetLobe4;
        targetWeight1 = blobTargets.targetWeight1;
        targetWeight2 = blobTargets.targetWeight2;
        targetWeight3 = blobTargets.targetWeight3;
        targetWeight4 = blobTargets.targetWeight4;
        targetStretchX = blobTargets.targetStretchX;
        targetStretchY = blobTargets.targetStretchY;
        noiseAmp += blobTargets.noiseAmpBoost || 0;

        const webProfile = this.getWebProfile();
        const webStateKey = this.state === 'post-talk' ? 'post-talk' : this.state;
        const webMul = webProfile.stateMultipliers?.[webStateKey]
            || webProfile.stateMultipliers?.idle
            || { expansion: 1, opacity: 1 };
        targetWebExp *= webMul.expansion ?? 1;
        targetWebOp *= webMul.opacity ?? 1;

        // RENDER STEP 2: Subtle Laser Sweep (background scanner layer)
        this.drawLaserSweep(w, h, primaryColor);

        // Smooth state transitions (no scale bounce — steady orb size per state)
        this.orbPulseScale += (targetScale - this.orbPulseScale) * 0.06;
        this.webExpansion += (targetWebExp - this.webExpansion) * 0.08;
        this.webOpacity += (targetWebOp * this.colorModeOpacityScale - this.webOpacity) * 0.1;

        // Smoothly interpolate morphing parameters
        const morphEase = this.getBlobMorphEase();
        this.harmonicLobe1 += (targetLobe1 - this.harmonicLobe1) * morphEase.lobe;
        this.harmonicLobe2 += (targetLobe2 - this.harmonicLobe2) * morphEase.lobe;
        this.harmonicLobe3 += (targetLobe3 - this.harmonicLobe3) * morphEase.lobe;
        this.harmonicLobe4 += (targetLobe4 - this.harmonicLobe4) * morphEase.lobe;

        this.harmonicWeight1 += (targetWeight1 - this.harmonicWeight1) * morphEase.weight;
        this.harmonicWeight2 += (targetWeight2 - this.harmonicWeight2) * morphEase.weight;
        this.harmonicWeight3 += (targetWeight3 - this.harmonicWeight3) * morphEase.weight;
        this.harmonicWeight4 += (targetWeight4 - this.harmonicWeight4) * morphEase.weight;

        this.stretchX += (targetStretchX - this.stretchX) * morphEase.stretch;
        this.stretchY += (targetStretchY - this.stretchY) * morphEase.stretch;

        if (this.state !== 'speaking') {
            this.updateNodeActivations();
        }

        const isCreature = this.isCreatureAvatar();
        const activeRadius = this.coreBaseRadius * this.orbPulseScale;
        const avatarRadius = isCreature ? activeRadius * 1.38 : activeRadius;
        const showNeuralWeb = this.state !== 'speaking' && this.state !== 'post-talk' && this.webOpacity > 0.04;

        // RENDER STEP 3: Concentric HUD Rings and Rotating Hex Data Dials (hidden while speaking)
        if (this.state !== 'speaking' || isCreature) {
            this.drawHUDRings(avatarCenterX, avatarCenterY, avatarRadius, primaryColor, glowColor);
            this.drawDataRing(avatarCenterX, avatarCenterY, avatarRadius, primaryColor);
        }

        if (this.state === 'thinking' && webProfile.sweepIntervalMs) {
            const sweepNow = performance.now();
            if (sweepNow - this._lastThinkingSweepAt > webProfile.sweepIntervalMs) {
                this.triggerLayerSweep(webProfile);
                this._lastThinkingSweepAt = sweepNow;
            }
        }

        // RENDER STEP 4: Layered Neural Network — fixed to scene center so avatar roam does not drag the web
        if (showNeuralWeb) {
            this.drawNeuralWeb(sceneCenterX, sceneCenterY, avatarRadius, primaryColor, secondaryColor, webProfile);
        }

        // RENDER STEP 5: Central avatar form
        if (isCreature) {
            this.updateCreatureBlinkAndEyes();
            this.updateCreatureMouth();
            this.syncCreatureAvatarShell();
        } else {
            const shimmer = this.blobCoreShimmer || 0;
            // Multi-layered liquid plasma orb. We layer 3 separate undulating paths to simulate a 3D gas sphere.
            this.drawLiquidBlob(
                avatarCenterX, avatarCenterY,
                activeRadius * 1.28,
                this.time, scaleSpeed * 0.75, noiseAmp * 1.45, 0.75,
                `rgba(${this.hexToRgb(primaryColor)}, ${0.15 + shimmer * 0.08})`,
                glowColor, 20 + shimmer * 10
            );

            this.drawLiquidBlob(
                avatarCenterX, avatarCenterY,
                activeRadius,
                this.time + 12, scaleSpeed * 1.05, noiseAmp * 1.1, 1.05,
                `rgba(${this.hexToRgb(primaryColor)}, ${0.5 + shimmer * 0.15})`,
                'rgba(0,0,0,0)', 0
            );

            const coreGrad = this.ctx.createRadialGradient(avatarCenterX, avatarCenterY, 5, avatarCenterX, avatarCenterY, activeRadius * 0.6);
            coreGrad.addColorStop(0, '#ffffff');
            coreGrad.addColorStop(0.5, secondaryColor);
            coreGrad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, ${0.1 + shimmer * 0.12})`);

            this.drawLiquidBlob(
                avatarCenterX, avatarCenterY,
                activeRadius * 0.62,
                this.time - 8, scaleSpeed * 1.35, noiseAmp * 0.65, 1.35,
                coreGrad,
                `rgba(255,255,255,${0.4 + shimmer * 0.25})`, 8 + shimmer * 12
            );
        }

        // RENDER STEP 6: Vocal Oscilloscope Equalizer (outer speak boundary)
        this.drawVoiceWaveRing(avatarCenterX, avatarCenterY, avatarRadius, primaryColor, secondaryColor);

        // RENDER STEP 7: Active State Transition Shockwaves (expanding foreground overlay) safely using a backward loop
        for (let idx = this.shockwaves.length - 1; idx >= 0; idx--) {
            const sw = this.shockwaves[idx];
            sw.radius += sw.speed;
            sw.alpha = 1.0 - (sw.radius / sw.maxRadius);
            
            if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
                this.shockwaves.splice(idx, 1);
                continue;
            }

            this.ctx.strokeStyle = `rgba(${this.hexToRgb(primaryColor)}, ${sw.alpha})`;
            this.ctx.lineWidth = sw.width;
            
            // Outer expanding ring
            this.ctx.beginPath();
            this.ctx.arc(avatarCenterX, avatarCenterY, sw.radius, 0, Math.PI * 2);
            this.ctx.stroke();
            
            // Faint secondary glow ring
            this.ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, ${sw.alpha * 0.35})`;
            this.ctx.lineWidth = sw.width * 0.5;
            this.ctx.beginPath();
            this.ctx.arc(avatarCenterX, avatarCenterY, sw.radius * 0.9, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        // Queue next frame
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    /**
     * Renders background 3D parallax ambient constellation web
     */
    drawBackgroundWeb(width, height, color) {
        this.ctx.shadowBlur = 0;
        
        // 1. Calculate projected coordinates for all nodes first
        const projected = [];
        
        this.bgNodes.forEach(p => {
            // Apply ultra-slow orbit rotation
            p.angle += p.orbitSpeed;
            const dist = Math.sqrt(p.x * p.x + p.y * p.y);
            const cx = Math.cos(p.angle) * dist;
            const cy = Math.sin(p.angle) * dist;

            // Project coordinates based on 3D depth and parallax shifting
            const shiftX = -this.parallaxX * (85 / p.z);
            const shiftY = -this.parallaxY * (85 / p.z);

            const x = (cx * width / 2) + width / 2 + shiftX;
            const y = (cy * height / 2) + height / 2 + shiftY;
            
            projected.push({
                x, y,
                size: p.size * (2.5 / p.z),
                alpha: p.alpha / (p.z * 0.4),
                hasMarker: p.hasMarker
            });
        });

        // 2. Draw extremely fine connected lines between close points
        this.ctx.lineWidth = 0.5;
        for (let i = 0; i < projected.length; i++) {
            const pA = projected[i];
            
            // Skip points off screen
            if (pA.x < 0 || pA.x > width || pA.y < 0 || pA.y > height) continue;

            for (let j = i + 1; j < projected.length; j++) {
                const pB = projected[j];
                
                if (pB.x < 0 || pB.x > width || pB.y < 0 || pB.y > height) continue;

                const dx = pA.x - pB.x;
                const dy = pA.y - pB.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // If close enough, draw ultra-fine link
                if (distance < 130) {
                    const lineAlpha = (1.0 - distance / 130) * 0.08 * Math.min(pA.alpha, pB.alpha);
                    this.ctx.strokeStyle = `rgba(${this.hexToRgb(color)}, ${lineAlpha})`;
                    this.ctx.beginPath();
                    this.ctx.moveTo(pA.x, pA.y);
                    this.ctx.lineTo(pB.x, pB.y);
                    this.ctx.stroke();
                }
            }
        }

        // 3. Draw nodes & optional scifi tech reticles
        projected.forEach(p => {
            if (p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height) {
                this.ctx.globalAlpha = p.alpha;
                
                // Draw node core
                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();

                // Draw tiny sci-fi tick marks for specified constellation anchors
                if (p.hasMarker) {
                    this.ctx.strokeStyle = color;
                    this.ctx.lineWidth = 0.6;
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, p.size * 3.5, 0, Math.PI * 2);
                    this.ctx.stroke();
                    
                    // Draw mini tiny coordinate dashes
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x - p.size * 5, p.y);
                    this.ctx.lineTo(p.x - p.size * 2, p.y);
                    this.ctx.moveTo(p.x + p.size * 2, p.y);
                    this.ctx.lineTo(p.x + p.size * 5, p.y);
                    this.ctx.stroke();
                }
            }
        });

        this.ctx.globalAlpha = 1.0; // Reset
    }

    /**
     * Renders counter-rotating futuristic HUD concentric circles
     */
    drawHUDRings(cx, cy, baseRadius, themeColor, glowColor) {
        this.ctx.shadowBlur = 0;

        const ringPulse = (this.state === 'idle' ? this.blobRingPulse : 0) || 0;
        const ringOpacityBoost = 1 + ringPulse * 0.5;
        
        // Ring Rotation Accumulator
        let speed = 0.005;
        if (this.state === 'listening') speed = 0.03;
        else if (this.state === 'thinking') speed = 0.015;
        else if (this.state === 'speaking') speed = 0.01;
        if (ringPulse > 0) speed += ringPulse * 0.02;
        
        this.ringRotationAngle += speed;

        // HUD Ring 1: Thin outer dashed guide track
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, ${0.15 * ringOpacityBoost})`;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius * 1.5, 0, Math.PI * 2);
        this.ctx.stroke();

        // HUD Ring 2: Core border thin rotating dashes
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, ${0.4 * ringOpacityBoost})`;
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([12, 18, 4, 18]);
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius * 1.35, this.ringRotationAngle, this.ringRotationAngle + Math.PI * 2);
        this.ctx.stroke();
        this.ctx.setLineDash([]); // Reset

        // HUD Ring 3: Counter-rotating outer tick marks & subdivisions
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, ${0.25 * ringOpacityBoost})`;
        this.ctx.lineWidth = 1;
        const tickRadius = baseRadius * 1.45;
        const angleStep = Math.PI / 18; // 10 degrees

        for (let angle = 0; angle < Math.PI * 2; angle += angleStep) {
            // Apply slow counter rotation
            const activeAngle = angle - this.ringRotationAngle * 0.5;
            
            // Skip certain slices to look dashed
            if (Math.sin(activeAngle * 3) > 0.4) continue;

            const startX = cx + Math.cos(activeAngle) * tickRadius;
            const startY = cy + Math.sin(activeAngle) * tickRadius;
            const endX = cx + Math.cos(activeAngle) * (tickRadius + 5);
            const endY = cy + Math.sin(activeAngle) * (tickRadius + 5);

            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(endX, endY);
            this.ctx.stroke();
        }

        // HUD Ring 4: Thin coordinate tracking crosshairs
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, ${0.08 * ringOpacityBoost})`;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        // horizontal crosshair line
        this.ctx.moveTo(cx - baseRadius * 1.8, cy);
        this.ctx.lineTo(cx - baseRadius * 1.55, cy);
        this.ctx.moveTo(cx + baseRadius * 1.55, cy);
        this.ctx.lineTo(cx + baseRadius * 1.8, cy);
        // vertical crosshair line
        this.ctx.moveTo(cx, cy - baseRadius * 1.8);
        this.ctx.lineTo(cx, cy - baseRadius * 1.55);
        this.ctx.moveTo(cx, cy + baseRadius * 1.55);
        this.ctx.lineTo(cx, cy + baseRadius * 1.8);
        this.ctx.stroke();
    }

    /**
     * Walk polar angles to draw a seamless undulating liquid blob
     */
    drawLiquidBlob(cx, cy, baseRadius, time, speed, noiseAmplitude, frequency, fillStyle, shadowColor, shadowBlur) {
        this.ctx.beginPath();

        if (shadowBlur > 0) {
            this.ctx.shadowBlur = shadowBlur;
            this.ctx.shadowColor = shadowColor;
        } else {
            this.ctx.shadowBlur = 0;
        }

        this.traceSmoothBlobPath(cx, cy, baseRadius, time, speed, noiseAmplitude, frequency);

        this.ctx.fillStyle = fillStyle;
        this.ctx.fill();

        this.ctx.shadowBlur = 0;
    }

    getExpressionForState(state = this.state) {
        switch (state) {
            case 'listening':
                return 'attentive';
            case 'thinking':
                return 'thinking';
            case 'speaking':
                return this.avatarForm === 'eve' ? 'focused' : this.avatarForm === 'wisp' ? 'soft' : 'happy';
            case 'post-talk':
                return 'neutral';
            case 'idle':
            default:
                return 'neutral';
        }
    }

    pickWeightedAvatarAction(actions = []) {
        const total = actions.reduce((sum, [, weight]) => sum + weight, 0);
        if (!total) return 'glance';
        let cursor = Math.random() * total;
        for (const [action, weight] of actions) {
            cursor -= weight;
            if (cursor <= 0) return action;
        }
        return actions[0]?.[0] || 'glance';
    }

    getActionDuration(action) {
        const durations = {
            glance: 1350,
            'ear-perk': 1500,
            bounce: 1250,
            'cheek-pulse': 1400,
            'arm-wiggle': 1500,
            'double-blink': 700,
            'spark-burst': 1700,
            'slow-swirl': 2400,
            'hem-wave': 1800,
            'shy-blink': 850,
            'glow-pulse': 1500,
            'head-tilt': 1700,
            'visor-scan': 1600,
            'ring-calibrate': 1600,
            'arm-adjust': 1500,
            'focus-squint': 1200,
            'soft-pulse': 1800,
            'lobe-drift': 2200,
            'web-flicker': 1400,
            'core-shimmer': 1200,
            'ring-tick': 900,
            'settle-sigh': 4200,
            'orbit-wobble': 2000,
            'node-cluster': 1500,
            'halo-breathe': 1800,
            'web-surge': 1600,
            'scan-sweep': 1400,
            'lobe-compute': 1700,
            'rim-flare': 1100,
            'micro-pulse': 900,
            'tail-swish': 1400,
            'stretch-yawn': 2200,
            'look-around': 1600,
            'ear-flick': 900,
            'weight-shift': 1500,
            'paw-tap': 1200,
            'nod-beat': 1000,
            'ear-twitch': 850,
            'exhale-settle': 3200,
            'float-drift': 2400,
            'spark-trail': 1500,
            'hem-flutter': 1300,
            'swirl-think': 2200,
            'dim-gather': 1800,
            'spark-orbit': 1600,
            'spark-accent': 1000,
            'spark-fade': 3400,
            'shoulder-roll': 1500,
            'visor-blink': 900,
            'ring-spin': 1400,
            calibrate: 1600,
            'scan-pulse': 1400,
            'arm-fold': 1500,
            'bar-flash': 950,
            'ring-echo': 1100,
            'power-down': 3600,
            'gyro-wobble': 1500,
            'pedestal-hum': 1600,
            'stabilizer-kick': 1100,
            'visor-flare': 1200,
            'sync-tick': 900,
            'gyro-spin': 1500,
            'data-stream': 1400,
        };
        return durations[action] || 1400;
    }

    getIdleActionDuration(action) {
        return this.getActionDuration(action);
    }

    startPostTalkAction(now = performance.now()) {
        if (!this.avatarBehavior) return;
        const profile = this.getAvatarBehaviorProfile();
        const layers = this.pickPostTalkLayers(this.avatarForm);
        const duration = layers.duration || profile?.postTalkDuration || 3200;
        this.avatarBehavior.postTalkLayers = layers;
        this.avatarBehavior.action = layers.parts[0] || profile?.postTalkAction || 'exhale-settle';
        this.avatarBehavior.actionStartedAt = now;
        this.avatarBehavior.actionDuration = duration;
        this.avatarBehavior.actionIntensity = 1;
        this.avatarBehavior.postTalkEndsAt = now + duration;
        if (!this.isCreatureAvatar()) {
            this.triggerBlobActionEffects(this.avatarBehavior.action);
        } else {
            this.syncCreatureAvatarShell();
        }
    }

    triggerBlobActionEffects(action) {
        if (action === 'web-flicker' || action === 'web-surge' || action === 'node-cluster') {
            if (!this.webNodes?.length) return;
            const burstCount = action === 'node-cluster' ? 5 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < burstCount; i++) {
                const node = this.webNodes[Math.floor(Math.random() * this.webNodes.length)];
                node.targetActivation = 0.55 + Math.random() * 0.4;
            }
        }
        if (action === 'scan-sweep' || action === 'lobe-compute') {
            this.triggerLayerSweep();
        }
    }

    triggerThinkingToolBurst(toolName = '') {
        if (this.state !== 'thinking') return;
        const name = String(toolName || '').toLowerCase();
        let burstAction = 'scan-pulse';
        if (/search|find|grep|web/.test(name)) burstAction = 'visor-scan';
        else if (/shell|exec|run|command/.test(name)) burstAction = 'ring-calibrate';
        else if (/read|file|write|edit/.test(name)) burstAction = 'web-surge';
        else if (this.avatarForm === 'nova') burstAction = 'ear-flick';
        else if (this.avatarForm === 'wisp') burstAction = 'spark-orbit';
        else if (this.avatarForm === 'classic-blob') burstAction = 'web-surge';

        if (this.avatarBehavior) {
            const now = performance.now();
            this.avatarBehavior.action = burstAction;
            this.avatarBehavior.actionStartedAt = now;
            this.avatarBehavior.actionDuration = this.getActionDuration(burstAction) * 0.85;
            this.avatarBehavior.actionIntensity = 1;
            if (this.isCreatureAvatar()) {
                this.syncCreatureAvatarShell();
            }
        }
        if (!this.isCreatureAvatar()) {
            this.triggerBlobActionEffects(burstAction);
        }
        const webProfile = this.getWebProfile();
        this.triggerLayerSweep(webProfile);
        this.triggerWebBurst(webProfile, burstAction === 'web-surge' ? 1.2 : 1);
    }

    applyBlobActionOverlay(targets) {
        this.blobCoreShimmer = 0;
        this.blobRingPulse = 0;
        this.blobLaserBoost = 0;
        if (this.avatarForm !== 'classic-blob') return;

        const behavior = this.avatarBehavior;
        const action = behavior?.action;
        const intensity = behavior?.actionIntensity || 0;
        const state = this.state;

        if (state === 'post-talk' && action && action !== 'none') {
            const i = intensity;
            const parts = behavior?.postTalkLayers?.parts || [];
            targets.targetScale -= 0.1 * i;
            targets.targetWebOp -= 0.2 * i;
            targets.targetWebExp -= 0.15 * i;
            targets.targetStretchY += 0.1 * i;
            this.blobCoreShimmer = i * 0.55;
            this.blobRingPulse = i * 0.75;
            if (parts.includes('pt-blob-soft-sigh') || action === 'settle-sigh') {
                targets.targetStretchY -= 0.12 * i;
                targets.targetLobe2 += 0.8 * i;
                targets.targetWeight2 += 0.05 * i;
            }
            if (parts.includes('pt-blob-web-fade')) {
                targets.targetWebOp -= 0.12 * i;
                targets.targetWebExp -= 0.1 * i;
            }
            if (parts.includes('pt-blob-ring-pulse')) {
                this.blobRingPulse = i * 1.1;
                targets.targetScale += 0.05 * i;
            }
            if (parts.includes('pt-blob-orbit-compress')) {
                targets.targetScale -= 0.14 * i;
                targets.targetStretchX = 0.94 + (1 - i) * 0.06;
                targets.targetStretchY = 1.06 - i * 0.08;
                this.blobCoreShimmer = i * 0.8;
            }
            return;
        }

        if (!action || action === 'none' || intensity <= 0) return;
        if (state !== 'idle' && state !== 'thinking' && state !== 'speaking') return;

        const overlay = intensity * (state === 'idle' ? 0.48 : 1);

        if (action === 'core-shimmer' || action === 'halo-breathe') this.blobCoreShimmer = overlay;
        if (action === 'ring-tick' || action === 'rim-flare' || action === 'ring-echo') this.blobRingPulse = overlay;
        if (action === 'scan-sweep') this.blobLaserBoost = overlay;

        switch (action) {
            case 'soft-pulse':
            case 'micro-pulse':
            case 'halo-breathe':
                targets.targetScale += 0.06 * overlay;
                targets.targetWeight1 += 0.04 * overlay;
                targets.targetWeight2 += 0.035 * overlay;
                targets.targetWeight3 += 0.03 * overlay;
                targets.targetWeight4 += 0.025 * overlay;
                break;
            case 'lobe-drift':
            case 'orbit-wobble':
                targets.targetLobe1 += 0.75 * overlay;
                targets.targetLobe3 -= 0.5 * overlay;
                targets.targetStretchX += 0.025 * overlay;
                break;
            case 'web-flicker':
            case 'web-surge':
            case 'node-cluster':
                targets.targetWebOp += 0.12 * overlay;
                targets.targetWebExp += 0.08 * overlay;
                break;
            case 'settle-sigh':
                targets.targetStretchY -= 0.06 * overlay;
                targets.targetLobe2 += 0.5 * overlay;
                targets.targetWeight2 += 0.03 * overlay;
                break;
            case 'lobe-compute':
                targets.targetLobe1 += 2.0 * overlay;
                targets.targetLobe2 += 1.5 * overlay;
                targets.targetLobe3 += 1.8 * overlay;
                targets.targetWeight1 += 0.08 * overlay;
                break;
            case 'rim-flare':
                targets.targetScale += 0.04 * overlay;
                targets.noiseAmpBoost = (targets.noiseAmpBoost || 0) + 8 * overlay;
                break;
            case 'scan-sweep':
                targets.targetWebOp += 0.12 * overlay;
                break;
            default:
                break;
        }
    }

    applyBlobIdleActionOverlay(targets) {
        this.applyBlobActionOverlay(targets);
    }

    triggerPhaseAvatarAction(now = performance.now()) {
        if (!this.avatarBehavior) return;
        const profile = this.getAvatarBehaviorProfile();
        const actions = this.getProfileActionsForState(this.state, profile);
        const action = this.pickWeightedAvatarAction(actions);
        this.avatarBehavior.action = action;
        this.avatarBehavior.actionStartedAt = now;
        this.avatarBehavior.actionDuration = this.getActionDuration(action);
        this.avatarBehavior.actionIntensity = 1;
        if (this.isCreatureAvatar()) {
            if (action === 'double-blink' || action === 'shy-blink' || action === 'focus-squint' || action === 'visor-blink') {
                this.creatureBlinkAmount = 1;
                this.avatarBehavior.doubleBlinkPending = action === 'double-blink' ? 14 : 0;
            }
            this.syncCreatureAvatarShell();
        } else {
            this.triggerBlobActionEffects(action);
        }
    }

    triggerIdleAvatarAction(now = performance.now()) {
        this.triggerPhaseAvatarAction(now);
    }

    updateAvatarBehavior() {
        if (!this.avatarBehavior || this.avatarBehavior.form !== this.avatarForm) {
            this.resetAvatarBehavior();
        }

        const now = performance.now();
        const behavior = this.avatarBehavior;
        const profile = this.getAvatarBehaviorProfile();
        behavior.expression = this.getExpressionForState(this.state);

        if (this.state === 'post-talk') {
            if (behavior.action !== 'none') {
                const progress = Math.min(1, (now - behavior.actionStartedAt) / Math.max(1, behavior.actionDuration));
                behavior.actionIntensity = Math.sin(progress * Math.PI);
                if (progress >= 1 || now >= behavior.postTalkEndsAt) {
                    behavior.action = 'none';
                    behavior.actionIntensity = 0;
                    this.setState('idle');
                }
            } else if (now >= behavior.postTalkEndsAt) {
                this.setState('idle');
            }
        } else if (['idle', 'thinking', 'speaking'].includes(this.state)) {
            if (this.state === 'thinking') {
                this.refreshThinkingLayersIfDue(now);
            }
            const phaseRange = this.getActionRangeForState(this.state, profile);
            if (now >= behavior.nextPhaseActionAt && behavior.action === 'none') {
                this.triggerPhaseAvatarAction(now);
            }

            if (behavior.action !== 'none') {
                const progress = Math.min(1, (now - behavior.actionStartedAt) / Math.max(1, behavior.actionDuration));
                behavior.actionIntensity = Math.sin(progress * Math.PI);
                if (progress >= 1) {
                    behavior.action = 'none';
                    behavior.actionIntensity = 0;
                    behavior.nextPhaseActionAt = now + this.randomInRange(phaseRange[0], phaseRange[1]);
                    behavior.nextIdleActionAt = behavior.nextPhaseActionAt;
                }
            }
        }

        this.creatureExpression = behavior.expression;
        this.creatureAction = behavior.action;
        this.creatureActionIntensity = behavior.actionIntensity;
    }

    estimateSyllableCount(word = '') {
        const clean = String(word).toLowerCase().replace(/[^a-z]/g, '');
        if (!clean) return 1;
        const groups = clean.match(/[aeiouy]+/g) || [];
        const silentE = clean.length > 3 && clean.endsWith('e') ? 1 : 0;
        return Math.max(1, groups.length - silentE);
    }

    pickCreatureMouthShape(word = '', index = 0) {
        const clean = String(word).toLowerCase().replace(/[^a-z!?]/g, '');
        if (!clean) return index % 2 === 0 ? 'small' : 'flat';
        if (/[bpm]$/.test(clean) || /^[bpm]/.test(clean)) return 'closed';
        if (/[fv]/.test(clean)) return 'flat';
        if (/[wq]|oo|ou|ow|oh|au/.test(clean)) return 'round';
        if (/[a]|ah|ha|aw/.test(clean) || clean.length > 7 || /[!?]$/.test(clean)) return 'wide';
        if (/[ei]|ee|y$/.test(clean)) return this.avatarForm === 'eve' ? 'flat' : 'smile';
        return index % 3 === 0 ? 'small' : 'flat';
    }

    pickNovaMouthShape(word = '', index = 0) {
        return this.pickCreatureMouthShape(word, index);
    }

    getSpeechVisemeForBeat(word = '', wordIndex = 0, beatIndex = 0) {
        const primary = this.pickCreatureMouthShape(word, wordIndex);
        if (primary === 'closed') return beatIndex % 2 === 0 ? 'closed' : 'small';
        if (primary === 'round') return ['round', 'small', 'round'][beatIndex % 3];
        if (primary === 'wide') return ['wide', 'small', 'smile'][beatIndex % 3];
        if (primary === 'smile') return ['smile', 'small'][beatIndex % 2];
        if (primary === 'flat') return ['flat', 'small'][beatIndex % 2];
        return ['small', 'flat', 'round'][beatIndex % 3];
    }

    getWordShapeSequence(word = '', wordIndex = 0) {
        const primary = this.pickCreatureMouthShape(word, wordIndex);
        if (primary === 'round') return ['round', 'small', 'round'];
        if (primary === 'wide') return ['wide', 'small', 'smile'];
        if (primary === 'smile') return ['smile', 'small'];
        if (primary === 'flat') return ['flat', 'small'];
        if (primary === 'closed') return ['closed', 'small'];
        return ['small', 'flat'];
    }

    getTimedSpeechShape(cue, elapsed, hasLiveAudio) {
        if (!cue?.words.length) {
            const fallbackShapes = ['small', 'round', 'wide', 'flat', 'smile'];
            return fallbackShapes[Math.floor(elapsed / 220) % fallbackShapes.length];
        }

        const cueIndex = Math.min(Math.max(0, cue.wordIndex), cue.words.length - 1);
        const word = cue.words[cueIndex] || '';
        const sequence = this.getWordShapeSequence(word, cueIndex);
        const holdMs = hasLiveAudio ? 145 : 190;
        if (!Number.isFinite(cue.shapeHoldUntil) || elapsed >= cue.shapeHoldUntil) {
            cue.shapeIndex = (cue.shapeIndex + 1) % sequence.length;
            cue.shapeHoldUntil = elapsed + holdMs;
        }
        return sequence[cue.shapeIndex] || cue.boundaryShape || this.pickCreatureMouthShape(word, cueIndex);
    }

    updateCreatureMouth() {
        let targetOpen = 0;
        let targetRound = 0;
        let shape = 'closed';

        if (this.state === 'speaking') {
            const now = performance.now();
            const cue = this.speechCue;
            const elapsed = cue ? now - cue.startTime : this.time * 1000;
            const audioEnvelope = this._audioReactive?.envelope ?? 0;
            const mouthEnvelope = this._audioReactive?.mouthEnvelope ?? 0;
            const hasLiveAudio = Boolean(this._audioReactive?.hasLiveMouthAudio || this._audioReactive?.frequency);

            let activeWord = '';
            let syllables = 1;
            if (cue?.words.length) {
                if (!hasLiveAudio) {
                    const currentWord = cue.words[Math.min(cue.wordIndex, cue.words.length - 1)] || '';
                    const currentSyllables = this.estimateSyllableCount(currentWord);
                    const approxWordMs = Math.max(240, 220 + currentSyllables * 92 + Math.min(currentWord.length, 12) * 10);
                    cue.wordIndex = Math.min(cue.words.length - 1, Math.floor(elapsed / approxWordMs));
                }
                activeWord = cue.words[Math.min(cue.wordIndex, cue.words.length - 1)] || '';
                syllables = this.estimateSyllableCount(activeWord);
                shape = this.getTimedSpeechShape(cue, elapsed, hasLiveAudio);
            } else {
                shape = this.getTimedSpeechShape(cue, elapsed, hasLiveAudio);
            }

            if (!activeWord) {
                activeWord = cue?.words?.[Math.min(cue.wordIndex, Math.max(0, (cue?.words?.length || 1) - 1))] || '';
                syllables = this.estimateSyllableCount(activeWord);
            }
            const syllablePulse = 0.5 + 0.5 * Math.sin(elapsed / Math.max(70, 150 - syllables * 8));
            const liveBoost = hasLiveAudio
                ? Math.min(1, Math.max(mouthEnvelope * 1.25, audioEnvelope * 0.75))
                : 0.32 + syllablePulse * 0.46;
            const openness = {
                closed: 0,
                flat: 0.24,
                small: 0.48,
                smile: 0.38,
                round: 0.58,
                wide: 0.82,
            };

            targetOpen = Math.min(1, (openness[shape] ?? 0.4) * (0.65 + liveBoost * 0.65));
            targetRound = shape === 'round' ? 1 : shape === 'small' ? 0.35 : 0;
        }

        const profile = this.getAvatarBehaviorProfile();
        const audioEnvelope = this._audioReactive?.envelope ?? 0;
        const mouthScale = profile?.mouthScale ?? 1;
        const roundScale = profile?.roundScale ?? 1;
        const speechGlowScale = profile?.speechGlowScale ?? 1;
        targetOpen = Math.min(1, targetOpen * mouthScale);
        targetRound = Math.min(1, targetRound * roundScale);

        if (shape !== this.creatureMouthShape) {
            this.creatureMouthShape = shape;
        }
        const opening = targetOpen > this.creatureMouthOpen;
        const openEase = this.state === 'speaking'
            ? (opening ? (this.avatarForm === 'eve' ? 0.42 : 0.38) : (this.avatarForm === 'eve' ? 0.24 : 0.2))
            : 0.28;
        const roundEase = this.state === 'speaking' ? 0.24 : 0.18;
        if (Math.abs(targetOpen - this.creatureMouthOpen) > 0.012) {
            this.creatureMouthOpen += (targetOpen - this.creatureMouthOpen) * openEase;
        } else {
            this.creatureMouthOpen = targetOpen;
        }
        if (Math.abs(targetRound - this.creatureMouthRound) > 0.018) {
            this.creatureMouthRound += (targetRound - this.creatureMouthRound) * roundEase;
        } else {
            this.creatureMouthRound = targetRound;
        }
        const targetEnergy = this.state === 'speaking'
            ? Math.min(1, Math.max(this.creatureMouthOpen, audioEnvelope * speechGlowScale))
            : 0;
        this.creatureSpeechEnergy += (targetEnergy - this.creatureSpeechEnergy) * 0.24;
        this.syncLegacyCreatureFields();
    }

    updateNovaMouth() {
        this.updateCreatureMouth();
    }

    updateCreatureBlinkAndEyes() {
        const profile = this.getAvatarBehaviorProfile();
        const behavior = this.avatarBehavior || this.createAvatarBehavior(this.avatarForm);
        const blinkRange = profile?.blinkRange || [85, 235];
        this.creatureBlinkTimer -= 1;
        if (behavior.doubleBlinkPending > 0) {
            behavior.doubleBlinkPending -= 1;
            if (behavior.doubleBlinkPending === 1) {
                this.creatureBlinkAmount = 1;
            }
        }
        if (this.creatureBlinkTimer <= 0) {
            this.creatureBlinkAmount = 1;
            this.creatureBlinkTimer = this.randomInRange(blinkRange[0], blinkRange[1]);
            if (Math.random() < (profile?.doubleBlinkChance || 0.12)) {
                behavior.doubleBlinkPending = 14;
            }
        }
        this.creatureBlinkAmount *= this.avatarForm === 'eve' ? 0.66 : 0.72;

        const now = performance.now();
        if (now >= behavior.nextEyeTargetAt) {
            const range = profile?.eyeRange || { x: 5, y: 2.5 };
            behavior.eyeTarget.x = this.randomInRange(-range.x, range.x);
            behavior.eyeTarget.y = this.randomInRange(-range.y, range.y);
            behavior.nextEyeTargetAt = now + this.randomInRange(1200, this.state === 'thinking' ? 2300 : 3600);
        }

        const attentionMap = profile?.eyeAttention || {};
        const attention = attentionMap[this.state] ?? 0.35;
        const actionPush = behavior.action === 'glance'
            ? behavior.actionIntensity * (this.avatarForm === 'wisp' ? -2.5 : 4.2)
            : behavior.action === 'visor-scan'
                ? Math.sin((now - behavior.actionStartedAt) / 90) * 3.6 * behavior.actionIntensity
                : 0;
        const thinkingScan = this.state === 'thinking'
            ? Math.sin(this.time * (this.avatarForm === 'eve' ? 3.6 : 2.4)) * (this.avatarForm === 'eve' ? 3.2 : 2.4)
            : 0;
        const speakingFocus = this.state === 'speaking' ? Math.sin(this.time * 3.4) * 1.2 : 0;
        const driftX = (behavior.eyeTarget.x + thinkingScan + speakingFocus) * attention + actionPush + this.parallaxX * 5;
        const driftY = (behavior.eyeTarget.y + Math.cos(this.time * 0.7) * 2.2) * attention + this.parallaxY * 3;
        this.creatureEyeDrift.x += (driftX - this.creatureEyeDrift.x) * 0.07;
        this.creatureEyeDrift.y += (driftY - this.creatureEyeDrift.y) * 0.07;
        this.syncLegacyCreatureFields();
    }

    updateNovaBlinkAndEyes() {
        this.updateCreatureBlinkAndEyes();
    }

    syncCreatureAvatarShell() {
        if (!this.avatarLayer) return;
        if (!this.isCreatureAvatar()) {
            this.avatarLayer.innerHTML = '';
            this.avatarLayer.className = 'avatar-layer';
            this.renderedAvatarForm = null;
            return;
        }

        if (this.renderedAvatarForm !== this.avatarForm) {
            this.avatarLayer.innerHTML = this.getCreatureAvatarMarkup(this.avatarForm);
            this.avatarLayer.className = `avatar-layer active avatar-${this.avatarForm}`;
            this.renderedAvatarForm = this.avatarForm;
        }

        const audioEnvelope = this._audioReactive?.envelope ?? 0;
        const mouthEnvelope = this._audioReactive?.mouthEnvelope ?? 0;
        const profile = this.getAvatarBehaviorProfile();
        const behavior = this.avatarBehavior || this.createAvatarBehavior(this.avatarForm);
        const thinkingPulse = this.state === 'thinking' ? 0.5 + 0.5 * Math.sin(this.time * 5.4) : 0;
        const stateBoost = (this.state === 'listening' ? 0.55 : this.state === 'thinking' ? 0.72 + thinkingPulse * 0.28 : this.state === 'speaking' ? 0.95 : this.state === 'post-talk' ? 0.12 : 0.2);
        const mouthOpen = Math.max(this.creatureMouthOpen, this.state === 'speaking' ? mouthEnvelope * 0.18 * (profile?.mouthScale ?? 1) : 0);
        const mouthRound = this.creatureMouthRound;
        const blinkScale = Math.max(0.08, 1 - this.creatureBlinkAmount * 0.9);
        const eyeX = this.creatureEyeDrift.x.toFixed(2);
        const eyeY = this.creatureEyeDrift.y.toFixed(2);
        const actionIntensity = behavior.actionIntensity || 0;
        const speechEnergy = Math.max(this.creatureSpeechEnergy, this.state === 'speaking' ? audioEnvelope * (profile?.speechGlowScale ?? 1) : 0);
        const primary = this.accentTheme.primary || '#ff4436';
        const secondary = this.accentTheme.secondary || '#ff6e40';
        const glow = this.accentTheme.glow || 'rgba(255, 68, 54, 0.4)';

        this.avatarLayer.style.setProperty('--creature-primary', primary);
        this.avatarLayer.style.setProperty('--creature-secondary', secondary);
        this.avatarLayer.style.setProperty('--creature-glow', glow);
        this.avatarLayer.style.setProperty('--creature-blink', blinkScale.toFixed(3));
        this.avatarLayer.style.setProperty('--creature-eye-x', `${eyeX}px`);
        this.avatarLayer.style.setProperty('--creature-eye-y', `${eyeY}px`);
        const pose = mouthOpen < 0.04 ? 'closed' : this.creatureMouthShape;
        this.avatarLayer.style.setProperty('--creature-mouth-open', mouthOpen.toFixed(3));
        this.avatarLayer.style.setProperty('--creature-mouth-round', mouthRound.toFixed(3));
        this.avatarLayer.style.setProperty('--mouth-wide', (pose === 'wide' ? 1 : 0).toFixed(3));
        this.avatarLayer.style.setProperty('--mouth-round', (pose === 'round' ? 1 : 0).toFixed(3));
        this.avatarLayer.style.setProperty('--mouth-smile', (pose === 'smile' ? 1 : 0).toFixed(3));
        this.avatarLayer.style.setProperty('--mouth-flat', (pose === 'flat' ? 1 : 0).toFixed(3));
        this.avatarLayer.style.setProperty('--mouth-closed', (pose === 'closed' ? 1 : 0).toFixed(3));
        this.avatarLayer.style.setProperty('--creature-state-boost', stateBoost.toFixed(3));
        this.avatarLayer.style.setProperty('--avatar-action-intensity', actionIntensity.toFixed(3));
        this.avatarLayer.style.setProperty('--avatar-speech-energy', Math.min(1, speechEnergy).toFixed(3));
        this.avatarLayer.style.setProperty('--avatar-ear-perk', (this.avatarForm === 'nova' ? Math.max(actionIntensity, this.state === 'thinking' ? thinkingPulse * 0.5 : 0) : 0).toFixed(3));
        this.avatarLayer.style.setProperty('--avatar-spark', (this.avatarForm === 'wisp' ? Math.max(actionIntensity, speechEnergy * 0.7, this.state === 'thinking' ? thinkingPulse * 0.75 : 0) : 0).toFixed(3));
        this.avatarLayer.style.setProperty('--avatar-scan', (this.avatarForm === 'eve' ? Math.max(actionIntensity, this.state === 'thinking' ? 0.5 + thinkingPulse * 0.5 : 0) : 0).toFixed(3));
        const stage = this.stageMotion || { x: 0, y: 0, rotate: 0, scale: 1 };
        this.avatarLayer.style.setProperty('--avatar-stage-x', `${stage.x.toFixed(2)}px`);
        this.avatarLayer.style.setProperty('--avatar-stage-y', `${stage.y.toFixed(2)}px`);
        this.avatarLayer.style.setProperty('--avatar-stage-rotate', `${stage.rotate.toFixed(2)}deg`);
        this.avatarLayer.style.setProperty('--avatar-stage-scale', stage.scale.toFixed(3));
        if (this.state === 'post-talk' && behavior.postTalkLayers) {
            const durSec = ((behavior.actionDuration || 3200) / 1000).toFixed(2);
            this.avatarLayer.style.setProperty('--post-talk-duration', `${durSec}s`);
            this.avatarLayer.dataset.postTalkStage = behavior.postTalkLayers.stage || '';
            this.avatarLayer.dataset.postTalkParts = (behavior.postTalkLayers.parts || []).join(' ');
        } else {
            this.avatarLayer.style.removeProperty('--post-talk-duration');
            delete this.avatarLayer.dataset.postTalkStage;
            delete this.avatarLayer.dataset.postTalkParts;
        }
        if (this.state === 'thinking' && behavior.thinkingLayers) {
            const cycleSec = ((behavior.thinkingLayers.cycleMs || 4000) / 1000).toFixed(2);
            this.avatarLayer.style.setProperty('--thinking-cycle-duration', `${cycleSec}s`);
            this.avatarLayer.dataset.thinkingStage = behavior.thinkingLayers.stage || '';
            this.avatarLayer.dataset.thinkingParts = (behavior.thinkingLayers.parts || []).join(' ');
        } else {
            this.avatarLayer.style.removeProperty('--thinking-cycle-duration');
            delete this.avatarLayer.dataset.thinkingStage;
            delete this.avatarLayer.dataset.thinkingParts;
        }
        this.avatarLayer.dataset.state = this.state;
        this.avatarLayer.dataset.action = behavior.action || 'none';
        this.avatarLayer.dataset.expression = behavior.expression || this.getExpressionForState(this.state);
        this.syncCreatureMouthRig(pose);
    }

    syncCreatureMouthRig(pose = this.creatureMouthShape) {
        if (!this.avatarLayer || !this.isCreatureAvatar()) return;
        const rig = this.avatarLayer.querySelector('.mouth-rig');
        if (!rig) return;
        rig.dataset.mouthPose = pose || 'closed';
    }

    getCreatureAvatarMarkup(form) {
        if (form === 'wisp') return this.getWispAvatarMarkup();
        if (form === 'eve') return this.getEveAvatarMarkup();
        return this.getNovaAvatarMarkup();
    }

    getCreatureDefs(idPrefix) {
        return `
            <defs>
                <filter id="${idPrefix}-glow" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="6" result="blur"/>
                    <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1.5 0" result="glow"/>
                    <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <radialGradient id="${idPrefix}-body" cx="34%" cy="24%" r="78%">
                    <stop offset="0%" stop-color="#fff" stop-opacity="0.58"/>
                    <stop offset="26%" stop-color="var(--creature-secondary)" stop-opacity="0.58"/>
                    <stop offset="72%" stop-color="var(--creature-primary)" stop-opacity="0.42"/>
                    <stop offset="100%" stop-color="var(--creature-primary)" stop-opacity="0.16"/>
                </radialGradient>
                <radialGradient id="${idPrefix}-core" cx="50%" cy="50%" r="58%">
                    <stop offset="0%" stop-color="#fff"/>
                    <stop offset="34%" stop-color="var(--creature-secondary)" stop-opacity="0.92"/>
                    <stop offset="100%" stop-color="var(--creature-primary)" stop-opacity="0"/>
                </radialGradient>
                <linearGradient id="${idPrefix}-glass" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#fff" stop-opacity="0.55"/>
                    <stop offset="42%" stop-color="var(--creature-secondary)" stop-opacity="0.28"/>
                    <stop offset="100%" stop-color="var(--creature-primary)" stop-opacity="0.08"/>
                </linearGradient>
            </defs>`;
    }

    getCreatureEyesMarkup() {
        return `
            <g class="creature-eyes">
                <g class="creature-eye left-eye">
                    <ellipse class="eye-shell" cx="-45" cy="-30" rx="19" ry="27"/>
                    <circle class="eye-gloss big" cx="-51" cy="-42" r="6"/>
                    <circle class="eye-gloss small" cx="-38" cy="-23" r="3"/>
                </g>
                <g class="creature-eye right-eye">
                    <ellipse class="eye-shell" cx="45" cy="-30" rx="19" ry="27"/>
                    <circle class="eye-gloss big" cx="39" cy="-42" r="6"/>
                    <circle class="eye-gloss small" cx="52" cy="-23" r="3"/>
                </g>
                ${this.getOrganicMouthRigMarkup()}
            </g>`;
    }

    getOrganicMouthRigMarkup() {
        return `
            <g class="mouth-rig organic-mouth" data-mouth-pose="closed">
                <ellipse class="mouth-shadow" cx="0" cy="22" rx="26" ry="6.5"/>
                <ellipse class="mouth-cavity" cx="0" cy="22" rx="20" ry="8"/>
                <path class="mouth-tongue" d="M-12 26 C-5 32 8 32 14 26 C8 23 -7 23 -12 26Z"/>
                <path class="mouth-upper-lip" d="M-22 18 C-10 12 10 12 22 18"/>
                <path class="mouth-lower-lip" d="M-22 19 C-10 31 10 31 22 19"/>
                <path class="mouth-closed-line" d="M-20 18 C-8 23 8 23 20 18"/>
            </g>`;
    }

    getCreatureCoreMarkup(idPrefix, y = 48, r = 28) {
        return `
            <g class="creature-core" filter="url(#${idPrefix}-glow)">
                <circle class="core-aura" cx="0" cy="${y}" r="${r * 2.15}" fill="url(#${idPrefix}-core)"/>
                <circle class="core-ring" cx="0" cy="${y}" r="${r * 1.16}"/>
                <circle class="core-light" cx="0" cy="${y}" r="${r * 0.58}"/>
            </g>`;
    }

    getNovaAvatarMarkup() {
        return `
            <svg class="creature-svg nova-svg" viewBox="-210 -230 420 470" role="img" aria-label="Nova avatar">
                ${this.getCreatureDefs('nova')}
                <g class="creature-shadow"><ellipse cx="0" cy="178" rx="105" ry="18"/></g>
                <g class="creature-float">
                    <g class="nova-ears" filter="url(#nova-glow)">
                        <path class="glass-part nova-ear left" d="M-72 -95 C-138 -196 -57 -224 -31 -112 C-44 -105 -59 -100 -72 -95Z"/>
                        <path class="glass-line" d="M-73 -101 C-94 -144 -76 -181 -48 -124"/>
                        <path class="glass-part nova-ear right" d="M72 -95 C138 -196 57 -224 31 -112 C44 -105 59 -100 72 -95Z"/>
                        <path class="glass-line" d="M73 -101 C94 -144 76 -181 48 -124"/>
                        <path class="glass-part nova-fin left" d="M-76 -83 C-115 -82 -116 -52 -63 -61"/>
                        <path class="glass-part nova-fin right" d="M76 -83 C115 -82 116 -52 63 -61"/>
                    </g>
                    <g class="nova-limbs" filter="url(#nova-glow)">
                        <ellipse class="glass-part nova-arm left" cx="-107" cy="38" rx="22" ry="47" transform="rotate(25 -107 38)"/>
                        <ellipse class="glass-part nova-arm right" cx="107" cy="38" rx="22" ry="47" transform="rotate(-25 107 38)"/>
                        <ellipse class="glass-part nova-foot left" cx="-44" cy="137" rx="25" ry="36" transform="rotate(18 -44 137)"/>
                        <ellipse class="glass-part nova-foot right" cx="44" cy="137" rx="25" ry="36" transform="rotate(-18 44 137)"/>
                    </g>
                    <path class="creature-body nova-body" filter="url(#nova-glow)" d="M0 -120 C72 -120 118 -70 117 8 C116 92 70 151 0 151 C-70 151 -116 92 -117 8 C-118 -70 -72 -120 0 -120Z"/>
                    <path class="body-highlight" d="M-67 -74 C-31 -112 49 -112 78 -50"/>
                    <ellipse class="cheek left" cx="-55" cy="54" rx="21" ry="29"/>
                    <ellipse class="cheek right" cx="55" cy="54" rx="21" ry="29"/>
                    ${this.getCreatureEyesMarkup()}
                    ${this.getCreatureCoreMarkup('nova', 61, 30)}
                    <path class="surface-spark" d="M67 -83 C78 -88 83 -81 78 -72"/>
                </g>
            </svg>`;
    }

    getEveAvatarMarkup() {
        return `
            <svg class="creature-svg eve-svg" viewBox="-230 -245 460 500" role="img" aria-label="EVE avatar">
                <defs>
                    <filter id="eve-glow" x="-80%" y="-80%" width="260%" height="260%">
                        <feGaussianBlur stdDeviation="6" result="blur"/>
                        <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1.5 0" result="glow"/>
                        <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                    <radialGradient id="eve-body" cx="38%" cy="28%" r="80%">
                        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.99"/>
                        <stop offset="52%" stop-color="#eef3ff" stop-opacity="0.95"/>
                        <stop offset="100%" stop-color="var(--creature-secondary)" stop-opacity="0.40"/>
                    </radialGradient>
                </defs>
                <g class="creature-shadow"><ellipse cx="0" cy="248" rx="92" ry="13"/></g>
                <g class="eve-ground">
                    <ellipse class="eve-ring" cx="0" cy="246" rx="120" ry="17"/>
                    <ellipse class="eve-ring" cx="0" cy="249" rx="74" ry="10"/>
                </g>
                <g class="creature-float">
                    <g class="eve-arms" filter="url(#eve-glow)">
                        <ellipse class="creature-body eve-arm" cx="-112" cy="80" rx="17" ry="47" transform="rotate(-12 -112 80)"/>
                        <ellipse class="creature-body eve-arm" cx="112" cy="80" rx="17" ry="47" transform="rotate(12 112 80)"/>
                    </g>
                    <path class="creature-body eve-body" filter="url(#eve-glow)" d="M0,-50 C46,-50 72,2 76,68 C80,142 50,222 0,222 C-50,222 -80,142 -76,68 C-72,2 -46,-50 0,-50 Z"/>
                    <ellipse class="eve-sheen" cx="-30" cy="22" rx="30" ry="48" transform="rotate(-18 -30 22)"/>
                    <path class="eve-seam" d="M-58,152 Q0,172 58,152"/>
                    <g class="eve-head-grp">
                        <ellipse class="creature-body eve-head" filter="url(#eve-glow)" cx="0" cy="-138" rx="90" ry="64"/>
                        <ellipse class="eve-sheen" cx="-36" cy="-168" rx="26" ry="14" transform="rotate(-22 -36 -168)"/>
                        <ellipse class="eve-face" cx="0" cy="-136" rx="78" ry="52"/>
                        <g class="eve-eyes">
                            <g class="eve-eye-blink">
                                <ellipse class="eve-eye" cx="-31" cy="-138" rx="14" ry="18" transform="rotate(11 -31 -138)"/>
                                <ellipse class="eve-eye" cx="31" cy="-138" rx="14" ry="18" transform="rotate(-11 31 -138)"/>
                                <circle class="eve-eye-shine" cx="-33" cy="-146" r="5"/>
                                <circle class="eve-eye-shine" cx="33" cy="-146" r="5"/>
                                <circle class="eve-eye-shine sm" cx="-24" cy="-130" r="2.6"/>
                                <circle class="eve-eye-shine sm" cx="24" cy="-130" r="2.6"/>
                            </g>
                        </g>
                        <g class="mouth-rig eve-mouth-rig" data-mouth-pose="closed">
                            <rect class="eve-mouth-back" x="-32" y="-109" width="64" height="13" rx="6"/>
                            <rect class="eve-mouth-core" x="-21" y="-106" width="42" height="8" rx="4"/>
                            <rect class="eve-mouth-bar left" x="-29" y="-104" width="10" height="5" rx="2.5"/>
                            <rect class="eve-mouth-bar mid" x="-6" y="-104" width="12" height="5" rx="2.5"/>
                            <rect class="eve-mouth-bar right" x="19" y="-104" width="10" height="5" rx="2.5"/>
                        </g>
                    </g>
                </g>
            </svg>`;
    }

    getAxelAvatarMarkup() {
        return `
            <svg class="creature-svg axel-svg" viewBox="-330 -300 660 620" role="img" aria-label="Axel avatar">
                ${this.getCreatureDefs('axel')}
                <defs>
                    <linearGradient id="axel-red-armor" x1="15%" y1="0%" x2="85%" y2="100%">
                        <stop offset="0%" stop-color="#ff6547"/>
                        <stop offset="42%" stop-color="#b91925"/>
                        <stop offset="100%" stop-color="#470812"/>
                    </linearGradient>
                    <linearGradient id="axel-gold-plate" x1="18%" y1="0%" x2="82%" y2="100%">
                        <stop offset="0%" stop-color="#fff0a4"/>
                        <stop offset="36%" stop-color="#f0b13e"/>
                        <stop offset="72%" stop-color="#9b5416"/>
                        <stop offset="100%" stop-color="#4b2107"/>
                    </linearGradient>
                    <linearGradient id="axel-dark-glass" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#091523"/>
                        <stop offset="55%" stop-color="#02050b"/>
                        <stop offset="100%" stop-color="#0b1726"/>
                    </linearGradient>
                    <radialGradient id="axel-reactor-glow" cx="50%" cy="50%" r="58%">
                        <stop offset="0%" stop-color="#ffffff"/>
                        <stop offset="30%" stop-color="#a8fbff"/>
                        <stop offset="72%" stop-color="#13ccff" stop-opacity="0.52"/>
                        <stop offset="100%" stop-color="#13ccff" stop-opacity="0"/>
                    </radialGradient>
                    <filter id="axel-cyan-glow" x="-80%" y="-80%" width="260%" height="260%">
                        <feGaussianBlur stdDeviation="8" result="blur"/>
                        <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.03  0 0 0 0 0.84  0 0 0 0 1  0 0 0 1.55 0" result="glow"/>
                        <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                </defs>
                <g class="creature-shadow"><ellipse cx="0" cy="286" rx="218" ry="28"/></g>
                <g class="axel-ground">
                    <ellipse class="axel-hover-ring" cx="0" cy="286" rx="158" ry="13"/>
                    <ellipse class="axel-hover-ring wide" cx="0" cy="286" rx="218" ry="28"/>
                </g>
                <g class="creature-float">
                    <g class="axel-mech-head" filter="url(#axel-glow)">
                        <path class="axel-red-shell" d="M-263 -78 L-214 -184 L-118 -240 L-62 -256 L-26 -218 L26 -218 L62 -256 L118 -240 L214 -184 L263 -78 L235 126 L150 241 L43 279 L0 252 L-43 279 L-150 241 L-235 126Z"/>
                        <path class="axel-under-shell" d="M-219 -62 L-165 -156 L-78 -205 L-24 -214 L0 -185 L24 -214 L78 -205 L165 -156 L219 -62 L203 93 L129 196 L40 229 L0 204 L-40 229 L-129 196 L-203 93Z"/>
                        <path class="axel-gold-plate axel-brow-plate" d="M-136 -196 L-53 -230 L-18 -190 L18 -190 L53 -230 L136 -196 L96 -118 L36 -90 L0 -106 L-36 -90 L-96 -118Z"/>
                        <path class="axel-visor" d="M-202 -57 L-132 -123 L-49 -139 L0 -124 L49 -139 L132 -123 L202 -57 L177 8 L86 43 L0 29 L-86 43 L-177 8Z"/>
                    </g>
                    <g class="axel-eyes">
                        <g class="axel-eye-blink">
                            <path class="axel-eye" d="M-177 -44 L-102 -82 L-43 -79 L-67 -43 L-157 -20Z"/>
                            <path class="axel-eye" d="M177 -44 L102 -82 L43 -79 L67 -43 L157 -20Z"/>
                            <path class="axel-eye-shine" d="M-165 -42 L-99 -68 L-58 -65M165 -42 L99 -68 L58 -65"/>
                        </g>
                    </g>
                    <path class="axel-gold-plate axel-cheek left" d="M-168 21 L-95 64 L-49 58 L-73 126 L-150 107Z"/>
                    <path class="axel-gold-plate axel-cheek right" d="M168 21 L95 64 L49 58 L73 126 L150 107Z"/>
                    <path class="axel-gold-plate axel-jaw" d="M-91 54 L-38 80 L38 80 L91 54 L67 154 L28 190 L0 175 L-28 190 L-67 154Z"/>
                    <path class="axel-jaw-lines" d="M-49 114H49M-38 146H38M0 80V174"/>
                    <path class="creature-mouth axel-mouth" d="M-43 118 H43"/>
                    <g class="creature-core axel-reactor" filter="url(#axel-cyan-glow)">
                        <circle class="axel-reactor-aura" cx="0" cy="216" r="82"/>
                        <circle class="axel-reactor-ring" cx="0" cy="216" r="38"/>
                        <circle class="axel-reactor-light" cx="0" cy="216" r="24"/>
                        <path class="axel-reactor-bracket" d="M-74 202 L-41 178M74 202 L41 178M-68 235 L-34 248M68 235 L34 248"/>
                    </g>
                    <path class="axel-side-trace" d="M-242 -65 L-307 -28 L-281 51 L-229 73M242 -65 L307 -28 L281 51 L229 73"/>
                    <path class="axel-top-trace" d="M-228 -119 L-297 -162M228 -119 L297 -162"/>
                    <path class="axel-crown-trace" d="M-137 -223 L-162 -267M137 -223 L162 -267"/>
                    <path class="axel-panel-line" d="M-226 93 L-260 161 L-201 139M226 93 L260 161 L201 139M-118 -174 L-195 -94M118 -174 L195 -94M-140 210 L-91 170M140 210 L91 170"/>
                </g>
            </svg>`;
    }

    getWispAvatarMarkup() {
        return `
            <svg class="creature-svg wisp-svg" viewBox="-240 -255 480 560" role="img" aria-label="Wisp avatar">
                ${this.getCreatureDefs('wisp')}
                <g class="creature-shadow"><ellipse cx="0" cy="235" rx="126" ry="19"/></g>
                <g class="creature-float">
                    <path class="glass-part wisp-arm left" filter="url(#wisp-glow)" d="M-113 12 C-186 42 -177 115 -98 109 C-72 83 -77 35 -113 12Z"/>
                    <path class="glass-part wisp-arm right" filter="url(#wisp-glow)" d="M113 12 C186 42 177 115 98 109 C72 83 77 35 113 12Z"/>
                    <path class="creature-body wisp-body" filter="url(#wisp-glow)" d="M0 -151 C79 -151 132 -94 136 -18 C142 55 123 121 100 155 C76 144 56 154 39 176 C18 151 -7 151 -29 176 C-48 154 -70 144 -97 158 C-121 124 -139 57 -134 -18 C-128 -95 -79 -151 0 -151Z"/>
                    <path class="body-highlight" d="M-75 -91 C-32 -133 62 -126 91 -56"/>
                    <path class="wisp-hem-glow" d="M-96 145 C-74 132 -51 151 -29 176 C-8 152 18 152 39 176 C59 151 77 132 99 149"/>
                    <g class="wisp-sparks">
                        <circle cx="-52" cy="-102" r="2.1"/>
                        <circle cx="-12" cy="-116" r="1.5"/>
                        <circle cx="43" cy="-101" r="1.7"/>
                        <circle cx="-71" cy="-36" r="1.3"/>
                        <circle cx="71" cy="-27" r="1.4"/>
                        <circle cx="-33" cy="73" r="1.2"/>
                        <circle cx="36" cy="88" r="1.1"/>
                    </g>
                    <ellipse class="cheek left" cx="-68" cy="10" rx="22" ry="14"/>
                    <ellipse class="cheek right" cx="68" cy="10" rx="22" ry="14"/>
                    ${this.getCreatureEyesMarkup()}
                    ${this.getCreatureCoreMarkup('wisp', 73, 31)}
                </g>
            </svg>`;
    }

    drawNovaAvatar(cx, cy, activeRadius, primaryColor, secondaryColor, glowColor) {
        this.updateNovaBlinkAndEyes();
        this.updateNovaMouth();

        const ctx = this.ctx;
        const rootStyles = getComputedStyle(document.documentElement);
        const creaturePrimary = rootStyles.getPropertyValue('--accent-primary').trim() || primaryColor;
        const creatureSecondary = rootStyles.getPropertyValue('--accent-secondary').trim() || secondaryColor;
        const creatureGlow = rootStyles.getPropertyValue('--accent-glow').trim() || glowColor;
        const rgbPrimary = this.hexToRgb(creaturePrimary);
        const rgbSecondary = this.hexToRgb(creatureSecondary);
        const audioEnvelope = this._audioReactive?.envelope ?? 0;

        let stateLift = 0;
        let earLift = 0;
        let bodySquash = 1;
        if (this.state === 'listening') {
            stateLift = -8;
            earLift = 14;
            bodySquash = 0.97;
        } else if (this.state === 'thinking') {
            stateLift = -3 + Math.sin(this.time * 6) * 2;
            earLift = 9;
        } else if (this.state === 'speaking') {
            stateLift = Math.sin(this.time * 5.2) * 5 - audioEnvelope * 10;
            earLift = 7 + audioEnvelope * 12;
            bodySquash = 1 + audioEnvelope * 0.08;
        }

        const floatY = Math.sin(this.time * 1.4) * 7 + stateLift;
        const breathe = 1 + Math.sin(this.time * 1.9) * 0.025 + audioEnvelope * 0.05;
        const bodyR = activeRadius * 1.08;
        const bodyX = cx;
        const bodyY = cy + floatY + activeRadius * 0.1;

        ctx.save();
        ctx.translate(bodyX, bodyY);
        ctx.scale(breathe * (1 / bodySquash), breathe * bodySquash);

        // Soft hologram aura behind Nova.
        const aura = ctx.createRadialGradient(0, 0, bodyR * 0.1, 0, 0, bodyR * 1.45);
        aura.addColorStop(0, `rgba(${rgbSecondary}, 0.22)`);
        aura.addColorStop(0.45, `rgba(${rgbPrimary}, 0.16)`);
        aura.addColorStop(1, `rgba(${rgbPrimary}, 0)`);
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(0, 0, bodyR * 1.45, bodyR * 1.28, 0, 0, Math.PI * 2);
        ctx.fill();

        this.drawNovaEar(-bodyR * 0.42, -bodyR * 0.72, -1, bodyR, creaturePrimary, creatureSecondary, earLift);
        this.drawNovaEar(bodyR * 0.42, -bodyR * 0.72, 1, bodyR, creaturePrimary, creatureSecondary, earLift);
        this.drawNovaArm(-bodyR * 0.74, bodyR * 0.04, -1, bodyR, creaturePrimary, creatureSecondary);
        this.drawNovaArm(bodyR * 0.74, bodyR * 0.04, 1, bodyR, creaturePrimary, creatureSecondary);
        this.drawNovaFoot(-bodyR * 0.28, bodyR * 0.78, -1, bodyR, creaturePrimary, creatureSecondary);
        this.drawNovaFoot(bodyR * 0.28, bodyR * 0.78, 1, bodyR, creaturePrimary, creatureSecondary);

        ctx.shadowBlur = 24;
        ctx.shadowColor = creatureGlow;
        const bodyGrad = ctx.createRadialGradient(-bodyR * 0.22, -bodyR * 0.36, 8, 0, 0, bodyR * 1.05);
        bodyGrad.addColorStop(0, `rgba(255, 255, 255, 0.36)`);
        bodyGrad.addColorStop(0.24, `rgba(${rgbSecondary}, 0.68)`);
        bodyGrad.addColorStop(0.72, `rgba(${rgbPrimary}, 0.5)`);
        bodyGrad.addColorStop(1, `rgba(${rgbPrimary}, 0.24)`);
        ctx.fillStyle = bodyGrad;
        this.drawNovaOrganicBody(0, 0, bodyR);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = `rgba(${rgbSecondary}, 0.32)`;
        ctx.lineWidth = 1.3;
        this.drawNovaOrganicBody(0, 0, bodyR * 1.01);
        ctx.stroke();

        const corePulse = 1 + Math.sin(this.time * 4.8) * 0.08 + audioEnvelope * 0.5;
        const coreGrad = ctx.createRadialGradient(0, bodyR * 0.28, 2, 0, bodyR * 0.28, bodyR * 0.36 * corePulse);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.38, `rgba(${rgbSecondary}, 0.9)`);
        coreGrad.addColorStop(1, `rgba(${rgbPrimary}, 0.03)`);
        ctx.fillStyle = coreGrad;
        ctx.shadowBlur = 18 + audioEnvelope * 22;
        ctx.shadowColor = creatureSecondary;
        ctx.beginPath();
        ctx.arc(0, bodyR * 0.28, bodyR * 0.28 * corePulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        this.drawNovaFace(bodyR, creaturePrimary, creatureSecondary);
        this.drawNovaHudTicks(bodyR, primaryColor, secondaryColor);

        ctx.restore();
    }

    drawAxelAvatar(cx, cy, activeRadius, primaryColor, secondaryColor, glowColor) {
        this.updateNovaBlinkAndEyes();
        this.updateNovaMouth();

        const ctx = this.ctx;
        const rootStyles = getComputedStyle(document.documentElement);
        const creaturePrimary = rootStyles.getPropertyValue('--accent-primary').trim() || primaryColor;
        const creatureSecondary = rootStyles.getPropertyValue('--accent-secondary').trim() || secondaryColor;
        const creatureGlow = rootStyles.getPropertyValue('--accent-glow').trim() || glowColor;
        const rgbPrimary = this.hexToRgb(creaturePrimary);
        const rgbSecondary = this.hexToRgb(creatureSecondary);
        const audioEnvelope = this._audioReactive?.envelope ?? 0;
        const bodyR = activeRadius * 1.02;

        let stateLift = 0;
        let earLift = 0;
        let stance = 1;
        if (this.state === 'listening') {
            stateLift = -7;
            earLift = 10;
            stance = 0.98;
        } else if (this.state === 'thinking') {
            stateLift = -2 + Math.sin(this.time * 6.2) * 2;
            earLift = 6;
        } else if (this.state === 'speaking') {
            stateLift = Math.sin(this.time * 5) * 4 - audioEnvelope * 8;
            earLift = 5 + audioEnvelope * 8;
            stance = 1 + audioEnvelope * 0.05;
        }

        const floatY = Math.sin(this.time * 1.25) * 5 + stateLift + activeRadius * 0.1;
        const breathe = 1 + Math.sin(this.time * 1.7) * 0.018 + audioEnvelope * 0.035;

        ctx.save();
        ctx.translate(cx, cy + floatY);
        ctx.scale(breathe, breathe * stance);

        const aura = ctx.createRadialGradient(0, 0, bodyR * 0.15, 0, 0, bodyR * 1.5);
        aura.addColorStop(0, `rgba(${rgbSecondary}, 0.2)`);
        aura.addColorStop(0.45, `rgba(${rgbPrimary}, 0.16)`);
        aura.addColorStop(1, `rgba(${rgbPrimary}, 0)`);
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(0, 0, bodyR * 1.42, bodyR * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();

        this.drawAxelEar(-bodyR * 0.48, -bodyR * 0.72, -1, bodyR, creaturePrimary, creatureSecondary, earLift);
        this.drawAxelEar(bodyR * 0.48, -bodyR * 0.72, 1, bodyR, creaturePrimary, creatureSecondary, earLift);
        this.drawAxelSidePod(-bodyR * 0.72, -bodyR * 0.24, -1, bodyR, creaturePrimary, creatureSecondary);
        this.drawAxelSidePod(bodyR * 0.72, -bodyR * 0.24, 1, bodyR, creaturePrimary, creatureSecondary);
        this.drawAxelArm(-bodyR * 0.75, bodyR * 0.42, -1, bodyR, creaturePrimary, creatureSecondary);
        this.drawAxelArm(bodyR * 0.75, bodyR * 0.42, 1, bodyR, creaturePrimary, creatureSecondary);
        this.drawAxelLeg(-bodyR * 0.3, bodyR * 0.92, -1, bodyR, creaturePrimary, creatureSecondary);
        this.drawAxelLeg(bodyR * 0.3, bodyR * 0.92, 1, bodyR, creaturePrimary, creatureSecondary);

        ctx.shadowBlur = 24;
        ctx.shadowColor = creatureGlow;
        const bodyGrad = ctx.createRadialGradient(-bodyR * 0.18, -bodyR * 0.44, 8, 0, 0, bodyR * 1.1);
        bodyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
        bodyGrad.addColorStop(0.28, `rgba(${rgbSecondary}, 0.62)`);
        bodyGrad.addColorStop(0.72, `rgba(${rgbPrimary}, 0.42)`);
        bodyGrad.addColorStop(1, `rgba(${rgbPrimary}, 0.18)`);
        ctx.fillStyle = bodyGrad;
        this.drawAxelArmorBody(0, 0, bodyR);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = `rgba(${rgbSecondary}, 0.55)`;
        ctx.lineWidth = 1.8;
        this.drawAxelArmorBody(0, 0, bodyR);
        ctx.stroke();

        this.drawAxelArmorLines(bodyR, creaturePrimary, creatureSecondary);

        const corePulse = 1 + Math.sin(this.time * 5) * 0.08 + audioEnvelope * 0.48;
        const coreGrad = ctx.createRadialGradient(0, bodyR * 0.42, 2, 0, bodyR * 0.42, bodyR * 0.32 * corePulse);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.36, `rgba(${rgbSecondary}, 0.92)`);
        coreGrad.addColorStop(1, `rgba(${rgbPrimary}, 0.02)`);
        ctx.fillStyle = coreGrad;
        ctx.shadowBlur = 20 + audioEnvelope * 24;
        ctx.shadowColor = creatureSecondary;
        ctx.beginPath();
        ctx.arc(0, bodyR * 0.42, bodyR * 0.25 * corePulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        this.drawAxelFace(bodyR, creaturePrimary, creatureSecondary);
        this.drawNovaHudTicks(bodyR, primaryColor, secondaryColor);
        ctx.restore();
    }

    drawWispAvatar(cx, cy, activeRadius, primaryColor, secondaryColor, glowColor) {
        this.updateNovaBlinkAndEyes();
        this.updateNovaMouth();

        const ctx = this.ctx;
        const rootStyles = getComputedStyle(document.documentElement);
        const creaturePrimary = rootStyles.getPropertyValue('--accent-primary').trim() || primaryColor;
        const creatureSecondary = rootStyles.getPropertyValue('--accent-secondary').trim() || secondaryColor;
        const creatureGlow = rootStyles.getPropertyValue('--accent-glow').trim() || glowColor;
        const rgbPrimary = this.hexToRgb(creaturePrimary);
        const rgbSecondary = this.hexToRgb(creatureSecondary);
        const audioEnvelope = this._audioReactive?.envelope ?? 0;
        const bodyR = activeRadius * 1.08;

        let stateLift = 0;
        if (this.state === 'listening') {
            stateLift = -9;
        } else if (this.state === 'thinking') {
            stateLift = Math.sin(this.time * 6.5) * 2 - 4;
        } else if (this.state === 'speaking') {
            stateLift = Math.sin(this.time * 5.3) * 6 - audioEnvelope * 10;
        }

        const floatY = Math.sin(this.time * 1.1) * 9 + stateLift + activeRadius * 0.04;
        const breathe = 1 + Math.sin(this.time * 1.6) * 0.025 + audioEnvelope * 0.04;

        ctx.save();
        ctx.translate(cx, cy + floatY);
        ctx.scale(breathe, breathe * (1 + audioEnvelope * 0.04));

        const aura = ctx.createRadialGradient(0, 0, bodyR * 0.12, 0, 0, bodyR * 1.55);
        aura.addColorStop(0, `rgba(${rgbSecondary}, 0.26)`);
        aura.addColorStop(0.5, `rgba(${rgbPrimary}, 0.16)`);
        aura.addColorStop(1, `rgba(${rgbPrimary}, 0)`);
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(0, bodyR * 0.08, bodyR * 1.4, bodyR * 1.35, 0, 0, Math.PI * 2);
        ctx.fill();

        this.drawWispTail(bodyR, creaturePrimary, creatureSecondary);
        this.drawWispArm(-bodyR * 0.72, bodyR * 0.16, -1, bodyR, creaturePrimary, creatureSecondary);
        this.drawWispArm(bodyR * 0.72, bodyR * 0.16, 1, bodyR, creaturePrimary, creatureSecondary);

        ctx.shadowBlur = 28;
        ctx.shadowColor = creatureGlow;
        const bodyGrad = ctx.createRadialGradient(-bodyR * 0.18, -bodyR * 0.36, 8, 0, bodyR * 0.08, bodyR * 1.1);
        bodyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.48)');
        bodyGrad.addColorStop(0.3, `rgba(${rgbSecondary}, 0.52)`);
        bodyGrad.addColorStop(0.72, `rgba(${rgbPrimary}, 0.32)`);
        bodyGrad.addColorStop(1, `rgba(${rgbPrimary}, 0.08)`);
        ctx.fillStyle = bodyGrad;
        this.drawWispBody(0, 0, bodyR);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = `rgba(${rgbSecondary}, 0.55)`;
        ctx.lineWidth = 1.7;
        this.drawWispBody(0, 0, bodyR);
        ctx.stroke();

        const tuftGrad = ctx.createLinearGradient(0, -bodyR * 1.15, bodyR * 0.26, -bodyR * 0.54);
        tuftGrad.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
        tuftGrad.addColorStop(1, `rgba(${rgbSecondary}, 0.18)`);
        ctx.fillStyle = tuftGrad;
        ctx.beginPath();
        ctx.moveTo(bodyR * 0.02, -bodyR * 0.82);
        ctx.quadraticCurveTo(bodyR * 0.34, -bodyR * 1.18, bodyR * 0.18, -bodyR * 0.58);
        ctx.quadraticCurveTo(bodyR * 0.08, -bodyR * 0.68, bodyR * 0.02, -bodyR * 0.82);
        ctx.fill();

        const corePulse = 1 + Math.sin(this.time * 4.6) * 0.08 + audioEnvelope * 0.5;
        const coreGrad = ctx.createRadialGradient(0, bodyR * 0.28, 2, 0, bodyR * 0.28, bodyR * 0.36 * corePulse);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.38, `rgba(${rgbSecondary}, 0.86)`);
        coreGrad.addColorStop(1, `rgba(${rgbPrimary}, 0.02)`);
        ctx.fillStyle = coreGrad;
        ctx.shadowBlur = 20 + audioEnvelope * 24;
        ctx.shadowColor = creatureSecondary;
        ctx.beginPath();
        ctx.arc(0, bodyR * 0.28, bodyR * 0.27 * corePulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        this.drawWispFace(bodyR, creaturePrimary, creatureSecondary);
        this.drawNovaHudTicks(bodyR, primaryColor, secondaryColor);
        ctx.restore();
    }

    drawNovaOrganicBody(x, y, radius) {
        const steps = 96;
        const angleStep = (Math.PI * 2) / steps;
        this.ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const angle = i * angleStep;
            const wobble = Math.sin(angle * 3 + this.time * 0.85) * 0.045 +
                Math.cos(angle * 5 - this.time * 0.62) * 0.032 +
                Math.sin(angle * 2 + this.time * 0.38) * 0.022;
            const r = radius * (1 + wobble);
            const px = x + Math.cos(angle) * r * 0.74;
            const py = y + Math.sin(angle) * r * 0.9;
            if (i === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
    }

    drawAxelArmorBody(x, y, radius) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.54, y - radius * 0.42);
        ctx.quadraticCurveTo(x - radius * 0.48, y - radius * 0.82, x - radius * 0.06, y - radius * 0.86);
        ctx.quadraticCurveTo(x + radius * 0.48, y - radius * 0.88, x + radius * 0.56, y - radius * 0.42);
        ctx.lineTo(x + radius * 0.52, y + radius * 0.12);
        ctx.quadraticCurveTo(x + radius * 0.58, y + radius * 0.58, x + radius * 0.34, y + radius * 0.82);
        ctx.quadraticCurveTo(x, y + radius * 1.02, x - radius * 0.34, y + radius * 0.82);
        ctx.quadraticCurveTo(x - radius * 0.58, y + radius * 0.58, x - radius * 0.52, y + radius * 0.12);
        ctx.closePath();
    }

    drawAxelEar(x, y, side, bodyR, primaryColor, secondaryColor, lift) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y - lift);
        ctx.rotate(side * (0.54 + Math.sin(this.time * 1.5 + side) * 0.035));
        const grad = ctx.createLinearGradient(0, -bodyR * 0.7, 0, bodyR * 0.14);
        grad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.58)`);
        grad.addColorStop(0.52, `rgba(${this.hexToRgb(primaryColor)}, 0.28)`);
        grad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.08)`);
        ctx.fillStyle = grad;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.58)`;
        ctx.lineWidth = 1.7;
        ctx.shadowBlur = 15;
        ctx.shadowColor = secondaryColor;
        ctx.beginPath();
        ctx.moveTo(0, -bodyR * 0.68);
        ctx.quadraticCurveTo(side * bodyR * 0.28, -bodyR * 0.3, side * bodyR * 0.12, bodyR * 0.08);
        ctx.quadraticCurveTo(-side * bodyR * 0.1, -bodyR * 0.04, 0, -bodyR * 0.68);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(255, 255, 255, 0.28)`;
        ctx.beginPath();
        ctx.moveTo(side * bodyR * 0.02, -bodyR * 0.52);
        ctx.lineTo(side * bodyR * 0.1, -bodyR * 0.08);
        ctx.stroke();
        ctx.restore();
    }

    drawAxelSidePod(x, y, side, bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y);
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, bodyR * 0.22);
        grad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.5)`);
        grad.addColorStop(0.55, `rgba(${this.hexToRgb(primaryColor)}, 0.22)`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.14)');
        ctx.fillStyle = grad;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.55)`;
        ctx.lineWidth = 1.4;
        ctx.shadowBlur = 12;
        ctx.shadowColor = secondaryColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, bodyR * 0.16, bodyR * 0.23, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(255, 255, 255, 0.24)`;
        ctx.beginPath();
        ctx.arc(0, 0, bodyR * 0.1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    drawAxelArm(x, y, side, bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        const bob = Math.sin(this.time * 2.1 + side) * 5;
        ctx.save();
        ctx.translate(x, y + bob);
        ctx.rotate(side * (0.18 + Math.sin(this.time * 1.2) * 0.04));
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, bodyR * 0.3);
        grad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.44)`);
        grad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.13)`);
        ctx.fillStyle = grad;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.36)`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.roundRect(-bodyR * 0.1, -bodyR * 0.2, bodyR * 0.2, bodyR * 0.42, bodyR * 0.11);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawAxelLeg(x, y, side, bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y + Math.sin(this.time * 1.8 + side) * 2);
        ctx.rotate(side * -0.08);
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, bodyR * 0.24);
        grad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.38)`);
        grad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.12)`);
        ctx.fillStyle = grad;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.32)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, bodyR * 0.14, bodyR * 0.25, side * 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawAxelArmorLines(bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.34)`;
        ctx.lineWidth = 1.2;
        ctx.shadowBlur = 8;
        ctx.shadowColor = secondaryColor;
        ctx.beginPath();
        ctx.moveTo(-bodyR * 0.5, -bodyR * 0.32);
        ctx.lineTo(-bodyR * 0.24, -bodyR * 0.16);
        ctx.lineTo(bodyR * 0.24, -bodyR * 0.16);
        ctx.lineTo(bodyR * 0.5, -bodyR * 0.32);
        ctx.moveTo(-bodyR * 0.42, bodyR * 0.28);
        ctx.lineTo(-bodyR * 0.2, bodyR * 0.42);
        ctx.moveTo(bodyR * 0.42, bodyR * 0.28);
        ctx.lineTo(bodyR * 0.2, bodyR * 0.42);
        ctx.stroke();

        ctx.strokeStyle = `rgba(${this.hexToRgb(primaryColor)}, 0.6)`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-bodyR * 0.44, -bodyR * 0.42);
        ctx.lineTo(-bodyR * 0.17, -bodyR * 0.34);
        ctx.moveTo(bodyR * 0.44, -bodyR * 0.42);
        ctx.lineTo(bodyR * 0.17, -bodyR * 0.34);
        ctx.stroke();
        ctx.restore();
    }

    drawAxelFace(bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        const blinkScale = Math.max(0.1, 1 - this.novaBlinkAmount);
        const eyeY = -bodyR * 0.2 + this.novaEyeDrift.y;
        const leftX = -bodyR * 0.23 + this.novaEyeDrift.x;
        const rightX = bodyR * 0.23 + this.novaEyeDrift.x;

        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = secondaryColor;
        ctx.fillStyle = 'rgba(4, 8, 14, 0.88)';
        ctx.beginPath();
        ctx.ellipse(leftX, eyeY, bodyR * 0.09, bodyR * 0.14 * blinkScale, 0, 0, Math.PI * 2);
        ctx.ellipse(rightX, eyeY, bodyR * 0.09, bodyR * 0.14 * blinkScale, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.92)`;
        ctx.beginPath();
        ctx.arc(leftX + bodyR * 0.018, eyeY - bodyR * 0.01, bodyR * 0.032, 0, Math.PI * 2);
        ctx.arc(rightX + bodyR * 0.018, eyeY - bodyR * 0.01, bodyR * 0.032, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(leftX - bodyR * 0.026, eyeY - bodyR * 0.045, bodyR * 0.022, 0, Math.PI * 2);
        ctx.arc(rightX - bodyR * 0.026, eyeY - bodyR * 0.045, bodyR * 0.022, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        this.drawCreatureMouth(bodyR, bodyR * 0.08, primaryColor, secondaryColor, 0.95);
        ctx.restore();
    }

    drawWispBody(x, y, radius) {
        const ctx = this.ctx;
        const ripple = Math.sin(this.time * 1.8) * radius * 0.025;
        ctx.beginPath();
        ctx.moveTo(x, y - radius * 0.88);
        ctx.bezierCurveTo(x + radius * 0.48, y - radius * 0.86, x + radius * 0.64, y - radius * 0.42, x + radius * 0.62, y + radius * 0.02);
        ctx.bezierCurveTo(x + radius * 0.6, y + radius * 0.38, x + radius * 0.76, y + radius * 0.62, x + radius * 0.42, y + radius * 0.76 + ripple);
        ctx.quadraticCurveTo(x + radius * 0.24, y + radius * 0.62, x + radius * 0.08, y + radius * 0.78 - ripple);
        ctx.quadraticCurveTo(x - radius * 0.08, y + radius * 0.62, x - radius * 0.24, y + radius * 0.78 + ripple);
        ctx.quadraticCurveTo(x - radius * 0.42, y + radius * 0.62, x - radius * 0.62, y + radius * 0.76 - ripple);
        ctx.bezierCurveTo(x - radius * 0.78, y + radius * 0.5, x - radius * 0.64, y + radius * 0.22, x - radius * 0.62, y - radius * 0.02);
        ctx.bezierCurveTo(x - radius * 0.62, y - radius * 0.5, x - radius * 0.46, y - radius * 0.86, x, y - radius * 0.88);
        ctx.closePath();
    }

    drawWispTail(bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const sway = Math.sin(this.time * 1.35) * bodyR * 0.08;
        const tailGrad = ctx.createLinearGradient(0, bodyR * 0.72, bodyR * 0.78, bodyR * 1.42);
        tailGrad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.22)`);
        tailGrad.addColorStop(0.55, `rgba(${this.hexToRgb(primaryColor)}, 0.16)`);
        tailGrad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0)`);
        ctx.strokeStyle = tailGrad;
        ctx.lineWidth = bodyR * 0.13;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 16;
        ctx.shadowColor = secondaryColor;
        ctx.beginPath();
        ctx.moveTo(0, bodyR * 0.72);
        ctx.bezierCurveTo(bodyR * 0.1 + sway, bodyR * 0.94, bodyR * 0.5 + sway, bodyR * 1.0, bodyR * 0.66 + sway, bodyR * 1.34);
        ctx.stroke();
        ctx.lineWidth = bodyR * 0.035;
        ctx.strokeStyle = `rgba(255, 255, 255, 0.22)`;
        ctx.beginPath();
        ctx.moveTo(bodyR * 0.02, bodyR * 0.8);
        ctx.bezierCurveTo(bodyR * 0.22 + sway, bodyR * 0.98, bodyR * 0.36 + sway, bodyR * 1.08, bodyR * 0.58 + sway, bodyR * 1.25);
        ctx.stroke();
        ctx.lineWidth = bodyR * 0.025;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.18)`;
        ctx.beginPath();
        ctx.moveTo(-bodyR * 0.08, bodyR * 0.78);
        ctx.bezierCurveTo(bodyR * 0.08 - sway, bodyR * 1.0, bodyR * 0.18 - sway, bodyR * 1.08, bodyR * 0.38 - sway, bodyR * 1.3);
        ctx.stroke();
        ctx.restore();
    }

    drawWispArm(x, y, side, bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y + Math.sin(this.time * 2.1 + side) * 6);
        ctx.rotate(side * (0.52 + Math.sin(this.time * 1.4) * 0.06));
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, bodyR * 0.26);
        grad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.38)`);
        grad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.08)`);
        ctx.fillStyle = grad;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.34)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, bodyR * 0.15, bodyR * 0.31, side * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawWispFace(bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        const blinkScale = Math.max(0.12, 1 - this.novaBlinkAmount);
        const eyeY = -bodyR * 0.22 + this.novaEyeDrift.y;
        const leftX = -bodyR * 0.24 + this.novaEyeDrift.x;
        const rightX = bodyR * 0.24 + this.novaEyeDrift.x;

        ctx.save();
        ctx.shadowBlur = 16;
        ctx.shadowColor = secondaryColor;
        ctx.fillStyle = 'rgba(14, 10, 28, 0.82)';
        ctx.beginPath();
        ctx.ellipse(leftX, eyeY, bodyR * 0.105, bodyR * 0.16 * blinkScale, 0, 0, Math.PI * 2);
        ctx.ellipse(rightX, eyeY, bodyR * 0.105, bodyR * 0.16 * blinkScale, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.beginPath();
        ctx.arc(leftX - bodyR * 0.03, eyeY - bodyR * 0.054, bodyR * 0.03, 0, Math.PI * 2);
        ctx.arc(rightX - bodyR * 0.03, eyeY - bodyR * 0.054, bodyR * 0.03, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        const cheekY = bodyR * 0.03;
        ctx.fillStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.24)`;
        ctx.beginPath();
        ctx.ellipse(-bodyR * 0.38, cheekY, bodyR * 0.1, bodyR * 0.055, 0, 0, Math.PI * 2);
        ctx.ellipse(bodyR * 0.38, cheekY, bodyR * 0.1, bodyR * 0.055, 0, 0, Math.PI * 2);
        ctx.fill();

        this.drawCreatureMouth(bodyR, -bodyR * 0.02, primaryColor, secondaryColor, 0.9);
        ctx.restore();
    }

    drawCreatureMouth(bodyR, mouthY, primaryColor, secondaryColor, smileScale = 1) {
        const ctx = this.ctx;
        if (this.state === 'speaking' || this.novaMouthOpen > 0.12) {
            const mouthW = bodyR * (0.11 + this.novaMouthOpen * 0.16 - this.novaMouthRound * 0.04);
            const mouthH = bodyR * (0.018 + this.novaMouthOpen * 0.12);
            ctx.fillStyle = `rgba(4, 4, 10, ${0.72 + this.novaMouthOpen * 0.2})`;
            ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, ${0.34 + this.novaMouthOpen * 0.3})`;
            ctx.lineWidth = 1.3;
            ctx.shadowBlur = 8;
            ctx.shadowColor = secondaryColor;
            ctx.beginPath();
            if (this.novaMouthRound > 0.55) {
                ctx.ellipse(0, mouthY, mouthW * 0.72, mouthH * 1.08, 0, 0, Math.PI * 2);
            } else {
                ctx.ellipse(0, mouthY, mouthW, mouthH, 0, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.stroke();
            ctx.shadowBlur = 0;
            return;
        }

        ctx.strokeStyle = 'rgba(8, 6, 12, 0.86)';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-bodyR * 0.08 * smileScale, mouthY);
        ctx.quadraticCurveTo(0, mouthY + bodyR * 0.068 * smileScale, bodyR * 0.08 * smileScale, mouthY);
        ctx.stroke();
    }

    drawNovaEar(x, y, side, bodyR, primaryColor, secondaryColor, lift) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y - lift);
        ctx.rotate(side * (0.43 + Math.sin(this.time * 1.7 + side) * 0.04));
        const grad = ctx.createLinearGradient(0, -bodyR * 0.82, 0, bodyR * 0.18);
        grad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.5)`);
        grad.addColorStop(0.55, `rgba(${this.hexToRgb(primaryColor)}, 0.34)`);
        grad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.1)`);
        ctx.fillStyle = grad;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.32)`;
        ctx.lineWidth = 1.4;
        ctx.shadowBlur = 14;
        ctx.shadowColor = secondaryColor;
        ctx.beginPath();
        ctx.ellipse(0, -bodyR * 0.28, bodyR * 0.16, bodyR * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(255, 255, 255, 0.16)`;
        ctx.beginPath();
        ctx.ellipse(-side * bodyR * 0.035, -bodyR * 0.34, bodyR * 0.055, bodyR * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    drawNovaArm(x, y, side, bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        const wave = Math.sin(this.time * 2.2 + side) * 6;
        ctx.save();
        ctx.translate(x, y + wave);
        ctx.rotate(side * (0.42 + Math.sin(this.time * 1.4) * 0.05));
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, bodyR * 0.24);
        grad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.45)`);
        grad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.16)`);
        ctx.fillStyle = grad;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.26)`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 9;
        ctx.shadowColor = secondaryColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, bodyR * 0.14, bodyR * 0.27, side * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    drawNovaFoot(x, y, side, bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y + Math.sin(this.time * 1.8 + side) * 3);
        ctx.rotate(side * -0.2);
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, bodyR * 0.2);
        grad.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.38)`);
        grad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.13)`);
        ctx.fillStyle = grad;
        ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.22)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, bodyR * 0.13, bodyR * 0.23, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawNovaFace(bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        const blinkScale = Math.max(0.12, 1 - this.novaBlinkAmount);
        const eyeY = -bodyR * 0.16 + this.novaEyeDrift.y;
        const leftX = -bodyR * 0.24 + this.novaEyeDrift.x;
        const rightX = bodyR * 0.24 + this.novaEyeDrift.x;

        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = secondaryColor;
        ctx.fillStyle = 'rgba(14, 9, 10, 0.88)';
        ctx.beginPath();
        ctx.ellipse(leftX, eyeY, bodyR * 0.095, bodyR * 0.145 * blinkScale, 0, 0, Math.PI * 2);
        ctx.ellipse(rightX, eyeY, bodyR * 0.095, bodyR * 0.145 * blinkScale, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.beginPath();
        ctx.arc(leftX - bodyR * 0.026, eyeY - bodyR * 0.048, bodyR * 0.028, 0, Math.PI * 2);
        ctx.arc(rightX - bodyR * 0.026, eyeY - bodyR * 0.048, bodyR * 0.028, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        const cheekY = bodyR * 0.23;
        const cheekGradL = ctx.createRadialGradient(-bodyR * 0.36, cheekY, 2, -bodyR * 0.36, cheekY, bodyR * 0.17);
        cheekGradL.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.38)`);
        cheekGradL.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0)`);
        ctx.fillStyle = cheekGradL;
        ctx.beginPath();
        ctx.arc(-bodyR * 0.36, cheekY, bodyR * 0.17, 0, Math.PI * 2);
        ctx.fill();

        const cheekGradR = ctx.createRadialGradient(bodyR * 0.36, cheekY, 2, bodyR * 0.36, cheekY, bodyR * 0.17);
        cheekGradR.addColorStop(0, `rgba(${this.hexToRgb(secondaryColor)}, 0.38)`);
        cheekGradR.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0)`);
        ctx.fillStyle = cheekGradR;
        ctx.beginPath();
        ctx.arc(bodyR * 0.36, cheekY, bodyR * 0.17, 0, Math.PI * 2);
        ctx.fill();

        const mouthY = bodyR * 0.08;
        if (this.state === 'speaking' || this.novaMouthOpen > 0.12) {
            const mouthW = bodyR * (0.12 + this.novaMouthOpen * 0.16 - this.novaMouthRound * 0.04);
            const mouthH = bodyR * (0.02 + this.novaMouthOpen * 0.13);
            ctx.fillStyle = `rgba(8, 4, 5, ${0.72 + this.novaMouthOpen * 0.2})`;
            ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, ${0.34 + this.novaMouthOpen * 0.3})`;
            ctx.lineWidth = 1.3;
            ctx.shadowBlur = 8;
            ctx.shadowColor = secondaryColor;
            ctx.beginPath();
            if (this.novaMouthRound > 0.55) {
                ctx.ellipse(0, mouthY, mouthW * 0.72, mouthH * 1.08, 0, 0, Math.PI * 2);
            } else {
                ctx.ellipse(0, mouthY, mouthW, mouthH, 0, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.stroke();
            ctx.shadowBlur = 0;
        } else {
            ctx.strokeStyle = 'rgba(18, 8, 8, 0.88)';
            ctx.lineWidth = 2.3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-bodyR * 0.07, mouthY);
            ctx.quadraticCurveTo(0, mouthY + bodyR * 0.075, bodyR * 0.07, mouthY);
            ctx.stroke();
        }
        ctx.restore();
    }

    drawNovaHudTicks(bodyR, primaryColor, secondaryColor) {
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = `rgba(${this.hexToRgb(primaryColor)}, 0.22)`;
        ctx.lineWidth = 0.8;
        for (let i = 0; i < 10; i++) {
            const angle = i * Math.PI * 0.2 + this.time * 0.22;
            const inner = bodyR * (0.9 + Math.sin(this.time + i) * 0.02);
            const outer = inner + 8 + (i % 3) * 3;
            ctx.beginPath();
            ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
            ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
            ctx.stroke();
        }
        if (this.state === 'thinking') {
            ctx.fillStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.5)`;
            ctx.font = '600 7px "Fira Code", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('NOVA', 0, -bodyR * 1.04);
        }
        ctx.restore();
    }

    /**
     * Renders a floating, holographic laser scanner bar
     */
    drawLaserSweep(w, h, themeColor) {
        const scanBoost = this.blobLaserBoost
            || (this.avatarBehavior?.action === 'scan-sweep' ? this.avatarBehavior.actionIntensity : 0);
        if (this.state !== 'thinking' && this.state !== 'listening' && scanBoost <= 0.01) return;

        const speed = (this.state === 'thinking' ? 4.5 : 1.8) + scanBoost * 6;
        
        this.sweepY += speed * this.sweepDirection;
        if (this.sweepY > h) {
            this.sweepY = h;
            this.sweepDirection = -1;
        } else if (this.sweepY < 0) {
            this.sweepY = 0;
            this.sweepDirection = 1;
        }

        const lineAlpha = 0.35 + scanBoost * 0.45;
        this.ctx.lineWidth = 1.0;
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, ${lineAlpha})`;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.sweepY);
        this.ctx.lineTo(w, this.sweepY);
        this.ctx.stroke();

        // Create subtle trailing scan gradient
        const scanGrad = this.ctx.createLinearGradient(0, this.sweepY - 30 * this.sweepDirection, 0, this.sweepY);
        scanGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        scanGrad.addColorStop(1, `rgba(${this.hexToRgb(themeColor)}, 0.045)`);
        
        this.ctx.fillStyle = scanGrad;
        this.ctx.fillRect(0, this.sweepY - 30 * this.sweepDirection, w, 30 * this.sweepDirection);
    }

    /**
     * Renders a rotating concentric track of sci-fi hexadecimal telemetry values
     */
    drawDataRing(cx, cy, activeRadius, themeColor) {
        if (this.state !== 'thinking' && this.state !== 'speaking') return;

        const radius = activeRadius * 1.35;
        const count = 12;
        const angleStep = (Math.PI * 2) / count;
        
        this.ctx.font = '600 7px "Fira Code", monospace';
        this.ctx.fillStyle = `rgba(${this.hexToRgb(themeColor)}, ${this.webOpacity * 0.5})`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        for (let i = 0; i < count; i++) {
            // Apply slow counter rotation
            const activeAngle = i * angleStep - this.ringRotationAngle * 0.3;
            
            const rx = cx + Math.cos(activeAngle) * radius;
            const ry = cy + Math.sin(activeAngle) * radius;

            // Render random hexadecimal strings
            // Change values more rapidly in thinking mode
            const seed = Math.floor(this.time * (this.state === 'thinking' ? 8.0 : 2.0) + i * 5);
            const hexVal = (seed % 256).toString(16).toUpperCase().padStart(2, '0');
            const telemetryText = `0x${hexVal}`;

            this.ctx.save();
            this.ctx.translate(rx, ry);
            // Align orientation of text along the tangent of the ring
            this.ctx.rotate(activeAngle + Math.PI / 2);
            this.ctx.fillText(telemetryText, 0, 0);
            this.ctx.restore();
        }
    }

    /**
     * Renders a reactive voice waveform oscilloscope ring
     */
    drawVoiceWaveRing(cx, cy, activeRadius, themeColor, secondaryColor) {
        if (this.state !== 'speaking') return;

        const baseRadius = activeRadius * 1.15;
        const steps = 180;
        const angleStep = (Math.PI * 2) / steps;
        const audio = this._audioReactive;
        const useLiveAudio = Boolean(audio?.frequency);
        const voiceEnvelope = audio?.envelope ?? 0;

        // Layer 1: Outer bright reactive wave
        this.ctx.beginPath();
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, 0.85)`;
        this.ctx.lineWidth = 1.5;
        this.ctx.shadowBlur = 12;
        this.ctx.shadowColor = themeColor;

        for (let i = 0; i <= steps; i++) {
            const angle = i * angleStep;
            let r;

            if (useLiveAudio) {
                const freq = audio.frequency;
                const voiceBins = Math.min(64, freq.length);
                const binIdx = Math.floor((i / steps) * voiceBins);
                const band = freq[binIdx] / 255;
                const liveEnvelope = 10 + voiceEnvelope * 28;
                r = baseRadius + band * liveEnvelope;
            } else {
                const noise = Math.sin(angle * 10.0 + this.time * 15.0) * 0.35 +
                              Math.cos(angle * 22.0 - this.time * 9.0) * 0.25 +
                              Math.sin(angle * 5.0 + this.time * 6.0) * 0.4;
                const envelope = 15.0 + Math.sin(this.time * 4.5) * 5.0;
                r = baseRadius + noise * envelope;
            }

            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.shadowBlur = 0; // Reset

        // Layer 2: Secondary inner out-of-phase backing wave
        this.ctx.beginPath();
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, 0.45)`;
        this.ctx.lineWidth = 1.0;

        for (let i = 0; i <= steps; i++) {
            const angle = i * angleStep;
            let r;

            if (useLiveAudio) {
                const freq = audio.frequency;
                const voiceBins = Math.min(48, freq.length);
                const binIdx = Math.floor((i / steps) * voiceBins);
                const neighbor = freq[Math.min(voiceBins - 1, binIdx + 1)] / 255;
                const band = (freq[binIdx] / 255) * 0.65 + neighbor * 0.35;
                const liveEnvelope = 6 + voiceEnvelope * 16;
                r = baseRadius * 0.95 + band * liveEnvelope;
            } else {
                const noise = Math.cos(angle * 12.0 - this.time * 11.0) * 0.3 +
                              Math.sin(angle * 18.0 + this.time * 7.0) * 0.3 +
                              Math.cos(angle * 6.0 - this.time * 4.0) * 0.4;
                const envelope = 10.0 + Math.cos(this.time * 3.0) * 3.0;
                r = baseRadius * 0.95 + noise * envelope;
            }

            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.closePath();
        this.ctx.stroke();
    }

    /**
     * Renders the sprawling layered neural network representing matrix projections
     */
    drawNeuralWeb(cx, cy, activeRadius, themeColor, secondaryColor, profile = this.activeWebProfile || this.getWebProfile()) {
        const scale = activeRadius * this.webExpansion * 1.5;
        const lineColor = this.mixWebColor(themeColor, secondaryColor, profile.colorMix);
        const accentColor = this.mixWebColor(secondaryColor, themeColor, profile.colorMix);
        const maxLayer = (profile.layers?.length || 4) - 1;
        const connectionMode = profile.connectionMode || 'layered';
        const lineAlphaBase = profile.lineAlpha ?? DEFAULT_WEB_PROFILE.lineAlpha;
        const lineWidthBase = profile.lineWidth ?? DEFAULT_WEB_PROFILE.lineWidth;
        const dashed = profile.lineStyle === 'dashed';
        const isGhostWeb = profile.ghostRender || profile.topology === 'scatter';

        if (dashed) {
            this.ctx.setLineDash([4, 7]);
        }

        if (isGhostWeb) {
            const mistRadius = scale * 2.35;
            const mistGrad = this.ctx.createRadialGradient(cx, cy, scale * 0.2, cx, cy, mistRadius);
            mistGrad.addColorStop(0, `rgba(${lineColor}, ${this.webOpacity * 0.14})`);
            mistGrad.addColorStop(0.55, `rgba(${accentColor}, ${this.webOpacity * 0.06})`);
            mistGrad.addColorStop(1, 'rgba(0,0,0,0)');
            this.ctx.fillStyle = mistGrad;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, mistRadius, 0, Math.PI * 2);
            this.ctx.fill();
        }

        const drawConnection = (screenAX, screenAY, screenBX, screenBY, weight, pathActivation) => {
            let baseAlpha = lineAlphaBase * weight;
            if (pathActivation > 0.15) {
                baseAlpha = (lineAlphaBase + pathActivation * 0.35) * weight;
            } else if (this.state === 'thinking' || this.state === 'speaking') {
                if (weight > 0.65) baseAlpha = (lineAlphaBase + 0.06) * weight;
            } else if (isGhostWeb) {
                baseAlpha = lineAlphaBase * weight * 0.85;
            }

            const lineAlpha = baseAlpha * this.webOpacity;
            this.ctx.strokeStyle = `rgba(${lineColor}, ${lineAlpha})`;
            this.ctx.lineWidth = lineWidthBase + weight * 0.75 + pathActivation * 1.2;
            this.ctx.beginPath();
            this.ctx.moveTo(screenAX, screenAY);
            this.ctx.lineTo(screenBX, screenBY);
            this.ctx.stroke();
        };

        if (connectionMode === 'layered' || connectionMode === 'both') {
            for (let i = 0; i < this.webNodes.length; i++) {
                const nodeA = this.webNodes[i];
                const screenAX = cx + nodeA.x * scale;
                const screenAY = cy + nodeA.y * scale;
                const actA = nodeA.activation;

                if (nodeA.layer < maxLayer) {
                    const nextLayerNodes = this.webNodes.filter(n => n.layer === nodeA.layer + 1);

                    nextLayerNodes.forEach(nodeB => {
                        const hashVal = Math.sin(nodeA.index * 12.9898 + nodeB.index * 78.233) * 43758.5453;
                        const weight = (hashVal - Math.floor(hashVal));
                        const actB = nodeB.activation;
                        const pathActivation = Math.max(actA, actB);
                        const screenBX = cx + nodeB.x * scale;
                        const screenBY = cy + nodeB.y * scale;
                        drawConnection(screenAX, screenAY, screenBX, screenBY, weight, pathActivation);
                    });
                }
            }
        }

        if ((connectionMode === 'proximity' || connectionMode === 'both') && profile.proximityLinks) {
            const proxDist = profile.proximityDistance || DEFAULT_WEB_PROFILE.proximityDistance;
            for (let i = 0; i < this.webNodes.length; i++) {
                const nodeA = this.webNodes[i];
                const screenAX = cx + nodeA.x * scale;
                const screenAY = cy + nodeA.y * scale;
                for (let j = i + 1; j < this.webNodes.length; j++) {
                    const nodeB = this.webNodes[j];
                    const dx = nodeA.x - nodeB.x;
                    const dy = nodeA.y - nodeB.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > proxDist) continue;
                    const weight = 1 - dist / proxDist;
                    const pathActivation = Math.max(nodeA.activation, nodeB.activation);
                    const screenBX = cx + nodeB.x * scale;
                    const screenBY = cy + nodeB.y * scale;
                    const linkWeight = isGhostWeb ? weight * 0.9 : weight * 0.65;
                    drawConnection(screenAX, screenAY, screenBX, screenBY, linkWeight, Math.max(pathActivation, isGhostWeb ? 0.18 : 0));
                }
            }
        }

        if (dashed) {
            this.ctx.setLineDash([]);
        }

        // Draw active sweep particles
        for (let idx = this.feedforwardSignals.length - 1; idx >= 0; idx--) {
            const signal = this.feedforwardSignals[idx];

            if (signal.mode === 'radial') {
                const radius = signal.progress * 2.6 * scale;
                this.ctx.strokeStyle = `rgba(${accentColor}, ${this.webOpacity * (isGhostWeb ? 0.5 : 0.35)})`;
                this.ctx.lineWidth = isGhostWeb ? 2.2 : 1.2;
                this.ctx.beginPath();
                this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                this.ctx.stroke();
                if (isGhostWeb) {
                    this.ctx.strokeStyle = `rgba(255, 255, 255, ${this.webOpacity * 0.18})`;
                    this.ctx.lineWidth = 5;
                    this.ctx.beginPath();
                    this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                    this.ctx.stroke();
                }
                continue;
            }

            if (signal.mode === 'scanline') {
                const bandY = cy + (signal.progress - 0.5) * (profile.verticalSpread || 2.4) * scale;
                this.ctx.strokeStyle = `rgba(${accentColor}, ${this.webOpacity * 0.45})`;
                this.ctx.lineWidth = 1.4;
                this.ctx.beginPath();
                this.ctx.moveTo(cx - scale * 2.4, bandY);
                this.ctx.lineTo(cx + scale * 2.4, bandY);
                this.ctx.stroke();
                continue;
            }

            const layerANodes = this.webNodes.filter(n => n.layer === signal.layer);
            const layerBNodes = this.webNodes.filter(n => n.layer === signal.layer + 1);

            layerANodes.forEach(nodeA => {
                const screenAX = cx + nodeA.x * scale;
                const screenAY = cy + nodeA.y * scale;

                layerBNodes.forEach(nodeB => {
                    const hashVal = Math.sin(nodeA.index * 12.9898 + nodeB.index * 78.233) * 43758.5453;
                    const weight = (hashVal - Math.floor(hashVal));

                    if (weight > 0.55) {
                        const screenBX = cx + nodeB.x * scale;
                        const screenBY = cy + nodeB.y * scale;
                        const px = screenAX + (screenBX - screenAX) * signal.progress;
                        const py = screenAY + (screenBY - screenAY) * signal.progress;

                        this.ctx.shadowBlur = 5;
                        this.ctx.shadowColor = secondaryColor;
                        this.ctx.fillStyle = `rgba(${accentColor}, ${this.webOpacity * 0.9})`;
                        this.ctx.beginPath();
                        this.ctx.arc(px, py, 1.4 + weight * 0.8, 0, Math.PI * 2);
                        this.ctx.fill();
                        this.ctx.shadowBlur = 0;
                    }
                });
            });
        }

        const nodeGlow = profile.nodeGlow ?? DEFAULT_WEB_PROFILE.nodeGlow;

        this.webNodes.forEach((node) => {
            const screenX = cx + node.x * scale;
            const screenY = cy + node.y * scale;
            const act = node.activation;
            const nodeAlpha = (node.alpha * (0.45 + act * 0.55)) * this.webOpacity;

            if (isGhostWeb) {
                const haloR = node.size * (3.2 + act * 1.4);
                const haloGrad = this.ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, haloR);
                haloGrad.addColorStop(0, `rgba(255, 255, 255, ${nodeAlpha * 0.42})`);
                haloGrad.addColorStop(0.35, `rgba(${lineColor}, ${nodeAlpha * 0.22})`);
                haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
                this.ctx.fillStyle = haloGrad;
                this.ctx.beginPath();
                this.ctx.arc(screenX, screenY, haloR, 0, Math.PI * 2);
                this.ctx.fill();
            }

            if (act > 0.2 || isGhostWeb) {
                this.ctx.shadowBlur = nodeGlow + act * (nodeGlow * 0.8);
                this.ctx.shadowColor = isGhostWeb ? 'rgba(255,255,255,0.85)' : themeColor;
            }

            const coreAlpha = isGhostWeb
                ? Math.max(nodeAlpha * 0.55, this.webOpacity * 0.12)
                : nodeAlpha;
            this.ctx.fillStyle = `rgba(${lineColor}, ${coreAlpha})`;
            this.ctx.beginPath();
            this.ctx.arc(screenX, screenY, node.size * (isGhostWeb ? 1.15 : 1), 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;

            if (act > 0.25 || node.baseSize > 3.0 || isGhostWeb) {
                const ringAlpha = nodeAlpha * (0.35 + act * 0.65);
                this.ctx.strokeStyle = `rgba(${accentColor}, ${ringAlpha * (isGhostWeb ? 0.75 : 1)})`;
                this.ctx.lineWidth = 0.6 + act * 1.4;
                this.ctx.beginPath();
                this.ctx.arc(screenX, screenY, node.size * (1.8 + act * 0.8), 0, Math.PI * 2);
                this.ctx.stroke();
            }

            if (act > 0.5) {
                this.ctx.strokeStyle = `rgba(${lineColor}, ${act * 0.5 * this.webOpacity})`;
                this.ctx.lineWidth = 0.5;
                this.ctx.beginPath();
                this.ctx.arc(screenX, screenY, node.size * 3.2, 0, Math.PI * 2);
                this.ctx.stroke();
            }

            if (!node.label || profile.showLabels === false || this.webOpacity <= 0.4) return;

            if (this.state === 'thinking' && this.webOpacity > 0.5 && profile.showTelemetry !== false) {
                const dirX = node.baseX >= 0 ? 1 : -1;
                const dirY = node.baseY >= 0 ? 1 : -1;
                const line1 = 10;
                const line2 = 35;
                const pt1X = screenX + dirX * (node.size * 2.2);
                const pt1Y = screenY;
                const pt2X = pt1X + dirX * line1;
                const pt2Y = pt1Y + dirY * line1;
                const pt3X = pt2X + dirX * line2;
                const pt3Y = pt2Y;

                if (act > 0.35 || node.index % 7 === 0) {
                    this.ctx.strokeStyle = `rgba(${lineColor}, ${nodeAlpha * 0.35})`;
                    this.ctx.lineWidth = 0.7;
                    this.ctx.beginPath();
                    this.ctx.moveTo(screenX, screenY);
                    this.ctx.lineTo(pt2X, pt2Y);
                    this.ctx.lineTo(pt3X, pt3Y);
                    this.ctx.stroke();

                    this.ctx.font = '600 7px "Fira Code", monospace';
                    this.ctx.fillStyle = `rgba(${accentColor}, ${nodeAlpha * 0.75})`;
                    this.ctx.textAlign = dirX > 0 ? 'left' : 'right';

                    const liveWeight = (Math.sin(node.labelTimer * 3) * 0.5 + parseFloat(node.bias) * 0.5).toFixed(3);
                    const sign = liveWeight >= 0 ? '+' : '';
                    const telemetryText = `${node.label} [w: ${sign}${liveWeight}]`;

                    this.ctx.fillText(telemetryText, pt2X + dirX * 3, pt2Y - 3);
                }
            } else if (act > 0.2 || node.index % 6 === 0) {
                this.ctx.font = '500 7px "Fira Code", monospace';
                this.ctx.fillStyle = `rgba(${lineColor}, ${nodeAlpha * 0.5})`;
                this.ctx.textAlign = 'center';
                this.ctx.fillText(node.label, screenX, screenY - node.size * 2.5);
            }
        });
    }

    /**
     * Color helper: translates '#ffffff' strings to '255, 255, 255' RGB components
     */
    hexToRgb(hex) {
        // Strip hashes if present
        let c = hex.replace('#', '');
        if (c.length === 3) {
            c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        }
        const num = parseInt(c, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `${r}, ${g}, ${b}`;
    }
}
