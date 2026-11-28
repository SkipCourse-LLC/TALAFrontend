import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, CornerDownLeft, LocateFixed, Maximize2, Minimize2, Minus, Palette, Plus, X } from 'lucide-react';
import type { GraphEdge, GraphNode } from './graph';
import {
  buildMyMap,
  scaleWeight,
  type MyMapGrouping,
  type MyMapModel,
  type MyMapProject,
  type MyMapStandard,
  type MyMapTheme,
} from './buildMyMap';
import { layoutScene, measure } from './layoutMyMap';
import { SUBJECTS } from './subjects';

interface MyMapViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  studentName?: string;
  loading?: boolean;
  error?: boolean;
  onOpenProject?: (jobId: string) => void;
  /** Shown under the empty-state message, e.g. a button to add a first project. */
  emptyAction?: React.ReactNode;
  /** Colors the student picked, by node id -> swatch name. */
  colors?: Record<string, string>;
  /** Saves the whole color choice; the map offers color controls only when this is set. */
  onColorsChange?: (colors: Record<string, string>) => void;
  /** Local sample graph. The switch is shown only when a handler is passed. */
  mockData?: boolean;
  onMockDataChange?: (enabled: boolean) => void;
}

const GROUPINGS: Array<{ value: MyMapGrouping; label: string }> = [
  { value: 'course', label: 'Courses' },
  { value: 'skill', label: 'Skills' },
  { value: 'topic', label: 'Topics' },
  { value: 'tool', label: 'Tools' },
];

// Pastel fills in the spirit of a hand-made "about me" map, with a deeper
// shade of each for satellite borders and connectors. Students pick from these
// by name, and the first eight are the default order.
const SWATCHES: Record<string, readonly [fill: string, accent: string]> = {
  Indigo: ['#C9CBF7', '#6366F1'],
  Pink: ['#F7BFCB', '#DB2777'],
  Orange: ['#F6D5C7', '#EA580C'],
  Blue: ['#CFE0F7', '#2563EB'],
  Green: ['#D3ECD6', '#16A34A'],
  // Dark enough that a 2px border on white still clears 3:1.
  Yellow: ['#F4E3B5', '#A16207'],
  Purple: ['#E2D3F3', '#9333EA'],
  Rose: ['#EBCFD2', '#BE123C'],
  Teal: ['#C7EBE6', '#0D9488'],
  Slate: ['#E2E8F0', '#475569'],
  Lime: ['#E1EFC4', '#65A30D'],
  Sky: ['#CDEBF5', '#0284C7'],
};
const SWATCH_NAMES = Object.keys(SWATCHES);

// Every subject area has its own color. A student can change it in the Colors panel,
// which saves it under `subject:<name>`.
const SUBJECT_SWATCH: Record<string, string> = {
  Mathematics: 'Blue',
  Science: 'Green',
  'Language & Literature': 'Indigo',
  'Social Studies': 'Orange',
  'Arts & Media': 'Pink',
  'Technology & Computing': 'Teal',
  'Engineering & Trades': 'Yellow',
  'Business & Hospitality': 'Purple',
  'Health & Fitness': 'Rose',
  'Agriculture & Natural Resources': 'Lime',
  General: 'Slate',
};
const subjectKey = (subject: string) => `subject:${subject}`;

/** How many ideas the first view shows, and how many each "+ more" adds. */
const FIRST_VIEW = 16;
const MORE_STEP = 40;

/** One step from the student out to the idea currently on screen. */
interface MapCrumb {
  label: string;
  grouping: MyMapGrouping;
  themeId: string | null;
  standardId: string | null;
}

const rootCrumb = (grouping: MyMapGrouping): MapCrumb => ({
  label: 'You',
  grouping,
  themeId: null,
  standardId: null,
});

/** Put this standard at the end of the path, replacing a standard already open. */
function withStandard(current: MapCrumb[], standard: MyMapStandard): MapCrumb[] {
  const here = current[current.length - 1]!;
  if (here.standardId === standard.id) return current;
  const base = here.standardId ? current.slice(0, -1) : current;
  const parent = base[base.length - 1]!;
  return [...base, {
    label: truncate(standard.name, 32),
    grouping: parent.grouping,
    themeId: parent.themeId,
    standardId: standard.id,
  }];
}

type BlobKind = 'center' | 'primary' | 'satellite' | 'more';

interface SceneBlob {
  id: string;
  kind: BlobKind;
  title: string;
  subtitle?: string;
  badge?: string;
  /** Light background and dark text for a grade badge. Count badges use the accent border instead. */
  badgeTone?: { background: string; color: string };
  fontSize: number;
  fill: string;
  accent: string;
  /** Swatch name, for the ideas a student can recolor. */
  swatch?: string;
  /** Subject area. The blob is colored by it. */
  subject?: string;
  parentId?: string;
  weight: number;
  selected?: boolean;
  /** Subject area. Nodes in one cluster share a color and a wedge of the map. */
  cluster?: string;
  ariaLabel: string;
  onClick?: () => void;
  width: number;
  height: number;
}

interface SceneEdge {
  id: string;
  from: string;
  to: string;
  kind: 'center' | 'related';
  label?: string;
}

type Sizer = (blob: Omit<SceneBlob, 'width' | 'height'>, maxWidth: number, padX?: number, padY?: number) => SceneBlob;

/** Titles wrap onto at most two lines; anything longer is cut with an ellipsis. */
const TWO_LINES: React.CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
const truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const KEY_ICON = 'h-3 w-3';

/** A small picture of one keyboard key. The hint sentence stays in a screen-reader span. */
function Keycap({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <span
      className={`inline-flex h-5 items-center justify-center rounded border border-gray-300 bg-white text-[11px] font-medium leading-none text-gray-600 ${
        wide ? 'min-w-7 px-1' : 'w-5'
      }`}
    >
      {children}
    </span>
  );
}

function KeyHint({ keys, action }: { keys: React.ReactNode; action: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-px">{keys}</span>
      <span>{action}</span>
    </span>
  );
}

/** Dark text on a light ground. White-on-bright fails contrast for every score band. */
function gradeTone(grade: number): { background: string; color: string } {
  if (grade >= 80) return { background: '#D1FAE5', color: '#064E3B' };
  if (grade >= 60) return { background: '#FEF3C7', color: '#78350F' };
  return { background: '#FEE2E2', color: '#7F1D1D' };
}

const FOCUS_RING = 'focus:outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A]';

function GradeChip({ grade }: { grade?: number }) {
  if (grade === undefined) return null;
  const tone = gradeTone(grade);
  return (
    <span
      className="whitespace-nowrap rounded-full px-2 py-0.5 text-sm font-semibold"
      style={{ backgroundColor: tone.background, color: tone.color }}
    >
      {Math.round(grade)}%
    </span>
  );
}

export default function MyMapView({
  nodes, edges, studentName, loading = false, error = false, onOpenProject, emptyAction, colors, onColorsChange,
  mockData = false, onMockDataChange,
}: MyMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupingRef = useRef<HTMLFieldSetElement>(null);
  /** After a level change, put focus back on this map node instead of the side panel. */
  const pendingMapFocus = useRef<string | null>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 650 });
  const [tabStopId, setTabStopId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [path, setPath] = useState<MapCrumb[]>([rootCrumb('course')]);
  const [visibleRings, setVisibleRings] = useState(1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  // Zoom and pan sit on top of the fit-to-screen scale. x/y are pixels from the centered position.
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const justDraggedRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number; x: number; y: number; midX: number; midY: number } | null>(null);
  // "Expand" fills the browser window. The Curriculum header's Full screen button does the whole screen.
  const [expanded, setExpanded] = useState(false);

  const here = path[path.length - 1]!;
  const grouping = here.grouping;
  const focusThemeId = here.themeId;
  const selectedStandardId = here.standardId;
  const model = useMemo(() => buildMyMap(nodes, edges, grouping), [nodes, edges, grouping]);
  const focusTheme = model.themes.find((t) => t.id === focusThemeId) ?? null;
  const selectedStandard = focusTheme?.standards.find((s) => s.id === selectedStandardId) ?? null;

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const goBack = () => {
    if (path.length <= 1) return;
    const parent = path[path.length - 2]!;
    setHoveredId(null);
    setHighlightedProjectId(null);
    if (here.grouping !== parent.grouping || here.themeId !== parent.themeId) {
      setVisibleRings(1);
      setView({ zoom: 1, x: 0, y: 0 });
    }
    setPath(path.slice(0, -1));
  };

  const jumpTo = (index: number) => {
    if (index < 0 || index >= path.length - 1) return;
    const next = path.slice(0, index + 1);
    const dest = next[next.length - 1]!;
    setHoveredId(null);
    setHighlightedProjectId(null);
    if (dest.grouping !== here.grouping || dest.themeId !== here.themeId) {
      setVisibleRings(1);
      setView({ zoom: 1, x: 0, y: 0 });
    }
    if (dest.themeId) setDetailsOpen(true);
    setPath(next);
  };

  const resetTo = (nextGrouping: MyMapGrouping) => {
    setView({ zoom: 1, x: 0, y: 0 });
    setHoveredId(null);
    setHighlightedProjectId(null);
    setVisibleRings(1);
    setDetailsOpen(false);
    setPath([rootCrumb(nextGrouping)]);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // One Escape does one thing. Capture runs before the curriculum full-screen handler.
      const consume = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (colorsOpen) {
        consume();
        setColorsOpen(false);
        return;
      }
      if (path.length > 1) {
        consume();
        pendingMapFocus.current = here.standardId ?? here.themeId ?? 'center';
        goBack();
        return;
      }
      if (expanded) {
        consume();
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const scene = useMemo(
    () =>
      // The ref is updated only by the event callbacks passed to buildScene.
      // eslint-disable-next-line react-hooks/refs
      buildScene({
        model,
        focusTheme,
        selectedStandardId,
        visibleRings,
        studentName,
        colors,
        onTheme: (theme) => {
          setView({ zoom: 1, x: 0, y: 0 });
          setHoveredId(null);
          setHighlightedProjectId(null);
          setVisibleRings(1);
          setDetailsOpen(true);
          pendingMapFocus.current = 'center';
          setStatusMessage(`Opened ${theme.label}. ${plural(theme.standards.length, 'standard')} across ${plural(theme.projectCount, 'project')}.`);
          setPath((current) => [
            current[0]!,
            { label: theme.label, grouping: current[0]!.grouping, themeId: theme.id, standardId: null },
          ]);
        },
        // A related tag hangs off a theme, so that theme stays in the path behind it.
        onPivot: (link, parent) => {
          setView({ zoom: 1, x: 0, y: 0 });
          setHoveredId(null);
          setHighlightedProjectId(null);
          setVisibleRings(1);
          setDetailsOpen(true);
          pendingMapFocus.current = 'center';
          setStatusMessage(`Opened ${link.label}.`);
          setPath((current) => [
            current[0]!,
            { label: parent.label, grouping: current[0]!.grouping, themeId: parent.id, standardId: null },
            { label: link.label, grouping: link.grouping, themeId: link.id, standardId: null },
          ]);
        },
        onStandard: (standard) => {
          setDetailsOpen(true);
          setHighlightedProjectId(null);
          setHoveredId(null);
          if (selectedStandardId === standard.id) {
            setStatusMessage(`Closed ${standard.name}.`);
            setPath((current) => (current[current.length - 1]?.standardId ? current.slice(0, -1) : current));
            return;
          }
          setStatusMessage(`Opened ${standard.name}. Shown in ${plural(standard.projectCount, 'project')}.`);
          setPath((current) => withStandard(current, standard));
        },
        // The little project tags sit outside the standard. Open the description
        // on that standard and point at the project, instead of leaving the map.
        onProject: (project, standard) => {
          setDetailsOpen(true);
          setHoveredId(null);
          setHighlightedProjectId(project.jobId);
          setStatusMessage(`Opened ${standard.name}. ${project.label} is highlighted.`);
          setPath((current) => withStandard(current, standard));
        },
        onMore: () => { setHoveredId(null); setVisibleRings((rings) => rings + 1); },
      }),
    // The callbacks only set state, so they don't need to rebuild the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, grouping, focusTheme, selectedStandardId, visibleRings, studentName, colors],
  );

  const layout = useMemo(
    () => layoutScene(scene.map(({ id, kind, parentId, cluster, weight, width, height }) => ({ id, kind, parentId, cluster, weight, width, height }))),
    [scene],
  );
  const { width: canvasWidth, height, placed } = layout;
  const scale = Math.min(1, Math.max(0.1, (viewport.width - 16) / canvasWidth), Math.max(0.1, (viewport.height - 16) / height));
  const links = useMemo(() => sceneEdges(scene, focusTheme), [scene, focusTheme]);

  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 6;
  const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  /** Zoom by a factor, keeping the point under (cursorX, cursorY) fixed. Offsets are from the map's center. */
  const zoomBy = (factor: number, cursorX = 0, cursorY = 0) => {
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const ratio = zoom / current.zoom;
      return { zoom, x: cursorX - (cursorX - current.x) * ratio, y: cursorY - (cursorY - current.y) * ratio };
    });
  };
  const resetView = () => setView({ zoom: 1, x: 0, y: 0 });

  // Scroll wheel zooms toward the pointer. Needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomBy(factor, event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
    // zoomBy only uses stable state setters and constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clicking the blank map is not a control, so the browser drops focus onto the page.
  // Cancel that and leave the cursor on the current idea.
  const holdMapFocus = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-map-node], button, a, input, textarea, select, label')) return;
    event.preventDefault();
    const root = containerRef.current;
    const active = document.activeElement;
    if (active instanceof HTMLElement && root?.contains(active) && active.closest('[data-map-node]')) return;
    const el = tabStop ? root?.querySelector<HTMLElement>(`[data-map-node="${CSS.escape(tabStop)}"]`) : null;
    // preventScroll keeps the map from jumping; the browser still applies
    // focus-visible styling from the keyboard/mouse modality that got us here.
    el?.focus({ preventScroll: true });
  };

  const onPanStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      // A second finger turns the drag into a pinch.
      const [a, b] = [...pointersRef.current.values()];
      if (!a || !b) return;
      pinchRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: view.zoom, x: view.x, y: view.y,
        midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2,
      };
      dragRef.current = null;
      justDraggedRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } else if (pointersRef.current.size === 1) {
      dragRef.current = { startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y, moved: false };
    }
  };
  const onPanMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      if (!a || !b) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const zoom = clampZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
      const ratio = zoom / pinch.zoom;
      const startX = pinch.midX - rect.left - rect.width / 2;
      const startY = pinch.midY - rect.top - rect.height / 2;
      const nowX = (a.x + b.x) / 2 - rect.left - rect.width / 2;
      const nowY = (a.y + b.y) / 2 - rect.top - rect.height / 2;
      setView({ zoom, x: nowX - (startX - pinch.x) * ratio, y: nowY - (startY - pinch.y) * ratio });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // A finger wobbles more than a mouse, so it takes a bigger move to count as a drag.
    if (!drag.moved && Math.hypot(dx, dy) < (event.pointerType === 'touch' ? 9 : 5)) return;
    if (!drag.moved) {
      drag.moved = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setView((current) => ({ ...current, x: drag.originX + dx, y: drag.originY + dy }));
  };
  const onPanEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (dragRef.current?.moved) justDraggedRef.current = true;
    dragRef.current = null;
    if (pointersRef.current.size < 2) pinchRef.current = null;
  };
  // A drag that ends over a node must not also click it.
  const swallowClickAfterDrag = (event: React.MouseEvent) => {
    if (!justDraggedRef.current) return;
    justDraggedRef.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  /** Pick a standard from the sidebar: select it, reveal it if hidden, and bring it into view. */
  const selectStandard = (standard: MyMapStandard) => {
    if (!focusTheme) return;
    const index = focusTheme.standards.findIndex((item) => item.id === standard.id);
    const rings = index < FIRST_VIEW ? 1 : 1 + Math.ceil((index + 1 - FIRST_VIEW) / MORE_STEP);
    setVisibleRings((current) => Math.max(current, rings));
    setDetailsOpen(true);
    setHighlightedProjectId(null);
    setHoveredId(null);
    setPath((current) => withStandard(current, standard));
    setPendingFocusId(standard.id);
    pendingMapFocus.current = standard.id;
    setStatusMessage(`Opened ${standard.name}. Shown in ${plural(standard.projectCount, 'project')}.`);
  };
  const clearStandard = () => {
    setHighlightedProjectId(null);
    setPath((current) => (current[current.length - 1]?.standardId ? current.slice(0, -1) : current));
  };

  // Once the picked standard is on the map, zoom in on it and center it.
  useEffect(() => {
    if (!pendingFocusId) return;
    const spot = placed.get(pendingFocusId);
    if (!spot) return;
    const zoom = clampZoom(Math.max(1, 0.9 / scale));
    const total = scale * zoom;
    // The chosen node is positioned only after the new scene has been laid out.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({ zoom, x: -(spot.x - canvasWidth / 2) * total, y: -(spot.y - height / 2) * total });
    setPendingFocusId(null);
  }, [pendingFocusId, placed, canvasWidth, height, scale]);
  // The subjects drawn right now, in a fixed order, with the swatch each one wears.
  const subjectsOnScreen = useMemo(() => {
    const present = new Set(scene.flatMap((blob) => (blob.subject && blob.swatch ? [blob.subject] : [])));
    return SUBJECTS.filter((subject) => present.has(subject)).map((subject) => ({
      id: subjectKey(subject),
      title: subject,
      swatch: scene.find((blob) => blob.subject === subject)!.swatch!,
    }));
  }, [scene]);

  const blobById = new Map(scene.map((b) => [b.id, b]));
  const tabStop = tabStopId && scene.some((blob) => blob.id === tabStopId) ? tabStopId : scene[0]?.id ?? null;

  const focusMapNode = (id: string) => {
    setTabStopId(id);
    setHoveredId(id);
    const spot = placed.get(id);
    if (spot) {
      const ox = (spot.x - canvasWidth / 2) * scale;
      const oy = (spot.y - height / 2) * scale;
      setView((current) => {
        const sx = ox * current.zoom + current.x;
        const sy = oy * current.zoom + current.y;
        const limitX = Math.max(0, viewport.width / 2 - 56);
        const limitY = Math.max(0, viewport.height / 2 - 56);
        if (Math.abs(sx) <= limitX && Math.abs(sy) <= limitY) return current;
        return { ...current, x: -ox * current.zoom, y: -oy * current.zoom };
      });
    }
    const root = containerRef.current;
    const el = root && [...root.querySelectorAll<HTMLElement>('[data-map-node]')].find((node) => node.dataset.mapNode === id);
    el?.focus({ preventScroll: true });
  };

  // Opening a node replaces the buttons on the map. Put the cursor on the new
  // level so arrow keys keep moving through the graph, instead of falling into the side panel.
  useEffect(() => {
    const requested = pendingMapFocus.current;
    if (!requested) return;
    const target = scene.some((blob) => blob.id === requested) ? requested : scene.some((blob) => blob.id === 'center') ? 'center' : null;
    if (!target) return;
    pendingMapFocus.current = null;
    focusMapNode(target);
  });

  const nearestNode = (fromId: string, dx: number, dy: number) => {
    const from = placed.get(fromId);
    if (!from) return null;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const blob of scene) {
      if (blob.id === fromId) continue;
      const spot = placed.get(blob.id);
      if (!spot) continue;
      const vx = spot.x - from.x;
      const vy = spot.y - from.y;
      const dot = vx * dx + vy * dy;
      if (dot <= 0) continue;
      const dist = Math.hypot(vx, vy) || 1;
      // Any node in that half of the map is reachable. Prefer the closer, more direct one.
      const score = dist / Math.max(dot / dist, 0.2);
      if (score < bestScore) {
        bestScore = score;
        best = blob.id;
      }
    }
    return best;
  };

  const onMapKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    // Zoom and pan belong to the map. The side list keeps its own keys.
    if (!target.closest('[data-testid="map-canvas"]')) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(1.3);
      setStatusMessage('Zoomed in.');
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomBy(1 / 1.3);
      setStatusMessage('Zoomed out.');
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      resetView();
      setStatusMessage('Map fit to the screen.');
      return;
    }
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const step = direction[event.key];
    if (!step) return;
    if (event.shiftKey) {
      event.preventDefault();
      setView((current) => ({ ...current, x: current.x - step[0] * 140, y: current.y - step[1] * 140 }));
      return;
    }
    const node = target.closest<HTMLElement>('[data-map-node]');
    if (!node?.dataset.mapNode) return;
    event.preventDefault();
    const fromId = node.dataset.mapNode;
    const next = nearestNode(fromId, step[0], step[1]);
    if (next) {
      focusMapNode(next);
      return;
    }
    // At the fitted view, panning only slides a map that is already on screen.
    // Move to the nearest idea instead, so the cursor cannot get stuck.
    if (view.zoom === 1) {
      let closest: string | null = null;
      let closestDist = Infinity;
      const from = placed.get(fromId);
      if (from) {
        for (const blob of scene) {
          if (blob.id === fromId) continue;
          const spot = placed.get(blob.id);
          if (!spot) continue;
          const dist = Math.hypot(spot.x - from.x, spot.y - from.y);
          if (dist < closestDist) {
            closestDist = dist;
            closest = blob.id;
          }
        }
      }
      if (closest) {
        focusMapNode(closest);
        return;
      }
    }
    setView((current) => ({ ...current, x: current.x - step[0] * 80, y: current.y - step[1] * 80 }));
  };

  const onGroupingKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = GROUPINGS.findIndex((item) => item.value === grouping);
    const next = GROUPINGS[(index + delta + GROUPINGS.length) % GROUPINGS.length]!;
    resetTo(next.value);
    setStatusMessage(`Showing ${next.label.toLowerCase()}.`);
    requestAnimationFrame(() => {
      groupingRef.current?.querySelector<HTMLInputElement>(`input[value="${next.value}"]`)?.focus();
    });
  };

  return (
    <section
      onKeyDown={onMapKeyDown}
      className={expanded ? 'fixed inset-0 z-50 flex min-h-0 flex-col gap-2 bg-white p-3' : 'flex h-full min-h-0 flex-col gap-2'}
    >
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusMessage}</div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {path.length > 1 ? (
              <nav aria-label="Map location" className="flex flex-wrap items-center gap-1">
                {path.map((crumb, index) => {
                  const current = index === path.length - 1;
                  return (
                    <span key={`${index}:${crumb.grouping}:${crumb.themeId ?? ''}:${crumb.standardId ?? ''}`} className="inline-flex items-center gap-1">
                      {index > 0 && <span aria-hidden="true" className="text-gray-300">/</span>}
                      {current ? (
                        <span className="font-semibold text-gray-900" aria-current="page">{crumb.label}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => jumpTo(index)}
                          className={`min-h-11 rounded-full px-3 hover:bg-gray-50 hover:text-gray-900 ${FOCUS_RING}`}
                        >
                          {crumb.label}
                        </button>
                      )}
                    </span>
                  );
                })}
              </nav>
            ) : (
              <>
                <h2 className="font-semibold text-gray-900">Your map</h2>
              </>
            )}
            {mockData && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Sample student</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onMockDataChange && (
              <button
                type="button"
                role="switch"
                aria-checked={mockData}
                aria-label="Mock data"
                onClick={() => onMockDataChange(!mockData)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm motion-reduce:transition-none ${FOCUS_RING} ${
                  mockData ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Mock data
                <span className="font-semibold">{mockData ? 'On' : 'Off'}</span>
              </button>
            )}
            {onColorsChange && model.themes.length > 0 && (
              <button
                type="button"
                aria-pressed={colorsOpen}
                onClick={() => setColorsOpen((open) => !open)}
                className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm motion-reduce:transition-none ${FOCUS_RING} ${
                  colorsOpen ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Palette className="h-4 w-4" aria-hidden /> Colors
              </button>
            )}
            <fieldset ref={groupingRef} className="inline-flex min-w-0 rounded-full border-0 bg-gray-100 p-1">
              <legend className="sr-only">Group your work by</legend>
              {GROUPINGS.map((g) => (
                <label
                  key={g.value}
                  className={`inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-sm focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-[#1E3A8A] ${
                    grouping === g.value ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-700 hover:text-gray-900'
                  }`}
                >
                  <input
                    type="radio"
                    name="my-map-grouping"
                    value={g.value}
                    checked={grouping === g.value}
                    onChange={() => {
                      resetTo(g.value);
                      setStatusMessage(`Showing ${g.label.toLowerCase()}.`);
                    }}
                    onKeyDown={onGroupingKey}
                    className="sr-only"
                  />
                  {g.label}
                </label>
              ))}
            </fieldset>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={containerRef}
          data-testid="map-canvas"
          role="group"
          aria-label="Map of your work"
          aria-describedby="map-how-to"
          className="relative min-h-0 flex-1 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
          onMouseDown={holdMapFocus}
          onPointerDown={onPanStart}
          onPointerMove={onPanMove}
          onPointerUp={onPanEnd}
          onPointerCancel={onPanEnd}
          onClickCapture={swallowClickAfterDrag}
        >
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: canvasWidth * scale,
              height: height * scale,
              transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            }}
          >
          <div
          className="relative"
          style={{
            width: canvasWidth,
            height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            backgroundImage: 'radial-gradient(#e5e7eb 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
          >
          {model.themes.length === 0 ? (
            <div role={error ? 'alert' : 'status'} className="flex h-64 flex-col items-center justify-center gap-3 p-8 text-center text-base text-gray-800">
              {loading
                ? 'Loading your map…'
                : error
                  ? 'Your map could not be loaded. Refresh the page to try again.'
                  : model.totalProjects > 0
                    ? `No ${GROUPINGS.find((item) => item.value === grouping)?.label.toLowerCase()} are linked to your projects yet.`
                    : 'Submit a project to start building your map.'}
              {!loading && !error && model.totalProjects === 0 && emptyAction}
            </div>
          ) : (
            <>
              <svg className="pointer-events-none absolute inset-0" width={canvasWidth} height={height} aria-hidden>
                {links.map((edge) => {
                  const from = placed.get(edge.from);
                  const to = placed.get(edge.to);
                  if (!from || !to) return null;
                  const active = hoveredId && (edge.from === hoveredId || edge.to === hoveredId);
                  const source = blobById.get(edge.from);
                  const bend = edge.kind === 'related' ? 0.08 : 0.14;
                  const mx = (from.x + to.x) / 2 + (to.y - from.y) * bend;
                  const my = (from.y + to.y) / 2 - (to.x - from.x) * bend;
                  return (
                    <path
                      key={edge.id}
                      data-kind={edge.kind}
                      d={`M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`}
                      fill="none"
                      stroke={edge.kind === 'related' ? source?.accent ?? '#475569' : '#475569'}
                      strokeWidth={edge.kind === 'related' ? (active ? 3.5 : 2.25) : (active ? 3 : 2)}
                      strokeDasharray={edge.kind === 'related' ? '5 4' : undefined}
                    >
                      <title>{edge.label}</title>
                    </path>
                  );
                })}
              </svg>
              {scene.map((blob) => {
                const p = placed.get(blob.id);
                return p ? (
                  <BlobView
                    key={blob.id}
                    blob={blob}
                    tabIndex={blob.id === tabStop ? 0 : -1}
                    onHover={(id) => setHoveredId(id)}
                    style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%, -50%)' }}
                  />
                ) : null;
              })}
            </>
          )}
          </div>
          </div>
          <p
            id="map-how-to"
            className={
              model.themes.length > 0
                ? 'pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-4.75rem)] rounded-md bg-white/75 px-1.5 py-1 text-[11px] leading-4 text-gray-600'
                : 'sr-only'
            }
          >
            <span className="sr-only">
              Bigger means it shows up in more of your work. Arrow keys move. Shift and an arrow key slides the map. Plus and minus zoom. 0 fits the map. Enter opens a node. Escape goes back.
            </span>
            {model.themes.length > 0 && (
              <span aria-hidden="true" className="flex flex-col gap-1">
                <span>Bigger means it shows up in more of your work.</span>
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <KeyHint
                  action="move"
                  keys={(
                    <>
                      <Keycap><ArrowLeft className={KEY_ICON} /></Keycap>
                      <Keycap><ArrowUp className={KEY_ICON} /></Keycap>
                      <Keycap><ArrowDown className={KEY_ICON} /></Keycap>
                      <Keycap><ArrowRight className={KEY_ICON} /></Keycap>
                    </>
                  )}
                />
                <KeyHint
                  action="slide"
                  keys={(
                    <>
                      <Keycap wide><span className="text-[11px] leading-none">⇧</span></Keycap>
                      <span className="px-px">+</span>
                      <Keycap><ArrowRight className={KEY_ICON} /></Keycap>
                    </>
                  )}
                />
                <KeyHint
                  action="zoom"
                  keys={(
                    <>
                      <Keycap><Plus className={KEY_ICON} /></Keycap>
                      <Keycap><Minus className={KEY_ICON} /></Keycap>
                    </>
                  )}
                />
                <KeyHint action="fit" keys={<Keycap>0</Keycap>} />
                <KeyHint action="open" keys={<Keycap><CornerDownLeft className={KEY_ICON} /></Keycap>} />
                <KeyHint action="back" keys={<Keycap wide>Esc</Keycap>} />
                </span>
              </span>
            )}
          </p>
          {model.themes.length > 0 && (
            <div
              role="group"
              aria-label="Zoom controls"
              className="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md"
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.3)} className={`min-h-11 min-w-11 text-gray-800 hover:bg-gray-50 hover:text-gray-900 ${FOCUS_RING}`}>
                <Plus className="mx-auto h-5 w-5" aria-hidden />
              </button>
              <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.3)} className={`min-h-11 min-w-11 border-t border-gray-100 text-gray-800 hover:bg-gray-50 hover:text-gray-900 ${FOCUS_RING}`}>
                <Minus className="mx-auto h-5 w-5" aria-hidden />
              </button>
              <button type="button" aria-label="Fit map to view" title="Fit map to view" onClick={resetView} className={`min-h-11 min-w-11 border-t border-gray-100 text-gray-800 hover:bg-gray-50 hover:text-gray-900 ${FOCUS_RING}`}>
                <LocateFixed className="mx-auto h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={expanded ? 'Shrink map' : 'Expand map'}
                title={expanded ? 'Shrink map back' : 'Fill the browser window'}
                onClick={() => setExpanded((open) => !open)}
                className={`min-h-11 min-w-11 border-t border-gray-100 text-gray-800 hover:bg-gray-50 hover:text-gray-900 ${FOCUS_RING}`}
              >
                {expanded ? <Minimize2 className="mx-auto h-5 w-5" aria-hidden /> : <Maximize2 className="mx-auto h-5 w-5" aria-hidden />}
              </button>
            </div>
          )}
        </div>
        {subjectsOnScreen.length > 0 && (
          <ul aria-label="Subject colors" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 px-3 py-2 text-sm text-gray-800">
            <li className="font-medium">Color shows subject</li>
            {subjectsOnScreen.map((item) => (
              <li key={item.id} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full border"
                  style={{ backgroundColor: SWATCHES[item.swatch]![0], borderColor: SWATCHES[item.swatch]![1] }}
                />
                {item.title}
              </li>
            ))}
          </ul>
        )}
        </div>
      {((colorsOpen && onColorsChange && model.themes.length > 0) || (focusTheme && detailsOpen)) && (
      <aside aria-label={colorsOpen && onColorsChange ? 'Colors' : 'Details'} className="max-h-[45%] shrink-0 overflow-y-auto border-t border-gray-200 bg-white p-4 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
        {colorsOpen && onColorsChange ? (
          <ColorPanel
            items={subjectsOnScreen}
            colors={colors ?? {}}
            onChange={onColorsChange}
            onClose={() => setColorsOpen(false)}
          />
        ) : focusTheme && (
          <DetailPanel
            theme={focusTheme}
            standard={selectedStandard}
            onSelectStandard={selectStandard}
            onClearStandard={clearStandard}
            highlightedProjectId={highlightedProjectId}
            onOpenProject={onOpenProject}
            onClose={() => {
              setDetailsOpen(false);
              const id = selectedStandardId ?? focusThemeId;
              if (id) focusMapNode(id);
            }}
          />
        )}
      </aside>
      )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ scene ------------------------------ */

interface SceneInput {
  model: MyMapModel;
  focusTheme: MyMapTheme | null;
  selectedStandardId: string | null;
  visibleRings: number;
  studentName?: string;
  colors?: Record<string, string>;
  onTheme: (theme: MyMapTheme) => void;
  onPivot: (link: MyMapTheme['related'][number], parent: MyMapTheme) => void;
  onStandard: (standard: MyMapStandard) => void;
  onProject: (project: MyMapProject, standard: MyMapStandard) => void;
  onMore: () => void;
}

/** Everything drawn at the current level: center, ring of primaries, their satellites. */
function buildScene(input: SceneInput): SceneBlob[] {
  const { model, focusTheme, selectedStandardId, studentName } = input;
  const visibleRings = Math.max(1, input.visibleRings);
  const blobs: SceneBlob[] = [];
  const sized: Sizer = (blob, maxWidth, padX, padY) => {
    const size = measure(blob.title, blob.subtitle, blob.fontSize, maxWidth, padX, padY, {
      // Semibold titles, and the center's bold capitals, run wider than 0.6em.
      titleFactor: blob.kind === 'center' ? 0.94 : 0.74,
      subtitleFont: blob.kind === 'center' ? 16 : 14,
      fitLongestWord: blob.kind !== 'satellite',
      maxTitleLines: blob.kind === 'center' ? undefined : 2,
    });
    // Room for the count/grade pill and the gap before it. Never shrink a title
    // that already had to grow past the cap to fit its longest word.
    const badge = blob.badge ? blob.badge.length * 8 + 22 : 0;
    const height = blob.kind === 'center' ? size.height : Math.max(size.height, 44);
    return { ...blob, ...size, height, width: Math.max(size.width, Math.min(maxWidth, size.width + badge)) };
  };
  const more = (hidden: number) =>
    sized(
      {
        id: '__more__', kind: 'more', title: `+${hidden} more`, fontSize: 16, fill: '#F3F4F6', accent: '#4B5563',
        weight: 1, ariaLabel: `Show ${hidden} more`, onClick: input.onMore,
      },
      160, 16, 12,
    );

  const limit = FIRST_VIEW + (visibleRings - 1) * MORE_STEP;
  // Tags stay after "+ more", but get fewer and smaller so the extra nodes still have room.
  const crowded = visibleRings > 1;
  const tagsPerTheme = crowded ? 1 : 3;
  const tagsPerStandard = crowded ? 1 : 2;
  const tagFont = 16;
  const tagWidth = crowded ? 160 : 200;
  const paint = (subject: string) => {
    const picked = input.colors?.[subjectKey(subject)];
    const swatch = picked && SWATCHES[picked] ? picked : SUBJECT_SWATCH[subject] ?? 'Slate';
    const [fill, accent] = SWATCHES[swatch] ?? SWATCHES.Slate!;
    return { swatch, fill, accent };
  };

  if (!focusTheme) {
    const skills = model.topSkills.map((s) => s.label).join(' · ');
    blobs.push(
      sized(
        {
          id: 'center', kind: 'center', title: 'Who are you?',
          subtitle: [studentName, skills && `Most often: ${skills}`].filter(Boolean).join(' — '),
          fontSize: 30, fill: '#C9CBF7', accent: '#6366F1', weight: 0,
          ariaLabel: `Your map. ${[studentName, plural(model.totalProjects, 'project'), plural(model.totalStandards, 'standard'), skills && `Most often: ${skills}`].filter(Boolean).join('. ')}.`,
        },
        300, 28, 20,
      ),
    );
    const shown = model.themes.slice(0, limit);
    const maxWeight = Math.max(1, ...shown.map((theme) => theme.projectCount));
    shown.forEach((theme) => {
      const { swatch, fill, accent } = paint(theme.subject);
      blobs.push(
        sized(
          {
            id: theme.id, kind: 'primary', title: theme.label, subtitle: `${theme.subject} · ${plural(theme.projectCount, 'project')}`,
            fontSize: scaleWeight(theme.projectCount, maxWeight, 16, 24), fill, accent, swatch,
            subject: theme.subject, cluster: theme.subject, weight: theme.projectCount,
            ariaLabel: `${theme.label}: shown in ${plural(theme.projectCount, 'project')}. ${theme.subject}. Open to see standards.`,
            onClick: () => input.onTheme(theme),
          },
          360,
        ),
      );
      theme.related.slice(0, tagsPerTheme).forEach((link) => {
        blobs.push(
          sized(
            {
              id: `${theme.id}>${link.id}`, kind: 'satellite', parentId: theme.id, title: link.label,
              badge: String(link.projectCount), fontSize: tagFont, fill: '#ffffff', accent, weight: link.projectCount,
              ariaLabel: `${link.label}, in ${plural(link.projectCount, 'project')} with ${theme.label}. Open ${link.label}.`,
              onClick: () => input.onPivot(link, theme),
            },
            tagWidth, 14, 10,
          ),
        );
      });
    });
    if (model.themes.length > shown.length) blobs.push(more(model.themes.length - shown.length));
    return blobs;
  }

  const center = paint(focusTheme.subject);
  const related = focusTheme.related.map((r) => r.label).join(' · ');
  blobs.push(
    sized(
      {
        id: 'center', kind: 'center', title: focusTheme.label,
        subtitle: [
          `${plural(focusTheme.projectCount, 'project')} · ${plural(focusTheme.standards.length, 'standard')}`,
          related && `With ${related}`,
        ].filter(Boolean).join(' — '),
        fontSize: 26, fill: center.fill, accent: center.accent, swatch: center.swatch, subject: focusTheme.subject, weight: 0,
        ariaLabel: `${focusTheme.label}, ${focusTheme.subject}. ${plural(focusTheme.projectCount, 'project')}. ${plural(focusTheme.standards.length, 'standard')}.${related ? ` With ${related}.` : ''}`,
      },
      300, 28, 20,
    ),
  );
  const shown = focusTheme.standards.slice(0, limit);
  const maxWeight = Math.max(1, ...shown.map((standard) => standard.projectCount));
  shown.forEach((standard) => {
    const { swatch, fill, accent } = paint(standard.subject);
    blobs.push(
      sized(
        {
          id: standard.id, kind: 'primary', title: standard.name,
          subtitle: [standard.subject, standard.hasCode ? standard.code : undefined].filter(Boolean).join(' · '),
          fontSize: scaleWeight(standard.projectCount, maxWeight, 16, 22), fill, accent, swatch,
          subject: standard.subject, cluster: standard.subject, weight: standard.projectCount,
          selected: standard.id === selectedStandardId,
          ariaLabel: `${standard.name}${standard.hasCode ? ` (${standard.code})` : ''}: ${standard.description.replace(/\.$/, '')}. Shown in ${plural(standard.projectCount, 'project')}. ${standard.subject}.`,
          onClick: () => input.onStandard(standard),
        },
        300,
      ),
    );
    standard.projects.slice(0, tagsPerStandard).forEach((project) => {
      const grade = project.grade === undefined ? undefined : Math.round(project.grade);
      blobs.push(
        sized(
          {
            id: `${standard.id}>${project.jobId}`, kind: 'satellite', parentId: standard.id,
            title: project.label, badge: grade === undefined ? undefined : `${grade}%`,
            badgeTone: grade === undefined ? undefined : gradeTone(grade),
            fontSize: tagFont, fill: '#ffffff', accent, weight: 1,
            ariaLabel: `${project.label}${grade === undefined ? '' : `, ${grade}%`}. Open project.`,
            onClick: () => input.onProject(project, standard),
          },
          crowded ? 180 : 220, 14, 10,
        ),
      );
    });
  });
  if (focusTheme.standards.length > shown.length) blobs.push(more(focusTheme.standards.length - shown.length));
  return blobs;
}

/** Spokes from the center to each primary, and from each primary to its satellites. */
function sceneEdges(scene: SceneBlob[], focusTheme: MyMapTheme | null): SceneEdge[] {
  return scene
    .filter((blob) => blob.kind === 'primary' || blob.kind === 'satellite')
    .map((blob) => {
      const from = blob.parentId ?? 'center';
      return {
        id: `link:${from}:${blob.id}`,
        from,
        to: blob.id,
        kind: blob.kind === 'satellite' ? 'related' : 'center',
        label: blob.kind === 'satellite'
          ? focusTheme ? 'Project demonstrates this standard' : 'Connected by demonstrated standards'
          : 'Demonstrated by this student',
      };
    });
}

/* ------------------------------ views ------------------------------ */

function BlobView({ blob, style, onHover, tabIndex }: {
  blob: SceneBlob;
  style?: React.CSSProperties;
  onHover?: (id: string | null) => void;
  tabIndex: number;
}) {
  const shared = {
    'data-map-node': blob.id,
    tabIndex,
    onMouseEnter: () => onHover?.(blob.id),
    onMouseLeave: () => onHover?.(null),
  };
  if (blob.kind === 'center') {
    return (
      <div
        {...shared}
        role="group"
        aria-label={blob.ariaLabel}
        className={`overflow-hidden rounded-[40px] border-2 px-7 py-5 text-center shadow-sm motion-reduce:transition-none ${FOCUS_RING}`}
        style={{ backgroundColor: blob.fill, borderColor: blob.accent, width: blob.width, ...style }}
      >
        <div className="break-words font-bold leading-tight text-gray-900" style={{ fontSize: blob.fontSize }}>
          {blob.title}
        </div>
        {blob.subtitle && <div className="mt-1.5 text-base leading-snug text-gray-800">{blob.subtitle}</div>}
      </div>
    );
  }
  if (blob.kind === 'satellite') {
    return (
      <button
        {...shared}
        type="button"
        onClick={blob.onClick}
        aria-label={blob.ariaLabel}
        className={`inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-full border-2 bg-white px-3 py-2 text-center text-base font-medium text-gray-900 shadow-sm hover:shadow-md motion-reduce:transition-none ${FOCUS_RING}`}
        style={{ borderColor: blob.accent, width: blob.width, ...style }}
      >
        <span className="min-w-0 break-words text-center leading-tight" style={{ ...TWO_LINES, fontSize: blob.fontSize }}>{blob.title}</span>
        {blob.badge && (
          <span
            className="shrink-0 rounded-full border px-1.5 py-0.5 text-sm font-semibold leading-none"
            style={blob.badgeTone
              ? { backgroundColor: blob.badgeTone.background, color: blob.badgeTone.color, borderColor: blob.badgeTone.color }
              : { backgroundColor: '#ffffff', color: '#111827', borderColor: blob.accent }}
          >
            {blob.badge}
          </span>
        )}
      </button>
    );
  }
  return (
    <button
      {...shared}
      type="button"
      onClick={blob.onClick}
      aria-label={blob.ariaLabel}
      aria-pressed={blob.kind === 'primary' ? Boolean(blob.selected) : undefined}
      className={`overflow-hidden rounded-[28px] px-4 py-2.5 text-center text-gray-900 shadow-sm hover:shadow-md motion-reduce:transition-none ${FOCUS_RING} ${
        blob.kind === 'primary' ? 'border-2' : ''
      } ${blob.kind === 'more' ? 'whitespace-nowrap border border-dashed text-gray-800' : ''} ${
        blob.selected ? 'outline outline-[3px] outline-[#1E3A8A]' : ''
      }`}
      style={{ backgroundColor: blob.fill, borderColor: blob.kind === 'primary' ? blob.accent : blob.kind === 'more' ? blob.accent : undefined, width: blob.width, ...style }}
    >
      <span className="block break-words font-semibold leading-tight" style={blob.kind === 'more' ? { fontSize: blob.fontSize } : { fontSize: blob.fontSize, ...TWO_LINES }}>
        {blob.title}
      </span>
      {blob.subtitle && <span className="mt-1 block text-sm leading-snug text-gray-800">{blob.subtitle}</span>}
    </button>
  );
}

/** Pick a color for each subject on screen. Removing an entry goes back to the default. */
function ColorPanel({ items, colors, onChange, onClose }: {
  items: Array<{ id: string; title: string; swatch: string }>;
  colors: Record<string, string>;
  onChange: (colors: Record<string, string>) => void;
  onClose: () => void;
}) {
  const pick = (id: string, swatch: string | null) => {
    const next = { ...colors };
    if (swatch) next[id] = swatch;
    else delete next[id];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Colors</h2>
        <button type="button" onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900">
          Done
        </button>
      </div>
      <p className="text-sm text-gray-600">Colors show the subject area of a course or standard. Pick a color for each subject; your choices are saved to your account.</p>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-gray-800">{item.title}</span>
              {colors[item.id] && (
                <button type="button" onClick={() => pick(item.id, null)} className={`shrink-0 min-h-11 px-2 text-sm text-gray-800 hover:text-gray-950 ${FOCUS_RING}`}>
                  Reset
                </button>
              )}
            </div>
            <div role="radiogroup" aria-label={`Color for ${item.title}`} className="mt-1.5 flex flex-wrap gap-2">
              {SWATCH_NAMES.map((name, index) => (
                <label
                  key={name}
                  title={name}
                  className={`inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-[#1E3A8A] ${
                    item.swatch === name ? 'ring-2 ring-gray-900 ring-offset-2' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name={`map-color-${item.id}`}
                    value={name}
                    checked={item.swatch === name}
                    aria-label={name}
                    onChange={() => pick(item.id, name)}
                    onKeyDown={(event) => {
                      const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
                      if (!delta) return;
                      event.preventDefault();
                      const next = SWATCH_NAMES[(index + delta + SWATCH_NAMES.length) % SWATCH_NAMES.length]!;
                      pick(item.id, next);
                      const group = event.currentTarget.closest('[role="radiogroup"]');
                      requestAnimationFrame(() => group?.querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus());
                    }}
                    className="sr-only"
                  />
                  <span aria-hidden="true" className="h-8 w-8 rounded-full border-2" style={{ backgroundColor: SWATCHES[name]![0], borderColor: SWATCHES[name]![1] }} />
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {Object.keys(colors).length > 0 && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Reset all colors
        </button>
      )}
    </div>
  );
}

function ProjectList({
  projects,
  highlightedProjectId,
  onOpenProject,
}: {
  projects: MyMapProject[];
  highlightedProjectId?: string | null;
  onOpenProject?: (jobId: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {projects.map((p) => (
        <li
          key={p.jobId}
          className={`flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-2 ${
            p.jobId === highlightedProjectId ? 'bg-indigo-50 ring-2 ring-blue-900' : 'bg-gray-50'
          }`}
        >
          {onOpenProject ? (
            <button
              type="button"
              onClick={() => onOpenProject(p.jobId)}
              className={`text-left text-base font-medium text-indigo-800 underline-offset-2 hover:underline ${FOCUS_RING}`}
            >
              {p.label}
            </button>
          ) : (
            <span className="text-base font-medium text-gray-900">{p.label}</span>
          )}
          <GradeChip grade={p.grade} />
        </li>
      ))}
    </ul>
  );
}

function DetailHeader({ title, grade, onClose }: { title: string; grade?: number; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <h2 tabIndex={-1} className={`rounded-sm text-lg font-semibold text-gray-900 ${FOCUS_RING}`}>{title}</h2>
      <div className="flex shrink-0 items-center gap-1">
        <GradeChip grade={grade} />
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-800 hover:bg-gray-100 hover:text-gray-950 ${FOCUS_RING}`}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function DetailPanel({
  theme,
  standard,
  onSelectStandard,
  onClearStandard,
  highlightedProjectId,
  onOpenProject,
  onClose,
}: {
  theme: MyMapTheme;
  standard: MyMapStandard | null;
  onSelectStandard: (standard: MyMapStandard) => void;
  onClearStandard: () => void;
  highlightedProjectId?: string | null;
  onOpenProject?: (jobId: string) => void;
  onClose: () => void;
}) {
  if (standard) {
    const cutShort = standard.name.endsWith('…');
    return (
      <div className="space-y-3">
        <button type="button" onClick={onClearStandard} className={`inline-flex min-h-11 items-center gap-1 text-base text-indigo-800 hover:underline ${FOCUS_RING}`}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> All {plural(theme.standards.length, 'standard')}
        </button>
        {/* A name cut short with an ellipsis would only repeat the text below it, so lead with the code instead. */}
        <DetailHeader title={cutShort ? (standard.hasCode ? standard.code : 'Standard') : standard.name} grade={standard.averageGrade} onClose={onClose} />
        <p className="text-sm font-medium text-gray-800">
          {standard.hasCode && !cutShort && <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">{standard.code}</span>}
          {standard.subject}
        </p>
        {standard.description && standard.description !== standard.name && (
          <p className={cutShort ? 'text-base text-gray-800' : 'text-sm text-gray-700'}>{standard.description}</p>
        )}
        <h3 className="pt-2 text-sm font-semibold text-gray-800">
          Shown in {plural(standard.projectCount, 'project')}
        </h3>
        <ProjectList projects={standard.projects} highlightedProjectId={highlightedProjectId} onOpenProject={onOpenProject} />
      </div>
    );
  }

  const projects = new Map<string, MyMapProject>();
  for (const s of theme.standards) for (const p of s.projects) if (!projects.has(p.jobId)) projects.set(p.jobId, p);
  return (
    <div className="space-y-3">
      <DetailHeader title={theme.label} grade={theme.averageGrade} onClose={onClose} />
      <p className="text-base text-gray-800">
        {plural(theme.standards.length, 'standard')} across {plural(theme.projectCount, 'project')}. Pick a standard
        to find it on the map and see the work behind it.
      </p>
      <h3 className="pt-2 text-sm font-semibold text-gray-800">Standards</h3>
      <ul aria-label="Standards" className="space-y-1">
        {theme.standards.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelectStandard(item)}
              className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left hover:bg-indigo-50 ${FOCUS_RING}`}
            >
              <span className="block text-base font-medium text-gray-900">{item.name}</span>
              {item.hasCode && <span className="block font-mono text-sm text-gray-700">{item.code}</span>}
            </button>
          </li>
        ))}
      </ul>
      <h3 className="pt-2 text-sm font-semibold text-gray-800">Projects</h3>
      <ProjectList projects={[...projects.values()]} onOpenProject={onOpenProject} />
    </div>
  );
}
