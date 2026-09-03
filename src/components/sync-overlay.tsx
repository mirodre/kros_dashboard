"use client";

import { formatSyncEta, getSyncFraction, type SyncProgress } from "@/lib/use-sync-progress";

type Props = {
  progress: SyncProgress;
  /** Čo sa sťahuje, napr. „Výdavky“ — dopĺňa nadpis obrazovky sťahovania. */
  title: string;
  /** Vysvetlenie, prečo prvé načítanie trvá; zobrazí sa pod mriežkou krokov. */
  note?: string;
};

const RING_SIZE = 168;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type StepState = "done" | "active" | "pending";

type StepGroup = {
  name: string;
  isActive: boolean;
  items: { key: string; label: string; state: StepState }[];
};

/** Kroky zoskupené po firmách, v poradí sťahovania. */
function groupSteps(progress: SyncProgress): StepGroup[] {
  const groups: StepGroup[] = [];

  progress.steps.forEach((step, index) => {
    const state: StepState =
      index < progress.doneCount ? "done" : index === progress.activeIndex ? "active" : "pending";
    const item = { key: step.key, label: step.short ?? step.label, state };
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.name === step.group) {
      lastGroup.items.push(item);
      lastGroup.isActive = lastGroup.isActive || state === "active";
      return;
    }
    groups.push({ name: step.group, isActive: state === "active", items: [item] });
  });

  return groups;
}

/**
 * Sťahovanie dát na celú obrazovku. Prvé načítanie trvá desiatky sekúnd, preto
 * neukazujeme len percento: mriežka krokov dá prácu do kontextu (koľko mesiacov
 * a firiem ešte zostáva) a je na nej vidieť posun aj vtedy, keď percento chvíľu
 * stojí. Bez dát na obrazovke aj tak nie je čo iné zobraziť.
 */
export function SyncOverlay({ progress, title, note }: Props) {
  const fraction = getSyncFraction(progress);
  const percent = Math.min(100, Math.round(fraction * 100));
  const eta = formatSyncEta(progress.etaSeconds);
  const activeStep = progress.steps[progress.activeIndex];
  const groups = groupSteps(progress);
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
          <span>
            {[activeStep?.label, progress.detail].filter(Boolean).join(" · ") || " "}
          </span>
        </div>

        <div className="sync-overlay-steps">
          <p className="sync-overlay-steps-head">
            Krok {currentStepNumber} z {progress.steps.length}
          </p>
          <div className="sync-overlay-groups">
            {groups.map((group) => (
              <div
                className={group.isActive ? "sync-overlay-group active" : "sync-overlay-group"}
                key={`${group.name}:${group.items[0]?.key}`}
              >
                <span className="sync-overlay-group-name">{group.name}</span>
                <div className="sync-overlay-chips">
                  {group.items.map((item) => (
                    <span key={item.key} className={`sync-overlay-chip ${item.state}`}>
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {note ? <p className="sync-overlay-note">{note}</p> : null}
      </div>
    </div>
  );
}
