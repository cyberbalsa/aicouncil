import { spawn } from 'node:child_process';

// Spinner braille characters used by various CLI tools
const SPINNER_CHARS = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

// Progress line patterns to strip
const PROGRESS_PATTERNS = [
  /^[\s\u00a0]*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*/,
  /^\s*(Thinking|Loading|Processing|Generating|Analyzing|Running|Fetching|Waiting|Compiling)\.{0,3}\s*$/i,
  /^\s*[-|/\\]\s*(Thinking|Loading|Processing|Generating|Analyzing|Running|Fetching|Waiting|Compiling)\.{0,3}\s*$/i,
];

/**
 * Remove ANSI escape codes, spinner characters, and progress lines from a string.
 * Returns cleaned text with empty lines removed.
 */
export function stripAnsi(str) {
  // Remove ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  let cleaned = str.replace(/[\u001b\x1b][\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, '');

  // Remove other control sequences (OSC, etc.)
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/[\u001b\x1b]\][^\u0007\u001b]*[\u0007\u001b]/g, '');

  // Split into lines, filter out progress/spinner lines, remove empty lines
  const lines = cleaned.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    for (const pattern of PROGRESS_PATTERNS) {
      if (pattern.test(trimmed)) return false;
    }
    return true;
  });

  return lines.join('\n');
}

/**
 * Extract first valid JSON object or array from dirty CLI output.
 * Tries markdown code blocks first, then scans for bare { } or [ ] blocks.
 * Returns parsed object or null.
 */
export function extractJson(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Try markdown code blocks first
  const mdMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (mdMatch) {
    try {
      return JSON.parse(mdMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Scan for first { or [ and find matching closing bracket
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '{' && ch !== '[') continue;

    const closing = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let j = i; j < raw.length; j++) {
      const c = raw[j];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === ch) depth++;
      else if (c === closing) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(i, j + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Spawn a CLI process with timeout, output cap, and staleness detection.
 * Returns { stdout, stderr, exitCode, timedOut, truncated, durationMs }
 */
export function spawnAgent(cmd, args = [], opts = {}) {
  const {
    timeout = 120000,
    maxOutput = 51200,
    stalenessTimeout = 30000,
    cwd,
    env: extraEnv,
  } = opts;

  return new Promise((resolve) => {
    const startMs = Date.now();

    const spawnOpts = {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        TERM: 'dumb',
        ...extraEnv,
      },
    };
    if (cwd) spawnOpts.cwd = cwd;

    const child = spawn(cmd, args, spawnOpts);

    let stdoutBuf = '';
    let stderrBuf = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    let hardTimer = null;
    let stalenessTimer = null;

    function killGroup(signal = 'SIGTERM') {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* ignore */ }
      }
    }

    function finish(exitCode) {
      if (settled) return;
      settled = true;

      clearTimeout(hardTimer);
      clearTimeout(stalenessTimer);

      const durationMs = Date.now() - startMs;
      resolve({
        stdout: stripAnsi(stdoutBuf),
        stderr: stderrBuf,
        exitCode: exitCode ?? null,
        timedOut,
        truncated,
        durationMs,
      });
    }

    function resetStaleness() {
      clearTimeout(stalenessTimer);
      stalenessTimer = setTimeout(() => {
        timedOut = true;
        killGroup('SIGTERM');
        setTimeout(() => killGroup('SIGKILL'), 5000);
      }, stalenessTimeout);
    }

    // Hard timeout
    hardTimer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 5000);
    }, timeout);

    // Start staleness timer
    resetStaleness();

    child.stdout.on('data', (chunk) => {
      resetStaleness();
      if (!truncated) {
        const remaining = maxOutput - stdoutBuf.length;
        if (chunk.length >= remaining) {
          stdoutBuf += chunk.slice(0, remaining).toString();
          truncated = true;
        } else {
          stdoutBuf += chunk.toString();
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      resetStaleness();
      stderrBuf += chunk.toString();
    });

    child.on('close', (code) => {
      finish(code);
    });

    child.on('error', (err) => {
      stderrBuf += err.message;
      finish(null);
    });
  });
}
