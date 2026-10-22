import { demoClassSlots } from "./demoClassSlots";

export type ClassSlot = (typeof demoClassSlots)[number];
export type ScheduleScenario = "success" | "loading" | "empty" | "error";
export interface ScheduleData {
  slots: readonly ClassSlot[];
  joined: string[];
}
export interface ScheduleService {
  load(
    student: string,
    scenario: ScheduleScenario,
    signal: AbortSignal,
  ): Promise<ScheduleData>;
  join(
    student: string,
    classId: string,
    simulateError?: boolean,
    signal?: AbortSignal,
  ): Promise<string[]>;
}
type ScheduleErrorCode =
  "unavailable" | "load_failed" | "join_failed" | "class_unavailable" | "busy";
const messages: Record<ScheduleErrorCode, string> = {
  unavailable: "Scheduling is not connected. This preview requires demo mode.",
  load_failed: "The demo schedule could not load. Please retry.",
  join_failed:
    "The class was not added. Turn off the test error and try again.",
  class_unavailable: "This class is not available. Choose another class.",
  busy: "A class is already being added. Please wait before trying again.",
};
export class ScheduleError extends Error {
  constructor(readonly code: ScheduleErrorCode) {
    super(messages[code]);
    this.name = "ScheduleError";
  }
}
export function scheduleErrorMessage(error: unknown): string {
  return error instanceof ScheduleError && Object.hasOwn(messages, error.code)
    ? messages[error.code]
    : "Your schedule could not be updated. Please try again.";
}
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
export interface MockScheduleOptions {
  enabled?: boolean;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
// Local demo selections are not school bookings or a real scheduling API.
export function createMockScheduleService(
  options: MockScheduleOptions = {},
): ScheduleService {
  const selections = new Map<string, string[]>();
  const active = new Map<string, symbol>();
  const pause = options.wait ?? wait;
  function storage() {
    if (options.storage !== undefined) return options.storage;
    try {
      return globalThis.sessionStorage;
    } catch {
      return null;
    }
  }
  function requireDemo() {
    if (options.enabled === false) throw new ScheduleError("unavailable");
  }
  function read(student: string): string[] {
    const cached = selections.get(student);
    if (cached) return [...cached];
    try {
      const value: unknown = JSON.parse(
        storage()?.getItem(`tala.demo.classes.${student}`) ?? "[]",
      );
      if (Array.isArray(value))
        return [
          ...new Set(
            value.filter(
              (id): id is string =>
                typeof id === "string" &&
                demoClassSlots.some(
                  (slot) => slot.id === id && slot.status === "Available",
                ),
            ),
          ),
        ];
    } catch {
      /* A blocked or malformed store falls back to this module's memory. */
    }
    return [];
  }
  return {
    async load(student, scenario, signal) {
      requireDemo();
      signal.throwIfAborted();
      await pause(scenario === "loading" ? 4000 : 400, signal);
      signal.throwIfAborted();
      if (scenario === "error") throw new ScheduleError("load_failed");
      return {
        slots: scenario === "empty" ? [] : structuredClone(demoClassSlots),
        joined: read(student),
      };
    },
    async join(
      student,
      classId,
      simulateError,
      signal = new AbortController().signal,
    ) {
      requireDemo();
      signal.throwIfAborted();
      const slot = demoClassSlots.find((item) => item.id === classId);
      if (!slot || slot.status !== "Available")
        throw new ScheduleError("class_unavailable");
      if (active.has(student)) throw new ScheduleError("busy");
      const previous = read(student);
      if (previous.includes(classId)) return previous;
      const attempt = Symbol("demo-class-selection");
      active.set(student, attempt);
      const release = () => {
        if (active.get(student) === attempt) active.delete(student);
      };
      signal.addEventListener("abort", release, { once: true });
      try {
        await pause(600, signal);
        signal.throwIfAborted();
        if (active.get(student) !== attempt)
          throw new DOMException("Cancelled", "AbortError");
        if (simulateError) throw new ScheduleError("join_failed");
        const joined = read(student);
        const next = joined.includes(classId) ? joined : [...joined, classId];
        selections.set(student, next);
        try {
          storage()?.setItem(
            `tala.demo.classes.${student}`,
            JSON.stringify(next),
          );
        } catch {
          /* Keep the in-memory demo usable. */
        }
        return [...next];
      } finally {
        signal.removeEventListener("abort", release);
        release();
      }
    },
  };
}
