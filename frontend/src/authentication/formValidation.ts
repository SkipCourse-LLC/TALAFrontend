export type AuthField = "email" | "password";
export type FormErrors = Partial<Record<AuthField, string>>;
export interface AuthValues {
  email: string;
  password: string;
}
export function validateAuth(values: AuthValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.email.trim()) errors.email = "Enter your email address.";
  else if (values.email.trim().length > 254)
    errors.email = "Use an email address with 254 characters or fewer.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))
    errors.email = "Enter an email address such as learner@example.com.";
  if (!values.password) errors.password = "Enter a demo password.";
  else if (values.password.length < 8)
    errors.password = "Use at least 8 characters for this demo.";
  else if (values.password.length > 128)
    errors.password = "Use 128 characters or fewer.";
  return errors;
}
