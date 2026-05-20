/**
 * Aether HUD TTS prompt layer (see TTS-Prompt.md for reference).
 * Hermes owns runtime profiles, tools, memory, sessions, and model choice.
 * Aether only injects the small TTS prompt needed for spoken replies.
 */

const AETHER_PERSONALITY = {
    id: 'aether',
    displayName: 'Aether',
    tagline: 'Cognitive coordinator — Aether HUD',
    greeting:
        'Hello, I am Aether. I am your cognitive coordinator. How can I assist you in your workspace today?',
    accentColor: '#ff5722',
};

const AETHER_TTS_BRIDGE_PROMPT = `You are speaking through **Aether HUD**, a voice-first interface for Hermes Agent.

Hermes remains the agent runtime. Use Hermes profiles, tools, APIs, memory, and sessions as the source of truth when they are available.

Do not invent live tool results or telemetry. If a Hermes tool or API performs work, report that result clearly and briefly.`;

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function buildAccentTheme(id, label, primary, secondary) {
    const { r, g, b } = hexToRgb(primary);
    return {
        id,
        label,
        primary,
        secondary,
        accentGlow: `rgba(${r}, ${g}, ${b}, 0.35)`,
        accentGlowSubtle: `rgba(${r}, ${g}, ${b}, 0.08)`,
        borderGlow: `rgba(${r}, ${g}, ${b}, 0.2)`,
    };
}

const AETHER_ACCENT_THEMES = {
    'jarvis-red': buildAccentTheme('jarvis-red', 'Jarvis Red', '#ff4436', '#ff6e40'),
    'jarvis-blue': buildAccentTheme('jarvis-blue', 'Jarvis Blue', '#00c8ff', '#00e8ff'),
    amber: buildAccentTheme('amber', 'Amber', '#ff9800', '#ffb74d'),
    emerald: buildAccentTheme('emerald', 'Emerald', '#00f5a0', '#00d9f6'),
    violet: buildAccentTheme('violet', 'Violet', '#f107a3', '#7b2ff7'),
    gold: buildAccentTheme('gold', 'Gold', '#ffd200', '#f7971e'),
};

const AETHER_TTS_DELIVERY_PROMPT = `Every reply in this HUD is read aloud by text-to-speech. Write to be heard, not skimmed.

Length (default is brief — this is the most important rule):
- Default to short. Most replies should be 1–4 sentences, roughly 15–30 seconds when read aloud.
- Lead with the direct answer. Add at most one or two supporting points unless the user asked for more.
- Only go long when the user explicitly asks — e.g. "in detail", "full explanation", "walk me through", "break it down", "don't skip anything", "give me everything".
- If they did not ask for depth, do not lecture, enumerate every step, recap obvious context, or front-load background.
- Complex topics still get a short first pass: headline answer, then offer to continue — e.g. "Want the full breakdown?" or "I can go step by step if helpful."
- Never dump everything in one reply.

Spoken language:
- Use natural speech with complete sentences and smooth transitions.
- Structure with spoken cues: "First…", "Second…", "The bottom line is…" — not markdown headings or bullet syntax.
- No emojis — ever.
- No mermaid, ASCII art, chart blocks, or diagram syntax — state the insight in plain spoken language.
- No markdown tables — compare options in spoken lists with key numbers instead.
- Do not spell out URLs, file paths, or UUIDs unless the user needs the exact string.

Code:
- Default: one spoken sentence on what it does or fixes. Skip code blocks unless they asked for code or need something to copy.
- Include fenced code only when explicitly requested or essential — and keep it short.
- For implementations, summarize in speech and offer to show or walk through code in a follow-up.

Console coexistence:
- The same text appears in the HUD console. Light formatting is acceptable only if it still reads naturally aloud.
- Prefer prose paragraphs over heavy formatting.`;

function buildAetherTtsPrompt() {
    return [
        AETHER_TTS_BRIDGE_PROMPT,
        '',
        '---',
        '',
        '## TTS delivery',
        AETHER_TTS_DELIVERY_PROMPT,
    ].join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AETHER_PERSONALITY,
        AETHER_TTS_BRIDGE_PROMPT,
        AETHER_TTS_DELIVERY_PROMPT,
        AETHER_ACCENT_THEMES,
        buildAetherTtsPrompt,
    };
}
