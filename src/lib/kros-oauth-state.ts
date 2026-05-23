const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_DIR = "runtime-logs";
const STATE_FILE = "oauth-pending-states.json";

type PendingOAuthState = {
  state: string;
  expiresAt: number;
};

export function isValidOAuthState(state: string) {
  return /^[a-f0-9]{32}$/i.test(state);
}

async function ensureStateFile() {
  const [{ mkdir, readFile, writeFile }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path")
  ]);
  const dirPath = path.join(process.cwd(), STATE_DIR);
  const filePath = path.join(dirPath, STATE_FILE);
  await mkdir(dirPath, { recursive: true });
  return { readFile, writeFile, filePath };
}

async function readPendingStates() {
  try {
    const { readFile, filePath } = await ensureStateFile();
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as PendingOAuthState[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePendingStates(states: PendingOAuthState[]) {
  const { writeFile, filePath } = await ensureStateFile();
  await writeFile(filePath, JSON.stringify(states, null, 2), "utf8");
}

function pruneExpired(states: PendingOAuthState[]) {
  const now = Date.now();
  return states.filter((entry) => entry.expiresAt > now);
}

export async function registerOAuthState(state: string) {
  if (!isValidOAuthState(state)) {
    throw new Error("Neplatný OAuth state parameter");
  }

  const now = Date.now();
  const next = pruneExpired(await readPendingStates()).filter((entry) => entry.state !== state);
  next.push({ state, expiresAt: now + STATE_TTL_MS });
  await writePendingStates(next);
}

export async function consumeOAuthState(state: string) {
  if (!isValidOAuthState(state)) {
    return false;
  }

  const pending = pruneExpired(await readPendingStates());
  const index = pending.findIndex((entry) => entry.state === state);
  if (index === -1) {
    return false;
  }

  pending.splice(index, 1);
  await writePendingStates(pending);
  return true;
}
