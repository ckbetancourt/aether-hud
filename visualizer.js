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

    /**
     * Set visualizer operational status
     */
    setState(state) {
        if (this.state !== state) {
            if (state !== 'thinking') {
                this.thinkingCaption = '';
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
        const statusLabel = document.getElementById('hudOrbLabel');
        
        if (statusLabel) {
            const { primary, secondary } = this.accentTheme;
            switch (state) {
                case 'listening':
                    statusLabel.textContent = "Aether is listening...";
                    statusLabel.style.color = primary;
                    break;
                case 'thinking':
                    statusLabel.textContent = this.thinkingCaption || "Aether is thinking...";
                    statusLabel.style.color = secondary;
                    break;
                case 'speaking':
                    statusLabel.textContent = "Aether speaking...";
                    statusLabel.style.color = '#ffffff';
                    break;
                case 'idle':
                default:
                    statusLabel.textContent = "AETHER ACTIVE";
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
                statusLabel.textContent = this.thinkingCaption || "Aether is thinking...";
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

        const activeRadius = this.coreBaseRadius * this.orbPulseScale;
        const showNeuralWeb = this.state !== 'speaking' && this.webOpacity > 0.04;

        // RENDER STEP 3: Concentric HUD Rings and Rotating Hex Data Dials (hidden while speaking)
        if (this.state !== 'speaking') {
            this.drawHUDRings(centerX, centerY, activeRadius, primaryColor, glowColor);
            this.drawDataRing(centerX, centerY, activeRadius, primaryColor);
        }

        if (this.state === 'thinking' && Math.random() < 0.016) {
            this.triggerLayerSweep();
        }

        // RENDER STEP 4: Layered Neural Network (hidden while speaking — blob only)
        if (showNeuralWeb) {
            this.drawNeuralWeb(centerX, centerY, activeRadius, primaryColor, secondaryColor);
        }

        // RENDER STEP 5: Multi-Layered Liquid Plasma Orb
        // We layer 3 separate undulating paths to simulate a 3D gas sphere!
        
        // A. Outer low-opacity glowing gas boundary (wide morph)
        this.drawLiquidBlob(
            centerX, centerY, 
            activeRadius * 1.28, 
            this.time, scaleSpeed * 0.75, noiseAmp * 1.45, 0.75,
            `rgba(${this.hexToRgb(primaryColor)}, 0.15)`, 
            glowColor, 20
        );

        // B. Mid-layer standard plasma fluid (primary morph body)
        this.drawLiquidBlob(
            centerX, centerY, 
            activeRadius, 
            this.time + 12, scaleSpeed * 1.05, noiseAmp * 1.1, 1.05,
            `rgba(${this.hexToRgb(primaryColor)}, 0.5)`, 
            'rgba(0,0,0,0)', 0
        );

        // C. Hot glowing core plasma (tighter high-frequency detail)
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

        // RENDER STEP 6: Vocal Oscilloscope Equalizer (outer speak boundary)
        this.drawVoiceWaveRing(centerX, centerY, activeRadius, primaryColor, secondaryColor);

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
