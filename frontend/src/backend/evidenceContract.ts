/** Pure evidence response validation, usable without initializing a Firebase SDK. */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export type EvidenceContentType = "text/plain" | "application/pdf";
export interface TalaEvidenceUploadStatus {
  uploadId: string;
  status: "pending" | "uploaded" | "submitted";
  sha256: string;
  size: number;
  contentType: EvidenceContentType;
}

export class EvidenceContractError extends Error {
  constructor(readonly code: "INVALID_RESPONSE" | "CONFLICT") {
    super(
      code === "CONFLICT"
        ? "This upload has changed. Retry with the original file."
        : "The backend returned an unexpected record.",
    );
    this.name = "EvidenceContractError";
  }
}

/** A completed network reply never proves that it belongs to this file. */
export function validateEvidenceUploadStatus(
  raw: unknown,
  expected: Omit<TalaEvidenceUploadStatus, "status">,
): TalaEvidenceUploadStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new EvidenceContractError("INVALID_RESPONSE");
  const value = raw as Record<string, unknown>;
  if (
    value.uploadId !== expected.uploadId ||
    typeof value.uploadId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.uploadId) ||
    !["pending", "uploaded", "submitted"].includes(String(value.status)) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    (value.contentType !== "text/plain" &&
      value.contentType !== "application/pdf") ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > MAX_EVIDENCE_BYTES
  )
    throw new EvidenceContractError("INVALID_RESPONSE");
  if (
    value.sha256 !== expected.sha256 ||
    value.size !== expected.size ||
    value.contentType !== expected.contentType
  )
    throw new EvidenceContractError("CONFLICT");
  return {
    uploadId: expected.uploadId,
    status: value.status as TalaEvidenceUploadStatus["status"],
    sha256: value.sha256,
    size: value.size,
    contentType: value.contentType,
  };
}
