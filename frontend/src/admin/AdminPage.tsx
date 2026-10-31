import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "./firebase";
import {
  DRAFTS_COLLECTION,
  PUBLISHED_COLLECTION,
  TALA_COMPANY,
  TALA_PROVIDER,
  hasTalaAdminAccess,
  type TalaDraft,
} from "./adminConfig";
import AdminContentForm from "./AdminContentForm";
import "./admin.css";

type Published = { id: string; title: string; kind?: string };

function draftState(draft: TalaDraft) {
  if (draft.publicationStatus === "active") return "published";
  return draft.publishedJobId ? "unpublished" : "draft";
}

export function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [drafts, setDrafts] = useState<TalaDraft[]>([]);
  const [published, setPublished] = useState<Published[]>([]);
  const [selected, setSelected] = useState<TalaDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(
    firebaseConfigured
      ? ""
      : "Firebase is not configured. Add the VITE_FIREBASE_* variables to the build environment.",
  );

  useEffect(() => {
    document.title = "TALA admin | TALA";
    if (!auth || !db) return;
    return onAuthStateChanged(auth, async (current) => {
      setUser(current);
      setAuthorized(false);
      setError("");
      if (!current) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const allowed = await hasTalaAdminAccess(current);
        setAuthorized(allowed);
        if (!allowed)
          setError(
            "This Google account is not authorized. Access requires an allowlisted email and users/{uid}.role = talaadmin.",
          );
      } catch {
        setError("Unable to verify your administrator role. Please try again.");
      } finally {
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!authorized || !db) return;
    return onSnapshot(
      collection(db, DRAFTS_COLLECTION),
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({
          ...item.data(),
          id: item.id,
        })) as TalaDraft[];
        items.sort((a, b) =>
          (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
        );
        setDrafts(items);
        setSelected((current) =>
          current
            ? (items.find((item) => item.id === current.id) ?? null)
            : null,
        );
      },
      () =>
        setError(
          "Unable to load drafts. Check the Firestore rules and try again.",
        ),
    );
  }, [authorized]);

  useEffect(() => {
    if (!authorized || !db) return;
    return onSnapshot(
      query(
        collection(db, PUBLISHED_COLLECTION),
        where("companyName", "==", TALA_COMPANY),
        where("provider", "==", TALA_PROVIDER),
        where("status", "==", "active"),
      ),
      (snapshot) =>
        setPublished(
          snapshot.docs.map(
            (item) => ({ ...item.data(), id: item.id }) as Published,
          ),
        ),
      () => setError("Unable to load published items."),
    );
  }, [authorized]);

  async function login() {
    if (!auth) return;
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Google sign-in failed.",
      );
    }
  }

  async function logout() {
    if (auth) await signOut(auth);
    setSelected(null);
    setCreating(false);
  }

  const closeForm = () => {
    setSelected(null);
    setCreating(false);
  };

  if (loading)
    return (
      <div className="container state-panel" role="status">
        Checking administrator access…
      </div>
    );

  if (!user || !authorized)
    return (
      <section className="container state-panel admin-signin">
        <h1>TALA admin</h1>
        <p>
          Sign in with an authorized Google account. Access requires an
          allowlisted email and the Firestore role talaadmin.
        </p>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        {user ? (
          <button
            className="button button-outline"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        ) : (
          firebaseConfigured && (
            <button className="button" onClick={() => void login()}>
              Sign in with Google
            </button>
          )
        )}
      </section>
    );

  return (
    <section className="container admin-page">
      <div className="admin-row admin-heading">
        <div>
          <p className="admin-eyebrow">Tucson Adaptive Learning Academy</p>
          <h1>Events and opportunities</h1>
          <p className="admin-hint">Signed in as {user.email}</p>
        </div>
        <button className="button button-outline" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {creating || selected ? (
        <AdminContentForm
          key={selected?.id ?? "new"}
          draft={selected}
          user={user}
          onSaved={(saved) => {
            setError("");
            setSelected(saved);
            setCreating(false);
          }}
          onPublished={closeForm}
          onCancel={closeForm}
          onError={setError}
        />
      ) : (
        <>
          <div className="admin-row">
            <h2>Drafts</h2>
            <button className="button" onClick={() => setCreating(true)}>
              Create content
            </button>
          </div>
          {drafts.length === 0 ? (
            <p className="admin-empty">
              No drafts yet. Create an event or opportunity to get started.
            </p>
          ) : (
            <ul className="admin-list">
              {drafts.map((draft) => (
                <li key={draft.id}>
                  <button type="button" onClick={() => setSelected(draft)}>
                    <strong>{draft.title || "Untitled draft"}</strong>
                    <span>
                      {draft.kind} · {draftState(draft)}
                    </span>
                    <small>Updated {draft.updatedAt || "not yet saved"}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {published.length > 0 && (
            <>
              <h2 className="admin-subhead">Published</h2>
              <ul className="admin-list">
                {published.map((item) => (
                  <li key={item.id} className="admin-published">
                    <strong>{item.title}</strong>
                    <span>{item.kind ?? "event"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
