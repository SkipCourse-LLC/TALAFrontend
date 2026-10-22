import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  enrollmentErrorMessage,
  enrollmentService,
  validateEnrollment,
} from "./enrollmentContract";
import type {
  EnrollmentDraft,
  EnrollmentErrors,
  EnrollmentReceipt,
} from "./enrollmentContract";
export function useRegistration(
  onComplete: (receipt: EnrollmentReceipt) => void,
) {
  const [params] = useSearchParams();
  const [draft, setDraft] = useState<EnrollmentDraft>({
    parentName: "",
    parentEmail: "",
    password: "",
    confirmPassword: "",
    studentName: "",
    studentEmail: "",
    learningMode: "",
    timeBlock: "",
    intent:
      params.get("intent") === "waiting-list" ? "Waiting list" : "Enrollment",
    documentsAcknowledged: false,
    funding: "Private",
    fundingAcknowledged: false,
  });
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<EnrollmentErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [simulateError, setSimulateError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const failureBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (failure) failureBox.current?.focus();
  }, [failure]);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  function change<K extends keyof EnrollmentDraft>(
    key: K,
    value: EnrollmentDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }
  async function next(event: FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const validationStep =
      step === 5
        ? ([0, 1, 2, 3, 4].find(
            (index) => Object.keys(validateEnrollment(draft, index)).length,
          ) ?? 5)
        : step;
    const checked = validateEnrollment(draft, validationStep);
    setErrors(checked);
    setFailure("");
    const first = Object.keys(checked)[0];
    if (first) {
      if (validationStep !== step) setStep(validationStep);
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>(`#${first}`)?.focus(),
      );
      return;
    }
    if (step < 5) {
      setStep(step + 1);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const receipt = await enrollmentService.submit(
        { ...draft },
        simulateError,
        controller.signal,
      );
      if (controller.signal.aborted || request.current !== controller) return;
      setDraft((current) => ({
        ...current,
        password: "",
        confirmPassword: "",
      }));
      onComplete(receipt);
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller)
        setFailure(enrollmentErrorMessage(error));
    } finally {
      if (request.current === controller) {
        if (!controller.signal.aborted) setPending(false);
        request.current = null;
      }
    }
  }
  function goBack() {
    setStep(step - 1);
    setErrors({});
    setFailure("");
  }
  return {
    draft,
    step,
    errors,
    pending,
    failure,
    simulateError,
    showPassword,
    heading,
    form,
    failureBox,
    change,
    next,
    setStep,
    goBack,
    setSimulateError,
    setShowPassword,
  };
}
