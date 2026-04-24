export type KrosApiLogEntry = {
  id: string;
  timestamp: string;
  direction: "request" | "response" | "error";
  endpoint: string;
  method: string;
  companyName?: string;
  status?: number;
  message?: string;
  payload?: unknown;
};

const MAX_LOGS = 300;
const LOG_DIR = "runtime-logs";
const LOG_FILE = "kros-api-log.json";

async function ensureFs() {
  const [{ mkdir, readFile, writeFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const dirPath = path.join(process.cwd(), LOG_DIR);
  const filePath = path.join(dirPath, LOG_FILE);
  await mkdir(dirPath, { recursive: true });
  return { readFile, writeFile, filePath };
}

export async function appendKrosLog(entry: Omit<KrosApiLogEntry, "id" | "timestamp">) {
  try {
    const { readFile, writeFile, filePath } = await ensureFs();
    const previous = await readKrosLogs();
    const next: KrosApiLogEntry[] = [
      ...previous,
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry
      }
    ];
    const trimmed = next.slice(-MAX_LOGS);
    await writeFile(filePath, JSON.stringify(trimmed, null, 2), "utf8");
  } catch {
    // Logging must not break API flow.
  }
}

export async function readKrosLogs() {
  try {
    const { readFile, filePath } = await ensureFs();
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as KrosApiLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function clearKrosLogs() {
  try {
    const { writeFile, filePath } = await ensureFs();
    await writeFile(filePath, "[]", "utf8");
  } catch {
    // ignore clear errors
  }
}
