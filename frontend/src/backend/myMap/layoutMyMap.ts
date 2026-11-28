/**
 * Collision-free placement for My Map blobs.
 *
 * Primaries that share a cluster pack into a loose wedge around the center,
 * heaviest first and closest in, instead of sitting on even rings. Satellites
 * fan out behind their parent. Overlapping boxes are then pushed apart while a
 * weak spring pulls each blob back toward its spot, so nothing covers text.
 */

export interface LayoutBox {
  id: string;
  /** Preferred center. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fixed boxes (the center) never move. */
  fixed?: boolean;
}

export interface Placed {
  x: number;
  y: number;
}

const GAP = 10;
const ITERATIONS = 400;
const SPRING = 0.04;
// The pull home fades out, and the final passes only separate, so overlaps can't survive
// once the canvas has room for every blob.
const SPRING_UNTIL = 0.7;

export function relax(boxes: LayoutBox[], bounds: { width: number; height: number }): Map<string, Placed> {
  const pos = boxes.map((b) => ({ x: b.x, y: b.y }));

  const clamp = (i: number) => {
    const b = boxes[i]!;
    const point = pos[i]!;
    point.x = Math.min(bounds.width - b.width / 2 - 4, Math.max(b.width / 2 + 4, point.x));
    point.y = Math.min(bounds.height - b.height / 2 - 4, Math.max(b.height / 2 + 4, point.y));
  };

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const pointA = pos[i]!;
        const pointB = pos[j]!;
        let dx = pointB.x - pointA.x;
        let dy = pointB.y - pointA.y;
        const overlapX = (a.width + b.width) / 2 + GAP - Math.abs(dx);
        const overlapY = (a.height + b.height) / 2 + GAP - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (dx === 0 && dy === 0) {
          // Stacked exactly: pick a direction from the pair so they still spread out.
          const angle = (i * 7 + j * 13) * 2.399963;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
        }
        // Push apart along the line between centers (so a clump spreads in every
        // direction), just far enough to clear on whichever axis clears first.
        const length = Math.hypot(dx, dy);
        const ux = dx / length;
        const uy = dy / length;
        const clear = Math.min(
          Math.abs(ux) > 1e-6 ? overlapX / Math.abs(ux) : Infinity,
          Math.abs(uy) > 1e-6 ? overlapY / Math.abs(uy) : Infinity,
        );
        const push = clear / 2;
        const shareA = a.fixed ? 0 : b.fixed ? 2 : 1;
        const shareB = b.fixed ? 0 : a.fixed ? 2 : 1;
        pointA.x -= ux * push * shareA;
        pointA.y -= uy * push * shareA;
        pointB.x += ux * push * shareB;
        pointB.y += uy * push * shareB;
      }
    }
    const progress = iter / ITERATIONS;
    const spring = progress < SPRING_UNTIL ? SPRING * (1 - progress / SPRING_UNTIL) : 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      const point = pos[i]!;
      if (box.fixed) continue;
      point.x += (box.x - point.x) * spring;
      point.y += (box.y - point.y) * spring;
      clamp(i);
    }
  }

  return new Map(boxes.map((b, i) => [b.id, pos[i]!]));
}

export interface MapNode {
  id: string;
  kind: 'center' | 'primary' | 'satellite' | 'more';
  parentId?: string;
  /** Shared group. Courses use a skill, standards inside a course use a topic. */
  cluster?: string;
  weight?: number;
  width: number;
  height: number;
}

const EDGE = 36;

function hash01(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 1000) / 1000;
}

function hits(
  occupied: Array<{ x: number; y: number; w: number; h: number }>,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  return occupied.some((box) =>
    Math.abs(x - box.x) < (w + box.w) / 2 + GAP && Math.abs(y - box.y) < (h + box.h) / 2 + GAP);
}

/** Distance along `angle` at which two boxes stop overlapping. */
function clearDistance(angle: number, reachX: number, reachY: number): number {
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const alongX = cos > 1e-3 ? reachX / cos : Infinity;
  const alongY = sin > 1e-3 ? reachY / sin : Infinity;
  return Math.min(alongX, alongY);
}

function overlaps(boxes: LayoutBox[], placed: Map<string, Placed>): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const boxA = boxes[i]!;
      const boxB = boxes[j]!;
      const a = placed.get(boxA.id)!;
      const b = placed.get(boxB.id)!;
      const apartX = Math.abs(a.x - b.x) >= (boxA.width + boxB.width) / 2 + GAP - 1;
      const apartY = Math.abs(a.y - b.y) >= (boxA.height + boxB.height) / 2 + GAP - 1;
      if (!apartX && !apartY) return true;
    }
  }
  return false;
}

/**
 * Packs each cluster into its own wedge around the center. The heaviest node
 * in a wedge lands closest to the middle, and the rest fill in beside it.
 */
export function layoutScene(nodes: MapNode[]): { width: number; height: number; placed: Map<string, Placed> } {
  const center = nodes.find((node) => node.kind === 'center');
  const primaries = nodes.filter((node) => node.kind === 'primary');
  const more = nodes.find((node) => node.kind === 'more');
  const groups = new Map<string, MapNode[]>();
  for (const node of primaries) {
    const key = node.cluster || 'other';
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const clusters = [...groups.entries()]
    .map(([id, members]) => ({
      id,
      members: [...members].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.id.localeCompare(b.id)),
      weight: members.reduce((sum, node) => sum + (node.weight ?? 0), 0),
    }))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

  const spot = new Map<string, { x: number; y: number; angle: number }>();
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (center) occupied.push({ x: 0, y: 0, w: center.width, h: center.height });

  const wedge = (Math.PI * 2) / Math.max(clusters.length, 1);
  clusters.forEach((cluster, index) => {
    const base = -Math.PI / 2 + index * wedge + (hash01(cluster.id) - 0.5) * Math.min(0.35, wedge * 0.2);
    const half = wedge * 0.46;
    for (const node of cluster.members) {
      let placedNode = false;
      for (let step = 0; step < 700 && !placedNode; step++) {
        const samples = Math.max(1, Math.ceil((half * 2 * Math.max(step * 8, 24)) / 18));
        for (let sample = 0; sample < samples && !placedNode; sample++) {
          const t = samples === 1 ? 0 : (sample / (samples - 1)) * 2 - 1;
          const angle = base + t * half;
          const reachX = (center?.width ?? 0) / 2 + node.width / 2 + GAP;
          const reachY = (center?.height ?? 0) / 2 + node.height / 2 + GAP;
          const radius = clearDistance(angle, reachX, reachY) + step * 8;
          const x = radius * Math.cos(angle);
          const y = radius * Math.sin(angle);
          if (hits(occupied, x, y, node.width, node.height)) continue;
          occupied.push({ x, y, w: node.width, h: node.height });
          spot.set(node.id, { x, y, angle });
          placedNode = true;
        }
      }
    }
  });

  const siblings = new Map<string, MapNode[]>();
  for (const node of nodes) {
    if (node.kind === 'satellite' && node.parentId) {
      siblings.set(node.parentId, [...(siblings.get(node.parentId) ?? []), node]);
    }
  }
  for (const [parentId, group] of siblings) {
    const parentSpot = spot.get(parentId);
    const parent = nodes.find((node) => node.id === parentId);
    if (!parentSpot || !parent) continue;
    group.forEach((node, i) => {
      const angle = parentSpot.angle + (i - (group.length - 1) / 2) * 0.55;
      const reachX = (parent.width + node.width) / 2 + GAP;
      const reachY = (parent.height + node.height) / 2 + GAP;
      let x = parentSpot.x;
      let y = parentSpot.y;
      for (let extra = 0; extra < 500; extra += 8) {
        const dist = clearDistance(angle, reachX, reachY) + 4 + extra;
        x = parentSpot.x + dist * Math.cos(angle);
        y = parentSpot.y + dist * Math.sin(angle);
        if (!hits(occupied, x, y, node.width, node.height)) break;
      }
      occupied.push({ x, y, w: node.width, h: node.height });
      spot.set(node.id, { x, y, angle });
    });
  }

  if (more) {
    let maxY = (center?.height ?? 0) / 2;
    for (const box of occupied) maxY = Math.max(maxY, box.y + box.h / 2);
    spot.set(more.id, { x: 0, y: maxY + more.height / 2 + GAP, angle: Math.PI / 2 });
  }

  const draft: LayoutBox[] = nodes.map((node) => {
    const at = node.kind === 'center' ? { x: 0, y: 0 } : spot.get(node.id) ?? { x: 0, y: 0 };
    return { id: node.id, x: at.x, y: at.y, width: node.width, height: node.height, fixed: node.kind === 'center' };
  });

  let pad = EDGE;
  let width = 880;
  let height = 640;
  let placed = new Map<string, Placed>();
  for (let attempt = 0; attempt < 4; attempt++) {
    let maxX = 0;
    let maxY = 0;
    for (const box of draft) {
      maxX = Math.max(maxX, Math.abs(box.x) + box.width / 2);
      maxY = Math.max(maxY, Math.abs(box.y) + box.height / 2);
    }
    width = Math.max(640, Math.ceil((maxX + pad) * 2));
    height = Math.max(480, Math.ceil((maxY + pad) * 2));
    const shifted = draft.map((box) => ({ ...box, x: box.x + width / 2, y: box.y + height / 2 }));
    placed = relax(shifted, { width, height });
    if (!overlaps(shifted, placed)) break;
    pad += 140;
  }

  return { width, height, placed };
}

/** Rough rendered size of a blob, so layout can run before anything is drawn. */
export function measure(
  title: string,
  subtitle: string | undefined,
  fontSize: number,
  maxWidth: number,
  padX = 16,
  padY = 10,
  options?: { titleFactor?: number; subtitleFont?: number; fitLongestWord?: boolean; maxTitleLines?: number },
): { width: number; height: number } {
  const charWidth = fontSize * (options?.titleFactor ?? 0.6);
  const subChar = (options?.subtitleFont ?? 12) * 0.55;
  const longest = title.split(/\s+/).reduce((max, word) => Math.max(max, word.length * charWidth), 0);
  const subWidth = (subtitle?.length ?? 0) * subChar;
  // With a line limit, grow wide enough that the title fits in that many lines
  // (plus slack, since a line can't break mid-word) instead of running long.
  const maxLines = options?.maxTitleLines;
  const titleNeed = maxLines ? (title.length * charWidth) / maxLines + charWidth * 9 : title.length * charWidth;
  const natural = Math.max(Math.min(title.length * charWidth, titleNeed), subWidth, longest) + padX * 2;
  const capped = Math.min(maxWidth, Math.max(56, natural));
  // A capped width can be narrower than one word. Grow for that word so the
  // title stays inside the node instead of painting past the edge.
  const width = options?.fitLongestWord ? Math.max(capped, longest + padX * 2) : capped;
  const inner = Math.max(1, width - padX * 2);
  const wanted = Math.max(1, Math.ceil((title.length * charWidth) / inner));
  const titleLines = maxLines ? Math.min(maxLines, wanted) : wanted;
  const subLines = subtitle ? Math.max(1, Math.ceil(subWidth / inner)) : 0;
  const subLineHeight = (options?.subtitleFont ?? 12) * 1.35;
  const height = titleLines * fontSize * 1.2 + subLines * subLineHeight + (subtitle ? 4 : 0) + padY * 2;
  return { width, height };
}
