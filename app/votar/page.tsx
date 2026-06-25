"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { startTransition, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  CheckSquare2,
  Clock,
  ExternalLink,
  Fingerprint,
  Key,
  LogOut,
  PartyPopper,
  Scan,
  Send
} from "lucide-react";
import { ShimmerButton } from "../components/ui/shimmer-button";
import { SpotlightCard } from "../components/ui/spotlight-card";

type ResultadoCandidato = { id: number; nombre: string; votos: number };
type ResultadosResponse = {
  candidatos: ResultadoCandidato[];
  contractAddress: string;
  estadoUrna: "CERRADA" | "ABIERTA" | "FINALIZADA";
  totalVotos: number;
  updatedAt: string;
};
type BiometricInitResponse = {
  attemptId: string;
  status: string;
  veriffSessionId: string;
  veriffSessionToken: string | null;
  veriffUrl: string | null;
};
type BiometricStatusResponse = {
  attemptId: string;
  biometricMatch: boolean | null;
  failureReason: string | null;
  resolvedAt: string | null;
  status: "PENDIENTE" | "APROBADO" | "RECHAZADO" | "EXPIRADO" | "ERROR";
  veriffSessionId: string;
  voterEstado: string | null;
  votoEmitido: boolean;
};
type VoteTokenResponse = { expiresAt: string; tokenDigestHex: string; tokenFirmado: string };
type VoteReceipt = { blockNumber: number; contractAddress: string; transactionHash: string };
type VeriffFrameController = { close: () => void };

const RESULT_POLL_INTERVAL_MS = 8_000;
const BIOMETRIC_POLL_INTERVAL_MS = 4_000;

function formatDateTime(value: string | null) {
  if (!value) return "Sin dato";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin dato";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function BiometricStatusLabel({ status }: { status: BiometricStatusResponse["status"] | null }) {
  if (status === "APROBADO") return <span className="status-chip-success"><CheckCircle2 size={12} /> Verificada</span>;
  if (status === "RECHAZADO") return <span className="status-chip-danger"><AlertCircle size={12} /> Rechazada</span>;
  if (status === "EXPIRADO") return <span className="status-chip-warning"><Clock size={12} /> Expirada</span>;
  if (status === "PENDIENTE") return <span className="status-chip animate-pulse-soft"><span className="h-1.5 w-1.5 rounded-full bg-brand-amber" /> Pendiente</span>;
  return <span className="status-chip">Sin verificar</span>;
}

export default function VotarPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [resultados, setResultados] = useState<ResultadosResponse | null>(null);
  const [biometricAttempt, setBiometricAttempt] = useState<BiometricStatusResponse | null>(null);
  const [voteToken, setVoteToken] = useState<VoteTokenResponse | null>(null);
  const [voteReceipt, setVoteReceipt] = useState<VoteReceipt | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [isCreatingAttempt, setIsCreatingAttempt] = useState(false);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState("Iniciá la verificación biométrica para habilitar tu boleta.");
  const biometricPollingRef = useRef<number | null>(null);
  const veriffFrameRef = useRef<VeriffFrameController | null>(null);
  const tokenGenerationLockRef = useRef(false);

  useEffect(() => {
    return () => {
      if (biometricPollingRef.current) window.clearInterval(biometricPollingRef.current);
      veriffFrameRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") { router.replace("/login"); return; }
    if (status === "authenticated" && session.user.role === "AUTORIDAD") router.replace("/admin");
  }, [router, session, status]);

  useEffect(() => {
    if (status !== "authenticated" || session.user.role !== "VOTANTE") return;
    let isMounted = true;

    async function fetchResultados() {
      try {
        const res = await fetch("/api/resultados", { cache: "no-store" });
        const payload = (await res.json()) as ResultadosResponse & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? "No se pudieron leer los resultados");
        if (isMounted) startTransition(() => setResultados(payload));
      } catch (error) {
        if (isMounted) setErrorMessage(error instanceof Error ? error.message : "No se pudieron leer los resultados");
      }
    }

    void fetchResultados();
    const id = window.setInterval(() => void fetchResultados(), RESULT_POLL_INTERVAL_MS);
    return () => { isMounted = false; window.clearInterval(id); };
  }, [session?.user.role, status]);

  useEffect(() => {
    if (status !== "authenticated" || session.user.role !== "VOTANTE") return;

    async function loadCurrentAttempt() {
      try {
        const res = await fetch("/api/verificar-biometria", { cache: "no-store" });
        if (res.status === 404) return;
        const payload = (await res.json()) as BiometricStatusResponse & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? "No se pudo leer el estado biométrico");
        setBiometricAttempt(payload);
        if (payload.votoEmitido) { setNotice("Tu voto ya fue confirmado en blockchain."); return; }
        if (payload.status === "PENDIENTE") beginBiometricPolling(payload.veriffSessionId);
        if (payload.status === "APROBADO" && payload.biometricMatch) {
          setNotice("Biometría validada. Generando token de voto...");
          await issueVoteToken();
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "No se pudo recuperar el estado biométrico");
      }
    }

    void loadCurrentAttempt();
  }, [session?.user.role, status]);

  function stopBiometricPolling() {
    if (biometricPollingRef.current) { window.clearInterval(biometricPollingRef.current); biometricPollingRef.current = null; }
  }

  async function openVeriffFrame(veriffUrl: string) {
    const { MESSAGES, createVeriffFrame } = await import("@veriff/incontext-sdk");
    veriffFrameRef.current?.close();
    veriffFrameRef.current = createVeriffFrame({
      lang: "es",
      onEvent(message) {
        if (message === MESSAGES.STARTED) setNotice("Veriff está capturando la nueva prueba de vida.");
        if (message === MESSAGES.SUBMITTED || message === MESSAGES.FINISHED)
          setNotice("La evidencia biométrica fue enviada. Esperando respuesta del backend.");
        if (message === MESSAGES.CANCELED) setNotice("La captura se cerró. Podés iniciar otra verificación.");
      },
      onReload() { window.location.reload(); },
      url: veriffUrl
    });
  }

  async function issueVoteToken() {
    if (voteToken || tokenGenerationLockRef.current) return;
    tokenGenerationLockRef.current = true;
    setIsGeneratingToken(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/generar-token", { method: "POST" });
      const payload = (await res.json()) as VoteTokenResponse & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "No se pudo generar el token de voto");
      setVoteToken(payload);
      setNotice("Token anónimo emitido. Ya podés seleccionar tu opción.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo generar el token de voto");
    } finally {
      tokenGenerationLockRef.current = false;
      setIsGeneratingToken(false);
    }
  }

  async function refreshBiometricAttempt(sessionId: string) {
    try {
      const res = await fetch(`/api/verificar-biometria?sessionId=${encodeURIComponent(sessionId)}&refresh=1`, { cache: "no-store" });
      const payload = (await res.json()) as BiometricStatusResponse & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "No se pudo consultar el estado biométrico");
      setBiometricAttempt(payload);
      if (payload.votoEmitido) { stopBiometricPolling(); setNotice("El voto ya fue emitido para esta sesión."); return; }
      if (payload.status === "APROBADO" && payload.biometricMatch) {
        stopBiometricPolling();
        setNotice("Biometría aprobada. Generando token de voto...");
        await issueVoteToken();
      }
      if (["RECHAZADO", "EXPIRADO", "ERROR"].includes(payload.status)) {
        stopBiometricPolling();
        setErrorMessage(payload.failureReason ?? "La verificación biométrica no pudo aprobarse. Iniciá otra sesión.");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo consultar el estado biométrico");
    }
  }

  function beginBiometricPolling(sessionId: string) {
    stopBiometricPolling();
    void refreshBiometricAttempt(sessionId);
    biometricPollingRef.current = window.setInterval(() => void refreshBiometricAttempt(sessionId), BIOMETRIC_POLL_INTERVAL_MS);
  }

  async function beginBiometricVerification() {
    setIsCreatingAttempt(true);
    setErrorMessage(null);
    setVoteToken(null);
    setVoteReceipt(null);
    tokenGenerationLockRef.current = false;
    try {
      const res = await fetch("/api/verificar-biometria", { method: "POST" });
      const payload = (await res.json()) as BiometricInitResponse & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "No se pudo iniciar la verificación biométrica");
      if (!payload.veriffUrl) throw new Error("Veriff no devolvió la URL segura de liveness");
      setBiometricAttempt({
        attemptId: payload.attemptId,
        biometricMatch: null,
        failureReason: null,
        resolvedAt: null,
        status: "PENDIENTE",
        veriffSessionId: payload.veriffSessionId,
        voterEstado: session?.user.estado ?? null,
        votoEmitido: false
      });
      setNotice("Completá la prueba de vida en la ventana de Veriff.");
      beginBiometricPolling(payload.veriffSessionId);
      await openVeriffFrame(payload.veriffUrl);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo iniciar la verificación biométrica");
    } finally {
      setIsCreatingAttempt(false);
    }
  }

  async function submitVote() {
    if (selectedCandidateId === null || !voteToken) return;
    setIsSubmittingVote(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/voto", {
        body: JSON.stringify({ candidatoId: selectedCandidateId, tokenFirmado: voteToken.tokenFirmado }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await res.json()) as VoteReceipt & { details?: string; error?: string };
      if (!res.ok) throw new Error(payload.details ?? payload.error ?? "No se pudo emitir el voto");
      setVoteReceipt(payload);
      setNotice("El voto quedó confirmado en la blockchain.");
      setVoteToken(null);
      await fetch("/api/verificar-biometria?refresh=1", { cache: "no-store" });
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo emitir el voto");
    } finally {
      setIsSubmittingVote(false);
    }
  }

  if (status === "loading" || (status === "authenticated" && session.user.role === "AUTORIDAD")) {
    return (
      <main className="page-shell flex items-center justify-center">
        <div className="glass-panel rounded-[28px] px-8 py-10 text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-sm text-brand-ink/60">Cargando entorno de votación...</p>
        </div>
      </main>
    );
  }

  const urnaAbierta = resultados?.estadoUrna === "ABIERTA";
  const biometricOk = biometricAttempt?.status === "APROBADO" && biometricAttempt.biometricMatch;
  const selectedCandidate = selectedCandidateId === null
    ? null
    : resultados?.candidatos.find((c) => c.id === selectedCandidateId) ?? null;

  /* Step states */
  const step1Done = biometricOk;
  const step2Active = !!voteToken && !voteReceipt;
  const step2Done = !!voteReceipt;

  return (
    <main className="page-shell">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">

        {/* ─── Main voting column ─── */}
        <div className="grid gap-5">

          {/* Header */}
          <section className="glass-panel p-7 sm:p-9">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <span className="eyebrow">Cabina de votación</span>
                <h1 className="section-title">Boleta anónima habilitada por verificación biométrica</h1>
                <p className="max-w-xl text-sm text-brand-ink/65">
                  Tu identidad valida que podés votar. La opción elegida viaja separada del
                  padrón y se registra en cadena con un token anónimo de un solo uso.
                </p>
              </div>
            </div>

            {/* Status chips row */}
            <div className="mt-6 flex flex-wrap gap-3">
              <div className="info-row flex-1 min-w-[120px]">
                <span className="text-xs text-brand-ink/50">Urna</span>
                {resultados?.estadoUrna === "ABIERTA" ? (
                  <span className="status-chip-success"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-live-pulse" /> Abierta</span>
                ) : resultados?.estadoUrna === "CERRADA" ? (
                  <span className="status-chip">Cerrada</span>
                ) : resultados ? (
                  <span className="status-chip-warning">Finalizada</span>
                ) : (
                  <span className="skeleton h-5 w-20" />
                )}
              </div>
              <div className="info-row flex-1 min-w-[140px]">
                <span className="text-xs text-brand-ink/50">Biometría</span>
                <BiometricStatusLabel status={biometricAttempt?.status ?? null} />
              </div>
              <div className="info-row flex-1 min-w-[140px]">
                <span className="text-xs text-brand-ink/50">Token</span>
                {voteToken ? (
                  <span className="status-chip-success"><Key size={11} /> Activo</span>
                ) : (
                  <span className="status-chip">Sin emitir</span>
                )}
              </div>
            </div>
          </section>

          {/* Step 1 — Biometric */}
          <section className={`glass-panel p-7 sm:p-8 transition ${step1Done ? "ring-1 ring-emerald-200" : ""}`}>
            <div className="flex items-start gap-4">
              <div className={step1Done ? "step-dot-done" : "step-dot"}>
                {step1Done ? <CheckCircle2 size={16} /> : <Scan size={15} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">Paso 1</p>
                    <h2 className="mt-1 text-xl font-semibold text-brand-ink">Verificación biométrica</h2>
                  </div>
                  {!step1Done && (
                    <ShimmerButton
                      disabled={isCreatingAttempt || !urnaAbierta || Boolean(voteReceipt)}
                      onClick={() => void beginBiometricVerification()}
                      type="button"
                    >
                      {isCreatingAttempt ? (
                        <><span className="spinner-sm" /> Abriendo...</>
                      ) : (
                        <><Fingerprint size={15} /> Iniciar liveness</>
                      )}
                    </ShimmerButton>
                  )}
                  {step1Done && <span className="status-chip-success"><CheckCircle2 size={12} /> Completado</span>}
                </div>

                <p className="mt-3 text-sm text-brand-ink/65">{notice}</p>

                {errorMessage && (
                  <div className="alert-error mt-4">
                    <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {biometricAttempt && !step1Done && (
                  <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                    <div className="info-row">
                      <dt className="text-xs text-brand-teal">Intento</dt>
                      <dd className="break-all font-mono text-xs">{biometricAttempt.attemptId}</dd>
                    </div>
                    <div className="info-row">
                      <dt className="text-xs text-brand-teal">Sesión</dt>
                      <dd className="break-all font-mono text-xs">{biometricAttempt.veriffSessionId}</dd>
                    </div>
                  </dl>
                )}
              </div>
            </div>
          </section>

          {/* Step 2 — Candidate selection */}
          <section className={`glass-panel p-7 sm:p-8 transition ${step2Done ? "ring-1 ring-emerald-200" : ""}`}>
            <div className="flex items-start gap-4">
              <div className={step2Done ? "step-dot-done" : step2Active ? "step-dot" : "step-dot-inactive"}>
                {step2Done ? <CheckCircle2 size={16} /> : <CheckSquare2 size={15} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">Paso 2</p>
                    <h2 className="mt-1 text-xl font-semibold text-brand-ink">Selección de candidato</h2>
                  </div>
                  {isGeneratingToken && (
                    <span className="status-chip animate-pulse-soft"><span className="spinner-sm" /> Generando token...</span>
                  )}
                </div>

                <div className="mt-5 grid gap-3">
                  {(resultados?.candidatos ?? []).map((candidate) => {
                    const isSelected = selectedCandidateId === candidate.id;
                    const isDisabled = !voteToken || !urnaAbierta || Boolean(voteReceipt);
                    return (
                      <SpotlightCard key={candidate.id} className="w-full">
                        <button
                          className={`group w-full rounded-[22px] border p-5 text-left transition ${
                            isSelected
                              ? "border-brand-teal bg-brand-mint/70 ring-2 ring-brand-teal/20"
                              : "border-brand-line/60 bg-white/80 hover:border-brand-teal/50 hover:bg-brand-mint/30"
                          } ${isDisabled ? "cursor-not-allowed opacity-55" : "hover:-translate-y-px hover:shadow-card"}`}
                          disabled={isDisabled}
                          onClick={() => setSelectedCandidateId(candidate.id)}
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">
                                Opción {candidate.id}
                              </p>
                              <h3 className="mt-1.5 text-lg font-semibold text-brand-ink">{candidate.nombre}</h3>
                              <p className="mt-1 text-sm text-brand-ink/55">
                                {candidate.votos} votos registrados
                              </p>
                            </div>
                            <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition ${
                              isSelected
                                ? "border-brand-teal bg-brand-teal text-white"
                                : "border-brand-line/60 bg-white"
                            }`}>
                              {isSelected && <CheckCircle2 size={13} />}
                            </div>
                          </div>
                        </button>
                      </SpotlightCard>
                    );
                  })}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <ShimmerButton
                    disabled={!voteToken || selectedCandidateId === null || isSubmittingVote || !urnaAbierta || Boolean(voteReceipt)}
                    onClick={() => void submitVote()}
                    type="button"
                  >
                    {isSubmittingVote ? (
                      <><span className="spinner-sm" /> Enviando a blockchain...</>
                    ) : (
                      <><Send size={15} /> Emitir voto</>
                    )}
                  </ShimmerButton>
                  <Link className="secondary-button" href="/resultados">
                    <BarChart3 size={15} />
                    Ver escrutinio
                  </Link>
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* ─── Right sidebar ─── */}
        <aside className="grid gap-4 content-start">

          {/* Vote receipt */}
          {voteReceipt ? (
            <section className="metric-card border-2 border-emerald-200 bg-emerald-50/60">
              <div className="flex items-center gap-3">
                <PartyPopper size={22} className="text-emerald-600" />
                <h2 className="text-lg font-semibold text-emerald-800">¡Voto confirmado!</h2>
              </div>
              <p className="mt-2 text-sm text-emerald-700">
                Tu voto quedó registrado de forma inmutable en la blockchain.
              </p>
              <dl className="mt-4 grid gap-2 text-sm">
                <div className="rounded-2xl border border-emerald-200 bg-white/70 px-4 py-3">
                  <dt className="text-xs text-brand-teal">Bloque</dt>
                  <dd className="mt-1 font-semibold text-brand-ink">#{voteReceipt.blockNumber}</dd>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-white/70 px-4 py-3">
                  <dt className="text-xs text-brand-teal">Tx hash</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-brand-ink/80">{voteReceipt.transactionHash}</dd>
                </div>
              </dl>
              <a
                className="secondary-button mt-4"
                href={`https://sepolia.etherscan.io/tx/${voteReceipt.transactionHash}`}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink size={14} />
                Ver en Etherscan
              </a>
            </section>
          ) : (
            /* Boleta anónima */
            <section className="metric-card">
              <h2 className="text-lg font-semibold text-brand-ink">Boleta anónima</h2>
              <dl className="mt-4 grid gap-2 text-sm">
                <div className="info-row">
                  <dt className="text-xs text-brand-teal">Hash del token</dt>
                  <dd className="max-w-[10rem] truncate font-mono text-xs">{voteToken?.tokenDigestHex ?? "—"}</dd>
                </div>
                <div className="info-row">
                  <dt className="text-xs text-brand-teal">Expira</dt>
                  <dd className="text-xs">{voteToken ? formatDateTime(voteToken.expiresAt) : "Sin token"}</dd>
                </div>
                <div className="info-row">
                  <dt className="text-xs text-brand-teal">Candidato</dt>
                  <dd className="text-xs font-medium">{selectedCandidate?.nombre ?? "Sin seleccionar"}</dd>
                </div>
              </dl>
            </section>
          )}

          {/* Garantías */}
          <section className="metric-card">
            <h2 className="text-base font-semibold text-brand-ink">Garantías de privacidad</h2>
            <ul className="mt-3 grid gap-2">
              {[
                "Tu identidad no viaja a la blockchain.",
                "El token es de un solo uso; no se puede reutilizar.",
                "La biometría se compara como hash, nunca en claro."
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-brand-ink/68">
                  <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                  {text}
                </li>
              ))}
            </ul>
          </section>

          {/* Logout */}
          <button
            className="secondary-button w-full"
            onClick={() => void signOut({ callbackUrl: "/login" })}
            type="button"
          >
            <LogOut size={15} />
            Cerrar sesión
          </button>

        </aside>
      </div>
    </main>
  );
}
