import { expect, test } from "@playwright/test";
import {
  authErrorMessage,
  demoAuthAdapter,
} from "../src/authentication/demoAuthAdapter";
import {
  createMockEnrollmentService,
  enrollmentErrorMessage,
  validateEnrollment,
} from "../src/registration/enrollmentContract";
import type { EnrollmentDraft } from "../src/registration/enrollmentContract";
import {
  createMockScheduleService,
  scheduleErrorMessage,
} from "../src/classes/scheduleAdapter";
import type { ClassSlot } from "../src/classes/scheduleAdapter";
import { demoClassSlots } from "../src/classes/demoClassSlots";
import { courseProgress } from "../src/dashboard/courseProgress";
import { learningErrorMessage } from "../src/dashboard/learningErrors";

const signal = () => new AbortController().signal;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function draft(): EnrollmentDraft {
  return {
    parentName: " Taylor Parent ",
    parentEmail: " taylor@example.com ",
    password: "made-up-only",
    confirmPassword: "made-up-only",
    studentName: " Jordan Learner ",
    studentEmail: " jordan@example.com ",
    learningMode: "Hybrid",
    timeBlock: "8–10 AM",
    intent: "Enrollment",
    documentsAcknowledged: true,
    funding: "ESA",
    fundingAcknowledged: true,
  };
}
const available = demoClassSlots.filter((slot) => slot.status === "Available");

test("demo sign-in normalizes identity and never returns the supplied password", async () => {
  const result = await demoAuthAdapter.login(
    " sample@example.com ",
    "made-up-only",
    " Alex Sample ",
    false,
    signal(),
  );
  expect(result).toEqual({
    mode: "demo",
    email: "sample@example.com",
    name: "Alex Sample",
  });
  expect(JSON.stringify(result)).not.toContain("made-up-only");
});

test("sign-in cancellation rejects before an identity can be returned", async () => {
  const controller = new AbortController();
  const result = demoAuthAdapter.login(
    "sample@example.com",
    "",
    undefined,
    false,
    controller.signal,
  );
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  await expect(
    demoAuthAdapter.login(
      "sample@example.com",
      "",
      undefined,
      false,
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("unknown authentication errors are not displayed as raw server details", () => {
  expect(authErrorMessage(new Error("private-service-detail"))).not.toContain(
    "private-service-detail",
  );
  expect(authErrorMessage(null)).toContain("try again");
  expect(
    enrollmentErrorMessage(new Error("private-service-detail")),
  ).not.toContain("private-service-detail");
  expect(
    learningErrorMessage(new Error("private-service-detail")),
  ).not.toContain("private-service-detail");
});

test("enrollment validates actual choices, not arbitrary nonempty values", () => {
  for (const [key, step] of [
    ["learningMode", 2],
    ["timeBlock", 2],
    ["intent", 2],
    ["funding", 4],
  ] as const) {
    expect(
      validateEnrollment({ ...draft(), [key]: "invalid choice" }, step)[key],
    ).toBeTruthy();
  }
  for (let step = 0; step < 5; step++)
    expect(validateEnrollment(draft(), step)).toEqual({});
});

test("enrollment snapshots the submitted choices and returns only safe receipt metadata", async () => {
  const gate = deferred();
  const service = createMockEnrollmentService({ delay: () => gate.promise });
  const original = draft();
  const pending = service.submit(original, false, signal());
  original.parentName = "Changed while pending";
  original.funding = "Private";
  gate.resolve();
  const receipt = await pending;
  expect(receipt).toMatchObject({
    parentName: "Taylor Parent",
    funding: "ESA",
    learningMode: "Hybrid",
    timeBlock: "8–10 AM",
    intent: "Enrollment",
  });
  expect(Object.keys(receipt).sort()).toEqual(
    [
      "funding",
      "intent",
      "learningMode",
      "parentEmail",
      "parentName",
      "studentEmail",
      "studentName",
      "timeBlock",
    ].sort(),
  );
});

test("enrollment ignores completion from a service that does not cooperate with abort", async () => {
  const gate = deferred();
  const service = createMockEnrollmentService({ delay: () => gate.promise });
  const controller = new AbortController();
  const pending = service.submit(draft(), false, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  gate.resolve();
  await rejected;
});

test("disabled enrollment never falls through to a guessed backend", async () => {
  let called = false;
  const service = createMockEnrollmentService({
    enabled: false,
    delay: async () => {
      called = true;
    },
  });
  await expect(service.submit(draft(), false, signal())).rejects.toThrow();
  expect(called).toBe(false);
});

test("class joins are locked per student and an existing selection is idempotent", async () => {
  const gate = deferred();
  const service = createMockScheduleService({
    storage: null,
    wait: () => gate.promise,
  });
  const pending = service.join("alex@example.com", available[0]!.id);
  await expect(
    service.join("alex@example.com", available[0]!.id),
  ).rejects.toMatchObject({ code: "busy" });
  gate.resolve();
  const once = await pending;
  expect(await service.join("alex@example.com", available[0]!.id)).toEqual(
    once,
  );
  expect(once).toHaveLength(1);
});

test("an aborted class join cannot overwrite a newer selection even when wait ignores cancellation", async () => {
  const gates = [deferred(), deferred()];
  let waitCall = 0;
  const service = createMockScheduleService({
    storage: null,
    wait: () => gates[waitCall++]!.promise,
  });
  const controller = new AbortController();
  const old = service.join(
    "alex@example.com",
    available[0]!.id,
    false,
    controller.signal,
  );
  const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  const next = service.join("alex@example.com", available[1]!.id);
  gates[1]!.resolve();
  expect(await next).toEqual([available[1]!.id]);
  gates[0]!.resolve();
  await rejected;
});

test("schedule storage rejects unknown, full and duplicated IDs and separates learners", async () => {
  const values = new Map<string, string>();
  values.set(
    "tala.demo.classes.alex@example.com",
    JSON.stringify([
      available[0]!.id,
      available[0]!.id,
      "unknown",
      demoClassSlots.find((slot) => slot.status === "Full")!.id,
    ]),
  );
  const service = createMockScheduleService({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    wait: async () => {},
  });
  expect(
    (await service.load("alex@example.com", "success", signal())).joined,
  ).toEqual([available[0]!.id]);
  const client = await service.load("alex@example.com", "success", signal());
  (client.slots as ClassSlot[]).length = 0;
  expect(
    (await service.load("alex@example.com", "success", signal())).slots,
  ).toHaveLength(demoClassSlots.length);
  expect(
    (await service.load("jordan@example.com", "success", signal())).joined,
  ).toEqual([]);
});

test("blocked storage preserves in-memory selections without exposing mutable joined arrays", async () => {
  const service = createMockScheduleService({
    storage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    },
    wait: async () => {},
  });
  const result = await service.join("alex@example.com", available[0]!.id);
  result.length = 0;
  expect(
    (await service.load("alex@example.com", "success", signal())).joined,
  ).toEqual([available[0]!.id]);
});

test("full classes and disabled scheduling remain unavailable and errors are safe", async () => {
  const service = createMockScheduleService({
    storage: null,
    wait: async () => {},
  });
  await expect(
    service.join(
      "alex@example.com",
      demoClassSlots.find((slot) => slot.status === "Full")!.id,
    ),
  ).rejects.toMatchObject({ code: "class_unavailable" });
  await expect(
    createMockScheduleService({ enabled: false }).load(
      "alex@example.com",
      "success",
      signal(),
    ),
  ).rejects.toMatchObject({ code: "unavailable" });
  expect(
    scheduleErrorMessage(new Error("private-service-detail")),
  ).not.toContain("private-service-detail");
});

test("progress stays meaningful for empty courses and incomplete adapter data", () => {
  expect(courseProgress({ completed: 10, lessons: [] })).toEqual({
    total: 0,
    completed: 0,
    percent: null,
  });
  const lessons = ["Sample lesson"];
  expect(courseProgress({ completed: Number.NaN, lessons }).percent).toBe(0);
  expect(courseProgress({ completed: 100, lessons }).percent).toBe(100);
  expect(courseProgress({ completed: -5, lessons }).percent).toBe(0);
});
