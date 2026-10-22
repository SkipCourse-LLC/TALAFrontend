import type { EnrollmentDraft } from "./enrollmentService";
export function RegistrationReview({
  draft,
  onEdit,
}: {
  draft: EnrollmentDraft;
  onEdit: (step: number) => void;
}) {
  const rows: [label: string, value: string, step: number][] = [
    ["Parent", `${draft.parentName} · ${draft.parentEmail}`, 0],
    ["Student", `${draft.studentName} · ${draft.studentEmail}`, 1],
    [
      "Enrollment",
      `${draft.intent} · ${draft.learningMode} · ${draft.timeBlock}`,
      2,
    ],
    ["Documents", "Nothing uploaded in this preview", 3],
    ["Funding", `${draft.funding} · no payment`, 4],
  ];
  return (
    <>
      <p>
        Review your family profile. You can edit any section before continuing.
      </p>
      <dl className="review-list">
        {rows.map(([label, value, index]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <button
              type="button"
              className="text-link"
              onClick={() => onEdit(index)}
            >
              Edit {label}
            </button>
          </div>
        ))}
      </dl>
      <p className="small">
        Next: try two-factor verification, then review your application status.
        No application or payment is submitted in this preview.
      </p>
    </>
  );
}
