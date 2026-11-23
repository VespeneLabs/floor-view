import {
  FloorplanViewer,
  type FloorPlan,
  type HeatmapLayer,
  type LevelSelection,
  type PointLayer,
  type RoomLayer,
  type ViewMode,
} from '@vespenelabs/floorview';
import { cn } from 'cn';
import { Pause, Play, RotateCcw, ShieldCheck, Siren, SquarePen, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { ALARM_LABELS, formatReading, formatThresholds, GAS_IDS, GASES, hazardStops, type AlarmLevel, type GasId } from './gases';
import {
  alarmEvents,
  detectorsFor,
  DURATION,
  formatElapsed,
  readingAt,
  scenariosFor,
  STEP,
  suspectPipelines,
  type Detector,
  type Reading,
} from './simulation';
import { createGasDemoPlan } from './site';
import { AlarmBadge, GasGlyph, HazardLegend } from './widgets';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { VespeneLabsMark } from '@/components/VespeneLabsMark';
import { useStudio } from '@/features/studio/studio-context';
import { cssToken, useViewerTheme } from '@/features/viewer/useViewerTheme';
import { ASSETS } from '@/lib/assets';
import { navigate } from '@/lib/route';

/** Playback: one timeline step (5 simulated seconds) per tick, so an incident plays in 30 s. */
const PLAY_INTERVAL_MS = 250;
const DETECTOR_LAYER = 'gas-detectors';
/** The built-in site, shown while the editor's plan has no gas detectors. */
const DEMO_PLAN = createGasDemoPlan();
const EVENT_LIMIT = 8;

type GasFilter = GasId | 'all';
type Readings = Map<string, Reading>;

/** The alarm colors of the current theme, by level. */
function alarmColors(): Record<AlarmLevel, string | null> {
  return { 0: null, 1: cssToken('--status-moderate'), 2: cssToken('--destructive') };
}

/** Hazard interpolated between the detectors of each room: walls keep the gas in. */
function heatmapLayer(detectors: Detector[], readings: Readings, dark: boolean): HeatmapLayer {
  return {
    id: 'gas-heatmap',
    type: 'heatmap',
    byRoom: true,
    colorStops: hazardStops(dark),
    opacity: 0.8,
    resolution: 0.2,
    points: detectors.map((d) => ({ levelId: d.levelId, position: d.position, value: readings.get(d.id)!.hazard })),
  };
}

function detectorLine(d: Detector, reading: Reading): string {
  return `${d.tag} · ${d.gas.formula} ${formatReading(d.gas, reading.value)} · ${ALARM_LABELS[reading.level]}`;
}

/** Neutral floors under the heatmap; the tooltip lists the room's detectors. */
function roomLayer(detectors: Detector[], readings: Readings, neutral: string): RoomLayer {
  return {
    id: 'gas-rooms',
    type: 'rooms',
    color: () => neutral,
    opacity: 1,
    tooltip: (room) => {
      const inRoom = detectors.filter((d) => d.roomId === room.id);
      const lines = inRoom.length > 0 ? inRoom.map((d) => detectorLine(d, readings.get(d.id)!)) : ['No detectors'];
      return [room.name, ...lines].join('\n');
    },
  };
}

/** The detectors in alarm with the highest reading of their gas in their room: one per gas cloud. */
function leadDetectors(detectors: Detector[], readings: Readings): Set<string> {
  const lead = new Map<string, Detector>();
  for (const d of detectors) {
    const reading = readings.get(d.id)!;
    if (reading.level === 0) continue;
    const key = `${d.levelId}|${d.roomId}|${d.gas.id}`;
    const best = lead.get(key);
    if (!best || reading.hazard > readings.get(best.id)!.hazard) lead.set(key, d);
  }
  return new Set([...lead.values()].map((d) => d.id));
}

/**
 * One point above each detector post, in the gas's color and shape. A detector in alarm gets a
 * ring in the alarm color; alarm 2 adds a beam. Each room in alarm names its gas and the highest
 * reading on the plan (`showValues` labels every detector instead).
 */
function detectorLayer(detectors: Detector[], readings: Readings, showValues: boolean): PointLayer {
  const colors = alarmColors();
  const byId = new Map(detectors.map((d) => [d.id, d]));
  const lead = leadDetectors(detectors, readings);
  return {
    id: DETECTOR_LAYER,
    type: 'points',
    size: 0.22,
    elevation: 2.6,
    beamStyle: { width: 2.2, spread: 7 },
    label: (p) => {
      const d = byId.get(p.id);
      const reading = readings.get(p.id);
      if (!d || !reading || !(showValues || lead.has(p.id))) return null;
      return `${d.gas.formula} ${formatReading(d.gas, reading.value)}`;
    },
    points: detectors.map((d) => {
      const { level } = readings.get(d.id)!;
      return {
        id: d.id,
        levelId: d.levelId,
        position: d.position,
        color: d.gas.color,
        shape: d.gas.shape,
        ring: colors[level],
        beam: level === 2 ? colors[2] : null,
      };
    }),
    tooltip: (p) => {
      const d = byId.get(p.id);
      const reading = readings.get(p.id);
      if (!d || !reading) return null;
      return [
        d.model ? `${d.tag} · ${d.model}` : d.tag,
        `${d.gas.name} (${d.gas.formula}): ${formatReading(d.gas, reading.value)} · ${ALARM_LABELS[reading.level]}`,
        `${d.gas.hazard} · ${formatThresholds(d.gas)}`,
        d.roomName,
      ].join('\n');
    },
  };
}

function useGasViewer(plan: FloorPlan) {
  const container = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<FloorplanViewer | null>(null);

  useEffect(() => {
    if (!container.current) return;
    // Low walls: the heatmap and the equipment stay visible from every side.
    const instance = new FloorplanViewer(container.current, { assets: ASSETS, wallDisplay: 'low' });
    setViewer(instance);
    return () => {
      setViewer(null);
      instance.dispose();
    };
  }, []);

  useEffect(() => {
    viewer?.setPlan(plan);
  }, [viewer, plan]);

  return { container, viewer };
}

const BANNER_CLASSES: Record<AlarmLevel, string> = {
  0: 'border-status-good/40 bg-status-good/10',
  1: 'border-status-moderate/50 bg-status-moderate/10',
  2: 'border-status-poor/60 bg-status-poor/10',
};
const BANNER_ICONS = { 0: ShieldCheck, 1: TriangleAlert, 2: Siren } as const;
const BANNER_ICON_CLASSES: Record<AlarmLevel, string> = { 0: 'text-status-good', 1: 'text-status-moderate', 2: 'text-status-poor' };
const ROW_CLASSES =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/**
 * Gas detection demo: fixed gas detectors on the plan, an area heatmap of the hazard and
 * indicators of which gas is detected where, driven by simulated incidents.
 */
export function GasDetectionView() {
  const { editor, snapshot, announce } = useStudio();
  const editorPlan = snapshot?.plan ?? null;
  const ownSite = !editorPlan || detectorsFor(editorPlan).length === 0;
  const plan = ownSite ? DEMO_PLAN : editorPlan;
  const { container, viewer } = useGasViewer(plan);
  const theme = useViewerTheme(viewer);

  const [scenarioId, setScenarioId] = useState('normal');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState<GasFilter>('all');
  const [mode, setMode] = useState<ViewMode>('3d');
  const [level, setLevel] = useState<LevelSelection | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [, startTransition] = useTransition();
  const scenarioFieldId = useId();
  const sliderId = useId();
  const valuesId = useId();

  const detectors = detectorsFor(plan);
  const scenarios = scenariosFor(plan, detectors);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0]!;
  const readings: Readings = new Map(detectors.map((d) => [d.id, readingAt(d, scenario, time)]));
  const gases = GAS_IDS.filter((id) => detectors.some((d) => d.gas.id === id)).map((id) => GASES[id]);
  const activeFilter: GasFilter = filter !== 'all' && gases.some((g) => g.id === filter) ? filter : 'all';
  const shown = activeFilter === 'all' ? detectors : detectors.filter((d) => d.gas.id === activeFilter);
  const levels = plan.levels;
  const activeLevel = level && (level === 'all' || levels.some((l) => l.id === level)) ? level : (levels[0]?.id ?? 'all');
  const visibleLevelIds = new Set(activeLevel === 'all' ? levels.map((l) => l.id) : [activeLevel]);

  // Playback: advance the clock and stop at the end of the incident.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => startTransition(() => setTime((t) => Math.min(DURATION, t + STEP))), PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing]);
  if (playing && time >= DURATION) setPlaying(false);

  useEffect(() => {
    viewer?.setMode(mode);
  }, [viewer, mode]);

  useEffect(() => {
    viewer?.setLevel(activeLevel);
  }, [viewer, activeLevel]);

  const worstOf = (list: Detector[]) => list.reduce<Detector | null>((worst, d) => (!worst || readings.get(d.id)!.hazard > readings.get(worst.id)!.hazard ? d : worst), null);
  const alarming = detectors.filter((d) => readings.get(d.id)!.level > 0);
  const siteLevel = Math.max(0, ...alarming.map((d) => readings.get(d.id)!.level)) as AlarmLevel;
  /** The gases in alarm, each with its worst detector: what is detected, and where. */
  const detected = gases.flatMap((gas) => {
    const inAlarm = alarming.filter((d) => d.gas.id === gas.id);
    const worst = worstOf(inAlarm);
    return worst ? [{ gas, worst, count: inAlarm.length, rooms: [...new Set(inAlarm.map((d) => d.roomName))] }] : [];
  });
  const suspects = suspectPipelines(plan, alarming);
  const alarmKey = alarming.map((d) => `${d.id}:${readings.get(d.id)!.level}`).join(' ');
  const suspectKey = suspects.map((s) => s.id).join(' ');

  // Rebuild the data layers whenever the readings, the gas filter or the theme change. Same ids
  // every tick: the viewer updates the existing layers in place.
  useEffect(() => {
    if (!viewer) return;
    viewer.setLayer(roomLayer(detectors, readings, cssToken('--muted')));
    viewer.setLayer(heatmapLayer(shown, readings, theme === 'dark'));
    viewer.setLayer(detectorLayer(shown, readings, showValues));
    // `detectors`, `shown` and `readings` are derived from these inputs on every render.
  }, [viewer, plan, scenario.id, time, activeFilter, showValues, theme]);

  // Detector posts in alarm and the pipelines that may feed the leak take the alarm color.
  useEffect(() => {
    if (!viewer) return;
    const colors = alarmColors();
    viewer.setMarkerTints(Object.fromEntries(alarming.map((d) => [d.id, colors[readings.get(d.id)!.level]])), { replace: true });
    viewer.setPipelineTints(Object.fromEntries(suspects.map((s) => [s.id, colors[2]])), { replace: true });
  }, [viewer, alarmKey, suspectKey, theme]);

  function selectScenario(id: string) {
    setScenarioId(id);
    setTime(0);
    setPlaying(id !== 'normal');
    announce(id === 'normal' ? 'Normal operation' : `Playing: ${scenarios.find((s) => s.id === id)?.label ?? id}`);
  }

  function focusDetector(d: Detector) {
    const reading = readings.get(d.id)!;
    if (activeFilter !== 'all' && activeFilter !== d.gas.id) setFilter('all');
    setLevel(d.levelId);
    viewer?.focus({ kind: 'marker', id: d.id, levelId: d.levelId }, { highlight: { duration: 4000 } });
    announce(`${d.tag} in ${d.roomName}: ${d.gas.name} ${formatReading(d.gas, reading.value)}, ${ALARM_LABELS[reading.level]}`);
  }

  function editSite() {
    if (ownSite) editor?.setPlan(createGasDemoPlan(), { keepHistory: true });
    navigate('editor');
    announce(ownSite ? 'Demo site loaded into the editor · move a detector, then return to Gas detection' : 'Move a detector, then return to Gas detection');
  }

  const ranked = [...shown].sort((a, b) => readings.get(b.id)!.hazard - readings.get(a.id)!.hazard || a.tag.localeCompare(b.tag));
  const events = alarmEvents(detectors, scenario, time).reverse();
  const zones = new Set(detectors.map((d) => d.roomId ?? d.levelId)).size;
  const BannerIcon = BANNER_ICONS[siteLevel];

  return (
    <main className="grid min-h-0 gap-2 overflow-y-auto p-2 lg:grid-cols-[minmax(0,1fr)_23rem] lg:overflow-hidden">
      <Panel
        title={`Gas detection · ${plan.name || 'Untitled plan'}`}
        actions={
          <>
            {levels.length > 1 && (
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
                <ToggleGroupItem value="all">All</ToggleGroupItem>
              </ToggleGroup>
            )}
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

      <Panel title="Detection system" className="lg:min-h-0">
        <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-5 overflow-y-auto p-3">
          <section aria-label="System status" className={cn('grid gap-2 rounded-lg border p-3', BANNER_CLASSES[siteLevel])}>
            <div className="flex items-center gap-2">
              <BannerIcon aria-hidden className={cn('size-5 shrink-0', BANNER_ICON_CLASSES[siteLevel])} />
              <h3 className="font-semibold">{siteLevel === 0 ? 'All clear' : `${ALARM_LABELS[siteLevel]} · gas detected`}</h3>
            </div>
            {detected.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No gas detected. {detectors.length} detectors in {zones} zones read normal.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-1.5">
                {detected.map(({ gas, worst, count, rooms }) => {
                  const reading = readings.get(worst.id)!;
                  return (
                    <li key={gas.id}>
                      <button
                        type="button"
                        onClick={() => focusDetector(worst)}
                        className="grid w-full gap-0.5 rounded-md bg-background/70 px-2 py-1.5 text-left hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span className="flex items-center gap-2">
                          <GasGlyph gas={gas} />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {gas.name} ({gas.formula})
                          </span>
                          <AlarmBadge level={reading.level} />
                        </span>
                        <span className="text-sm">
                          <span className="font-semibold tabular-nums">{formatReading(gas, reading.value)}</span> at {worst.tag} · {rooms.join(', ')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {gas.hazard} · {count === 1 ? '1 detector' : `${count} detectors`} in alarm
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="grid gap-2">
            <Label htmlFor={scenarioFieldId} className="text-xs text-muted-foreground">
              Simulated incident
            </Label>
            <Select
              items={scenarios.map((s) => ({ value: s.id, label: s.label }))}
              value={scenario.id}
              onValueChange={(value) => typeof value === 'string' && selectScenario(value)}
            >
              <SelectTrigger id={scenarioFieldId} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scenarios.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between">
              <Label htmlFor={sliderId} className="text-xs text-muted-foreground">
                Time since start
              </Label>
              <span className="font-mono text-sm tabular-nums">{formatElapsed(time)}</span>
            </div>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={DURATION}
              step={STEP}
              value={time}
              aria-valuetext={formatElapsed(time)}
              onChange={(e) => {
                const value = Number(e.target.value);
                startTransition(() => setTime(value));
              }}
              className="w-full accent-brand"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-pressed={playing}
                onClick={() => {
                  if (!playing && time >= DURATION) setTime(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                {playing ? 'Pause' : 'Play'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTime(0);
                  setPlaying(false);
                }}
              >
                <RotateCcw data-icon="inline-start" /> Restart
              </Button>
            </div>
          </section>

          <section className="grid gap-2" aria-labelledby="gas-list">
            <h3 id="gas-list" className="text-xs text-muted-foreground">
              Gases on the map
            </h3>
            <ul className="grid grid-cols-1 gap-1">
              <li>
                <button type="button" aria-pressed={activeFilter === 'all'} onClick={() => setFilter('all')} className={cn(ROW_CLASSES, activeFilter === 'all' && 'bg-muted')}>
                  <span className="min-w-0 flex-1 truncate font-medium">All gases</span>
                  <span className="text-muted-foreground">{detectors.length} detectors</span>
                </button>
              </li>
              {gases.map((gas) => {
                const worst = worstOf(detectors.filter((d) => d.gas.id === gas.id))!;
                const reading = readings.get(worst.id)!;
                return (
                  <li key={gas.id}>
                    <button
                      type="button"
                      aria-pressed={activeFilter === gas.id}
                      onClick={() => setFilter(activeFilter === gas.id ? 'all' : gas.id)}
                      className={cn(ROW_CLASSES, activeFilter === gas.id && 'bg-muted')}
                    >
                      <GasGlyph gas={gas} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          <span className="font-medium">{gas.formula}</span> {gas.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{formatThresholds(gas)}</span>
                      </span>
                      <span className="tabular-nums">{formatReading(gas, reading.value)}</span>
                      <AlarmBadge level={reading.level} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <HazardLegend gas={activeFilter === 'all' ? null : GASES[activeFilter]} />
          </section>

          {suspects.length > 0 && (
            <section className="grid grid-cols-1 gap-1" aria-labelledby="gas-pipes">
              <h3 id="gas-pipes" className="text-xs text-muted-foreground">
                Possible sources: pipelines in the alarm zones
              </h3>
              <ul className="grid grid-cols-1 gap-1">
                {suspects.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setLevel(s.levelId);
                        viewer?.focus({ kind: 'pipeline', id: s.id }, { highlight: { duration: 4000 } });
                        announce(`${s.name} runs through ${s.roomName}, where ${s.gas.name.toLowerCase()} is in alarm`);
                      }}
                      className={ROW_CLASSES}
                    >
                      <span aria-hidden className="h-1 w-4 shrink-0 rounded-full bg-destructive" />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="truncate text-muted-foreground">{s.roomName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="grid grid-cols-1 gap-1" aria-labelledby="gas-detectors">
            <div className="flex items-center justify-between gap-2">
              <h3 id="gas-detectors" className="text-xs text-muted-foreground">
                Detectors, highest reading first
              </h3>
              <div className="flex items-center gap-2">
                <Switch id={valuesId} size="sm" checked={showValues} onCheckedChange={setShowValues} />
                <Label htmlFor={valuesId} className="text-xs font-normal text-muted-foreground">
                  All values on plan
                </Label>
              </div>
            </div>
            <ul className="grid grid-cols-1 gap-1">
              {ranked.map((d) => {
                const reading = readings.get(d.id)!;
                return (
                  <li key={d.id}>
                    <button type="button" onClick={() => focusDetector(d)} className={ROW_CLASSES}>
                      <GasGlyph gas={d.gas} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{d.tag}</span> <span className="text-muted-foreground">{d.roomName}</span>
                        {!visibleLevelIds.has(d.levelId) && <span className="text-muted-foreground"> · {d.levelName}</span>}
                      </span>
                      <span className="whitespace-nowrap tabular-nums">
                        {d.gas.formula} {formatReading(d.gas, reading.value)}
                      </span>
                      <AlarmBadge level={reading.level} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid grid-cols-1 gap-1" aria-labelledby="gas-events">
            <h3 id="gas-events" className="text-xs text-muted-foreground">
              Event log
            </h3>
            {events.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">No alarms since the start.</p>
            ) : (
              <ol className="grid grid-cols-1 gap-1">
                {events.slice(0, EVENT_LIMIT).map((e) => (
                  <li key={`${e.time}:${e.detector.id}`} className="flex items-center gap-2 px-2 py-1 text-sm">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatElapsed(e.time)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{e.detector.tag}</span> {e.detector.gas.formula} {formatReading(e.detector.gas, e.value)}
                    </span>
                    <AlarmBadge level={e.level} />
                  </li>
                ))}
              </ol>
            )}
            {events.length > EVENT_LIMIT && <p className="px-2 text-xs text-muted-foreground">{events.length - EVENT_LIMIT} earlier events</p>}
          </section>

          <section className="grid gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {ownSite
                ? 'Built-in demo site. The readings are simulated.'
                : 'Detectors come from the plan in the editor. The readings are simulated.'}
            </p>
            <Button variant="outline" size="sm" disabled={!editor} onClick={editSite} className="justify-self-start">
              <SquarePen data-icon="inline-start" /> {ownSite ? 'Open site in editor' : 'Edit site'}
            </Button>
          </section>
        </div>
        <VespeneLabsMark />
      </Panel>
    </main>
  );
}
