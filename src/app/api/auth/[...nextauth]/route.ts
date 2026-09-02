import { handlers } from "@/auth";

// `NextAuth()` vracia `handlers: { GET, POST }` — App Router ich potrebuje ako pojmenované
// exporty tohto súboru. Overené proti typom next-auth@5.0.0-beta.32 (`NextAuthResult`).
export const { GET, POST } = handlers;
