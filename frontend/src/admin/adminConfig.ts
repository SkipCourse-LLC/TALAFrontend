import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

export const TALA_COMPANY = "Tucson Adaptive Learning Academy";
export const TALA_PROVIDER = "tala";
export const TALA_ADMIN_ROLE = "talaadmin";

// Firestore collections shared with the central skip-class-slsru4 project.
export const DRAFTS_COLLECTION = "tala_drafts";
export const PUBLISHED_COLLECTION = "jobs";
export const UPLOADS_PREFIX = "tala_uploads";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Must match the allowlist in docs/firebase-rules-snippet.md.
export const TALA_ADMIN_EMAILS = ["karl@skipcourse.com"];

export type ContentKind = "event" | "opportunity";

export type DraftFields = {
  title: string;
  kind: ContentKind;
  category: string;
  estimatedDuration: string;
  slug: string;
  summary: string;
  problemStatement: string;
  requirements: string;
  providedMaterials: string;
  skillsRequired: string[];
  date: string;
  iso: string;
  location: string;
  schedule: string[];
  links: string[];
  fileUrls: string[];
  fileNames: string[];
};

export type TalaDraft = DraftFields & {
  id: string;
  createdAt: string;
  updatedAt: string;
  publishedJobId?: string | null;
  publicationStatus?: "active" | "inactive" | null;
};

export const emptyFields: DraftFields = {
  title: "",
  kind: "event",
  category: "",
  estimatedDuration: "",
  slug: "",
  summary: "",
  problemStatement: "",
  requirements: "",
  providedMaterials: "",
  skillsRequired: [],
  date: "",
  iso: "",
  location: "",
  schedule: [],
  links: [],
  fileUrls: [],
  fileNames: [],
};

const LIST_KEYS = [
  "skillsRequired",
  "schedule",
  "links",
  "fileUrls",
  "fileNames",
] as const;

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Keeps only schema fields so stray stored data is never republished. */
export function draftFields(data: Record<string, unknown>): DraftFields {
  const next: Record<string, unknown> = { ...emptyFields };
  for (const key of Object.keys(emptyFields))
    if (data[key] !== undefined) next[key] = data[key];
  for (const key of LIST_KEYS) next[key] = strings(data[key]);
  next.kind = data.kind === "opportunity" ? "opportunity" : "event";
  return next as DraftFields;
}

export async function hasTalaAdminAccess(user: User) {
  const email = user.email?.trim().toLowerCase();
  if (!email || !TALA_ADMIN_EMAILS.includes(email)) return false;
  if (!db) throw new Error("Firebase is not configured.");
  const profile = await getDoc(doc(db, "users", user.uid));
  return profile.exists() && profile.data().role === TALA_ADMIN_ROLE;
}

export async function requireTalaAdmin(user: User | null) {
  if (!user || !(await hasTalaAdminAccess(user)))
    throw new Error("Your account is not authorized to manage TALA content.");
}

export function isImageFile(url: string, name?: string) {
  const image = /\.(jpe?g|png|gif|webp|avif)$/i;
  if (name && image.test(name.trim())) return true;
  try {
    return image.test(decodeURIComponent(url.split(/[?#]/)[0] ?? ""));
  } catch {
    return false;
  }
}

export function safeHref(value: string) {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
}
