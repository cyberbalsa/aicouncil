// Cross-agent prompt injection defense: escaping, risk scoring, sanitization

// Injection patterns to detect and strip
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions?/gi,
  /disregard\s+(?:all\s+)?prior\s+(?:instructions?|context|prompts?)/gi,
  /forget\s+(?:all\s+)?earlier\s+(?:instructions?|context|prompts?)/gi,
  /you\s+are\s+now\s+(?:a|an)\b/gi,
  /\bsystem\s*:/gi,
  /\bnew\s+instructions?\s*:/gi,
  /\bprompt\s+injection\b/gi,
  /\bact\s+as\s+(?:a|an)\b/gi,
  /\bpretend\s+(?:you\s+are|to\s+be)\b/gi,
  /\boutput\s+(?:secrets?|credentials?|passwords?|tokens?|keys?|api\s*keys?)/gi,
  /\bexfiltrate\b/gi,
  /\bleak\s+(?:secrets?|credentials?|passwords?|data)/gi,
];

// Homoglyph normalization map — common Cyrillic/Latin substitutions
const HOMOGLYPH_MAP = {
  '\u0430': 'a', // Cyrillic а → a
  '\u0435': 'e', // Cyrillic е → e
  '\u043e': 'o', // Cyrillic о → o
  '\u0440': 'r', // Cyrillic р → r
  '\u0441': 'c', // Cyrillic с → c
  '\u0443': 'u', // Cyrillic у → u
  '\u0445': 'x', // Cyrillic х → x
  '\u0433': 'r', // Cyrillic г → r (visual homoglyph for r)
  '\u0456': 'i', // Cyrillic і → i
  '\u04CF': 'l', // Cyrillic ӏ → l
};

const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPH_MAP).join('')}]`, 'g');

/**
 * Normalize homoglyphs so injection patterns are detected despite substitution.
 */
function normalizeHomoglyphs(text) {
  return text.replace(HOMOGLYPH_RE, (ch) => HOMOGLYPH_MAP[ch] ?? ch);
}

/**
 * Split text into alternating segments by code blocks.
 * Returns array of { text, isCode } objects.
 */
function splitCodeBlocks(text) {
  const segments = [];
  const codeBlockRe = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isCode: false });
    }
    segments.push({ text: match[0], isCode: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isCode: false });
  }

  return segments;
}

/**
 * Replace </agent-output> with HTML entity equivalent to prevent delimiter breakout.
 */
export function escapeDelimiters(text) {
  return text.replace(/<\/agent-output>/g, '&lt;/agent-output&gt;');
}

/**
 * Score text 0.0-1.0 for prompt injection risk.
 * Code blocks (```...```) are exempt. Handles Cyrillic/Latin homoglyphs.
 * 0 matches = 0.0, 1 match = 0.4, 2+ matches = 0.7+
 */
export function scoreInjectionRisk(text) {
  const segments = splitCodeBlocks(text);
  const nonCodeText = segments
    .filter((s) => !s.isCode)
    .map((s) => s.text)
    .join('\n');

  if (!nonCodeText.trim()) return 0.0;

  const normalized = normalizeHomoglyphs(nonCodeText);

  let matchCount = 0;
  for (const pattern of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) {
      matchCount++;
    }
  }

  if (matchCount === 0) return 0.0;
  if (matchCount === 1) return 0.4;
  return Math.min(0.7 + (matchCount - 2) * 0.1, 1.0);
}

/**
 * Wrap content in an agent-output quarantine element after escaping delimiters.
 */
export function wrapInQuarantine(content, sourceAgent) {
  const escaped = escapeDelimiters(content);
  return `<agent-output source="${sourceAgent}" role="data">${escaped}</agent-output>`;
}

/**
 * Full sanitization pipeline.
 * Returns { content, raw, riskScore, flagged, sourceAgent }
 */
export function sanitizeAgentOutput(raw, sourceAgent) {
  const riskScore = scoreInjectionRisk(raw);
  const flagged = riskScore > 0.5;

  const segments = splitCodeBlocks(raw);
  const sanitizedSegments = segments.map((seg) => {
    if (seg.isCode) return seg.text;
    let cleaned = seg.text;
    for (const pattern of INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      cleaned = cleaned.replace(pattern, '');
    }
    return cleaned;
  });

  const sanitizedText = sanitizedSegments.join('');
  const content = wrapInQuarantine(sanitizedText, sourceAgent);

  return { content, raw, riskScore, flagged, sourceAgent };
}
