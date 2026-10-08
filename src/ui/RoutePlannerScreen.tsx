import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  formatDistanceKm,
  formatPaceSeconds,
  nearestRoutePoint,
  nextTurn,
  remainingRouteMeters,
  routePreferenceLabel,
  googleMapsDirectionsUrl,
  type RouteMode,
  type RoutePlan,
  type RoutePreference,
  type RouteRequest,
} from '../domain/routes';
import { fixed, tr } from '../domain/i18n';
import { requestRoutePlan } from '../services/routeProvider';
import { normalizeRunTarget, targetForPurpose } from '../domain/runTarget';
import {
  native,
  nativeCall,
  normalizeRun,
  type LocationSearchResult,
  type NativeLocation,
  type Run,
  type RoutePlannerState,
  type RouteVoiceSettings,
} from '../native';
import {
  Button,
  Card,
  ChipGroup,
  Copy,
  Field,
  Input,
  Notice,
  RouteMap,
  RouteOpenActions,
  Row,
  Section,
  Stat,
  Title,
  color,
  space,
  type,
} from './components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type PlannerView =
  | 'start'
  | 'search'
  | 'distance'
  | 'mode'
  | 'preference'
  | 'result'
  | 'live';

const DEFAULT_VOICE_SETTINGS: RouteVoiceSettings = {
  enabled: true,
  pace: true,
  distance: true,
  heartRate: false,
  navigation: true,
  intervalKm: 1,
};

const distanceOptions = [
  { value: '3', label: '3 km' },
  { value: '5', label: '5 km' },
  { value: '8', label: '8 km' },
  { value: '10', label: '10 km' },
  { value: '15', label: '15 km' },
];

// Built per render so the active language applies without a restart.
const modeOptions = (): { value: RouteMode; label: string }[] => [
  { value: 'loop', label: tr('Rundweg', 'Loop') },
  { value: 'out_and_back', label: tr('Hin und zurück', 'Out and back') },
];

const preferenceOptions = (): { value: RoutePreference; label: string }[] => [
  { value: 'flat', label: tr('Möglichst flach', 'As flat as possible') },
  { value: 'quiet', label: tr('Möglichst ruhig', 'As quiet as possible') },
  { value: 'green', label: tr('Möglichst grün', 'As green as possible') },
  { value: 'balanced', label: tr('Ausgeglichen', 'Balanced') },
];

const voiceIntervalOptions = () => [
  { value: '0.5', label: `${fixed(0.5, 1)} km` },
  { value: '1', label: '1 km' },
  { value: '2', label: '2 km' },
  { value: '5', label: '5 km' },
];

function number(value: number | undefined, digits = 1) {
  return Number.isFinite(value) ? fixed(value || 0, digits) : '–';
}

function duration(seconds: number | undefined) {
  if (!Number.isFinite(seconds)) return '–:––';
  const rounded = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function normalizePlannerState(
  value: Partial<RoutePlannerState>,
): RoutePlannerState {
  const voice = value.voice as Partial<RouteVoiceSettings> | undefined;
  return {
    routes: Array.isArray(value.routes)
      ? value.routes
          .filter(
            route =>
              route &&
              route.source === 'brouter' &&
              Array.isArray(route.points) &&
              route.points.length >= 2,
          )
          .slice(0, 10)
      : [],
    voice: {
      ...DEFAULT_VOICE_SETTINGS,
      ...(voice || {}),
      intervalKm:
        Number(voice?.intervalKm) || DEFAULT_VOICE_SETTINGS.intervalKm,
    },
    activeRoutePlanId: value.activeRoutePlanId ?? null,
  };
}

export function RoutePlannerScreen({
  onClose,
  embedded = false,
}: {
  onClose: () => void;
  embedded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<PlannerView>('start');
  const [plannerState, setPlannerState] = useState<RoutePlannerState | null>(
    null,
  );
  const [start, setStart] = useState<NativeLocation | null>(null);
  const [startQuery, setStartQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>(
    [],
  );
  const [distanceInput, setDistanceInput] = useState('5');
  const [mode, setMode] = useState<RouteMode>('loop');
  const [preference, setPreference] = useState<RoutePreference>('flat');
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [recording, setRecording] = useState<Run | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voice, setVoice] = useState<RouteVoiceSettings>(
    DEFAULT_VOICE_SETTINGS,
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const plannerStateRef = useRef<RoutePlannerState | null>(null);
  const plannerWrite = useRef(Promise.resolve());
  const routeCursor = useRef(0);

  const applyState = (next: RoutePlannerState, run: Run | null) => {
    const normalized = normalizePlannerState(next);
    plannerStateRef.current = normalized;
    setPlannerState(normalized);
    setVoice(normalized.voice);
    setRecording(run);
    const activeId = normalized.activeRoutePlanId;
    const active = activeId
      ? normalized.routes.find(item => item.id === activeId)
      : undefined;
    if (run && active && active.activeRunId === run.id) {
      setRoute(active);
      setView('live');
    }
  };

  useEffect(() => {
    let mounted = true;
    void Promise.all([native.state(), native.routePlannerState()])
      .then(([next, planner]) => {
        if (mounted) applyState(planner, next.recording);
      })
      .catch(errorValue => {
        if (mounted)
          setError(
            errorValue instanceof Error
              ? errorValue.message
              : String(errorValue),
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (view !== 'live') return;
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await native.state();
        if (!mounted) return;
        setRecording(next.recording);
        if (!next.recording) {
          setView('result');
          setMessage(tr('Lauf gespeichert.', 'Run saved.'));
        }
      } catch {
        // The recording stays active natively, even if a single query fails.
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1_500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [view]);

  const persistPlannerState = async (
    patch: Partial<RoutePlannerState>,
  ): Promise<void> => {
    const current = plannerStateRef.current;
    if (!current)
      throw new Error(
        tr(
          'Die lokalen Routendaten sind noch nicht geladen.',
          'The local route data is not loaded yet.',
        ),
      );
    const next = normalizePlannerState({ ...current, ...patch });
    plannerStateRef.current = next;
    setPlannerState(next);
    setVoice(next.voice);
    const operation = plannerWrite.current.then(() =>
      native.saveRoutePlannerState(next),
    );
    plannerWrite.current = operation.catch(() => undefined);
    await operation;
  };

  const saved = plannerState?.routes ?? [];

  useEffect(() => {
    routeCursor.current = 0;
  }, [route?.id]);

  const currentPoint = useMemo(() => {
    const points = recording?.route;
    return points && points.length ? points[points.length - 1] : undefined;
  }, [recording?.route]);

  const progress = useMemo(() => {
    if (!route || !currentPoint) return null;
    const nearest = nearestRoutePoint(
      route.points,
      currentPoint,
      routeCursor.current,
    );
    if (nearest.index >= routeCursor.current) {
      routeCursor.current = nearest.index;
    }
    return {
      ...nearest,
      remainingMeters: remainingRouteMeters(route.points, nearest.index),
      nextTurn: nextTurn(route.points, nearest.index),
    };
  }, [currentPoint, route]);

  const loadCurrentLocation = async () => {
    setBusy(true);
    setError('');
    try {
      await nativeCall('requestRecordingPermissions');
      const location = await native.currentLocation();
      setStart({
        ...location,
        label: tr('Aktuelle Position', 'Current position'),
      });
      if (location.accuracyM && location.accuracyM > 100) {
        setMessage(
          tr(
            `Die aktuelle Position ist ungefähr ${Math.round(
              location.accuracyM,
            )} m genau.`,
            `The current position is about ${Math.round(
              location.accuracyM,
            )} m accurate.`,
          ),
        );
      }
      setView('distance');
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const searchStart = async () => {
    setBusy(true);
    setError('');
    try {
      const results = await native.searchLocation(startQuery);
      setSearchResults(results);
      if (!results.length)
        setError(
          tr(
            'Kein passender Startort gefunden.',
            'No matching start place found.',
          ),
        );
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const selectSearchResult = (result: LocationSearchResult) => {
    setStart(result);
    setSearchResults([]);
    setView('distance');
  };

  const request = (): RouteRequest | null => {
    if (!start) {
      setError(
        tr('Wähle zuerst einen Startpunkt.', 'Choose a start point first.'),
      );
      return null;
    }
    const distanceKm = Number(distanceInput.replace(',', '.'));
    if (!Number.isFinite(distanceKm) || distanceKm < 1 || distanceKm > 50) {
      setError(
        tr(
          'Wähle eine Distanz zwischen 1 und 50 Kilometern.',
          'Choose a distance between 1 and 50 kilometers.',
        ),
      );
      return null;
    }
    return {
      start: {
        latitude: start.latitude,
        longitude: start.longitude,
      },
      startLabel: start.label || tr('Startpunkt', 'Start point'),
      distanceKm,
      mode,
      preference,
    };
  };

  const generate = async () => {
    const nextRequest = request();
    if (!nextRequest) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const nextRoute = await requestRoutePlan(nextRequest);
      if (!nextRoute) {
        setRoute(null);
        setError(
          tr(
            'Keine begehbare Route gefunden. Prüfe die Internetverbindung und versuche es erneut.',
            'No walkable route found. Check your internet connection and try again.',
          ),
        );
        setView('preference');
        return;
      }
      setRoute(nextRoute);
      setView('result');
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const saveRoute = async (plan: RoutePlan) => {
    if (plan.source !== 'brouter') {
      setError(
        tr(
          'Nur verifizierte Straßenrouten können gespeichert werden.',
          'Only verified road routes can be saved.',
        ),
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = [plan, ...saved.filter(item => item.id !== plan.id)].slice(
        0,
        10,
      );
      await persistPlannerState({ routes: next });
      setRoute(plan);
      setMessage(tr('Route gespeichert.', 'Route saved.'));
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const startRun = async () => {
    if (!route || route.source !== 'brouter') {
      setError(
        tr(
          'Nur eine verifizierte Straßenroute kann gestartet werden.',
          'Only a verified road route can be started.',
        ),
      );
      return;
    }
    setBusy(true);
    setError('');
    let activated = false;
    let hadRecording = false;
    try {
      const current = await native.state();
      hadRecording = Boolean(current.recording);
      const activeRouteId = plannerStateRef.current?.activeRoutePlanId;
      if (current.recording && activeRouteId !== route.id) {
        throw new Error(
          tr(
            'Ein anderer Lauf ist bereits aktiv. Beende ihn zuerst, bevor du diese Route startest.',
            'Another run is already active. End it before you start this route.',
          ),
        );
      }
      const permissions = await nativeCall<{ locationPermission: boolean }>(
        'requestRecordingPermissions',
      );
      if (!permissions.locationPermission) {
        throw new Error(
          tr(
            'Für die Aufzeichnung fehlt die genaue Standortfreigabe.',
            'Precise location permission is missing for recording.',
          ),
        );
      }
      const nextRoutes = saved.some(item => item.id === route.id)
        ? saved
        : [route, ...saved].slice(0, 10);
      await persistPlannerState({
        routes: nextRoutes,
        activeRoutePlanId: route.id,
      });
      activated = true;
      let started = current.recording;
      if (!started) {
        const result = await nativeCall<{ recording?: unknown }>(
          'startRouteRun',
          route.id,
          'free',
          'running',
          JSON.stringify(
            targetForPurpose(
              normalizeRunTarget(current.settings.runTarget),
              'free',
            ),
          ),
        );
        started = result.recording ? normalizeRun(result.recording) : null;
      }
      if (!started?.id)
        throw new Error(
          tr(
            'Der Lauf konnte nicht gestartet werden.',
            'The run could not be started.',
          ),
        );
      const activeRoutes = nextRoutes.map(item =>
        item.id === route.id ? { ...item, activeRunId: started.id } : item,
      );
      const nextPlanner = normalizePlannerState({
        ...(plannerStateRef.current || {}),
        routes: activeRoutes,
        activeRoutePlanId: route.id,
      });
      plannerStateRef.current = nextPlanner;
      setPlannerState(nextPlanner);
      setVoice(nextPlanner.voice);
      setRecording(started);
      setView('live');
    } catch (errorValue) {
      if (activated && !hadRecording) {
        await persistPlannerState({ activeRoutePlanId: null }).catch(() => {});
      }
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const finishRun = async () => {
    setBusy(true);
    setError('');
    try {
      await nativeCall('finishRun');
      const activeRouteId = plannerStateRef.current?.activeRoutePlanId;
      const clearedRoutes = saved.map(item =>
        item.id === activeRouteId ? { ...item, activeRunId: undefined } : item,
      );
      await persistPlannerState({
        routes: clearedRoutes,
        activeRoutePlanId: null,
      });
      const next = await native.state();
      setRecording(next.recording);
      setView('result');
      setMessage(tr('Lauf gespeichert.', 'Run saved.'));
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    if (!recording) return;
    setBusy(true);
    try {
      await nativeCall(
        recording.status === 'recording' ? 'pauseRun' : 'resumeRun',
      );
      const next = await native.state();
      setRecording(next.recording);
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const updateVoice = (patch: Partial<RouteVoiceSettings>) => {
    const next = { ...voice, ...patch };
    setVoice(next);
    void persistPlannerState({ voice: next }).catch(errorValue =>
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      ),
    );
  };

  const openGoogleMaps = async (points: RoutePlan['points']) => {
    setBusy(true);
    setError('');
    try {
      const url = googleMapsDirectionsUrl(points);
      if (!url)
        throw new Error(
          tr(
            'Diese Route kann nicht geöffnet werden.',
            'This route cannot be opened.',
          ),
        );
      await Linking.openURL(url);
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const openCoMaps = async (points: RoutePlan['points']) => {
    setBusy(true);
    setError('');
    try {
      await native.openRouteFile(points, 'comaps');
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const back = useCallback(() => {
    setError('');
    setMessage('');
    switch (view) {
      case 'start':
        onClose();
        break;
      case 'search':
        setView('start');
        break;
      case 'distance':
        setView('start');
        break;
      case 'mode':
        setView('distance');
        break;
      case 'preference':
        setView('mode');
        break;
      case 'result':
        setView('preference');
        break;
      case 'live':
        setView('result');
        break;
    }
  }, [onClose, view]);
  useEffect(() => {
    if (!embedded) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (view === 'start') return false;
        back();
        return true;
      },
    );
    return () => subscription.remove();
  }, [back, embedded, view]);

  const step =
    view === 'start' || view === 'search'
      ? '1 / 4'
      : view === 'distance'
      ? '2 / 4'
      : view === 'mode'
      ? '3 / 4'
      : view === 'preference'
      ? '4 / 4'
      : '';

  const shell = (children: React.ReactNode) => (
    <View
      style={[
        styles.shell,
        {
          paddingTop: embedded ? 0 : insets.top,
          paddingBottom: embedded ? 0 : Math.max(insets.bottom, space.xs),
        },
      ]}
    >
      {!embedded || view !== 'start' ? (
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('Zurück', 'Back')}
            onPress={back}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
            <Text style={styles.backLabel}>{tr('Zurück', 'Back')}</Text>
          </Pressable>
          <View style={styles.headerRight}>
            {step ? <Text style={styles.step}>{step}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr(
                'Routenplaner schließen',
                'Close route planner',
              )}
              onPress={onClose}
              style={styles.close}
            >
              <Text style={styles.closeText}>{tr('Schließen', 'Close')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {error ? (
        <View style={styles.noticeSlot}>
          <Notice
            title={tr('Aktion nicht abgeschlossen', 'Action not completed')}
            onDismiss={() => setError('')}
          >
            {error}
          </Notice>
        </View>
      ) : null}
      {message ? (
        <View style={styles.noticeSlot}>
          <Notice onDismiss={() => setMessage('')}>{message}</Notice>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );

  const renderStart = () => (
    <>
      <Title>
        {embedded
          ? tr('Routen', 'Routes')
          : tr('Wo startest du?', 'Where do you start?')}
      </Title>
      <Copy muted>
        {tr(
          'Wähle den Start für deine nächste Laufroute.',
          'Choose the start for your next running route.',
        )}
      </Copy>
      <Button
        title={tr('Aktuelle Position verwenden', 'Use current position')}
        onPress={() => void loadCurrentLocation()}
        disabled={busy}
      />
      <Button
        secondary
        title={tr('Startort suchen', 'Search for a start place')}
        onPress={() => setView('search')}
        disabled={busy}
      />
      {saved.length ? (
        <Section title={tr('Gespeicherte Routen', 'Saved routes')}>
          {saved.map(item => (
            <Row
              key={item.id}
              title={`${number(item.distanceMeters / 1000, 2)} km · ${
                item.mode === 'loop'
                  ? tr('Rundweg', 'Loop')
                  : tr('Hin und zurück', 'Out and back')
              }`}
              subtitle={`${item.startLabel} · ${routePreferenceLabel(
                item.preference,
              )}`}
              onPress={() => {
                setRoute(item);
                setView('result');
              }}
            />
          ))}
        </Section>
      ) : null}
    </>
  );

  const renderSearch = () => (
    <>
      <Title>{tr('Startort suchen', 'Search for a start place')}</Title>
      <Copy muted>
        {tr(
          'Suche nach einer Adresse, einem Ort oder einem Treffpunkt.',
          'Search for an address, a place or a meeting point.',
        )}
      </Copy>
      <Field label={tr('Startort', 'Start place')}>
        <Input
          label={tr('Startort', 'Start place')}
          value={startQuery}
          onChangeText={setStartQuery}
          placeholder={tr(
            'Zum Beispiel: Seepark Freiburg',
            'For example: Seepark Freiburg',
          )}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => void searchStart()}
        />
      </Field>
      <Button
        title={tr('Startort suchen', 'Search for a start place')}
        onPress={() => void searchStart()}
        disabled={busy || startQuery.trim().length < 3}
      />
      {searchResults.length ? (
        <Section title={tr('Treffer', 'Matches')}>
          {searchResults.map((result, index) => (
            <Row
              key={`${result.latitude}-${result.longitude}-${index}`}
              title={result.label}
              subtitle={tr('Als Startpunkt verwenden', 'Use as start point')}
              onPress={() => selectSearchResult(result)}
            />
          ))}
        </Section>
      ) : null}
    </>
  );

  const renderDistance = () => (
    <>
      <Title>
        {tr('Wie weit möchtest du laufen?', 'How far do you want to run?')}
      </Title>
      <Copy muted>
        {tr(
          'Die Distanz meint die gesamte Route, inklusive Rückweg.',
          'The distance covers the whole route, including the way back.',
        )}
      </Copy>
      <Field label={tr('Schnellauswahl', 'Quick pick')}>
        <ChipGroup
          label={tr('Distanz auswählen', 'Choose distance')}
          options={distanceOptions}
          value={
            distanceOptions.some(option => option.value === distanceInput)
              ? distanceInput
              : ''
          }
          onChange={setDistanceInput}
        />
      </Field>
      <Field
        label={tr('Eigene Distanz', 'Custom distance')}
        hint={tr('Zwischen 1 und 50 km', 'Between 1 and 50 km')}
      >
        <Input
          label={tr(
            'Eigene Distanz in Kilometern',
            'Custom distance in kilometers',
          )}
          value={distanceInput}
          onChangeText={setDistanceInput}
          keyboardType="decimal-pad"
        />
      </Field>
      <Button
        title={tr('Weiter', 'Next')}
        onPress={() => setView('mode')}
        disabled={busy}
      />
    </>
  );

  const renderMode = () => (
    <>
      <Title>
        {tr('Welche Strecke möchtest du?', 'Which route do you want?')}
      </Title>
      <Copy muted>
        {tr(
          'Beide Varianten bringen dich wieder zum Start.',
          'Both options bring you back to the start.',
        )}
      </Copy>
      <ChipGroup
        label={tr('Routentyp', 'Route type')}
        options={modeOptions()}
        value={mode}
        onChange={setMode}
      />
      <Card>
        <Text style={styles.cardTitle}>
          {mode === 'loop'
            ? tr('Rundweg', 'Loop')
            : tr('Hin und zurück', 'Out and back')}
        </Text>
        <Copy muted>
          {mode === 'loop'
            ? tr(
                'Runback sucht eine Schleife mit möglichst wenig doppelter Strecke.',
                'Runback looks for a loop with as little doubled distance as possible.',
              )
            : tr(
                'Runback sucht einen Wendepunkt und führt dich auf demselben Weg zurück.',
                'Runback looks for a turnaround point and brings you back the same way.',
              )}
        </Copy>
      </Card>
      <Button
        title={tr('Weiter', 'Next')}
        onPress={() => setView('preference')}
      />
    </>
  );

  const renderPreference = () => (
    <>
      <Title>{tr('Was ist dir wichtig?', 'What matters to you?')}</Title>
      <Copy muted>
        {tr(
          'Runback nutzt die Auswahl als Priorität, nicht als starres Versprechen.',
          'Runback uses your choice as a priority, not a fixed promise.',
        )}
      </Copy>
      <ChipGroup
        label={tr('Routenpriorität', 'Route priority')}
        options={preferenceOptions()}
        value={preference}
        onChange={setPreference}
      />
      <Card>
        <Text style={styles.cardTitle}>{routePreferenceLabel(preference)}</Text>
        <Copy muted>
          {tr(
            'Hauptstraßen und ungeeignete Wege werden weiterhin vermieden, wenn die Kartendaten das erkennen lassen.',
            'Main roads and unsuitable paths are still avoided when the map data shows them.',
          )}
        </Copy>
      </Card>
      <Notice>
        {tr(
          'Für eine begehbare Straßenroute werden Startpunkt und Routenzwischenpunkte an BRouter mit OpenStreetMap-Daten übertragen. Laufdaten bleiben lokal auf deinem Gerät.',
          'For a walkable road route, the start point and route waypoints are sent to BRouter with OpenStreetMap data. Run data stays on your device.',
        )}
      </Notice>
      <Button
        title={tr('Route finden', 'Find route')}
        onPress={() => void generate()}
        disabled={busy || !start}
      />
      {busy ? (
        <View style={styles.loading}>
          <ActivityIndicator color={color.green} />
          <Copy muted>
            {tr(
              'Routenvorschläge werden verglichen …',
              'Comparing route options …',
            )}
          </Copy>
        </View>
      ) : null}
    </>
  );

  const renderResult = () => {
    if (!route) return null;
    const isSaved = saved.some(item => item.id === route.id);
    const isNavigable = route.source === 'brouter';
    return (
      <>
        <Title>{tr('Deine Route', 'Your route')}</Title>
        <Copy muted>
          {route.startLabel} · {routePreferenceLabel(route.preference)}
        </Copy>
        <RouteMap planned={route.points} />
        <View style={styles.metrics}>
          <Stat
            value={number(route.distanceMeters / 1000, 2)}
            label={tr('Kilometer', 'Kilometers')}
          />
          <Stat
            value={
              route.ascentMeters === undefined
                ? '–'
                : number(route.ascentMeters, 0)
            }
            label={tr('Höhenmeter', 'Elevation gain')}
          />
          <Stat
            value={
              route.mode === 'loop'
                ? tr('Rundweg', 'Loop')
                : tr('Wende', 'Turn')
            }
            label={tr('Strecke', 'Route')}
          />
        </View>
        <RouteOpenActions
          onGoogleMaps={() => void openGoogleMaps(route.points)}
          onCoMaps={() => void openCoMaps(route.points)}
          disabled={busy}
        />
        <Card>
          <Text style={styles.cardTitle}>
            {route.source === 'brouter'
              ? tr('Strecke gefunden', 'Route found')
              : tr('Vorschau', 'Preview')}
          </Text>
          <Copy muted>
            {route.providerLabel}.{' '}
            {route.source === 'preview'
              ? tr(
                  'Die Kartendaten waren nicht erreichbar. Prüfe die Strecke vor dem Lauf.',
                  'The map data could not be reached. Check the route before the run.',
                )
              : tr(
                  'Die Route basiert auf OpenStreetMap-Daten.',
                  'The route is based on OpenStreetMap data.',
                )}
          </Copy>
        </Card>
        <Button
          title={
            isSaved
              ? tr('Gespeichert · Lauf starten', 'Saved · Start run')
              : tr('Route speichern & Lauf starten', 'Save route & start run')
          }
          onPress={() => void startRun()}
          disabled={busy || !isNavigable}
        />
        {!isSaved ? (
          <Button
            secondary
            title={tr('Nur Route speichern', 'Only save route')}
            onPress={() => void saveRoute(route)}
            disabled={busy || !isNavigable}
          />
        ) : null}
        {!isNavigable ? (
          <Copy muted>
            {tr(
              'Diese Vorschau ist nicht auf Straßen geprüft und kann deshalb weder gespeichert noch gestartet werden.',
              'This preview is not checked against roads, so it cannot be saved or started.',
            )}
          </Copy>
        ) : null}
        <Button
          secondary
          small
          title={tr('Andere Route suchen', 'Find another route')}
          onPress={() => setView('preference')}
          disabled={busy}
        />
      </>
    );
  };

  const renderVoiceSettings = () => (
    <Section title={tr('Sprachansagen', 'Voice cues')}>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>
            {tr('Sprachansagen aktiv', 'Voice cues on')}
          </Text>
          <Text style={styles.rowSubtitle}>
            {tr(
              'Pace und Route werden während des Laufs angesagt.',
              'Pace and route are announced during the run.',
            )}
          </Text>
        </View>
        <Switch
          accessibilityLabel={tr('Sprachansagen aktiv', 'Voice cues on')}
          accessibilityState={{ checked: voice.enabled }}
          value={voice.enabled}
          onValueChange={enabled => updateVoice({ enabled })}
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.enabled ? color.green : color.muted}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Pace</Text>
          <Text style={styles.rowSubtitle}>
            {tr(
              'Aktueller Durchschnitt in min/km.',
              'Current average in min/km.',
            )}
          </Text>
        </View>
        <Switch
          accessibilityLabel={tr('Pace ansagen', 'Announce pace')}
          accessibilityState={{ checked: voice.pace }}
          value={voice.pace}
          onValueChange={paceValue => updateVoice({ pace: paceValue })}
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.pace ? color.green : color.muted}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>{tr('Distanz', 'Distance')}</Text>
          <Text style={styles.rowSubtitle}>
            {tr(
              'Bereits gelaufene Kilometer und Reststrecke.',
              'Kilometers run so far and distance left.',
            )}
          </Text>
        </View>
        <Switch
          accessibilityLabel={tr('Distanz ansagen', 'Announce distance')}
          accessibilityState={{ checked: voice.distance }}
          value={voice.distance}
          onValueChange={distanceValue =>
            updateVoice({ distance: distanceValue })
          }
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.distance ? color.green : color.muted}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>{tr('Puls', 'Heart rate')}</Text>
          <Text style={styles.rowSubtitle}>
            {tr(
              'Nur wenn ein gültiger Wert vorliegt.',
              'Only when a valid value is available.',
            )}
          </Text>
        </View>
        <Switch
          accessibilityLabel={tr('Puls ansagen', 'Announce heart rate')}
          accessibilityState={{ checked: voice.heartRate }}
          value={voice.heartRate}
          onValueChange={heartRate => updateVoice({ heartRate })}
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.heartRate ? color.green : color.muted}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>{tr('Route', 'Route')}</Text>
          <Text style={styles.rowSubtitle}>
            {tr(
              'Reststrecke und Abstand zur geplanten Route.',
              'Distance left and offset from the planned route.',
            )}
          </Text>
        </View>
        <Switch
          accessibilityLabel={tr('Route ansagen', 'Announce route')}
          accessibilityState={{ checked: voice.navigation }}
          value={voice.navigation}
          onValueChange={navigation => updateVoice({ navigation })}
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.navigation ? color.green : color.muted}
        />
      </View>
      <Field label={tr('Ansageintervall', 'Announcement interval')}>
        <ChipGroup
          label={tr('Ansageintervall', 'Announcement interval')}
          options={voiceIntervalOptions()}
          value={String(voice.intervalKm)}
          onChange={value => updateVoice({ intervalKm: Number(value) })}
        />
      </Field>
    </Section>
  );

  const renderLive = () => {
    if (!route || !recording) return null;
    const paceSeconds =
      recording.distanceMeters >= 20
        ? recording.durationSeconds / (recording.distanceMeters / 1000)
        : undefined;
    const offRoute =
      progress?.distanceMeters !== undefined && progress.distanceMeters > 80;
    return (
      <>
        <Title>
          {recording.status === 'recording'
            ? tr('Lauf läuft', 'Run in progress')
            : tr('Lauf pausiert', 'Run paused')}
        </Title>
        <Copy muted>
          {route.startLabel} · {tr('Ziel', 'Goal')}{' '}
          {formatDistanceKm(route.distanceMeters)}
        </Copy>
        <RouteMap
          planned={route.points}
          track={recording.route || []}
          current={currentPoint}
        />
        <Card>
          <Text style={styles.cardTitle}>
            {offRoute
              ? tr('Du bist neben der Route', 'You are off the route')
              : tr('Du bist auf der Route', 'You are on the route')}
          </Text>
          <Copy muted>
            {offRoute
              ? tr(
                  `Etwa ${number(
                    progress?.distanceMeters,
                    0,
                  )} m von der geplanten Strecke entfernt.`,
                  `About ${number(
                    progress?.distanceMeters,
                    0,
                  )} m from the planned route.`,
                )
              : tr('Folge der gestrichelten Linie.', 'Follow the dashed line.')}
          </Copy>
        </Card>
        <View style={styles.metrics}>
          <Stat
            value={duration(recording.durationSeconds)}
            label={tr('Dauer', 'Duration')}
          />
          <Stat
            value={formatDistanceKm(recording.distanceMeters)}
            label={tr('Gelaufen', 'Covered')}
          />
          <Stat value={formatPaceSeconds(paceSeconds)} label="Pace" />
        </View>
        <RouteOpenActions
          onGoogleMaps={() => void openGoogleMaps(route.points)}
          onCoMaps={() => void openCoMaps(route.points)}
          disabled={busy}
        />
        <Section title={tr('Während des Laufs', 'During the run')}>
          <Row
            title={tr('Reststrecke', 'Distance left')}
            subtitle={formatDistanceKm(progress?.remainingMeters)}
          />
          <Row
            title={tr('Nächste Richtungsänderung', 'Next direction change')}
            subtitle={
              progress?.nextTurn
                ? progress.nextTurn.direction === 'left'
                  ? tr(
                      `In ${formatDistanceKm(
                        progress.nextTurn.distanceMeters,
                      )} links`,
                      `In ${formatDistanceKm(
                        progress.nextTurn.distanceMeters,
                      )} left`,
                    )
                  : tr(
                      `In ${formatDistanceKm(
                        progress.nextTurn.distanceMeters,
                      )} rechts`,
                      `In ${formatDistanceKm(
                        progress.nextTurn.distanceMeters,
                      )} right`,
                    )
                : tr('Dem Weg weiter folgen', 'Keep following the path')
            }
          />
          <Row
            title={tr('Herzfrequenz', 'Heart rate')}
            subtitle={
              recording.avgHeartRate
                ? `${Math.round(recording.avgHeartRate)} bpm`
                : tr('Keine Daten', 'No data')
            }
          />
        </Section>
        <Button
          title={
            recording.status === 'recording'
              ? tr('Lauf pausieren', 'Pause run')
              : tr('Lauf fortsetzen', 'Resume run')
          }
          onPress={() => void togglePause()}
          disabled={busy}
        />
        <Button
          secondary
          title={tr('Lauf beenden & speichern', 'End & save run')}
          onPress={() => void finishRun()}
          disabled={busy}
        />
        <Button
          secondary
          small
          title={
            voiceOpen
              ? tr('Sprachansagen schließen', 'Close voice cues')
              : tr('Sprachansagen konfigurieren', 'Set up voice cues')
          }
          onPress={() => setVoiceOpen(value => !value)}
        />
        {voiceOpen ? renderVoiceSettings() : null}
      </>
    );
  };

  if (loading) {
    return shell(
      <View style={styles.loading}>
        <ActivityIndicator color={color.green} />
        <Copy muted>{tr('Routen werden geladen …', 'Loading routes …')}</Copy>
      </View>,
    );
  }

  return shell(
    view === 'start'
      ? renderStart()
      : view === 'search'
      ? renderSearch()
      : view === 'distance'
      ? renderDistance()
      : view === 'mode'
      ? renderMode()
      : view === 'preference'
      ? renderPreference()
      : view === 'result'
      ? renderResult()
      : renderLive(),
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: color.bg },
  header: {
    minHeight: 58,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  back: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  backText: { color: color.text, fontSize: 34, lineHeight: 36 },
  backLabel: { color: color.text, ...type.label },
  step: { color: color.muted, ...type.label },
  close: { minHeight: 48, justifyContent: 'center' },
  closeText: { color: color.muted, ...type.label },
  noticeSlot: { paddingHorizontal: space.md, paddingTop: space.sm },
  content: { padding: space.md, paddingBottom: space.xxl, gap: space.md },
  cardTitle: { color: color.text, ...type.heading },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  metrics: { flexDirection: 'row', gap: space.sm },
  switchRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  switchText: { flex: 1, gap: space.xxs },
  rowTitle: { color: color.text, ...type.body, fontWeight: '500' },
  rowSubtitle: { color: color.muted, ...type.label },
});
