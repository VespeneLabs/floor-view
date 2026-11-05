import {
  FloorplanViewer,
  type FloorPlan,
  type HeatmapLayer,
  type LevelSelection,
  type PointLayer,
  type RoomLayer,
  type ViewMode,
} from '@vespenelabs/floorview';
import { Clock, Pause, Play } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { bandOf, colorFor, formatValue, METRIC_IDS, METRICS, severity, type Metric, type MetricId } from './metrics';
import { formatHour, readingAt, sensorsFor, type Reading, type Sensor } from './simulation';
import { StatusBadge, MetricLegend } from './widgets';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { VespeneLabsMark } from '@/components/VespeneLabsMark';
import { useStudio } from '@/features/studio/studio-context';
import { cssToken, useViewerTheme } from '@/features/viewer/useViewerTheme';

/** Timeline step (hours) and playback speed: 15 simulated minutes per tick. */
const STEP = 0.25;
const PLAY_INTERVAL_MS = 500;

function startHour(): number {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  // Outside office hours the building is empty and everything is green, so start mid-afternoon.
  return hour >= 8 && hour <= 18 ? Math.round(hour / STEP) * STEP : 14;
}

function heatmapLayer(metric: Metric, sensors: Sensor[], readings: Map<string, Reading>): HeatmapLayer {
  return {
    id: 'aq-heatmap',
    type: 'heatmap',
    colorStops: metric.colorStops,
    opacity: 0.85,
    resolution: 0.15,
    power: 2.5,
    points: sensors.map((s) => ({ levelId: s.levelId, position: s.position, value: readings.get(s.id)![metric.id] })),
  };
}

function roomLayer(metric: Metric, sensors: Sensor[], readings: Map<string, Reading>, neutral: string): RoomLayer {
  const byRoom = new Map(sensors.map((s) => [s.roomId, s]));
  return {
    id: 'aq-rooms',
    type: 'rooms',
    // Neutral floors so the heatmap colors read cleanly on top.
    color: () => neutral,
    opacity: 1,
    tooltip: (room) => {
      const sensor = byRoom.get(room.id);
      if (!sensor) return room.name;
      const value = readings.get(sensor.id)![metric.id];
      return `${room.name}\n${metric.label}: ${formatValue(metric, value)} · ${bandOf(metric, value).label}`;
    },
  };
}

function sensorLayer(metric: Metric, sensors: Sensor[], readings: Map<string, Reading>): PointLayer {
  return {
    id: 'aq-sensors',
    type: 'points',
    size: 0.25,
    elevation: 1.2,
    points: sensors.map((s) => ({
      id: s.id,
      levelId: s.levelId,
      position: s.position,
      color: colorFor(metric, readings.get(s.id)![metric.id]),
    })),
    tooltip: (p) => {
      const sensor = sensors.find((s) => s.id === p.id);
      const reading = readings.get(p.id);
      if (!sensor || !reading) return null;
      const lines = METRIC_IDS.map((id) => {
        const m = METRICS[id];
        return `${m.label}: ${formatValue(m, reading[id])} (${bandOf(m, reading[id]).label})`;
      });
      return [`Sensor · ${sensor.roomName}`, ...lines].join('\n');
    },
  };
}

function useAirQualityViewer(plan: FloorPlan | null) {
  const container = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<FloorplanViewer | null>(null);

  // The plan may arrive after mount (the editor mounts first), so create the viewer empty and
  // feed it the plan below; its first setPlan frames the camera.
  useEffect(() => {
    if (!container.current) return;
    const instance = new FloorplanViewer(container.current);
    setViewer(instance);
    return () => {
      setViewer(null);
      instance.dispose();
    };
  }, []);

  useEffect(() => {
    if (viewer && plan) viewer.setPlan(plan);
  }, [viewer, plan]);

  return { container, viewer };
}

/** Air-quality monitoring demo: simulated sensors in every room, drawn as a heatmap over the current plan. */
export function AirQualityView() {
  const { snapshot, announce } = useStudio();
  const plan = snapshot?.plan ?? null;
  const { container, viewer } = useAirQualityViewer(plan);
  const theme = useViewerTheme(viewer);

  const [metricId, setMetricId] = useState<MetricId>('co2');
  const [mode, setMode] = useState<ViewMode>('3d');
  const [level, setLevel] = useState<LevelSelection | null>(null);
  const [hour, setHour] = useState(startHour);
  const [playing, setPlaying] = useState(false);
  const [, startTransition] = useTransition();
  const sliderId = useId();

  const metric = METRICS[metricId];
  const sensors = plan ? sensorsFor(plan) : [];
  const readings = new Map(sensors.map((s) => [s.id, readingAt(s, hour)]));
  const levels = plan?.levels ?? [];
  const activeLevel = level && (level === 'all' || levels.some((l) => l.id === level)) ? level : (levels[0]?.id ?? 'all');

  // Playback: advance the clock, wrapping at midnight.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => startTransition(() => setHour((h) => (h + STEP) % 24)), PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    viewer?.setMode(mode);
  }, [viewer, mode]);

  useEffect(() => {
    viewer?.setLevel(activeLevel);
  }, [viewer, activeLevel]);

  // Rebuild the data layers whenever the data, the metric or the theme changes.
  useEffect(() => {
    if (!viewer || !plan) return;
    viewer.setLayer(roomLayer(metric, sensors, readings, cssToken('--muted')));
    viewer.setLayer(heatmapLayer(metric, sensors, readings));
    viewer.setLayer(sensorLayer(metric, sensors, readings));
    // `sensors` and `readings` are derived from plan + hour on every render, so the effect is keyed
    // on those inputs instead of the (always new) derived objects.
  }, [viewer, plan, metric, hour, theme]);

  const ranked = [...sensors].sort(
    (a, b) => severity(metric, readings.get(b.id)![metricId]) - severity(metric, readings.get(a.id)![metricId]),
  );
  const counts = { good: 0, moderate: 0, poor: 0 };
  for (const s of sensors) counts[bandOf(metric, readings.get(s.id)![metricId]).tone]++;
  const visibleLevelIds = new Set(activeLevel === 'all' ? levels.map((l) => l.id) : [activeLevel]);

  return (
    <main className="grid min-h-0 gap-2 overflow-y-auto p-2 lg:grid-cols-[minmax(0,1fr)_20rem] lg:overflow-hidden">
      <Panel
        title="Air quality"
        actions={
          <>
            <ToggleGroup
              aria-label="Level"
              variant="outline"
              size="sm"
              spacing={0}
              value={[activeLevel]}
              onValueChange={([value]) => value && setLevel(value)}
            >
              {levels.map((l) => (
                <ToggleGroupItem key={l.id} value={l.id}>
                  {l.name || l.id}
                </ToggleGroupItem>
              ))}
              {levels.length > 1 && <ToggleGroupItem value="all">All</ToggleGroupItem>}
            </ToggleGroup>
            <ToggleGroup
              aria-label="View mode"
              variant="outline"
              size="sm"
              spacing={0}
              value={[mode]}
              onValueChange={([value]) => value && setMode(value as ViewMode)}
            >
              <ToggleGroupItem value="3d">3D</ToggleGroupItem>
              <ToggleGroupItem value="2d">2D</ToggleGroupItem>
            </ToggleGroup>
          </>
        }
      >
        <div ref={container} className="relative min-h-0 flex-1" />
      </Panel>

      <Panel title="Sensors" className="lg:min-h-0">
        <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-3">
          <section className="grid gap-2" aria-labelledby="aq-metric">
            <h3 id="aq-metric" className="text-xs text-muted-foreground">
              Metric
            </h3>
            <ToggleGroup
              aria-label="Metric"
              variant="outline"
              size="sm"
              spacing={0}
              className="w-full"
              value={[metricId]}
              onValueChange={([value]) => value && setMetricId(value as MetricId)}
            >
              {METRIC_IDS.map((id) => (
                <ToggleGroupItem key={id} value={id} className="flex-1" aria-label={METRICS[id].label}>
                  {METRICS[id].short}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <MetricLegend metric={metric} />
          </section>

          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={sliderId} className="text-xs text-muted-foreground">
                Time of day
              </Label>
              <span className="font-mono text-sm tabular-nums">{formatHour(hour)}</span>
            </div>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={24 - STEP}
              step={STEP}
              value={hour}
              aria-valuetext={formatHour(hour)}
              onChange={(e) => {
                const value = Number(e.target.value);
                startTransition(() => setHour(value));
              }}
              className="w-full accent-brand"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
                {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                {playing ? 'Pause' : 'Play day'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  setHour(Math.round((now.getHours() + now.getMinutes() / 60) / STEP) * STEP);
                  announce('Timeline set to now');
                }}
              >
                <Clock data-icon="inline-start" /> Now
              </Button>
            </div>
          </section>

          <section className="grid gap-2" aria-labelledby="aq-summary">
            <h3 id="aq-summary" className="text-xs text-muted-foreground">
              {sensors.length} sensors at {formatHour(hour)}
            </h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              {(['good', 'moderate', 'poor'] as const).map((tone) => (
                <div key={tone} className="rounded-md border p-2">
                  <div className="text-lg font-semibold tabular-nums">{counts[tone]}</div>
                  <StatusBadge tone={tone}>{tone === 'good' ? 'Good' : tone === 'moderate' ? 'Moderate' : 'Poor'}</StatusBadge>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-1" aria-labelledby="aq-list">
            <h3 id="aq-list" className="text-xs text-muted-foreground">
              Rooms, worst first
            </h3>
            <ul className="grid gap-1">
              {ranked.map((s) => {
                const value = readings.get(s.id)![metricId];
                const band = bandOf(metric, value);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setLevel(s.levelId);
                        announce(`${s.roomName}: ${formatValue(metric, value)}, ${band.label}`);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: colorFor(metric, value) }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {s.roomName}
                        {!visibleLevelIds.has(s.levelId) && (
                          <span className="text-muted-foreground"> · {s.levelName}</span>
                        )}
                      </span>
                      <span className="tabular-nums">{formatValue(metric, value)}</span>
                      <StatusBadge tone={band.tone}>{band.label}</StatusBadge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        <VespeneLabsMark />
      </Panel>
    </main>
  );
}
