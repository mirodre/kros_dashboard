"use client";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: Props) {
  return (
    <main className="app-shell">
      <section className="panel">
        <p className="eyebrow">Niečo sa pokazilo</p>
        <h2>Dashboard sa nepodarilo načítať</h2>
        <p>{error.message}</p>
        <button className="sync-button" type="button" onClick={reset}>
          Skúsiť znovu
        </button>
      </section>
    </main>
  );
}
