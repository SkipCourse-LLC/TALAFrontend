// Frontend view models only. These are NOT a confirmed SkipCourse API schema.
export type CommunityRole = "Student" | "Parent" | "Alumni" | "Staff";
export interface DemoSession {
  role?: CommunityRole;
  representing?: string;
  studentName?: string;
  studentEmail?: string;
  mode: "demo";
  name: string;
  email: string;
}
export type DemoScenario = "success" | "empty" | "error" | "loading";
export interface AuthAdapter {
  login(
    email: string,
    password: string,
    name?: string,
    simulateError?: boolean,
    signal?: AbortSignal,
  ): Promise<DemoSession>;
}
