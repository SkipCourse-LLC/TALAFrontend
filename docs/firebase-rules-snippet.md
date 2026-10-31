# Firebase rules for the TALA admin page

Examples to merge manually into the central `skip-class-slsru4` rules. They are not deployed by this repository. Do not grant client writes to `users/{uid}.role`. Keep the email list in sync with `TALA_ADMIN_EMAILS` in `frontend/src/admin/adminConfig.ts`.

The admin page lives at `/#/admin`. Admins need `users/{uid}.role == 'talaadmin'` and an allowlisted email.

Also: add the hosting domain (`tucsonala` site and `talaedu.com`) to Firebase Authentication > Authorized domains, and set the `VITE_FIREBASE_*` values in the build environment.

## Cloud Firestore

```text
function isTalaAdmin() {
  return request.auth != null
    && request.auth.token.email in ['karl@skipcourse.com']
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'talaadmin';
}

match /users/{uid} {
  allow get: if request.auth != null && request.auth.uid == uid;
}

match /tala_drafts/{draftId} {
  allow read, delete: if isTalaAdmin();
  allow create, update: if isTalaAdmin()
    && request.resource.data.companyName == 'Tucson Adaptive Learning Academy'
    && request.resource.data.provider == 'tala';
}

match /jobs/{jobId} {
  allow get, list: if resource.data.companyName == 'Tucson Adaptive Learning Academy'
    && resource.data.provider == 'tala'
    && resource.data.status == 'active';
  allow get: if isTalaAdmin()
    && (resource == null
      || (resource.data.companyName == 'Tucson Adaptive Learning Academy'
        && resource.data.provider == 'tala'));
  allow create: if isTalaAdmin()
    && request.resource.data.companyName == 'Tucson Adaptive Learning Academy'
    && request.resource.data.provider == 'tala';
  allow update: if isTalaAdmin()
    && resource.data.provider == 'tala'
    && request.resource.data.companyName == 'Tucson Adaptive Learning Academy'
    && request.resource.data.provider == 'tala';
  allow delete: if isTalaAdmin() && resource.data.provider == 'tala';
}
```

Firestore `allow` rules are additive: review existing `jobs` grants so they do not bypass this scope. The admin page queries `jobs` by `companyName`, `provider` and `status`; create the composite index if Firestore requests it.

## Cloud Storage

```text
function isTalaAdmin() {
  return request.auth != null
    && request.auth.token.email in ['karl@skipcourse.com']
    && firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.role == 'talaadmin';
}

match /tala_uploads/{uid}/{fileName} {
  allow read: if true;
  allow create, update: if request.auth.uid == uid
    && isTalaAdmin()
    && request.resource.size <= 10 * 1024 * 1024
    && (request.resource.contentType.matches('image/.*')
      || request.resource.contentType == 'application/pdf');
  allow delete: if request.auth.uid == uid && isTalaAdmin();
}
```

Verify in the Rules Playground with an allowlisted `talaadmin` user and a non-admin before deploying.

## Schema

`tala_drafts/{id}` and `jobs/{id}` (published) share these fields: `title`, `kind` (`event` | `opportunity`), `category`, `estimatedDuration`, `slug`, `summary`, `problemStatement`, `requirements`, `providedMaterials`, `skillsRequired[]`, `date`, `iso`, `location`, `schedule[]`, `links[]`, `fileUrls[]`, `fileNames[]`, plus `companyName`, `provider: 'tala'`, `status`, `submittedBy`, `submitterEmail`, `createdAt`, `updatedAt`. Drafts also hold `publishedJobId` and `publicationStatus`.
