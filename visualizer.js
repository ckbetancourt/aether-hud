/**
 * Aether Jarvis HUD Visualization Engine
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
        
        // Stardust Particles (60 points in space)
        this.particles = [];
        this.initParticles();

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
     * Set visualizer operational status
     */
    setState(state) {
        this.state = state;
        const statusLabel = document.getElementById('hudOrbLabel');
        
        if (statusLabel) {
            switch (state) {
                case 'listening':
                    statusLabel.textContent = "Aether is listening...";
                    statusLabel.style.color = 'var(--accent-primary)';
                    break;
                case 'thinking':
                    statusLabel.textContent = "Aether is thinking...";
                    statusLabel.style.color = 'var(--accent-secondary)';
                    break;
                case 'speaking':
                    statusLabel.textContent = "Aether speaking...";
                    statusLabel.style.color = '#ffffff';
                    break;
                case 'idle':
                default:
                    statusLabel.textContent = "Aether Active";
                    statusLabel.style.color = 'var(--text-muted)';
                    break;
            }
        }
    }

    /**
     * Generate holographic particles with 3D depth parameters
     */
    initParticles() {
        this.particles = [];
        for (let i = 0; i < 60; i++) {
            this.particles.push({
                x: Math.random() * 2 - 1, // Normalized coordinates (-1 to 1)
                y: Math.random() * 2 - 1,
                z: Math.random() * 4 + 1, // 3D Depth (closer points move faster)
                size: Math.random() * 1.5 + 0.5,
                alpha: Math.random() * 0.5 + 0.15,
                angle: Math.random() * Math.PI * 2,
                orbitSpeed: (Math.random() * 0.002 + 0.0005) * (Math.random() > 0.5 ? 1 : -1)
            });
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
     * Simulated pseudo-noise using multiple sine/cosine overlays
     */
    harmonicNoise(angle, time, speedModifier, frequencyModifier) {
        const t = time * speedModifier;
        const a = angle * frequencyModifier;
        return Math.sin(a * 3.0 + t) * 0.4 + 
               Math.cos(a * 5.0 - t * 1.4) * 0.3 + 
               Math.sin(a * 2.0 + t * 0.8) * 0.3;
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
        
        // Fetch active theme color tokens
        const primaryColor = getComputedStyle(document.body).getPropertyValue('--accent-primary').trim() || '#ff4436';
        const secondaryColor = getComputedStyle(document.body).getPropertyValue('--accent-secondary').trim() || '#ff6e40';
        const glowColor = getComputedStyle(document.body).getPropertyValue('--accent-glow').trim() || 'rgba(255, 68, 54, 0.4)';
        
        // RENDER STEP 1: Drawing 3D Parallax Stardust Particles
        this.drawParallaxStars(w, h, primaryColor);

        // Calculate dynamic orb sizes & undulation metrics based on state
        let scaleSpeed = 0.08;
        let noiseAmp = 18;
        
        switch (this.state) {
            case 'listening':
                this.orbPulseScale = 1.15 + Math.sin(this.time * 8.0) * 0.08;
                scaleSpeed = 0.22;
                noiseAmp = 34;
                break;
            case 'thinking':
                this.orbPulseScale = 0.95 + Math.sin(this.time * 20.0) * 0.02;
                scaleSpeed = 0.12;
                noiseAmp = 8;
                break;
            case 'speaking':
                this.orbPulseScale = 1.05 + Math.sin(this.time * 6.0) * 0.1;
                scaleSpeed = 0.15;
                noiseAmp = 25;
                break;
            case 'idle':
            default:
                this.orbPulseScale = 1.0 + Math.sin(this.time * 1.5) * 0.03;
                scaleSpeed = 0.04;
                noiseAmp = 12;
                break;
        }

        const activeRadius = this.coreBaseRadius * this.orbPulseScale;

        // RENDER STEP 2: Concentric Vector HUD Rings & Ticks
        this.drawHUDRings(centerX, centerY, activeRadius, primaryColor, glowColor);

        // RENDER STEP 3: Multi-Layered Liquid Plasma Orb
        // We layer 3 separate undulating paths to simulate a 3D gas sphere!
        
        // A. Outer low-opacity glowing gas boundary
        this.drawLiquidBlob(
            centerX, centerY, 
            activeRadius * 1.25, 
            this.time, scaleSpeed * 0.8, noiseAmp * 1.3, 0.8,
            `rgba(${this.hexToRgb(primaryColor)}, 0.15)`, 
            glowColor, 20
        );

        // B. Mid-layer standard plasma fluid
        this.drawLiquidBlob(
            centerX, centerY, 
            activeRadius, 
            this.time + 10, scaleSpeed, noiseAmp, 1.0,
            `rgba(${this.hexToRgb(primaryColor)}, 0.5)`, 
            'rgba(0,0,0,0)', 0
        );

        // C. Hot glowing core plasma (smaller, bright)
        const coreGrad = this.ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, activeRadius * 0.6);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.5, secondaryColor);
        coreGrad.addColorStop(1, `rgba(${this.hexToRgb(primaryColor)}, 0.1)`);

        this.drawLiquidBlob(
            centerX, centerY, 
            activeRadius * 0.65, 
            this.time - 5, scaleSpeed * 1.3, noiseAmp * 0.5, 1.2,
            coreGrad, 
            'rgba(255,255,255,0.4)', 8
        );

        // Queue next frame
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    /**
     * Renders background stardust shifting in 3D parallax coordinates
     */
    drawParallaxStars(width, height, starColor) {
        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = starColor;

        this.particles.forEach(p => {
            // Apply orbit offset rotation
            p.angle += p.orbitSpeed;
            const dist = Math.sqrt(p.x * p.x + p.y * p.y);
            const cx = Math.cos(p.angle) * dist;
            const cy = Math.sin(p.angle) * dist;

            // Project stardust from center coordinate with mouse offsets relative to Z depth
            // Closer points (lower Z) shift MORE in opposite direction of mouse cursor
            const shiftX = -this.parallaxX * (100 / p.z);
            const shiftY = -this.parallaxY * (100 / p.z);

            const x = (cx * width / 2) + width / 2 + shiftX;
            const y = (cy * height / 2) + height / 2 + shiftY;

            // Keep within screen bounds
            if (x >= 0 && x <= width && y >= 0 && y <= height) {
                this.ctx.globalAlpha = p.alpha / (p.z * 0.5);
                this.ctx.beginPath();
                this.ctx.arc(x, y, p.size * (3 / p.z), 0, Math.PI * 2);
                this.ctx.fill();
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
            
            // Generate radial wave offsets using harmonic polar equations
            const offset = this.harmonicNoise(angle, time, speed, frequency) * noiseAmplitude;
            const radius = baseRadius + offset;

            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;

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
