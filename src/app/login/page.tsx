"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Prihlásenie zlyhalo");
        return;
      }

      const nextPath = searchParams.get("next");
      router.replace(nextPath && nextPath.startsWith("/") ? nextPath : "/");
      router.refresh();
    } catch {
      setError("Nepodarilo sa kontaktovať server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="login-card panel">
      <h1>KROS Dashboard</h1>
      <p className="tag-sub">Pre pokračovanie zadaj prístupové heslo.</p>
      <form className="login-form" onSubmit={handleSubmit}>
        <label htmlFor="dashboard-password">Heslo</label>
        <input
          id="dashboard-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error ? <p className="login-error">{error}</p> : null}
        <button type="submit" className="secondary-button" disabled={isSubmitting}>
          {isSubmitting ? "Prihlasujem..." : "Prihlásiť sa"}
        </button>
      </form>
    </section>
  );
}

export default function LoginPage() {
  return (
    <main className="login-page">
      <Suspense fallback={<section className="login-card panel">Načítavam prihlásenie...</section>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
