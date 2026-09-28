"use client";

import Link from "next/link";
import { startRegistration } from "@simplewebauthn/browser";
import { startTransition, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Fingerprint,
  Globe,
  Hash,
  User,
  UserPlus
} from "lucide-react";
import {
  closeIdentityVerificationFrames,
  openIdentityVerificationFrame,
  type IdentityFrameController
} from "../adapters/identityVerificationFrame";
import {
  clearPendingRegistrationVerification,
  isTerminalVerificationStatus,
  loadPendingRegistrationVerification,
  savePendingRegistrationVerification
} from "../adapters/identityVerificationStorage";
import {
  createRegistrationVerification,
  getVerificationProvider,
  getVerificationSessionId,
  getVerificationUrl,
  getRegistrationVerificationStatus,
  initRegistrationStatusFromAttempt,
  type RegistrationFormPayload,
  type RegistrationInitResponse,
  type RegistrationStatusResponse
} from "../services/identityVerification";

const DEFAULT_FORM: RegistrationFormPayload = {
  dateOfBirth: "",
  dni: "",
  documentCountry: "AR",
  documentType: "ID_CARD",
  firstName: "",
  lastName: ""
};

const POLL_INTERVAL_MS = 4_000;

type Step = "datos" | "veriff" | "aprobado";
type RegistroInitResponse = RegistrationInitResponse;
type RegistroStatusResponse = RegistrationStatusResponse;

function getStep(attempt: RegistroInitResponse | null, status: RegistroStatusResponse | null): Step {
  if (status?.status === "APROBADO" || attempt?.status === "APROBADO") return "aprobado";
  if (attempt) return "veriff";
  return "datos";
}

function StepBar({ current }: { current: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "datos", label: "Tus datos" },
    { id: "veriff", label: "Verificación" },
    { id: "aprobado", label: "Aprobado" }
  ];
  const order: Step[] = ["datos", "veriff", "aprobado"];
  const currentIdx = order.indexOf(current);

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                    ? "bg-brand-teal text-white ring-4 ring-brand-teal/20"
                    : "border-2 border-brand-line bg-white text-brand-ink/40"
                }`}
              >
                {done ? <CheckCircle2 size={14} /> : i + 1}
              </div>
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide ${
                  done
                    ? "text-emerald-600"
                    : active
                    ? "text-brand-teal"
                    : "text-brand-ink/40"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mb-5 mx-2 h-px w-10 sm:w-16 transition-colors ${
                  done ? "bg-emerald-400" : "bg-brand-line/60"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountReadyPanel({ status }: { status: RegistroStatusResponse | null }) {
  return (
    <div className="grid gap-6 py-4">
      <div className="flex flex-col items-center gap-4 rounded-[28px] border border-emerald-200 bg-emerald-50/70 px-6 py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
          <CheckCircle2 size={34} />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-brand-ink">Tu cuenta está lista</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-brand-ink/65">
            Tu identidad fue aprobada y el padrón ya puede reconocerte como votante registrado.
          </p>
        </div>
        {status?.voter && (
          <dl className="grid w-full max-w-md gap-2 text-left text-sm sm:grid-cols-2">
            <div className="info-row">
              <dt className="text-xs text-brand-teal">Estado</dt>
              <dd className="font-semibold text-brand-ink">{status.voter.estado}</dd>
            </div>
            <div className="info-row">
              <dt className="text-xs text-brand-teal">Registro</dt>
              <dd className="break-all font-mono text-xs">{status.voter.id}</dd>
            </div>
          </dl>
        )}
        <Link className="cta-button mt-1" href="/login">
          Continuar al login
          <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}

export default function RegistroPage() {
  const [formState, setFormState] = useState<RegistrationFormPayload>(DEFAULT_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEnrollingPasskey, setIsEnrollingPasskey] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("Completá tus datos y preparate para la captura.");
  const [attempt, setAttempt] = useState<RegistroInitResponse | null>(null);
  const [attemptStatus, setAttemptStatus] = useState<RegistroStatusResponse | null>(null);
  const pollingRef = useRef<number | null>(null);
  const frameRef = useRef<IdentityFrameController | null>(null);
  const terminalStatusRef = useRef(false);

  const currentStep = getStep(attempt, attemptStatus);

  useEffect(() => {
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
      frameRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const pendingAttempt = loadPendingRegistrationVerification();
    if (!pendingAttempt) return;

    const sessionId = getVerificationSessionId(pendingAttempt);
    terminalStatusRef.current = false;
    setAttempt(pendingAttempt);
    setAttemptStatus(initRegistrationStatusFromAttempt(pendingAttempt));
    setNotice("Retomando la verificación pendiente.");
    beginPolling(pendingAttempt.attemptId, sessionId);

    if (!pendingAttempt.sandbox && getVerificationUrl(pendingAttempt)) {
      void openVerificationFrame(pendingAttempt);
    }
  }, []);

  async function openVerificationFrame(payload: RegistroInitResponse) {
    const verificationUrl = getVerificationUrl(payload);
    if (!verificationUrl) throw new Error("El proveedor no devolvió la URL de la sesión");
    const provider = getVerificationProvider(payload);
    const sessionId = getVerificationSessionId(payload);

    closeVerificationFrame();
    const frame = await openIdentityVerificationFrame({
      onCanceled() {
        setNotice("La ventana de verificación fue cerrada. Podés retomar enviando un nuevo registro.");
      },
      onFinished() {
        setNotice("El proveedor recibió la evidencia. Esperamos la decisión final.");
        void refreshAttemptStatus(payload.attemptId, sessionId);
      },
      onReload() {
        window.location.reload();
      },
      onStarted() {
        setNotice("El proveedor inició la captura de documento y biometría.");
      },
      provider,
      url: verificationUrl
    });

    if (terminalStatusRef.current) {
      frame.close();
      return;
    }

    frameRef.current = frame;
  }

  function stopPolling() {
    if (pollingRef.current) { window.clearInterval(pollingRef.current); pollingRef.current = null; }
  }

  function closeVerificationFrame() {
    frameRef.current?.close();
    frameRef.current = null;
    closeIdentityVerificationFrames();
  }

  async function refreshAttemptStatus(attemptId: string, sessionId: string) {
    try {
      const payload = await getRegistrationVerificationStatus({
        attemptId,
        refresh: true,
        sessionId
      });
      terminalStatusRef.current = isTerminalVerificationStatus(payload.status);
      startTransition(() => setAttemptStatus(payload));
      if (payload.status === "APROBADO") {
        stopPolling();
        closeVerificationFrame();
        clearPendingRegistrationVerification();
        setNotice("Tu identidad quedó verificada. Ya podés iniciar sesión para votar.");
      }
      if (["RECHAZADO", "EXPIRADO", "ERROR"].includes(payload.status)) {
        stopPolling();
        closeVerificationFrame();
        clearPendingRegistrationVerification();
        setErrorMessage(payload.failureReason ?? "La sesión no pudo aprobarse. Iniciá un nuevo registro.");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo consultar el estado del registro");
    }
  }

  async function enrollPasskey() {
    const sessionId = attemptStatus?.veriffSessionId ?? attempt?.veriffSessionId;
    if (!sessionId) return;
    setIsEnrollingPasskey(true); setErrorMessage(null);
    try {
      const optionsResponse = await fetch("/api/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register-options", verificationSessionId: sessionId }) });
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options.error ?? "No se pudo iniciar la passkey");
      const response = await startRegistration({ optionsJSON: options });
      const verifyResponse = await fetch("/api/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register-verify", verificationSessionId: sessionId, response }) });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(verified.error ?? "No se pudo registrar la passkey");
      setNotice("Passkey registrada. Ya podés iniciar sesión.");
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "No se pudo registrar la passkey"); }
    finally { setIsEnrollingPasskey(false); }
  }

  function beginPolling(attemptId: string, sessionId: string) {
    stopPolling();
    void refreshAttemptStatus(attemptId, sessionId);
    pollingRef.current = window.setInterval(() => void refreshAttemptStatus(attemptId, sessionId), POLL_INTERVAL_MS);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setAttempt(null);
    setAttemptStatus(null);
    setNotice("Solicitando sesión de identidad...");
    stopPolling();
    closeVerificationFrame();
    terminalStatusRef.current = false;
    clearPendingRegistrationVerification();

    try {
      const payload = await createRegistrationVerification(formState);
      if (!payload.sandbox && !getVerificationUrl(payload)) throw new Error("El proveedor no devolvió la URL de la sesión");

      const sessionId = getVerificationSessionId(payload);
      terminalStatusRef.current = isTerminalVerificationStatus(payload.status);
      setAttempt(payload);
      setAttemptStatus(initRegistrationStatusFromAttempt(payload));
      if (payload.sandbox) {
        setNotice("Modo demo: identidad aprobada automáticamente. Tu cuenta ya está activa.");
        beginPolling(payload.attemptId, sessionId);
      } else {
        savePendingRegistrationVerification(payload);
        setNotice("Sesión creada. Completá la captura en la ventana segura.");
        beginPolling(payload.attemptId, sessionId);
        await openVerificationFrame(payload);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo iniciar el registro");
      setNotice("Corregí los datos o reintentá en unos segundos.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">

        {/* ─── Form panel ─── */}
        <section className="glass-panel p-8 sm:p-10">
          <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <span className="eyebrow">Registro de votante</span>
                <h1 className="section-title">Alta segura con prueba de vida</h1>
                <p className="max-w-lg text-sm text-brand-ink/65 sm:text-base">
                  Solo persisten hashes del DNI y biometría validada. Nunca se guardan
                  imágenes ni vectores crudos.
                </p>
              </div>
            </div>

            {/* Step bar */}
            <StepBar current={currentStep} />

            {currentStep === "aprobado" ? (
              <AccountReadyPanel status={attemptStatus} />
            ) : (
              <form className="grid gap-5" onSubmit={handleSubmit}>
                {/* Nombre / Apellido */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="field-label">Nombre</span>
                    <div className="relative">
                      <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-ink/35" />
                      <input
                        className="field-input field-input-icon"
                        onChange={(e) => setFormState((s) => ({ ...s, firstName: e.target.value }))}
                        placeholder="María"
                        required
                        value={formState.firstName}
                      />
                    </div>
                  </label>
                  <label className="grid gap-2">
                    <span className="field-label">Apellido</span>
                    <div className="relative">
                      <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-ink/35" />
                      <input
                        className="field-input field-input-icon"
                        onChange={(e) => setFormState((s) => ({ ...s, lastName: e.target.value }))}
                        placeholder="González"
                        required
                        value={formState.lastName}
                      />
                    </div>
                  </label>
                </div>

                {/* DNI / Fecha */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="field-label">DNI</span>
                    <div className="relative">
                      <Hash size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-ink/35" />
                      <input
                        className="field-input field-input-icon"
                        inputMode="numeric"
                        onChange={(e) => setFormState((s) => ({ ...s, dni: e.target.value }))}
                        placeholder="30111222"
                        required
                        value={formState.dni}
                      />
                    </div>
                  </label>
                  <label className="grid gap-2">
                    <span className="field-label">Fecha de nacimiento</span>
                    <div className="relative">
                      <Clock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-ink/35" />
                      <input
                        className="field-input field-input-icon"
                        onChange={(e) => setFormState((s) => ({ ...s, dateOfBirth: e.target.value }))}
                        required
                        type="date"
                        value={formState.dateOfBirth}
                      />
                    </div>
                  </label>
                </div>

                {/* País / Tipo */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="field-label">País del doc.</span>
                    <div className="relative">
                      <Globe size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-ink/35" />
                      <input
                        className="field-input field-input-icon uppercase"
                        maxLength={2}
                        onChange={(e) => setFormState((s) => ({ ...s, documentCountry: e.target.value.toUpperCase() }))}
                        value={formState.documentCountry}
                      />
                    </div>
                  </label>
                  <label className="grid gap-2">
                    <span className="field-label">Tipo de doc.</span>
                    <select
                      className="field-input"
                      onChange={(e) => setFormState((s) => ({ ...s, documentType: e.target.value }))}
                      value={formState.documentType}
                    >
                      <option value="ID_CARD">DNI / Cédula</option>
                      <option value="PASSPORT">Pasaporte</option>
                      <option value="DRIVERS_LICENSE">Licencia de conducir</option>
                      <option value="RESIDENCE_PERMIT">Permiso de residencia</option>
                    </select>
                  </label>
                </div>

                <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                  <button className="cta-button" disabled={isSubmitting} type="submit">
                    {isSubmitting ? (
                      <><span className="spinner-sm" /> Creando sesión...</>
                    ) : (
                      <><UserPlus size={15} /> Iniciar verificación</>
                    )}
                  </button>
                  <Link className="secondary-button" href="/login">
                    Ya estoy registrado
                  </Link>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* ─── Status panel ─── */}
        <aside className="grid gap-4 content-start">

          {/* Estado en curso */}
          <section className="metric-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="eyebrow">Estado en curso</span>
                <div className="mt-3">
                  {attemptStatus?.status === "APROBADO" ? (
                    <div className="status-chip-success"><CheckCircle2 size={12} /> Aprobado</div>
                  ) : attemptStatus?.status === "RECHAZADO" ? (
                    <div className="status-chip-danger"><AlertCircle size={12} /> Rechazado</div>
                  ) : attemptStatus?.status === "EXPIRADO" ? (
                    <div className="status-chip-warning"><Clock size={12} /> Expirado</div>
                  ) : attemptStatus?.status === "PENDIENTE" ? (
                    <div className="status-chip animate-pulse-soft"><span className="h-2 w-2 rounded-full bg-brand-amber" /> Pendiente</div>
                  ) : (
                    <div className="status-chip">Sin intento</div>
                  )}
                </div>
              </div>
              <Fingerprint size={20} className="mt-1 flex-shrink-0 text-brand-teal/50" />
            </div>

            <p className="mt-4 text-sm leading-relaxed text-brand-ink/70">{notice}</p>

            {errorMessage && (
              <div className="alert-error mt-4">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

          </section>

          {/* Próximos pasos */}
          <section className="metric-card">
            <h2 className="text-lg font-semibold text-brand-ink">Después del alta</h2>
            <ol className="mt-4 grid gap-2">
              {[
                "El proveedor aprueba el documento y el rostro.",
                "El backend genera dniHash y biometricHash.",
                "El votante queda listo para iniciar sesión y pasar al liveness final."
              ].map((text, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-2xl border border-brand-line/50 bg-white/65 px-4 py-3 text-sm text-brand-ink/72"
                >
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-mint text-[11px] font-bold text-brand-teal">
                    {i + 1}
                  </span>
                  {text}
                </li>
              ))}
            </ol>

            {attemptStatus?.status === "APROBADO" && (
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button className="cta-button" disabled={isEnrollingPasskey} onClick={() => void enrollPasskey()} type="button">
                  <Fingerprint size={15} /> {isEnrollingPasskey ? "Registrando passkey..." : "Registrar passkey"}
                </button>
                <Link className="secondary-button" href="/login">Continuar al login <ArrowRight size={15} /></Link>
              </div>
            )}
          </section>

        </aside>
      </div>
    </main>
  );
}
