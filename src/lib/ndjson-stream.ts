/**
 * NDJSON stream — riadok = jeden JSON objekt. Používa ho sťahovanie výdavkov:
 * server posiela priebeh (koľko dokladov už spracoval) ešte počas práce a
 * dáta pošle až posledným riadkom, takže progress bar sa hýbe aj v rámci
 * jedného kroku sťahovania.
 */
export async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      onEvent(JSON.parse(trimmed));
    } catch {
      // Nečitateľný riadok priebehu prehltneme — dáta prídu vo vlastnom riadku.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      flushLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  flushLine(buffer);
}
