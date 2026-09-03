"use client";

import { formatSyncEta, getSyncFraction, type SyncProgress } from "@/lib/use-sync-progress";

type Props = {
  progress: SyncProgress;
  /** Čo sa sťahuje, napr. „Výdavky“ — dopĺňa nadpis obrazovky sťahovania. */
  title: string;
  /** Vysvetlenie, prečo prvé načítanie trvá; zobrazí sa pod popisom kroku. */
  note?: string;
};

const RING_SIZE = 168;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Sťahovanie dát na celú obrazovku. Prvé načítanie trvá desiatky sekúnd a bez
 * dát nie je na obrazovke čo iné zobraziť — dostane teda celú: kruh s podielom
 * hotového a pod ním, kde sa sťahovanie práve nachádza.
 */
export function SyncOverlay({ progress, title, note }: Props) {
  const fraction = getSyncFraction(progress);
  const percent = Math.min(100, Math.round(fraction * 100));
  const eta = formatSyncEta(progress.etaSeconds);
  const activeStep = progress.steps[progress.activeIndex];
  const currentStepNumber = Math.min(progress.doneCount + 1, progress.steps.length);

  return (
    <div className="sync-overlay" role="status" aria-live="polite">
      <div className="sync-overlay-card">
        <p className="sync-overlay-eyebrow">{title} · načítavam z KROS</p>

        <div className="sync-overlay-ring">
          <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
            <defs>
              <linearGradient id="sync-ring-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4f6ee0" />
                <stop offset="55%" stopColor="#7ea0ff" />
                <stop offset="100%" stopColor="#5ee0c0" />
              </linearGradient>
            </defs>
            <circle
              className="sync-overlay-ring-track"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
            />
            <circle
              className="sync-overlay-ring-value"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
            />
          </svg>
          <div className="sync-overlay-ring-center">
            <strong>{percent} %</strong>
            <span>{eta ?? "počítam odhad..."}</span>
          </div>
        </div>

        <div className="sync-overlay-current">
          <strong>{activeStep?.group ?? "Pripravujem sťahovanie"}</strong>
          <span>{[activeStep?.label, progress.detail].filter(Boolean).join(" · ") || " "}</span>
          <em>
            Krok {currentStepNumber} z {progress.steps.length}
          </em>
        </div>

        {note ? <p className="sync-overlay-note">{note}</p> : null}
      </div>
    </div>
  );
}
