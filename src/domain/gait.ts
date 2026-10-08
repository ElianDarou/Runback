import type {
  GaitDevice,
  GaitPlacement,
  GaitValues,
  RunSummary,
} from './types';
import {
  RECENT_MAX_RUNS,
  RECENT_MIN_RUNS,
  RECENT_WINDOW_DAYS,
  formatSignedPercent,
  type Rating,
} from './insights';
import { fixed, quote, tr } from './i18n';

/**
 * Running form on the detail page: sentences and comparisons from the running
 * form values that Kotlin computed per device (`Gait`, `GaitSummary`). Everything
 * here is observation, not a recommendation and not an efficiency score. Only
 * compared with your own runs where the same device sat in the same place; a
 * carry position delivers only what it can measure. The word boundaries (even,
 * across, little bounce) are rough guidance and versioned too.
 */
export const GAIT_VIEW_VERSION = 'gait-view-1';

/** Choices at the start; the watch always sits on the wrist. */
// Getters keep the labels in the active language at read time.
export const PHONE_PLACEMENTS: { value: GaitPlacement; readonly label: string }[] =
  [
    {
      value: 'hand',
      get label() {
        return tr('In der Hand', 'In the hand');
      },
    },
    {
      value: 'waist',
      get label() {
        return tr('Am Gürtel', 'At the waist');
      },
    },
    {
      value: 'pocket',
      get label() {
        return tr('In der Tasche', 'In a pocket');
      },
    },
    {
      value: 'upper_arm',
      get label() {
        return tr('Am Oberarm', 'On the upper arm');
      },
    },
    {
      value: 'chest',
      get label() {
        return tr('Am Oberkörper', 'On the chest');
      },
    },
    {
      value: 'unknown',
      get label() {
        return tr('Weiß nicht', "Don't know");
      },
    },
  ];
// A function: the words depend on the active language.
const placementTexts = (): Record<GaitPlacement, string> => ({
  hand: tr('in der Hand', 'in the hand'),
  waist: tr('am Gürtel', 'at the waist'),
  pocket: tr('in der Tasche', 'in a pocket'),
  upper_arm: tr('am Oberarm', 'on the upper arm'),
  chest: tr('am Oberkörper', 'on the chest'),
  wrist: tr('am Handgelenk', 'at the wrist'),
  unknown: tr('ohne Angabe', 'not stated'),
});
export function placementWords(placement: GaitPlacement): string {
  return placementTexts()[placement];
}
export function normalizePlacement(value: unknown): GaitPlacement {
  return PHONE_PLACEMENTS.some(item => item.value === value)
    ? (value as GaitPlacement)
    : 'unknown';
}
const isArm = (placement: GaitPlacement) =>
  placement === 'hand' || placement === 'upper_arm' || placement === 'wrist';
const isTrunk = (placement: GaitPlacement) =>
  placement === 'waist' || placement === 'chest';

export type GaitDeviceKey = 'phone' | 'watch';
export type GaitMetric =
  | 'armSwingDeg'
  | 'crossShare'
  | 'regularity'
  | 'oscillationCm'
  | 'verticalRatio'
  | 'contactMs'
  | 'impactG'
  | 'brakingMps'
  | 'leanDeg';

/** At least one minute with a detected step. */
const MIN_USABLE_WINDOWS = 6;
/** From this many windows on, "fairly sure" (five minutes). */
const CONFIDENT_WINDOWS = 30;

/**
 * Direction and threshold (percent) per value. `neutral`: more is neither good
 * nor bad, only different — then no color.
 */
const RULES: Record<
  GaitMetric,
  { direction: 'lower' | 'higher' | 'neutral'; threshold: number }
> = {
  armSwingDeg: { direction: 'neutral', threshold: 5 },
  crossShare: { direction: 'lower', threshold: 15 },
  regularity: { direction: 'higher', threshold: 4 },
  oscillationCm: { direction: 'lower', threshold: 5 },
  verticalRatio: { direction: 'lower', threshold: 5 },
  contactMs: { direction: 'lower', threshold: 3 },
  impactG: { direction: 'lower', threshold: 5 },
  brakingMps: { direction: 'lower', threshold: 8 },
  leanDeg: { direction: 'neutral', threshold: 15 },
};

const DAY = 24 * 60 * 60 * 1000;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const number = (value: number, digits = 0) => fixed(value, digits);

/** Device with enough usable windows whose signal matches the carry position. */
export function signalMismatch(device: GaitDevice | undefined): boolean {
  return Boolean(
    device &&
      device.checked >= MIN_USABLE_WINDOWS &&
      device.mismatch / device.checked > 0.5,
  );
}
export function usableDevice(
  device: GaitDevice | undefined,
): GaitDevice | undefined {
  return device &&
    device.usable >= MIN_USABLE_WINDOWS &&
    !signalMismatch(device)
    ? device
    : undefined;
}

/**
 * Bounce relative to step length (percent). Step length from the running pace
 * of the RUN phases and the cadence of the same device; unknown without both.
 */
export function verticalRatio(
  run: RunSummary,
  device: GaitValues | undefined,
): number | undefined {
  const running = run.phaseMetrics?.running;
  if (
    !device ||
    !finite(device.oscillationCm) ||
    !finite(device.cadence) ||
    device.cadence <= 0 ||
    !running ||
    running.seconds < 60 ||
    running.meters <= 0
  )
    return undefined;
  const stepMeters = running.meters / running.seconds / (device.cadence / 60);
  return stepMeters > 0 ? device.oscillationCm / stepMeters : undefined;
}

function metricValue(
  metric: GaitMetric,
  run: RunSummary,
  device: GaitDevice,
): number | undefined {
  if (metric === 'verticalRatio') return verticalRatio(run, device);
  const value = device[metric];
  return finite(value) ? value : undefined;
}

export interface GaitComparison {
  rating: Rating;
  /** Signed change such as "+8 %"; for neutral values a phrase like "8 % more than usual". */
  delta: string;
  reference: number;
  count: number;
}
/**
 * Against the median of the latest runs (120 days, at most eight) where the
 * same device sat in the same place. Under three such runs there is no comparison.
 */
export function compareGait(
  run: RunSummary,
  history: RunSummary[],
  key: GaitDeviceKey,
  metric: GaitMetric,
): GaitComparison | undefined {
  const own = usableDevice(run.gait?.[key]);
  if (!own) return undefined;
  const value = metricValue(metric, run, own);
  if (value === undefined) return undefined;
  const references = history
    .filter(
      other =>
        other.id !== run.id &&
        (other.sport ?? 'running') === 'running' &&
        other.startTime < run.startTime &&
        run.startTime - other.startTime <= RECENT_WINDOW_DAYS * DAY,
    )
    .sort((a, b) => b.startTime - a.startTime)
    .map(other => {
      const device = usableDevice(other.gait?.[key]);
      return device && device.placement === own.placement
        ? metricValue(metric, other, device)
        : undefined;
    })
    .filter(finite)
    .slice(0, RECENT_MAX_RUNS);
  const reference = median(references);
  if (
    reference === undefined ||
    reference === 0 ||
    references.length < RECENT_MIN_RUNS
  )
    return undefined;
  const deltaPercent = (value / reference - 1) * 100;
  const rule = RULES[metric];
  if (rule.direction === 'neutral') {
    const size = Math.round(Math.abs(deltaPercent));
    return {
      rating: 'same',
      delta:
        size < rule.threshold
          ? tr('wie sonst', 'like usual')
          : tr(
              `${size} % ${deltaPercent > 0 ? 'mehr' : 'weniger'} als sonst`,
              `${size}% ${deltaPercent > 0 ? 'more' : 'less'} than usual`,
            ),
      reference,
      count: references.length,
    };
  }
  const good = rule.direction === 'higher' ? deltaPercent : -deltaPercent;
  const rating: Rating =
    good >= rule.threshold
      ? 'better'
      : good > -rule.threshold
      ? 'same'
      : good > -rule.threshold * 2
      ? 'slightly_worse'
      : 'worse';
  return {
    rating,
    delta: formatSignedPercent(deltaPercent),
    reference,
    count: references.length,
  };
}

export function regularityWord(value: number): string {
  if (value >= 0.85) return tr('sehr gleichmäßig', 'very even');
  if (value >= 0.7) return tr('gleichmäßig', 'even');
  return tr('unruhig', 'uneven');
}
export function crossWord(share: number): string {
  if (share < 0.2) return tr('eher nach vorn', 'mostly forward');
  if (share < 0.35) return tr('etwas quer', 'somewhat across');
  return tr(
    'deutlich quer vor dem Körper',
    'clearly across in front of the body',
  );
}
export function bounceWord(ratioPercent: number): string {
  if (ratioPercent < 7) return tr('wenig', 'little');
  if (ratioPercent <= 9) return tr('mittel', 'medium');
  return tr('viel', 'a lot');
}

export interface GaitLine {
  metric: GaitMetric;
  device: GaitDeviceKey;
  title: string;
  subtitle: string;
  comparison?: GaitComparison;
}
export interface GaitInsight {
  version: string;
  /** The most striking observation in one sentence. */
  headline?: string;
  /** Signal does not match the carry position; this device's values are therefore missing. */
  notice?: string;
  lines: GaitLine[];
  /** Last third against first third, as a short list. */
  late?: string;
  details: string[];
}

const deviceWord = (key: GaitDeviceKey) =>
  key === 'phone' ? tr('Handy', 'Phone') : tr('Uhr', 'Watch');

/** Change from the first to the last third, in percent. */
function thirdChange(
  device: GaitDevice | undefined,
  key: keyof GaitValues,
): number | undefined {
  const early = device?.early?.[key];
  const late = device?.late?.[key];
  return finite(early) && finite(late) && early !== 0
    ? (late / early - 1) * 100
    : undefined;
}

export function gaitInsight(
  run: RunSummary,
  history: RunSummary[],
): GaitInsight | undefined {
  const gait = run.gait;
  if (!gait || (run.sport ?? 'running') !== 'running') return undefined;
  const devices: { key: GaitDeviceKey; device: GaitDevice }[] = [];
  let notice: string | undefined;
  (['phone', 'watch'] as GaitDeviceKey[]).forEach(key => {
    const raw = gait[key];
    if (signalMismatch(raw) && key === 'phone' && raw) {
      const place = quote(placementWords(raw.placement));
      notice = tr(
        `Das Handy-Signal passt nicht zu ${place} — wähl beim nächsten Start den Ort, an dem es wirklich steckt.`,
        `The phone signal does not match ${place} — pick the spot where it really sits at the next start.`,
      );
    }
    const device = usableDevice(raw);
    if (device) devices.push({ key, device });
  });
  if (!devices.length && !notice) return undefined;

  const lines: GaitLine[] = [];
  const line = (
    key: GaitDeviceKey,
    metric: GaitMetric,
    title: string,
    subtitle: string,
  ) =>
    lines.push({
      metric,
      device: key,
      title,
      subtitle,
      comparison: compareGait(run, history, key, metric),
    });
  const armDevices = devices.filter(
    ({ device }) => isArm(device.placement) && finite(device.armSwingDeg),
  );
  const bothArms = armDevices.length === 2;
  const armName = (key: GaitDeviceKey) =>
    key === 'phone'
      ? tr('Arm mit Handy', 'Arm with phone')
      : tr('Arm mit Uhr', 'Arm with watch');

  // Rhythm once, from the device most likely worn on every run.
  const primary = devices.find(item => item.key === 'watch') ?? devices[0];
  if (primary && finite(primary.device.regularity)) {
    line(
      primary.key,
      'regularity',
      tr('Schrittrhythmus', 'Stride rhythm'),
      regularityWord(primary.device.regularity),
    );
  }
  armDevices.forEach(({ key, device }) => {
    line(
      key,
      'armSwingDeg',
      tr('Armschwung', 'Arm swing'),
      `${bothArms ? `${armName(key)} · ` : ''}${tr(
        `${Math.round(device.armSwingDeg!)}° von vorn bis hinten`,
        `${Math.round(device.armSwingDeg!)}° from front to back`,
      )}`,
    );
  });
  armDevices.forEach(({ key, device }) => {
    if (!finite(device.crossShare)) return;
    line(
      key,
      'crossShare',
      tr('Schwungrichtung', 'Swing direction'),
      `${bothArms ? `${armName(key)} · ` : ''}${crossWord(device.crossShare)}`,
    );
  });
  const trunk = devices.find(({ device }) => isTrunk(device.placement));
  if (trunk) {
    const { key, device } = trunk;
    const ratio = verticalRatio(run, device);
    if (finite(device.oscillationCm)) {
      line(
        key,
        ratio !== undefined ? 'verticalRatio' : 'oscillationCm',
        tr('Auf und Ab', 'Bounce'),
        ratio !== undefined
          ? tr(
              `${number(device.oscillationCm, 1)} cm · ${number(
                ratio,
                1,
              )} % der Schrittlänge · ${bounceWord(ratio)}`,
              `${number(device.oscillationCm, 1)} cm · ${number(
                ratio,
                1,
              )}% of step length · ${bounceWord(ratio)}`,
            )
          : `${number(device.oscillationCm, 1)} cm`,
      );
    }
    if (finite(device.contactMs))
      line(
        key,
        'contactMs',
        tr('Bodenkontakt', 'Ground contact'),
        tr(
          `ungefähr ${Math.round(device.contactMs)} ms je Schritt`,
          `about ${Math.round(device.contactMs)} ms per step`,
        ),
      );
    if (finite(device.impactG))
      line(
        key,
        'impactG',
        tr('Aufkommen', 'Impact'),
        tr(
          `${number(device.impactG, 1)} g Spitze je Schritt`,
          `${number(device.impactG, 1)} g peak per step`,
        ),
      );
    if (finite(device.brakingMps))
      line(
        key,
        'brakingMps',
        tr('Abbremsen', 'Braking'),
        tr(
          `${number(device.brakingMps, 2)} m/s Tempo-Schwankung je Schritt`,
          `${number(device.brakingMps, 2)} m/s pace variation per step`,
        ),
      );
    if (finite(device.leanDeg))
      line(
        key,
        'leanDeg',
        tr('Vorlage', 'Forward lean'),
        tr(
          `etwa ${Math.round(device.leanDeg)}° nach vorn gegenüber dem Stehen`,
          `about ${Math.round(device.leanDeg)}° forward compared with standing`,
        ),
      );
  }

  // Last third against first third.
  const parts: string[] = [];
  const armPrimary =
    armDevices.find(item => item.key === 'watch') ?? armDevices[0];
  const swingChange = thirdChange(armPrimary?.device, 'armSwingDeg');
  if (swingChange !== undefined && Math.abs(swingChange) >= 8)
    parts.push(
      `${tr('Armschwung', 'Arm swing')} ${formatSignedPercent(swingChange)}`,
    );
  const early = primary?.device.early?.regularity;
  const late = primary?.device.late?.regularity;
  if (finite(early) && finite(late) && Math.abs(late - early) >= 0.05)
    parts.push(
      late < early
        ? tr('Rhythmus unruhiger', 'Rhythm less even')
        : tr('Rhythmus ruhiger', 'Rhythm more even'),
    );
  const bounceChange = thirdChange(trunk?.device, 'oscillationCm');
  if (bounceChange !== undefined && Math.abs(bounceChange) >= 8)
    parts.push(
      `${tr('Auf und Ab', 'Bounce')} ${formatSignedPercent(bounceChange)}`,
    );
  const contactChange = thirdChange(trunk?.device, 'contactMs');
  if (contactChange !== undefined && Math.abs(contactChange) >= 5)
    parts.push(
      `${tr('Bodenkontakt', 'Ground contact')} ${formatSignedPercent(contactChange)}`,
    );
  const hasThirds = devices.some(({ device }) => device.early && device.late);
  const lateText = parts.length
    ? parts.join(' · ')
    : hasThirds
    ? tr('Bis zum Ende gleich geblieben', 'Unchanged to the end')
    : undefined;

  // One headline: the thing you are most likely able to change.
  let headline: string | undefined;
  const phoneArm = armDevices.find(
    ({ key, device }) => key === 'phone' && device.placement === 'hand',
  );
  const watchArm = armDevices.find(({ key }) => key === 'watch');
  const asymmetry =
    phoneArm && watchArm
      ? (phoneArm.device.armSwingDeg! / watchArm.device.armSwingDeg! - 1) * 100
      : undefined;
  const crossing = armDevices.find(
    ({ device }) => finite(device.crossShare) && device.crossShare >= 0.35,
  );
  const ratio = trunk ? verticalRatio(run, trunk.device) : undefined;
  if (asymmetry !== undefined && Math.abs(asymmetry) >= 15) {
    const percent = Math.round(Math.abs(asymmetry));
    headline =
      asymmetry < 0
        ? tr(
            `Der Arm mit dem Handy schwingt ${percent} % weniger als der mit der Uhr.`,
            `The arm with the phone swings ${percent}% less than the one with the watch.`,
          )
        : tr(
            `Der Arm mit dem Handy schwingt ${percent} % mehr als der mit der Uhr.`,
            `The arm with the phone swings ${percent}% more than the one with the watch.`,
          );
  } else if (swingChange !== undefined && swingChange <= -10) {
    const percent = Math.round(-swingChange);
    headline = tr(
      `Zum Ende hin schwingen deine Arme ${percent} % weniger weit.`,
      `Toward the end your arms swing ${percent}% less far.`,
    );
  } else if (crossing) {
    headline = tr(
      'Deine Arme schwingen deutlich quer vor dem Körper.',
      'Your arms swing clearly across in front of your body.',
    );
  } else if (ratio !== undefined && ratio > 9) {
    const percent = number(ratio, 1);
    headline = tr(
      `Du federst viel auf und ab — ${percent} % deiner Schrittlänge.`,
      `You bounce a lot — ${percent}% of your step length.`,
    );
  } else if (
    primary &&
    finite(primary.device.regularity) &&
    primary.device.regularity >= 0.85
  ) {
    headline = tr(
      'Dein Schrittrhythmus war sehr gleichmäßig.',
      'Your stride rhythm was very even.',
    );
  }

  const details = devices.map(
    ({ key, device }) =>
      `${deviceWord(key)} ${placementWords(device.placement)}: ${
        device.usable
      } ${tr(
        `von ${device.windows} Abschnitten à 10 s`,
        `of ${device.windows} windows of 10 s`,
      )} · ${
        device.usable >= CONFIDENT_WINDOWS
          ? tr('ziemlich sicher', 'fairly sure')
          : tr('eher ein Eindruck', 'more of an impression')
      }`,
  );
  const phone = gait.phone;
  if (phone && !isTrunk(phone.placement)) {
    details.push(
      tr(
        'Auf und Ab, Bodenkontakt, Aufkommen und Abbremsen misst das Handy nur am Gürtel oder am Oberkörper.',
        'The phone measures bounce, ground contact, impact and braking only at the waist or on the chest.',
      ),
    );
  }
  if (!devices.some(({ device }) => isArm(device.placement))) {
    details.push(
      tr(
        'Den Armschwung misst das Handy in der Hand oder die Uhr.',
        'Arm swing is measured by the phone in the hand or by the watch.',
      ),
    );
  }
  details.push(
    tr(
      `Modell ${gait.model_version} · ${GAIT_VIEW_VERSION} · Schätzung aus Bewegungssensoren, keine Labormessung.`,
      `Model ${gait.model_version} · ${GAIT_VIEW_VERSION} · estimate from motion sensors, not a lab measurement.`,
    ),
  );

  return {
    version: GAIT_VIEW_VERSION,
    headline,
    notice,
    lines,
    late: lateText,
    details,
  };
}
