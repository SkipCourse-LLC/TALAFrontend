import type { InputHTMLAttributes, ReactNode } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
};

/** Shared label, hint and validation semantics for registration and login. */
export function TextField({ id, label, error, hint, ...input }: Props) {
  const description =
    [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        {...input}
        id={id}
        aria-invalid={!!error}
        aria-describedby={description}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
