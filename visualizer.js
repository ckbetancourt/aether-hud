/**
 * Aether HUD Visualization Engine
 * Renders a full-screen, high-performance sci-fi hologram:
 * - A 3D-like liquid morphing plasma orb using harmonic math curves
 * - Concentric rotating orbital tracks, tick mark gauges, and dashed segments
 * - A 3D Parallax stardust field responsive to mouse coordinates
 * - Audio active warping and pulsing scaling states
 */

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
        this.initWebNodes();

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
        this.speechCue = null;
        this.novaBlinkTimer = 40 + Math.random() * 120;
        this.novaBlinkAmount = 0;
        this.novaEyeDrift = { x: 0, y: 0 };
        this.novaMouthShape = 'closed';
        this.novaMouthOpen = 0;
        this.novaMouthRound = 0;

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
        const allowedForms = ['classic-blob', 'nova', 'axel', 'wisp'];
        this.avatarForm = allowedForms.includes(formId) ? formId : 'classic-blob';
        this.syncCreatureAvatarShell();
        this.syncAvatarLabelPlacement(document.getElementById('hudOrbLabel'));
        this.setState(this.state);
    }

    isCreatureAvatar() {
        return this.avatarForm !== 'classic-blob';
    }

    syncAvatarLabelPlacement(statusLabel) {
        if (!statusLabel) return;
        const isCreature = this.isCreatureAvatar();
        statusLabel.classList.toggle('nova-label', isCreature);
        statusLabel.style.top = '50%';
        statusLabel.style.left = '50%';
        statusLabel.style.transform = isCreature
            ? 'translate(-50%, -50%) translateY(190px)'
            : 'translate(-50%, -50%)';
    }

    getAvatarName() {
        const names = {
            'classic-blob': 'Aether',
            nova: 'Nova',
            axel: 'Axel',
            wisp: 'Wisp',
        };
        return names[this.avatarForm] || 'Aether';
    }

    startSpeechMouthCue(text) {
        const cleanText = String(text || '').trim();
        this.speechCue = {
            text: cleanText,
            words: cleanText ? cleanText.split(/\s+/).filter(Boolean) : [],
            startTime: performance.now(),
            boundaryTime: 0,
            wordIndex: 0,
            shape: 'small',
            lastShapeAt: 0,
        };
    }

    stopSpeechMouthCue() {
        this.speechCue = null;
        this.novaMouthShape = 'closed';
        this.syncCreatureAvatarShell();
    }

    handleSpeechBoundary(event) {
        if (!this.speechCue || !this.isCreatureAvatar()) return;
        const now = performance.now();
        const elapsed = now - this.speechCue.startTime;
        this.speechCue.boundaryTime = elapsed;
        this.speechCue.wordIndex += 1;
        this.speechCue.shape = this.pickNovaMouthShape(
            this.speechCue.words[this.speechCue.wordIndex] || '',
            this.speechCue.wordIndex
        );
        this.speechCue.lastShapeAt = elapsed;
        this.syncCreatureAvatarShell();
        if (Number.isFinite(event?.charIndex)) {
            const spokenPrefix = this.speechCue.text.slice(0, event.charIndex);
            this.speechCue.wordIndex = Math.max(
                this.speechCue.wordIndex,
                spokenPrefix.split(/\s+/).filter(Boolean).length
            );
        }
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
                case 'idle':
                default:
                    statusLabel.textContent = this.isCreatureAvatar() ? `${avatarName.toUpperCase()} ACTIVE` : "AETHER ACTIVE";
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
     * Trigger a new forward-propagating neural network signal sweep (left to right)
     */
    triggerLayerSweep() {
        this.feedforwardSignals.push({
            layer: 0,
            progress: 0,
            speed: 0.038,
            intensity: 1.0
        });
        // Light up input layer as sweep begins
        this.webNodes.filter(n => n.layer === 0).forEach(n => {
            n.targetActivation = Math.max(n.targetActivation, 0.85);
        });
    }

    /**
     * Drive node activation levels (movement lives on nodes, not orb bounce)
     */
    updateNodeActivations() {
        this.activationTick += 1;

        this.webNodes.forEach(node => {
            node.activation += (node.targetActivation - node.activation) * 0.12;
            node.targetActivation *= 0.965;
            if (node.targetActivation < 0.02) node.targetActivation = 0;

            const act = node.activation;
            node.size = node.baseSize * (1 + act * 0.55);
            node.x = node.baseX;
            node.y = node.baseY;
            node.labelTimer += 0.035;
        });

        // Feedforward sweep lights current + next layer
        this.feedforwardSignals.forEach(sig => {
            const boost = 0.45 + (1 - sig.progress) * 0.55;
            this.webNodes.forEach(node => {
                if (node.layer === sig.layer || node.layer === sig.layer + 1) {
                    node.targetActivation = Math.max(node.targetActivation, boost * sig.intensity);
                }
            });
        });

        const st = this.state;
        if (st === 'thinking') {
            if (this.activationTick % 18 === 0) {
                const layer = (Math.floor(this.activationTick / 18) % 4);
                this.webNodes.filter(n => n.layer === layer).forEach(n => {
                    if (Math.random() < 0.4) n.targetActivation = 0.75 + Math.random() * 0.25;
                });
            }
            if (Math.random() < 0.025) {
                const hub = this.webNodes[Math.floor(Math.random() * this.webNodes.length)];
                hub.targetActivation = 1.0;
            }
        } else if (st === 'listening') {
            if (this.activationTick % 22 === 0) {
                this.webNodes.filter(n => n.layer === 0).forEach(n => {
                    if (Math.random() < 0.5) n.targetActivation = 0.8;
                });
            }
        } else if (st === 'idle' && Math.random() < 0.004) {
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
     * Generate structured feedforward neural network nodes (Input -> Hidden 1 -> Hidden 2 -> Output)
     */
    initWebNodes() {
        this.webNodes = [];
        this.feedforwardSignals = [];
        
        // Define LLM-style network layer counts
        const layers = [8, 12, 12, 8];
        const layerXPositions = [-1.8, -0.6, 0.6, 1.8];
        const nodeLabels = {
            0: ['IN_TOKN', 'POS_EMB', 'VOC_IN', 'ATT_IN', 'CTX_VEC', 'SEN_EMB', 'LAT_IN', 'SRC_VEC'],
            1: ['Q_PROJ', 'K_PROJ', 'V_PROJ', 'FFN_UP', 'FFN_GAT', 'RE_LU', 'GEL_U', 'LN_RMS', 'SOFT_M', 'DOT_PR', 'MHA_01', 'MHA_02'],
            2: ['FFN_DN', 'O_PROJ', 'ATT_OUT', 'RES_ADD', 'LN_RMS2', 'DROPOUT', 'CONV_1D', 'ATT_H2', 'ATT_H3', 'MHA_03', 'MHA_04', 'OUT_PROJ'],
            3: ['TOK_OUT', 'LOGITS', 'PROB_S', 'DEC_OUT', 'SOFT_MX', 'OUT_VEC', 'LAT_OUT', 'END_TOK']
        };

        let nodeIndex = 0;
        for (let l = 0; l < layers.length; l++) {
            const count = layers[l];
            const baseX = layerXPositions[l];
            const labels = nodeLabels[l] || [];

            for (let i = 0; i < count; i++) {
                // Distribute vertically with nice spacing
                const baseY = count > 1 ? (i / (count - 1) - 0.5) * 2.4 : 0;
                
                // Add a subtle organic arc (bulging slightly outward at the center)
                const arcX = baseX * (1.0 + (1.0 - Math.abs(baseY) * 0.15) * 0.1);
                
                // Variable neuron bias sizes (Input/Output are standard, hidden hubs can be large or small)
                let size = Math.random() * 2.5 + 1.8;
                if (l === 1 || l === 2) {
                    // Hidden layers have a few highly active hub nodes (bias weights)
                    if (i % 4 === 0) size = Math.random() * 2.5 + 4.5; // Large hub
                    else if (i % 3 === 0) size = Math.random() * 1.0 + 1.2; // Small node
                }

                this.webNodes.push({
                    index: nodeIndex++,
                    layer: l,
                    baseX: arcX,
                    baseY: baseY,
                    x: arcX,
                    y: baseY,
                    baseSize: size,
                    size: size,
                    alpha: Math.random() * 0.35 + 0.55,
                    activation: 0,
                    targetActivation: 0,
                    bias: (Math.random() * 2.0 - 1.0).toFixed(3),
                    label: i < labels.length ? labels[i] : `NEUR_${l}_${i}`,
                    labelTimer: Math.random() * 100
                });
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
     * Simulated pseudo-noise using multiple dynamic sine/cosine overlays
     */
    harmonicNoise(angle, time, speedModifier, frequencyModifier) {
        const t = time * speedModifier;
        const a = angle * frequencyModifier;
        const mp = this.morphPhase;
        
        return Math.sin(a * this.harmonicLobe1 + t + mp) * this.harmonicWeight1 +
               Math.cos(a * this.harmonicLobe2 - t * 1.4 + mp * 0.7) * this.harmonicWeight2 +
               Math.sin(a * this.harmonicLobe3 + t * 0.8 - mp * 0.5) * this.harmonicWeight3 +
               Math.cos(a * this.harmonicLobe4 - t * 1.1 + mp * 1.2) * this.harmonicWeight4;
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

        const centerX = w / 2 + this.parallaxX * 25; // Parallax center shift
        const centerY = h / 2 + this.parallaxY * 25;

        // Clear canvas
        this.ctx.clearRect(0, 0, w, h);
        
        this.time += 0.04;
        this.morphPhase += 0.018;

        this._audioReactive = null;
        if (this.state === 'speaking' && this.speechEngine?.voiceAudioActive) {
            this._audioReactive = this.speechEngine.updateVoiceAudioAnalysis();
        }
        
        const primaryColor = this.accentTheme.primary;
        const secondaryColor = this.accentTheme.secondary;
        const glowColor = this.accentTheme.glow;
        
        // RENDER STEP 1: Drawing 3D Parallax Constellation Lattice
        this.drawBackgroundWeb(w, h, primaryColor);

        // RENDER STEP 2: Subtle Laser Sweep (background scanner layer)
        this.drawLaserSweep(w, h, primaryColor);

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

                targetLobe1 = 11.0 + Math.sin(mp * 0.55) * 2.5;
                targetLobe2 = 9.0 + Math.cos(mp * 0.48) * 2.0;
                targetLobe3 = 14.0 + Math.sin(mp * 0.62) * 2.8;
                targetLobe4 = 16.0 + Math.cos(mp * 0.5) * 3.0;
                targetWeight1 = 0.55;
                targetWeight2 = 0.42;
                targetWeight3 = 0.38;
                targetWeight4 = 0.32;
                targetStretchX = 1.02;
                targetStretchY = 0.99;
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
            case 'idle':
            default:
                targetScale = 1.0;
                targetWebExp = 1.0;
                targetWebOp = 0.22;
                scaleSpeed = 0.05;
                noiseAmp = 16;

                targetLobe1 = 3.2 + Math.sin(mp * 0.25) * 0.6;
                targetLobe2 = 5.2 + Math.cos(mp * 0.22) * 0.5;
                targetLobe3 = 2.2 + Math.sin(mp * 0.28) * 0.4;
                targetLobe4 = 7.2 + Math.cos(mp * 0.26) * 0.7;
                targetWeight1 = 0.38;
                targetWeight2 = 0.3;
                targetWeight3 = 0.26;
                targetWeight4 = 0.24;
                targetStretchX = 1.0;
                targetStretchY = 1.0;
                break;
        }

        // Smooth state transitions (no scale bounce — steady orb size per state)
        this.orbPulseScale += (targetScale - this.orbPulseScale) * 0.06;
        this.webExpansion += (targetWebExp - this.webExpansion) * 0.08;
        this.webOpacity += (targetWebOp * this.colorModeOpacityScale - this.webOpacity) * 0.1;

        // Smoothly interpolate morphing parameters
        this.harmonicLobe1 += (targetLobe1 - this.harmonicLobe1) * 0.06;
        this.harmonicLobe2 += (targetLobe2 - this.harmonicLobe2) * 0.06;
        this.harmonicLobe3 += (targetLobe3 - this.harmonicLobe3) * 0.06;
        this.harmonicLobe4 += (targetLobe4 - this.harmonicLobe4) * 0.06;

        this.harmonicWeight1 += (targetWeight1 - this.harmonicWeight1) * 0.06;
        this.harmonicWeight2 += (targetWeight2 - this.harmonicWeight2) * 0.06;
        this.harmonicWeight3 += (targetWeight3 - this.harmonicWeight3) * 0.06;
        this.harmonicWeight4 += (targetWeight4 - this.harmonicWeight4) * 0.06;

        this.stretchX += (targetStretchX - this.stretchX) * 0.05;
        this.stretchY += (targetStretchY - this.stretchY) * 0.05;

        if (this.state !== 'speaking') {
            this.updateNodeActivations();
        }

        const isCreature = this.isCreatureAvatar();
        const activeRadius = this.coreBaseRadius * this.orbPulseScale;
        const avatarRadius = isCreature ? activeRadius * 1.38 : activeRadius;
        const showNeuralWeb = this.state !== 'speaking' && this.webOpacity > 0.04;

        // RENDER STEP 3: Concentric HUD Rings and Rotating Hex Data Dials (hidden while speaking)
        if (this.state !== 'speaking' || isCreature) {
            this.drawHUDRings(centerX, centerY, avatarRadius, primaryColor, glowColor);
            this.drawDataRing(centerX, centerY, avatarRadius, primaryColor);
        }

        if (this.state === 'thinking' && Math.random() < 0.016) {
            this.triggerLayerSweep();
        }

        // RENDER STEP 4: Layered Neural Network (hidden while speaking — blob only)
        if (showNeuralWeb) {
            this.drawNeuralWeb(centerX, centerY, avatarRadius, primaryColor, secondaryColor);
        }

        // RENDER STEP 5: Central avatar form
        if (isCreature) {
            this.updateNovaBlinkAndEyes();
            this.updateNovaMouth();
            this.syncCreatureAvatarShell();
        } else {
            // Multi-layered liquid plasma orb. We layer 3 separate undulating paths to simulate a 3D gas sphere.
            this.drawLiquidBlob(
                centerX, centerY,
                activeRadius * 1.28,
                this.time, scaleSpeed * 0.75, noiseAmp * 1.45, 0.75,
                `rgba(${this.hexToRgb(primaryColor)}, 0.15)`,
                glowColor, 20
            );

            this.drawLiquidBlob(
                centerX, centerY,
                activeRadius,
                this.time + 12, scaleSpeed * 1.05, noiseAmp * 1.1, 1.05,
                `rgba(${this.hexToRgb(primaryColor)}, 0.5)`,
                'rgba(0,0,0,0)', 0
            );

            const coreGrad = this.ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, activeRadius * 0.6);
            coreGrad.addColorStop(0, '#ffffff');
            coreGrad.addColorStop(0.5, secondaryColor);
            coreGrad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.1)`);

            this.drawLiquidBlob(
                centerX, centerY,
                activeRadius * 0.62,
                this.time - 8, scaleSpeed * 1.35, noiseAmp * 0.65, 1.35,
                coreGrad,
                'rgba(255,255,255,0.4)', 8
            );
        }

        // RENDER STEP 6: Vocal Oscilloscope Equalizer (outer speak boundary)
        this.drawVoiceWaveRing(centerX, centerY, avatarRadius, primaryColor, secondaryColor);

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
            this.ctx.arc(centerX, centerY, sw.radius, 0, Math.PI * 2);
            this.ctx.stroke();
            
            // Faint secondary glow ring
            this.ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, ${sw.alpha * 0.35})`;
            this.ctx.lineWidth = sw.width * 0.5;
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, sw.radius * 0.9, 0, Math.PI * 2);
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
        
        // Ring Rotation Accumulator
        let speed = 0.005;
        if (this.state === 'listening') speed = 0.03;
        else if (this.state === 'thinking') speed = 0.015;
        else if (this.state === 'speaking') speed = 0.01;
        
        this.ringRotationAngle += speed;

        // HUD Ring 1: Thin outer dashed guide track
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, 0.15)`;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius * 1.5, 0, Math.PI * 2);
        this.ctx.stroke();

        // HUD Ring 2: Core border thin rotating dashes
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, 0.4)`;
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([12, 18, 4, 18]);
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius * 1.35, this.ringRotationAngle, this.ringRotationAngle + Math.PI * 2);
        this.ctx.stroke();
        this.ctx.setLineDash([]); // Reset

        // HUD Ring 3: Counter-rotating outer tick marks & subdivisions
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, 0.25)`;
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
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, 0.08)`;
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

        // Apply glow shadow attributes
        if (shadowBlur > 0) {
            this.ctx.shadowBlur = shadowBlur;
            this.ctx.shadowColor = shadowColor;
        } else {
            this.ctx.shadowBlur = 0;
        }

        // Walk angles from 0 to 2*PI in small steps for liquid continuity
        const steps = 120;
        const angleStep = (Math.PI * 2) / steps;

        for (let i = 0; i <= steps; i++) {
            const angle = i * angleStep;
            
            let offset = this.harmonicNoise(angle, time, speed, frequency) * noiseAmplitude;
            const audio = this._audioReactive;
            if (this.state === 'speaking' && audio?.frequency) {
                const freq = audio.frequency;
                const voiceBins = Math.min(56, freq.length);
                const binIdx = Math.floor((i / steps) * voiceBins);
                const band = freq[binIdx] / 255;
                const envelope = audio.envelope ?? 0;
                const audioOffset = band * noiseAmplitude * (0.85 + envelope * 1.6);
                offset = audioOffset + offset * 0.18;
            }
            const radius = baseRadius + offset;

            // Apply dynamic visual squash and stretch (squash along X and Y axes)
            const x = cx + Math.cos(angle) * radius * this.stretchX;
            const y = cy + Math.sin(angle) * radius * this.stretchY;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }

        this.ctx.closePath();
        this.ctx.fillStyle = fillStyle;
        this.ctx.fill();

        this.ctx.shadowBlur = 0; // Reset
    }

    pickNovaMouthShape(word = '', index = 0) {
        const clean = String(word).toLowerCase();
        if (/[ou]/.test(clean)) return 'round';
        if (/[a]/.test(clean) || clean.length > 7) return 'wide';
        if (/[ei]/.test(clean)) return 'smile';
        return index % 3 === 0 ? 'small' : 'flat';
    }

    updateNovaMouth() {
        let targetOpen = 0;
        let targetRound = 0;
        let shape = 'closed';

        if (this.state === 'speaking') {
            const now = performance.now();
            const cue = this.speechCue;
            const elapsed = cue ? now - cue.startTime : this.time * 1000;
            const audioEnvelope = this._audioReactive?.envelope ?? 0;
            const hasLiveAudio = Boolean(this._audioReactive?.frequency);

            if (cue?.words.length) {
                const approxWordMs = 210;
                const scheduledIndex = Math.floor(elapsed / approxWordMs) % cue.words.length;
                const cueIndex = Math.max(cue.wordIndex, scheduledIndex);
                shape = this.pickNovaMouthShape(cue.words[cueIndex] || '', cueIndex);
            } else {
                const fallbackShapes = ['small', 'round', 'wide', 'flat', 'smile'];
                shape = fallbackShapes[Math.floor(elapsed / 170) % fallbackShapes.length];
            }

            const syllablePulse = 0.5 + 0.5 * Math.sin(elapsed / 48);
            const liveBoost = hasLiveAudio ? Math.min(1, audioEnvelope * 7) : 0.45 + syllablePulse * 0.45;
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

        this.novaMouthShape = shape;
        this.novaMouthOpen += (targetOpen - this.novaMouthOpen) * 0.32;
        this.novaMouthRound += (targetRound - this.novaMouthRound) * 0.28;
    }

    updateNovaBlinkAndEyes() {
        this.novaBlinkTimer -= 1;
        if (this.novaBlinkTimer <= 0) {
            this.novaBlinkAmount = 1;
            this.novaBlinkTimer = 85 + Math.random() * 150;
        }
        this.novaBlinkAmount *= 0.72;

        const attention = this.state === 'listening' ? 1 : this.state === 'thinking' ? 0.65 : 0.35;
        const driftX = Math.sin(this.time * 0.9) * 5 * attention + this.parallaxX * 5;
        const driftY = Math.cos(this.time * 0.7) * 2.5 * attention + this.parallaxY * 3;
        this.novaEyeDrift.x += (driftX - this.novaEyeDrift.x) * 0.06;
        this.novaEyeDrift.y += (driftY - this.novaEyeDrift.y) * 0.06;
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
        const stateBoost = this.state === 'listening' ? 0.55 : this.state === 'thinking' ? 0.72 : this.state === 'speaking' ? 0.95 : 0.2;
        const mouthOpen = Math.max(this.novaMouthOpen, this.state === 'speaking' ? audioEnvelope * 0.85 : 0);
        const mouthRound = this.novaMouthRound;
        const blinkScale = Math.max(0.08, 1 - this.novaBlinkAmount * 0.9);
        const eyeX = this.novaEyeDrift.x.toFixed(2);
        const eyeY = this.novaEyeDrift.y.toFixed(2);
        const primary = this.accentTheme.primary || '#ff4436';
        const secondary = this.accentTheme.secondary || '#ff6e40';
        const glow = this.accentTheme.glow || 'rgba(255, 68, 54, 0.4)';

        this.avatarLayer.style.setProperty('--creature-primary', primary);
        this.avatarLayer.style.setProperty('--creature-secondary', secondary);
        this.avatarLayer.style.setProperty('--creature-glow', glow);
        this.avatarLayer.style.setProperty('--creature-blink', blinkScale.toFixed(3));
        this.avatarLayer.style.setProperty('--creature-eye-x', `${eyeX}px`);
        this.avatarLayer.style.setProperty('--creature-eye-y', `${eyeY}px`);
        this.avatarLayer.style.setProperty('--creature-mouth-open', mouthOpen.toFixed(3));
        this.avatarLayer.style.setProperty('--creature-mouth-round', mouthRound.toFixed(3));
        this.avatarLayer.style.setProperty('--creature-state-boost', stateBoost.toFixed(3));
        this.avatarLayer.dataset.state = this.state;
    }

    getCreatureAvatarMarkup(form) {
        if (form === 'axel') return this.getAxelAvatarMarkup();
        if (form === 'wisp') return this.getWispAvatarMarkup();
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
                <path class="creature-mouth" d="M-14 17 Q0 31 14 17"/>
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

    getAxelAvatarMarkup() {
        return `
            <svg class="creature-svg axel-svg" viewBox="-230 -245 460 500" role="img" aria-label="Axel avatar">
                ${this.getCreatureDefs('axel')}
                <g class="creature-shadow"><ellipse cx="0" cy="190" rx="118" ry="18"/></g>
                <g class="creature-float">
                    <g class="axel-ears" filter="url(#axel-glow)">
                        <path class="glass-part axel-v-fin left" d="M-28 -112 L-116 -196 L-82 -118 Z"/>
                        <path class="glass-part axel-v-fin right" d="M28 -112 L116 -196 L82 -118 Z"/>
                        <path class="glass-part axel-v-fin outer-left" d="M-70 -105 L-176 -154 L-103 -101 Z"/>
                        <path class="glass-part axel-v-fin outer-right" d="M70 -105 L176 -154 L103 -101 Z"/>
                        <path class="axel-fin-cut left" d="M-38 -121 L-95 -174 L-70 -121 Z"/>
                        <path class="axel-fin-cut right" d="M38 -121 L95 -174 L70 -121 Z"/>
                        <path class="axel-fin-edge left" d="M-34 -116 L-103 -184"/>
                        <path class="axel-fin-edge right" d="M34 -116 L103 -184"/>
                        <path class="axel-crest" d="M0 -128 L18 -92 L0 -78 L-18 -92 Z"/>
                    </g>
                    <g class="axel-limbs" filter="url(#axel-glow)">
                        <ellipse class="glass-part axel-arm left" cx="-86" cy="93" rx="26" ry="52" transform="rotate(24 -86 93)"/>
                        <ellipse class="glass-part axel-arm right" cx="86" cy="93" rx="26" ry="52" transform="rotate(-24 86 93)"/>
                        <ellipse class="glass-part axel-leg left" cx="-45" cy="159" rx="32" ry="47" transform="rotate(10 -45 159)"/>
                        <ellipse class="glass-part axel-leg right" cx="45" cy="159" rx="32" ry="47" transform="rotate(-10 45 159)"/>
                    </g>
                    <path class="creature-body axel-torso" filter="url(#axel-glow)" d="M-70 61 C-55 23 55 23 70 61 C84 113 55 161 0 170 C-55 161 -84 113 -70 61Z"/>
                    <path class="creature-body axel-head" filter="url(#axel-glow)" d="M-104 -82 C-75 -128 75 -128 104 -82 L117 -30 C112 29 70 62 0 66 C-70 62 -112 29 -117 -30Z"/>
                    <path class="axel-helmet-rim" d="M-107 -78 L-66 -111 L0 -119 L66 -111 L107 -78"/>
                    <path class="axel-forehead-plate" d="M-47 -91 L0 -112 L47 -91 L31 -69 L0 -78 L-31 -69Z"/>
                    <path class="axel-face-plate" d="M-96 -58 C-68 -88 68 -88 96 -58 C78 -22 45 -6 0 -5 C-45 -6 -78 -22 -96 -58Z"/>
                    <path class="axel-cheek-plate left" d="M-98 -10 L-55 16 L-24 7 L-54 42 L-88 29Z"/>
                    <path class="axel-cheek-plate right" d="M98 -10 L55 16 L24 7 L54 42 L88 29Z"/>
                    <path class="axel-vent left" d="M-70 18 L-51 27 M-82 29 L-61 39"/>
                    <path class="axel-vent right" d="M70 18 L51 27 M82 29 L61 39"/>
                    <g class="axel-dash-eyes">
                        <path class="axel-eye-dash left" d="M-74 -44 C-60 -50 -38 -48 -23 -39 C-21 -35 -24 -31 -31 -31 L-69 -27 C-79 -28 -83 -39 -74 -44Z"/>
                        <path class="axel-eye-dash right" d="M74 -44 C60 -50 38 -48 23 -39 C21 -35 24 -31 31 -31 L69 -27 C79 -28 83 -39 74 -44Z"/>
                    </g>
                    <path class="creature-mouth axel-mouth" d="M-15 18 Q0 31 15 18"/>
                    <path class="axel-chest-plate left" d="M-63 63 L-13 76 L-31 105 L-73 94Z"/>
                    <path class="axel-chest-plate right" d="M63 63 L13 76 L31 105 L73 94Z"/>
                    <path class="armor-line" d="M-58 72 C-29 52 29 52 58 72"/>
                    <path class="armor-line" d="M-46 120 C-22 106 22 106 46 120"/>
                    ${this.getCreatureCoreMarkup('axel', 71, 29)}
                </g>
            </svg>`;
    }

    getWispAvatarMarkup() {
        return `
            <svg class="creature-svg wisp-svg" viewBox="-240 -255 480 560" role="img" aria-label="Wisp avatar">
                ${this.getCreatureDefs('wisp')}
                <g class="creature-shadow"><ellipse cx="0" cy="235" rx="126" ry="19"/></g>
                <g class="creature-float">
                    <path class="wisp-tail" filter="url(#wisp-glow)" d="M-8 137 C23 171 10 213 -42 235 C8 245 55 226 63 185 C72 145 103 140 140 117 C93 132 44 129 -8 137Z"/>
                    <path class="wisp-tail-stream" d="M-7 153 C31 191 20 227 -29 248 C28 242 43 209 58 181 C77 146 111 147 140 123"/>
                    <path class="wisp-ribbon" d="M74 151 C100 169 133 159 164 132"/>
                    <path class="glass-part wisp-arm left" filter="url(#wisp-glow)" d="M-113 12 C-186 42 -177 115 -98 109 C-72 83 -77 35 -113 12Z"/>
                    <path class="glass-part wisp-arm right" filter="url(#wisp-glow)" d="M113 12 C186 42 177 115 98 109 C72 83 77 35 113 12Z"/>
                    <path class="creature-body wisp-body" filter="url(#wisp-glow)" d="M0 -151 C79 -151 132 -94 136 -18 C142 55 123 121 100 155 C76 144 56 154 39 176 C18 151 -7 151 -29 176 C-48 154 -70 144 -97 158 C-121 124 -139 57 -134 -18 C-128 -95 -79 -151 0 -151Z"/>
                    <path class="wisp-tuft" d="M5 -151 C53 -216 96 -165 48 -97 C36 -119 22 -137 5 -151Z"/>
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
                    <ellipse class="cheek left" cx="-66" cy="46" rx="21" ry="13"/>
                    <ellipse class="cheek right" cx="66" cy="46" rx="21" ry="13"/>
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
        if (this.state !== 'thinking' && this.state !== 'listening') return;

        // Speed depends on state
        const speed = this.state === 'thinking' ? 4.5 : 1.8;
        
        this.sweepY += speed * this.sweepDirection;
        if (this.sweepY > h) {
            this.sweepY = h;
            this.sweepDirection = -1;
        } else if (this.sweepY < 0) {
            this.sweepY = 0;
            this.sweepDirection = 1;
        }

        // Draw horizontal scanline
        this.ctx.lineWidth = 1.0;
        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, 0.35)`;
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
     * Renders the sprawling layered feedforward neural network representing matrix projections
     */
    drawNeuralWeb(cx, cy, activeRadius, themeColor, secondaryColor) {
        const scale = activeRadius * this.webExpansion * 1.5;

        // 1. Draw connection lines from Layer N to Layer N+1 (Matrix connection weights)
        for (let i = 0; i < this.webNodes.length; i++) {
            const nodeA = this.webNodes[i];
            const screenAX = cx + nodeA.x * scale;
            const screenAY = cy + nodeA.y * scale;
            const actA = nodeA.activation;

            if (nodeA.layer < 3) {
                const nextLayerNodes = this.webNodes.filter(n => n.layer === nodeA.layer + 1);
                
                nextLayerNodes.forEach(nodeB => {
                    const hashVal = Math.sin(nodeA.index * 12.9898 + nodeB.index * 78.233) * 43758.5453;
                    const weight = (hashVal - Math.floor(hashVal));
                    const actB = nodeB.activation;
                    const pathActivation = Math.max(actA, actB);

                    const screenBX = cx + nodeB.x * scale;
                    const screenBY = cy + nodeB.y * scale;

                    let baseAlpha = 0.08 * weight;
                    if (pathActivation > 0.15) {
                        baseAlpha = (0.08 + pathActivation * 0.35) * weight;
                    } else if (this.state === 'thinking' || this.state === 'speaking') {
                        if (weight > 0.65) baseAlpha = 0.14 * weight;
                    }

                    const lineAlpha = baseAlpha * this.webOpacity;
                    this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, ${lineAlpha})`;
                    this.ctx.lineWidth = 0.35 + weight * 0.75 + pathActivation * 1.2;
                    
                    this.ctx.beginPath();
                    this.ctx.moveTo(screenAX, screenAY);
                    this.ctx.lineTo(screenBX, screenBY);
                    this.ctx.stroke();
                });
            }
        }

        // 2. Update and draw active layer-propagation sweeps safely using a backward loop
        for (let idx = this.feedforwardSignals.length - 1; idx >= 0; idx--) {
            const signal = this.feedforwardSignals[idx];
            signal.progress += signal.speed;

            if (signal.progress >= 1.0) {
                if (signal.layer < 2) {
                    signal.layer += 1;
                    signal.progress = 0;
                } else {
                    this.feedforwardSignals.splice(idx, 1);
                    continue;
                }
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
                        this.ctx.fillStyle = `rgba(${this.hexToRgb(secondaryColor)}, ${this.webOpacity * 0.9})`;
                        this.ctx.beginPath();
                        this.ctx.arc(px, py, 1.4 + weight * 0.8, 0, Math.PI * 2);
                        this.ctx.fill();
                        this.ctx.shadowBlur = 0;
                    }
                });
            });
        }

        // 3. Draw structured layers (size/brightness = activation, not position bounce)
        this.webNodes.forEach((node) => {
            const screenX = cx + node.x * scale;
            const screenY = cy + node.y * scale;
            const act = node.activation;
            const nodeAlpha = (node.alpha * (0.45 + act * 0.55)) * this.webOpacity;

            if (act > 0.2) {
                this.ctx.shadowBlur = 6 + act * 14;
                this.ctx.shadowColor = themeColor;
            }

            this.ctx.fillStyle = `rgba(${this.hexToRgb(themeColor)}, ${nodeAlpha})`;
            this.ctx.beginPath();
            this.ctx.arc(screenX, screenY, node.size, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;

            if (act > 0.25 || node.baseSize > 3.0) {
                const ringAlpha = nodeAlpha * (0.35 + act * 0.65);
                this.ctx.strokeStyle = `rgba(${this.hexToRgb(secondaryColor)}, ${ringAlpha})`;
                this.ctx.lineWidth = 0.6 + act * 1.4;
                this.ctx.beginPath();
                this.ctx.arc(screenX, screenY, node.size * (1.8 + act * 0.8), 0, Math.PI * 2);
                this.ctx.stroke();
            }

            if (act > 0.5) {
                this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, ${act * 0.5 * this.webOpacity})`;
                this.ctx.lineWidth = 0.5;
                this.ctx.beginPath();
                this.ctx.arc(screenX, screenY, node.size * 3.2, 0, Math.PI * 2);
                this.ctx.stroke();
            }

            // Dynamic leaders and activation data in thinking mode
            if (node.label && this.webOpacity > 0.4) {
                if (this.state === 'thinking' && this.webOpacity > 0.5) {
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
                        this.ctx.strokeStyle = `rgba(${this.hexToRgb(themeColor)}, ${nodeAlpha * 0.35})`;
                        this.ctx.lineWidth = 0.7;
                        this.ctx.beginPath();
                        this.ctx.moveTo(screenX, screenY);
                        this.ctx.lineTo(pt2X, pt2Y);
                        this.ctx.lineTo(pt3X, pt3Y);
                        this.ctx.stroke();

                        this.ctx.font = '600 7px "Fira Code", monospace';
                        this.ctx.fillStyle = `rgba(${this.hexToRgb(secondaryColor)}, ${nodeAlpha * 0.75})`;
                        this.ctx.textAlign = dirX > 0 ? 'left' : 'right';

                        // Change weight values dynamically in thinking mode
                        const liveWeight = (Math.sin(node.labelTimer * 3) * 0.5 + parseFloat(node.bias) * 0.5).toFixed(3);
                        const sign = liveWeight >= 0 ? '+' : '';
                        const telemetryText = `${node.label} [w: ${sign}${liveWeight}]`;
                        
                        this.ctx.fillText(telemetryText, pt2X + dirX * 3, pt2Y - 3);
                    }
                } else if (act > 0.2 || node.index % 6 === 0) {
                    this.ctx.font = '500 7px "Fira Code", monospace';
                    this.ctx.fillStyle = `rgba(${this.hexToRgb(themeColor)}, ${nodeAlpha * 0.5})`;
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText(node.label, screenX, screenY - node.size * 2.5);
                }
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
