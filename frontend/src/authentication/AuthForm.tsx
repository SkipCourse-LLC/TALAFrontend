import { TextField } from "../shared/TextField";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { demoEnabled, demoToolsEnabled } from "../shared/services/demoConfig";
import { validateAuth } from "./formValidation";
import type { AuthField, AuthValues, FormErrors } from "./formValidation";
import { Icon } from "../shared/Icon";
import { authErrorMessage } from "./authService";

interface Props {
  initialEmail?: string;
  onSubmit: (values: AuthValues, simulateError: boolean) => Promise<void>;
  pending?: boolean;
}
export function AuthForm({
  initialEmail = "",
  onSubmit,
  pending = false,
}: Props) {
  const [values, setValues] = useState<AuthValues>({
    email: initialEmail,
    password: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [serviceError, setServiceError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [simulateError, setSimulateError] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextErrors = validateAuth(values);
    setErrors(nextErrors);
    setServiceError("");
    const first = Object.keys(nextErrors)[0];
    if (first) {
      form.current
        ?.querySelector<HTMLInputElement>(`[name="${first}"]`)
        ?.focus();
      return;
    }
    try {
      await onSubmit({ ...values, email: values.email.trim() }, simulateError);
    } catch (error) {
      if (active.current) {
        setServiceError(authErrorMessage(error));
        requestAnimationFrame(() => {
          if (active.current) errorBox.current?.focus();
        });
      }
    }
  }
  const fields: {
    name: AuthField;
    label: string;
    type: string;
    autoComplete: string;
  }[] = [
    {
      name: "email",
      label: "Email address",
      type: "email",
      autoComplete: "email",
    },
    {
      name: "password",
      label: "Demo password",
      type: showPassword ? "text" : "password",
      autoComplete: "new-password",
    },
  ];
  return (
    <form ref={form} onSubmit={submit} noValidate aria-busy={pending}>
      {!demoEnabled && (
        <div className="notice error" role="status">
          Sign-in is unavailable in this preview.
        </div>
      )}
      {serviceError && (
        <div ref={errorBox} tabIndex={-1} className="notice error" role="alert">
          {serviceError}
        </div>
      )}
      <p className="sr-only">
        All fields are required. Use invented details in this preview.
      </p>
      {fields.map((field) => (
        <TextField
          key={field.name}
          label={field.label}
          error={errors[field.name]}
          hint={
            field.name === "password"
              ? "At least 8 characters. Use a made-up password, never a real one."
              : undefined
          }
          id={field.name}
          name={field.name}
          type={field.type}
          autoComplete={field.autoComplete}
          required
          maxLength={field.name === "email" ? 254 : 128}
          spellCheck={field.name === "email" ? false : undefined}
          value={values[field.name]}
          readOnly={pending}
          onChange={(event) => {
            const next = { ...values, [field.name]: event.target.value };
            setValues(next);
            // Validate on submit, then update existing errors while correcting.
            // Avoid moving the submit button during a pointer-triggered blur.
            const checked = validateAuth(next);
            setErrors((current) =>
              Object.fromEntries(
                Object.keys(current).map((name) => [
                  name,
                  checked[name as AuthField],
                ]),
              ),
            );
          }}
        />
      ))}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={showPassword}
          disabled={pending}
          onChange={(e) => setShowPassword(e.target.checked)}
        />{" "}
        Show password
      </label>
      <button
        className="button button-full"
        disabled={pending || !demoEnabled}
        type="submit"
      >
        {pending ? "Opening your demo hub…" : "Log in to demo"}
        <Icon name="arrow" />
      </button>
      <div className="sr-only" role="status">
        {pending
          ? "Please wait…"
          : Object.values(errors).some(Boolean)
            ? "Please correct the marked fields."
            : ""}
      </div>
      {demoToolsEnabled && (
        <details className="demo-tools">
          <summary>Demo testing options</summary>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={simulateError}
              disabled={pending}
              onChange={(e) => setSimulateError(e.target.checked)}
            />{" "}
            Simulate service error
          </label>
          <p>No request will be sent. Uncheck to try the successful flow.</p>
        </details>
      )}
    </form>
  );
}
