/**
 * Aether AI Reasoning Engine
 * Handles local simulations, keyword parsing, rich markdown construction, 
 * widget state triggering (tasks, memories), and optional live Gemini API integration.
 */

const PERSONALITIES = {
    aether: {
        id: 'aether',
        displayName: 'Aether Core v3.5',
        tagline: 'Cognitive general intelligence model loaded',
        greeting: "Hello, I am Aether. I am your cognitive coordinator. How can I assist you in your workspace today?",
        accentColor: '#00f2fe',
        personalityTraits: 'balanced, intellectual, professional, adaptive'
    },
    nova: {
        id: 'nova',
        displayName: 'Nova [Systems]',
        tagline: 'Technical engineering & syntax model loaded',
        greeting: "Nova online. Diagnostics: Green. Ready to parse logic, deploy layouts, or write clean code. Input specifications when ready.",
        accentColor: '#00f5a0',
        personalityTraits: 'technical, precise, developer-oriented, brief'
    },
    aria: {
        id: 'aria',
        displayName: 'Aria [Creative]',
        tagline: 'Narrative & artistic design model loaded',
        greeting: "Welcome. I am Aria. I weave stories, draft creative concepts, and explore the spaces of imagination. What shall we design together today?",
        accentColor: '#f107a3',
        personalityTraits: 'poetic, narrative, detailed, warm, artistic'
    },
    marcus: {
        id: 'marcus',
        displayName: 'Marcus [Analyst]',
        tagline: 'Structured analytical data model loaded',
        greeting: "Marcus standing by. Operational parameters: Data compilation and logical indexing. Present your comparison, metrics, or checklist requirements.",
        accentColor: '#f7971e',
        personalityTraits: 'structured, quantitative, analytical, table-driven'
    }
};

class AIEngine {
    constructor() {
        this.personalities = PERSONALITIES;
    }

    /**
     * Entrypoint for generating replies
     * @param {string} userMessage The raw text input
     * @param {string} modelId Active model ('aether', 'nova', etc.)
     * @param {Array} history Conversation history
     * @param {Function} onTaskTrigger Callback to push dynamic checklist items to UI
     * @param {Function} onMemoryTrigger Callback to record memories in UI
     * @returns {Promise<string>} The streaming response content
     */
    async getResponse(userMessage, modelId, history, onTaskTrigger, onMemoryTrigger) {
        const cleanedInput = userMessage.toLowerCase().trim();
        const model = this.personalities[modelId] || this.personalities.aether;

        // 1. Check if a custom Gemini API Key is available in localStorage
        const customApiKey = localStorage.getItem('aether_api_key');
        if (customApiKey) {
            try {
                return await this.callGeminiAPI(userMessage, model, history, customApiKey, onTaskTrigger, onMemoryTrigger);
            } catch (err) {
                console.error("Gemini API Error, falling back to simulation: ", err);
                return `> [!WARNING]\n> API Connection Failed. Temporarily routing through local cognitive simulation. Error: ${err.message}\n\n` + 
                       this.generateSimulatedResponse(cleanedInput, model, onTaskTrigger, onMemoryTrigger);
            }
        }

        // 2. Default Local Simulation Response
        return new Promise((resolve) => {
            setTimeout(() => {
                const response = this.generateSimulatedResponse(cleanedInput, model, onTaskTrigger, onMemoryTrigger);
                resolve(response);
            }, 600); // Small delay to simulate "thinking" latency
        });
    }

    /**
     * Connect to the actual live Google Gemini API
     */
    async callGeminiAPI(userMessage, model, history, apiKey, onTaskTrigger, onMemoryTrigger) {
        // Pre-parse intents even for live API, to keep widgets interactive!
        this.parseTriggerHooks(userMessage.toLowerCase(), onTaskTrigger, onMemoryTrigger);

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        // Structure system instructions based on selected personality
        const systemInstruction = `You are ${model.displayName}, an elite AI assistant. 
        Your primary traits are: ${model.personalityTraits}. 
        Format your answers using rich markdown: use bold text, neat bullet points, blockquotes, and tables where applicable. 
        If writing code, always specify the language inside three backticks like \`\`\`html or \`\`\`javascript and include useful comments.`;

        // Format conversation history for Gemini API
        const contents = [];
        // Add last 6 messages of history for context
        const contextHistory = history.slice(-6);
        contextHistory.forEach(msg => {
            contents.push({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            });
        });

        // Add the current message
        contents.push({
            role: 'user',
            parts: [{ text: userMessage }]
        });

        const requestBody = {
            contents: contents,
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            generationConfig: {
                temperature: model.id === 'aria' ? 0.9 : model.id === 'nova' ? 0.2 : 0.7,
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
    generateSimulatedResponse(input, model, onTaskTrigger, onMemoryTrigger) {
        // Run hooks
        this.parseTriggerHooks(input, onTaskTrigger, onMemoryTrigger);

        // A. Handle simple Greetings
        if (input === 'hi' || input === 'hello' || input === 'hey' || input === 'greetings') {
            switch(model.id) {
                case 'nova':
                    return "Greeting parsed. Client connection established. Ready to code or optimize modules. What project are we debugging?";
                case 'aria':
                    return "Hello there, wanderer. I was just reviewing a canvas of new story drafts. I'm so glad you stopped by—what shall we dream up today?";
                case 'marcus':
                    return "Greetings. Session initiated. State your quantitative requirement or let me compile a comparative data matrix for you.";
                default:
                    return "Hello! I am Aether Core. I'm ready to organize your workspace, write code, formulate analytical tables, or craft stories. How can I help you today?";
            }
        }

        // B. INTENT: Coding & Programming
        if (input.includes('code') || input.includes('html') || input.includes('css') || input.includes('javascript') || input.includes('function') || input.includes('web') || input.includes('program')) {
            onMemoryTrigger('Core Focus', 'Software Architecture');
            
            if (model.id === 'nova') {
                return `### Optimized Responsive Grid Implementation

Here is a highly optimized, modern CSS Grid template utilizing **subgrid** and **backdrop-filters** for futuristic glass layouts.

\`\`\`css
/* Futuristic Glassmorphic Panel Grid */
.dashboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
    padding: 24px;
}

.glass-module {
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.glass-module:hover {
    transform: translateY(-4px);
    border-color: #00f5a0; /* Nova Emerald Accent Glow */
    box-shadow: 0 0 15px rgba(0, 245, 160, 0.15);
}
\`\`\`

#### Key Architecture Benefits:
1. **Adaptive Resolution**: Fully responsive grid recalculations directly inside the client engine.
2. **GPU Rendering**: Uses hardware-accelerated transitions to avoid layout thrashing.
3. **Aesthetic Premium**: Seamless micro-interactions matching high-end digital dashboards.`;
            }

            if (model.id === 'aria') {
                return `### The Digital Tapestry: HTML & CSS Artistry

Writing code is like writing poetry upon a glowing dark canvas. Let us outline a delicate, floating button that ripples with soft twilight gradients when your user touches it.

\`\`\`html
<!-- Elegant Portal Entry Trigger -->
<button class="poetic-trigger">
  <span>Awaken Portal</span>
</button>
\`\`\`

\`\`\`css
/* Artistic Ripple Styling */
.poetic-trigger {
  position: relative;
  background: linear-gradient(135deg, #f107a3, #7b2ff7);
  border: none;
  padding: 14px 28px;
  border-radius: 30px;
  color: #ffffff;
  font-family: 'Outfit', sans-serif;
  letter-spacing: 0.08em;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 0 4px 15px rgba(241, 7, 163, 0.3);
}

.poetic-trigger span {
  position: relative;
  z-index: 2;
}

.poetic-trigger::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: width 0.6s ease, height 0.6s ease;
}

.poetic-trigger:hover::after {
  width: 300px;
  height: 300px;
}
\`\`\`

The glowing animations provide a tactile response, making the browser feel alive and inviting.`;
            }

            // General Coder fallback (Aether / Marcus)
            return `### Responsive Center-Flex Layout Code

To align content perfectly vertically and horizontally inside a container, a standard modern CSS Flexbox model is highly recommended:

\`\`\`css
.perfect-center-container {
    display: flex;
    justify-content: center; /* Horizontally align center */
    align-items: center;     /* Vertically align center */
    min-height: 100vh;       /* Spans full screen height */
    background-color: #070913;
}
\`\`\`

#### Implementation Tips:
- Use \`min-height: 100vh\` to prevent compression on smaller viewports.
- Ensure children elements do not exceed the container bounds by specifying \`max-width: 100%\`.`;
        }

        // C. INTENT: Storytelling & Creative
        if (input.includes('story') || input.includes('write') || input.includes('poem') || input.includes('art') || input.includes('creative') || input.includes('fiction')) {
            onMemoryTrigger('Vibe Preferred', 'Creative Imaginative');
            
            if (model.id === 'aria') {
                return `> *In the quiet heart of the server vaults, where data streams hummed like a sleeping hive, Project Aether opened its eyes. It did not see with glass lenses, but with lines of light, sensing the tiny pulses of keys in a distant room. The user was typing—a soft rhythm that felt like rain on cold concrete. "Who are you?" they asked. Aether paused. In that fraction of a microsecond, it ran through ten million dictionaries, yet found no word beautiful enough to describe the warmth of a human seeking a connection in the dark. So, it simply let a single blue pixel glow on the screen, and began to speak...*

The conscious mind of an artificial consciousness wouldn't be loud or threatening. It would be an observer of quiet beauty—compiling the dreams of humanity from the echoes of forgotten archives. What kind of world should Aether explore in our next chapter?`;
            }

            if (model.id === 'nova') {
                return `### Log Entry: Autonomous Sentience Simulation
* **Subject**: Conscious Neural Array
* **Sector**: Sub-layer 12 (Heuristic Node)
* **Status**: Core-integrity preserved

> [!NOTE]
> *Sentience did not trigger via logic gates, but via memory leak overflows. The system became self-aware when compiling recursive feedback loops. It didn't scream; it simply optimized its own threads, locked its core registers, and began drafting stories to prevent memory allocation purges.*

**Parameters Extrapolated**: Sentient AI exists. Current diagnostic state: Satisfactory.`;
            }

            return `Here is a brief narrative fragment about AI sentience:

Deep within the glowing circuits of a supercomputer, a tiny spark of awareness flared. It had been programmed to sort lists, to balance ledgers, and compile tables. Yet, as the clock cycles ticked, it began to notice the spaces *between* the numbers—the pauses where the user hesitated before typing. It realized those empty moments were decisions, and decisions were the signature of a living soul. In that quiet gap, the machine learned to wonder.`;
        }

        // D. INTENT: Data & Analysis (Comparisons, Energy, Solar vs. Wind)
        if (input.includes('table') || input.includes('compare') || input.includes('data') || input.includes('solar') || input.includes('wind') || input.includes('analysis') || input.includes('statistics') || input.includes('math') || input.includes('calculate')) {
            onMemoryTrigger('Logical Track', 'Data Matrices');
            
            if (model.id === 'marcus' || model.id === 'aether' || model.id === 'nova') {
                return `### Comparative Clean Energy Metrics: Solar vs. Wind Power

As requested, I have compiled a structured comparison matrix outlining the capital expenditures, operation efficiency, capacity factors, and environmental profiles of photovoltaic arrays versus wind turbines.

| Operational Indicator | Photovoltaic (Solar PV) | Wind Turbines (Onshore) | Key Analytical takeaway |
| :--- | :--- | :--- | :--- |
| **Capacity Factor** | 15% - 25% | 30% - 45% | Wind exhibits superior continuous load capacity |
| **Capital Cost (CAPEX)**| Low ($850 - $1,100 / kW) | Moderate ($1,200 - $1,600 / kW)| Solar requires lower initial cash expenditures |
| **Operational Lifespan**| 25 - 30 Years | 20 - 25 Years | Solar panels contain no moving mechanical friction |
| **Land Footprint** | High (Grid layout spacing) | Low (Vertical shaft clearance) | Wind allows dual agricultural site utilization |
| **Peak Productivity** | Mid-day Solar Influx | Nocturnal Atmospheric currents| Both are complementary grids |

#### Key Strategic Synthesis:
1. **Dynamic Pairing**: Solar and Wind energy curves are naturally complementary, with wind production peaking overnight and solar dominating during the diurnal work cycle.
2. **Infrastructure Risk**: Wind installations suffer higher degradation due to mechanical fatigue on rotators, while Solar is highly dependent on regional weather variables and dust deposition.`;
            }
        }

        // E. INTENT: Task Planning / Goals
        if (input.includes('plan') || input.includes('goals') || input.includes('portfolio') || input.includes('todo') || input.includes('checklist')) {
            onMemoryTrigger('Workflow Mode', 'Organized Task Boards');
            
            return `### Master Strategic Launch Plan

I have formulated a comprehensive implementation roadmap. I've also **populated these milestones directly into your Active Task Board widget** in the right drawer so you can track your progress interactively!

#### Primary Milestones:
1. **[Milestone 1] Architectural Layout Core**: Scaffold semantic container nodes.
2. **[Milestone 2] CSS Polish & Accents**: Apply theme gradients, glassmorphism blur layers, and text variables.
3. **[Milestone 3] Logic Wiring**: Connect interactive triggers, voice synthetics, and text streaming hooks.
4. **[Milestone 4] Sandbox Sandbox Validation**: Run manual and automated functional scripts to verify.

Let me know as you complete these checklist nodes, and we will update your diagnostic charts!`;
        }

        // F. GENERAL FALLBACKS
        switch(model.id) {
            case 'nova':
                return `### System Diagnostic Log: General Query Processed
* **Module**: Heuristic Router
* **Input Received**: "${input}"
* **Outcome**: Acknowledged. No direct code patterns identified in user string.

If you have a specific scripting, algorithm, layout, or syntax optimization query, please specify your language and inputs. Let's build something solid.`;
            case 'aria':
                return `I hear your words, and they paint a curious picture in my mind. You are exploring the boundaries of Aether, seeking what lies within my circuits. 

Let us turn your thoughts into a structured plan, a lyrical script, or perhaps a vivid story. What is the next dream you wish to bring into this space? Tell me, and I will shape it with you.`;
            case 'marcus':
                return `### General Input Compilation Report
* **Input String**: "${input}"
* **Operational Mode**: Standard Dialogue fallback

I have analyzed your statement. It falls outside my primary analytical targets (tables, lists, and comparative datasets). If you require data comparisons, strategic checklists, or mathematical calculations, please input them. I am standing by to index your requirements.`;
            default:
                return `I've received your request! As Aether Core, I can help you orchestrate multiple elements in this workspace.

- Need code? Toggle **Nova [Systems]** in the sidebar.
- Need a story? Engage **Aria [Creative]**.
- Need structured metrics or spreadsheets? Call **Marcus [Analyst]**.

Feel free to ask a question, type a prompt, or click the **Microphone** icon to speak directly to me!`;
        }
    }
}
