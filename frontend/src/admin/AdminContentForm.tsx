import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { User } from "firebase/auth";
import { collection, doc, runTransaction } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import {
  DRAFTS_COLLECTION,
  MAX_UPLOAD_BYTES,
  PUBLISHED_COLLECTION,
  TALA_COMPANY,
  TALA_PROVIDER,
  UPLOADS_PREFIX,
  draftFields,
  emptyFields,
  isImageFile,
  requireTalaAdmin,
  safeHref,
  type ContentKind,
  type DraftFields,
  type TalaDraft,
} from "./adminConfig";

type Props = {
  draft: TalaDraft | null;
  user: User;
  onSaved: (draft: TalaDraft) => void;
  onPublished: (draftId: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

type TextKey =
  "summary" | "problemStatement" | "requirements" | "providedMaterials";
type ListKey = "skillsRequired" | "schedule" | "links";

export default function AdminContentForm({
  draft,
  user,
  onSaved,
  onPublished,
  onCancel,
  onError,
}: Props) {
  const [fields, setFields] = useState<DraftFields>(() =>
    draft ? draftFields(draft) : emptyFields,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isEvent = fields.kind === "event";

  const change = <K extends keyof DraftFields>(key: K, value: DraftFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  function database() {
    if (!db) throw new Error("Firebase is not configured.");
    return db;
  }

  async function persistDraft() {
    const firestore = database();
    await requireTalaAdmin(user);
    const now = new Date().toISOString();
    const draftRef = draft
      ? doc(firestore, DRAFTS_COLLECTION, draft.id)
      : doc(collection(firestore, DRAFTS_COLLECTION));
    return runTransaction(firestore, async (transaction) => {
      const snapshot = draft ? await transaction.get(draftRef) : null;
      const current = snapshot?.exists() ? snapshot.data() : {};
      const data = {
        ...current,
        ...fields,
        companyName: TALA_COMPANY,
        provider: TALA_PROVIDER,
        status: "draft",
        submittedBy: user.uid,
        submitterEmail: user.email ?? "",
        createdAt: current.createdAt ?? now,
        updatedAt: now,
        publishedJobId: current.publishedJobId ?? null,
        publicationStatus:
          current.publicationStatus ??
          (current.publishedJobId ? "active" : null),
      };
      transaction.set(draftRef, data);
      return { ...data, id: draftRef.id } as unknown as TalaDraft;
    });
  }

  // Runs an action with shared busy/error handling.
  async function run(failure: string, action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const saveDraft = (event?: FormEvent) => {
    event?.preventDefault();
    return run("Unable to save draft.", async () => {
      onSaved(await persistDraft());
      setMessage("Draft saved.");
    });
  };

  const publish = () =>
    run("Unable to publish.", async () => {
      if (!fields.title.trim())
        throw new Error("Enter a title before publishing.");
      const firestore = database();
      const saved = await persistDraft();
      onSaved(saved);
      const now = new Date().toISOString();
      const draftRef = doc(firestore, DRAFTS_COLLECTION, saved.id);
      await runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(draftRef);
        if (!snapshot.exists()) throw new Error("Draft no longer exists.");
        const current = snapshot.data();
        const jobRef = doc(
          firestore,
          PUBLISHED_COLLECTION,
          current.publishedJobId || draftRef.id,
        );
        transaction.set(jobRef, {
          ...draftFields(current),
          companyName: TALA_COMPANY,
          provider: TALA_PROVIDER,
          status: "active",
          submittedBy: user.uid,
          submitterEmail: user.email ?? "",
          createdAt: current.createdAt,
          updatedAt: now,
        });
        transaction.update(draftRef, {
          publishedJobId: jobRef.id,
          publicationStatus: "active",
          updatedAt: now,
        });
      });
      onPublished(saved.id);
    });

  const unpublish = () =>
    run("Unable to unpublish.", async () => {
      if (!draft) return;
      const firestore = database();
      await persistDraft();
      const now = new Date().toISOString();
      const draftRef = doc(firestore, DRAFTS_COLLECTION, draft.id);
      const updated = await runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(draftRef);
        if (!snapshot.exists()) throw new Error("Draft no longer exists.");
        const current = snapshot.data();
        if (current.publishedJobId)
          transaction.update(
            doc(firestore, PUBLISHED_COLLECTION, current.publishedJobId),
            { status: "inactive", updatedAt: now },
          );
        const next = {
          ...current,
          publicationStatus: current.publishedJobId
            ? "inactive"
            : (current.publicationStatus ?? null),
          updatedAt: now,
        };
        transaction.set(draftRef, next);
        return { ...next, id: draftRef.id } as unknown as TalaDraft;
      });
      onSaved(updated);
      setMessage("Removed from public listings. The draft is preserved.");
    });

  const deletePublished = () => {
    if (
      !draft ||
      !window.confirm(
        "Permanently delete the published record? The draft will remain.",
      )
    )
      return Promise.resolve();
    return run("Unable to delete the published record.", async () => {
      const firestore = database();
      await persistDraft();
      const draftRef = doc(firestore, DRAFTS_COLLECTION, draft.id);
      const updated = await runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(draftRef);
        if (!snapshot.exists()) throw new Error("Draft no longer exists.");
        const current = snapshot.data();
        if (current.publishedJobId)
          transaction.delete(
            doc(firestore, PUBLISHED_COLLECTION, current.publishedJobId),
          );
        const next = {
          ...current,
          publishedJobId: null,
          publicationStatus: null,
          updatedAt: new Date().toISOString(),
        };
        transaction.set(draftRef, next);
        return { ...next, id: draftRef.id } as unknown as TalaDraft;
      });
      onSaved(updated);
      setMessage("Published record deleted. The draft is preserved.");
    });
  };

  const uploadFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return Promise.resolve();
    return run("Unable to upload file.", async () => {
      await requireTalaAdmin(user);
      if (!storage) throw new Error("Firebase Storage is not configured.");
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES)
          throw new Error(`${file.name} is larger than 10 MB.`);
        if (!file.type.startsWith("image/") && file.type !== "application/pdf")
          throw new Error(`${file.name} must be an image or PDF.`);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileRef = ref(
          storage,
          `${UPLOADS_PREFIX}/${user.uid}/${Date.now()}-${safeName}`,
        );
        await uploadBytes(fileRef, file, { contentType: file.type });
        const url = await getDownloadURL(fileRef);
        setFields((current) => ({
          ...current,
          fileUrls: [...current.fileUrls, url],
          fileNames: [...current.fileNames, file.name],
        }));
      }
      setMessage("Upload complete. Save the draft to keep the file links.");
    });
  };

  function removeFile(index: number) {
    setFields((current) => ({
      ...current,
      fileUrls: current.fileUrls.filter((_, i) => i !== index),
      fileNames: current.fileNames.filter((_, i) => i !== index),
    }));
    setMessage("File removed. Save the draft to keep this change.");
  }

  const textArea = (label: string, key: TextKey) => (
    <div className="admin-field">
      <label htmlFor={`admin-${key}`}>{label}</label>
      <textarea
        id={`admin-${key}`}
        rows={key === "summary" ? 3 : 5}
        value={fields[key]}
        onChange={(event) => change(key, event.target.value)}
      />
    </div>
  );
  const listArea = (label: string, key: ListKey) => (
    <div className="admin-field">
      <label htmlFor={`admin-${key}`}>
        {label} <span className="admin-hint">(one per line)</span>
      </label>
      <textarea
        id={`admin-${key}`}
        rows={3}
        value={fields[key].join("\n")}
        onChange={(event) => change(key, event.target.value.split("\n"))}
      />
    </div>
  );
  const textInput = (
    label: string,
    key:
      "title" | "category" | "estimatedDuration" | "slug" | "date" | "location",
    extra?: { required?: boolean; wide?: boolean },
  ) => (
    <div className={`admin-field${extra?.wide ? " admin-wide" : ""}`}>
      <label htmlFor={`admin-${key}`}>{label}</label>
      <input
        id={`admin-${key}`}
        required={extra?.required}
        value={fields[key]}
        onChange={(event) => change(key, event.target.value)}
      />
    </div>
  );

  return (
    <form className="admin-form" onSubmit={(event) => void saveDraft(event)}>
      <div className="admin-row">
        <h2>{draft ? "Edit draft" : "New draft"}</h2>
        <button
          type="button"
          className="button button-outline"
          disabled={busy}
          onClick={onCancel}
        >
          Back to drafts
        </button>
      </div>
      {message && (
        <p role="status" className="admin-status">
          {message}
        </p>
      )}
      <div className="admin-grid">
        {textInput("Title", "title", { required: true })}
        <div className="admin-field">
          <label htmlFor="admin-kind">Content type</label>
          <select
            id="admin-kind"
            value={fields.kind}
            onChange={(event) =>
              change("kind", event.target.value as ContentKind)
            }
          >
            <option value="event">Event</option>
            <option value="opportunity">Opportunity</option>
          </select>
        </div>
        {textInput("Category", "category")}
        {textInput("Estimated duration", "estimatedDuration")}
        {textInput("Slug", "slug")}
        {isEvent && (
          <>
            {textInput("Date (as displayed)", "date")}
            <div className="admin-field">
              <label htmlFor="admin-iso">ISO date</label>
              <input
                id="admin-iso"
                type="date"
                value={fields.iso}
                onChange={(event) => change("iso", event.target.value)}
              />
            </div>
            {textInput("Location", "location", { wide: true })}
          </>
        )}
      </div>
      {textArea("Summary", "summary")}
      {textArea(isEvent ? "Details" : "Description", "problemStatement")}
      {textArea("Requirements", "requirements")}
      {textArea("Provided materials", "providedMaterials")}
      <div className="admin-grid">
        {listArea(
          isEvent ? "Skills or topics" : "Skills required",
          "skillsRequired",
        )}
        {isEvent && listArea("Schedule", "schedule")}
        {listArea("Links", "links")}
      </div>
      <div className="admin-field">
        <label htmlFor="admin-files">Files and images</label>
        <input
          id="admin-files"
          type="file"
          multiple
          accept="image/*,application/pdf"
          disabled={busy}
          onChange={(event) => void uploadFiles(event)}
        />
      </div>
      {fields.fileUrls.length > 0 && (
        <ul className="admin-files">
          {fields.fileUrls.map((url, index) => {
            const name = fields.fileNames[index] || `Attachment ${index + 1}`;
            const href = safeHref(url);
            return (
              <li key={`${url}-${index}`}>
                {href && isImageFile(url, name) ? (
                  <img src={href} alt={name} loading="lazy" />
                ) : href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    File
                  </a>
                ) : null}
                <p title={name}>{name}</p>
                <button
                  type="button"
                  className="admin-link-button"
                  disabled={busy}
                  onClick={() => removeFile(index)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="form-actions">
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Working…" : "Save draft"}
        </button>
        <button
          className="button button-outline"
          type="button"
          onClick={() => void publish()}
          disabled={busy}
        >
          {draft?.publicationStatus === "active"
            ? "Update published item"
            : draft?.publishedJobId
              ? "Publish again"
              : "Publish"}
        </button>
        {draft?.publishedJobId && (
          <>
            <button
              className="button button-outline"
              type="button"
              onClick={() => void unpublish()}
              disabled={busy}
            >
              Unpublish
            </button>
            <button
              className="button button-outline"
              type="button"
              onClick={() => void deletePublished()}
              disabled={busy}
            >
              Delete published record
            </button>
          </>
        )}
      </div>
    </form>
  );
}
