export interface DemoMeeting {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "reserved" | "cancelled";
}
export interface DemoMeetingSlot {
  startsAt: string;
  endsAt: string;
}

export function demoMeetingSlots(now = new Date()): DemoMeetingSlot[] {
  const slots: DemoMeetingSlot[] = [];
  for (let day = 1; day <= 3; day++) {
    for (const hour of [11, 14]) {
      const start = new Date(now);
      start.setDate(start.getDate() + day);
      start.setHours(hour, 0, 0, 0);
      slots.push({
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      });
    }
  }
  return slots;
}

// A demo identity partitions browser fixtures; this is not authentication or RBAC.
// Do not put account names, emails, passwords or meeting content in the record.
export async function demoMeetingStorageKey(identity: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity.trim().toLowerCase()),
  );
  return `tala.demo-meetings.v1.${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function supported(value: unknown): value is DemoMeeting {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length <= 80 &&
    typeof item.startsAt === "string" &&
    typeof item.endsAt === "string" &&
    Number.isFinite(Date.parse(item.startsAt)) &&
    Date.parse(item.endsAt) - Date.parse(item.startsAt) === 30 * 60_000 &&
    (item.status === "reserved" || item.status === "cancelled")
  );
}

export function readDemoMeeting(key: string): DemoMeeting | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!supported(value)) throw new Error();
    return value;
  } catch {
    throw new Error(
      "The saved demo booking could not be read. Allow browser storage or clear this demo booking and try again.",
    );
  }
}

export function saveDemoMeeting(
  key: string,
  next: DemoMeeting,
  expected: DemoMeeting | null,
): void {
  if (!supported(next))
    throw new Error("Choose a supported demo meeting time.");
  if (JSON.stringify(readDemoMeeting(key)) !== JSON.stringify(expected))
    throw new Error(
      "This demo booking changed in another tab. Refresh before trying again.",
    );
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    throw new Error(
      "The demo booking could not be saved. Allow browser storage and try again.",
    );
  }
}

export function clearDemoMeeting(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    throw new Error("This browser could not clear the demo booking.");
  }
}
