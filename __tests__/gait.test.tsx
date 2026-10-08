import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import {
  compareGait,
  gaitInsight,
  normalizePlacement,
  usableDevice,
  verticalRatio,
} from '../src/domain/gait';
import { availableMetrics, type RunSeries } from '../src/domain/runSeries';
import type { GaitDevice, RunSummary } from '../src/domain/types';
import { RunInsights } from '../src/ui/RunInsights';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function device(
  placement: GaitDevice['placement'],
  values: Partial<GaitDevice> = {},
): GaitDevice {
  return {
    source: placement === 'wrist' ? 'wear_os' : 'phone',
    placement,
    windows: 36,
    usable: 36,
    checked: 36,
    mismatch: 0,
    cadence: 170,
    regularity: 0.8,
    ...values,
  };
}
function run(
  id: string,
  gait: RunSummary['gait'],
  extra: Partial<RunSummary> = {},
): RunSummary {
  return {
    id,
    startTime: NOW,
    endTime: NOW + 1800_000,
    durationSeconds: 1800,
    distanceMeters: 5400,
    purpose: 'easy',
    source: 'phone',
    status: 'completed',
    // 3 m/s at 180 spm → 1 m stride length.
    phaseMetrics: {
      model_version: 'p',
      runWalkTransitions: 0,
      trailingIdleSeconds: 0,
      running: { seconds: 1800, meters: 5400 },
      walking: { seconds: 0, meters: 0 },
      stopped: { seconds: 0, meters: 0 },
    },
    gait: gait ? { ...gait } : undefined,
    ...extra,
  };
}
const handAndWatch = (phoneSwing: number, watchSwing: number) => ({
  model_version: 'gait-1',
  phone: device('hand', { armSwingDeg: phoneSwing, crossShare: 0.1 }),
  watch: device('wrist', {
    armSwingDeg: watchSwing,
    crossShare: 0.12,
    regularity: 0.9,
    early: { armSwingDeg: 90, regularity: 0.9 },
    late: { armSwingDeg: 78, regularity: 0.82 },
  }),
});

describe('Running form', () => {
  it('reads the carry position only from the fixed list', () => {
    expect(normalizePlacement('waist')).toBe('waist');
    expect(normalizePlacement('wrist')).toBe('unknown');
    expect(normalizePlacement(undefined)).toBe('unknown');
  });

  it('discards recordings that are too short or do not fit', () => {
    expect(usableDevice(device('hand', { usable: 5 }))).toBeUndefined();
    expect(
      usableDevice(device('waist', { checked: 20, mismatch: 11 })),
    ).toBeUndefined();
    expect(
      usableDevice(device('waist', { checked: 20, mismatch: 3 })),
    ).toBeDefined();
  });

  it('relates bounce to stride length', () => {
    const current = run('r', {
      model_version: 'gait-1',
      phone: device('waist', { cadence: 180, oscillationCm: 8 }),
    });
    expect(verticalRatio(current, current.gait?.phone)).toBeCloseTo(8, 5);
    expect(
      verticalRatio(
        { ...current, phaseMetrics: undefined },
        current.gait?.phone,
      ),
    ).toBeUndefined();
  });

  it('names the difference between phone arm and watch arm first', () => {
    const insight = gaitInsight(run('r', handAndWatch(56, 84)), [])!;
    expect(insight.headline).toBe(
      'Der Arm mit dem Handy schwingt 33 % weniger als der mit der Uhr.',
    );
    expect(insight.lines.map(line => line.title)).toEqual([
      'Schrittrhythmus',
      'Armschwung',
      'Armschwung',
      'Schwungrichtung',
      'Schwungrichtung',
    ]);
    expect(insight.lines[1].subtitle).toBe(
      'Arm mit Handy · 56° von vorn bis hinten',
    );
    expect(insight.late).toBe('Armschwung −13 % · Rhythmus unruhiger');
    expect(insight.details.join('\n')).toContain(
      'misst das Handy nur am Gürtel oder am Oberkörper',
    );
  });

  it('shows bounce, ground contact, impact and braking at the belt', () => {
    const insight = gaitInsight(
      run('r', {
        model_version: 'gait-1',
        phone: device('waist', {
          cadence: 180,
          oscillationCm: 10,
          contactMs: 240,
          impactG: 2.6,
          brakingMps: 0.31,
        }),
      }),
      [],
    )!;
    expect(insight.headline).toBe(
      'Du federst viel auf und ab — 10,0 % deiner Schrittlänge.',
    );
    expect(insight.lines.map(line => line.subtitle)).toEqual([
      'gleichmäßig',
      '10,0 cm · 10,0 % der Schrittlänge · viel',
      'ungefähr 240 ms je Schritt',
      '2,6 g Spitze je Schritt',
      '0,31 m/s Tempo-Schwankung je Schritt',
    ]);
    expect(insight.details.join('\n')).toContain(
      'Den Armschwung misst das Handy in der Hand oder die Uhr.',
    );
  });

  it('honestly says when the signal does not fit the carry position', () => {
    const insight = gaitInsight(
      run('r', {
        model_version: 'gait-1',
        phone: device('waist', { checked: 30, mismatch: 25 }),
      }),
      [],
    )!;
    expect(insight.notice).toBe(
      'Das Handy-Signal passt nicht zu „am Gürtel“ — wähl beim nächsten Start den Ort, an dem es wirklich steckt.',
    );
    expect(insight.lines).toEqual([]);
  });

  it('compares only with runs where the device sat in the same place', () => {
    const past = (
      id: string,
      days: number,
      oscillationCm: number,
      placement: GaitDevice['placement'] = 'waist',
    ) =>
      run(
        id,
        {
          model_version: 'gait-1',
          phone: device(placement, { cadence: 180, oscillationCm }),
        },
        { startTime: NOW - days * DAY },
      );
    const current = run('r', {
      model_version: 'gait-1',
      phone: device('waist', { cadence: 180, oscillationCm: 9 }),
    });
    const history = [
      past('a', 1, 10),
      past('b', 2, 10),
      past('c', 3, 10),
      past('d', 4, 5, 'pocket'),
    ];
    const comparison = compareGait(current, history, 'phone', 'verticalRatio')!;
    expect(comparison.count).toBe(3);
    expect(comparison.reference).toBeCloseTo(10, 5);
    expect(comparison.rating).toBe('better');
    expect(comparison.delta).toBe('−10 %');
    expect(
      compareGait(current, history.slice(0, 2), 'phone', 'verticalRatio'),
    ).toBeUndefined();
  });

  it('does not rate the arm swing, it only names the difference', () => {
    const past = (id: string, days: number) =>
      run(id, handAndWatch(60, 80), { startTime: NOW - days * DAY });
    const comparison = compareGait(
      run('r', handAndWatch(60, 92)),
      [past('a', 1), past('b', 2), past('c', 3)],
      'watch',
      'armSwingDeg',
    )!;
    expect(comparison.rating).toBe('same');
    expect(comparison.delta).toBe('15 % mehr als sonst');
  });

  it('shows nothing without running form and nothing for rides', () => {
    expect(gaitInsight(run('r', undefined), [])).toBeUndefined();
    expect(
      gaitInsight(run('r', handAndWatch(56, 84), { sport: 'cycling' }), []),
    ).toBeUndefined();
  });

  it('gets its own section on the detail page', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <RunInsights
          run={run('r', handAndWatch(56, 84))}
          series={null}
          history={[]}
        />,
      );
    });
    const all = tree.root
      .findAllByType(Text)
      .map(node =>
        [node.props.children]
          .flat()
          .filter(c => typeof c === 'string')
          .join(''),
      )
      .join('\n');
    expect(all).toContain('Laufstil');
    expect(all).toContain(
      'Der Arm mit dem Handy schwingt 33 % weniger als der mit der Uhr.',
    );
    expect(all).toContain('Letztes gegen erstes Drittel');
  });

  it('offers arm swing in the history as soon as there are values', () => {
    const series: RunSeries = {
      stepSeconds: 5,
      rows: [1, 2, 3].map(i => ({
        elapsedSeconds: i * 5,
        distanceMeters: i * 15,
        moving: true,
        armSwingDeg: 70,
      })),
    };
    expect(availableMetrics(series)).toContain('armSwing');
  });
});
