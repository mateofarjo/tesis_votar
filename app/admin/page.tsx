"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { startTransition, useEffect, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  Link2,
  Lock,
  LogOut,
  RefreshCcw,
  ShieldCheck,
  Unlock,
  Users
} from "lucide-react";

type ResultadoCandidato = { id: number; nombre: string; votos: number };
type AdminSnapshot = {
  candidatos: ResultadoCandidato[];
  contractAddress: string;
  estadoUrna: "CERRADA" | "ABIERTA" | "FINALIZADA";
  fechaApertura: string | null;
  fechaCierre: string | null;
  padron: {
    registradas?: number;
    registrados?: number;
    total: number;
    verificadas: number;
    votoEmitido: number;
  };
  totalVotos: number;
  updatedAt: string;
  voters: Array<{
    createdAt: string;
    estado: "REGISTRADO" | "VERIFICADO" | "VOTO_EMITIDO";
    id: string;
    verifiedAt: string | null;
    votoEmitido: boolean;
    votedAt: string | null;
  }>;
};
type AdminActionReceipt = {
  action: "ABRIR_URNA" | "CERRAR_URNA";
  blockNumber: number;
  contractAddress: string;
  transactionHash: string;
};

const REFRESH_INTERVAL_MS = 8_000;

function formatDateTime(value: string | null) {
  if (!value) return "Sin dato";
  const n = Number(value);
  const date = Number.isFinite(n) ? new Date(n * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin dato";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function UrnaStateBadge({ estado }: { estado: AdminSnapshot["estadoUrna"] | undefined }) {
  if (!estado) return <div className="skeleton h-7 w-20" />;
  if (estado === "ABIERTA") return <span className="status-chip-success"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-live-pulse" /> Abierta</span>;
  if (estado === "FINALIZADA") return <span className="status-chip-warning">Finalizada</span>;
  return <span className="status-chip">Cerrada</span>;
}

function VoterBadge({ estado }: { estado: AdminSnapshot["voters"][number]["estado"] }) {
  if (estado === "VOTO_EMITIDO") return <span className="status-chip-success text-[10px]"><CheckCircle2 size={10} /> Votó</span>;
  if (estado === "VERIFICADO") return <span className="status-chip text-[10px] border-brand-teal/30 bg-brand-mint/60 text-brand-teal">Verificado</span>;
  return <span className="status-chip text-[10px]">Registrado</span>;
}

export default function AdminPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionReceipt, setActionReceipt] = useState<AdminActionReceipt | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") { router.replace("/login"); return; }
    if (status === "authenticated" && session.user.role !== "AUTORIDAD") router.replace("/votar");
  }, [router, session, status]);

  useEffect(() => {
    if (status !== "authenticated" || session.user.role !== "AUTORIDAD") return;
    let isMounted = true;

    async function fetchSnapshot() {
      try {
        const res = await fetch("/api/admin", { cache: "no-store" });
        const payload = (await res.json()) as AdminSnapshot & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? "No se pudo cargar el panel administrativo");
        if (!isMounted) return;
        startTransition(() => setSnapshot(payload));
        setLastFetch(new Date());
        setErrorMessage(null);
      } catch (error) {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : "No se pudo cargar el panel");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void fetchSnapshot();
    const id = window.setInterval(() => void fetchSnapshot(), REFRESH_INTERVAL_MS);
    return () => { isMounted = false; window.clearInterval(id); };
  }, [session?.user.role, status]);

  async function runAdminAction(action: "ABRIR_URNA" | "CERRAR_URNA") {
    setIsMutating(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/admin", {
        body: JSON.stringify({ action }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await res.json()) as AdminActionReceipt & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "No se pudo ejecutar la acción administrativa");
      setActionReceipt(payload);
      const refreshRes = await fetch("/api/admin", { cache: "no-store" });
      const refreshPayload = (await refreshRes.json()) as AdminSnapshot & { error?: string };
      if (!refreshRes.ok) throw new Error(refreshPayload.error ?? "No se pudo refrescar el panel");
      setSnapshot(refreshPayload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo ejecutar la acción");
    } finally {
      setIsMutating(false);
    }
  }

  async function exportResultsJson() {
    setErrorMessage(null);
    try {
      const res = await fetch("/api/admin/export", { cache: "no-store" });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? "No se pudo exportar el JSON");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "votar-resultados.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo exportar el JSON");
    }
  }

  if (status === "loading" || (status === "authenticated" && session.user.role !== "AUTORIDAD")) {
    return (
      <main className="page-shell flex items-center justify-center">
        <div className="glass-panel rounded-[28px] px-8 py-10 text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-sm text-brand-ink/60">Cargando panel de autoridad...</p>
        </div>
      </main>
    );
  }

  const registrados = snapshot?.padron.registrados ?? snapshot?.padron.registradas ?? 0;

  return (
    <main className="page-shell">
      <div className="grid gap-6">

        {/* Header */}
        <section className="glass-panel p-7 sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <span className="eyebrow">Panel de autoridad</span>
              <h1 className="section-title">Control de urna, padrón y escrutinio</h1>
              <p className="max-w-2xl text-sm text-brand-ink/65">
                Solo expone identificadores técnicos y estados operativos. Nunca muestra
                DNI, biometría ni tokens en claro.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {lastFetch && (
                <span className="inline-flex items-center gap-1.5 text-xs text-brand-ink/40">
                  <RefreshCcw size={10} />
                  {lastFetch.toLocaleTimeString("es-AR", { timeStyle: "short" })}
                </span>
              )}
              <button
                className="secondary-button"
                onClick={() => void exportResultsJson()}
                type="button"
              >
                <Download size={14} />
                Exportar JSON
              </button>
              <button
                className="secondary-button"
                onClick={() => void signOut({ callbackUrl: "/login" })}
                type="button"
              >
                <LogOut size={14} />
                Salir
              </button>
            </div>
          </div>

          {/* Metrics */}
          <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "Estado", value: <UrnaStateBadge estado={snapshot?.estadoUrna} />, icon: <ShieldCheck size={14} /> },
              { label: "Registrados", value: registrados, icon: <Users size={14} /> },
              { label: "Verificados", value: snapshot?.padron.verificadas ?? 0, icon: <CheckCircle2 size={14} /> },
              { label: "Voto emitido", value: snapshot?.padron.votoEmitido ?? 0, icon: <CheckCircle2 size={14} /> },
              { label: "Total on-chain", value: snapshot?.totalVotos ?? 0, icon: <Link2 size={14} /> }
            ].map(({ label, value, icon }) => (
              <div key={label} className="metric-card">
                <div className="flex items-center gap-1.5">
                  <span className="text-brand-teal">{icon}</span>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">{label}</p>
                </div>
                {isLoading
                  ? <div className="skeleton mt-3 h-9 w-20" />
                  : typeof value === "number"
                    ? <p className="mt-3 text-4xl font-semibold text-brand-ink">{value}</p>
                    : <div className="mt-3">{value}</div>
                }
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">

          {/* Controls + live results */}
          <aside className="grid gap-5 content-start">

            {/* Urna control */}
            <section className="glass-panel p-6">
              <h2 className="text-lg font-semibold text-brand-ink">Control de urna</h2>
              <p className="mt-1 text-sm text-brand-ink/55">Las acciones se registran en blockchain.</p>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="cta-button"
                  disabled={isMutating || snapshot?.estadoUrna === "ABIERTA"}
                  onClick={() => void runAdminAction("ABRIR_URNA")}
                  type="button"
                >
                  {isMutating ? <><span className="spinner-sm" /> Procesando...</> : <><Unlock size={14} /> Abrir urna</>}
                </button>
                <button
                  className="danger-button"
                  disabled={isMutating || snapshot?.estadoUrna !== "ABIERTA"}
                  onClick={() => void runAdminAction("CERRAR_URNA")}
                  type="button"
                >
                  {isMutating ? <><span className="spinner-sm" /> Procesando...</> : <><Lock size={14} /> Cerrar urna</>}
                </button>
              </div>

              <dl className="mt-5 grid gap-2 text-sm">
                <div className="info-row">
                  <dt className="flex items-center gap-1 text-xs text-brand-teal"><Clock size={11} /> Apertura</dt>
                  <dd className="text-xs">{formatDateTime(snapshot?.fechaApertura ?? null)}</dd>
                </div>
                <div className="info-row">
                  <dt className="flex items-center gap-1 text-xs text-brand-teal"><Clock size={11} /> Cierre</dt>
                  <dd className="text-xs">{formatDateTime(snapshot?.fechaCierre ?? null)}</dd>
                </div>
                <div className="info-row">
                  <dt className="flex items-center gap-1 text-xs text-brand-teal"><Link2 size={11} /> Contrato</dt>
                  <dd className="max-w-[10rem] truncate font-mono text-xs">{snapshot?.contractAddress ?? "—"}</dd>
                </div>
              </dl>

              {actionReceipt && (
                <div className="alert-success mt-4">
                  <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{actionReceipt.action === "ABRIR_URNA" ? "Urna abierta" : "Urna cerrada"} en bloque #{actionReceipt.blockNumber}</p>
                    <p className="mt-0.5 break-all font-mono text-xs opacity-80">{actionReceipt.transactionHash}</p>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="alert-error mt-4">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </section>

            {/* Live results */}
            <section className="glass-panel p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-brand-teal" />
                  <h2 className="text-lg font-semibold text-brand-ink">Resultados en vivo</h2>
                </div>
                {snapshot && (
                  <span className="text-xs text-brand-ink/40">{formatDateTime(snapshot.updatedAt)}</span>
                )}
              </div>
              <div className="mt-4 grid gap-3">
                {isLoading
                  ? [1, 2, 3].map((i) => <div key={i} className="skeleton h-16 w-full" />)
                  : (snapshot?.candidatos ?? []).map((c) => {
                    const pct = !snapshot || snapshot.totalVotos === 0 ? 0 : (c.votos / snapshot.totalVotos) * 100;
                    return (
                      <article key={c.id} className="rounded-[20px] border border-brand-line/60 bg-white/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-brand-teal">Candidato {c.id}</p>
                            <h3 className="mt-1 text-base font-semibold text-brand-ink">{c.nombre}</h3>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold text-brand-ink">{c.votos}</p>
                            <p className="text-xs text-brand-ink/50">{pct.toFixed(1)}%</p>
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-line/35">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-brand-teal to-brand-amber transition-[width] duration-700"
                            style={{ width: `${Math.max(pct, snapshot && snapshot.totalVotos > 0 ? 4 : 0)}%` }}
                          />
                        </div>
                      </article>
                    );
                })}
              </div>
            </section>
          </aside>

          {/* Voters table */}
          <section className="glass-panel p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-brand-teal" />
                <h2 className="text-lg font-semibold text-brand-ink">Padrón saneado</h2>
              </div>
              <span className="rounded-full border border-brand-line/60 bg-white/70 px-3 py-1 text-xs font-semibold text-brand-ink/60">
                {snapshot?.voters.length ?? 0} registros
              </span>
            </div>

            {isLoading ? (
              <div className="mt-5 grid gap-2">
                {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12 w-full" />)}
              </div>
            ) : (
              <div className="mt-5 overflow-hidden rounded-[20px] border border-brand-line/60">
                <div className="max-h-[44rem] overflow-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="sticky top-0 bg-brand-ink">
                      <tr>
                        {["ID", "Estado", "Alta", "Verificado", "Votado"].map((h) => (
                          <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/80">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(snapshot?.voters ?? []).map((voter, i) => (
                        <tr
                          key={voter.id}
                          className={`border-t border-brand-line/40 transition hover:bg-brand-mint/30 ${
                            i % 2 === 0 ? "bg-white/80" : "bg-white/50"
                          }`}
                        >
                          <td className="px-4 py-3 font-mono text-[11px] text-brand-ink/60">
                            {voter.id.slice(0, 8)}…
                          </td>
                          <td className="px-4 py-3">
                            <VoterBadge estado={voter.estado} />
                          </td>
                          <td className="px-4 py-3 text-xs text-brand-ink/65">{formatDateTime(voter.createdAt)}</td>
                          <td className="px-4 py-3 text-xs text-brand-ink/65">{formatDateTime(voter.verifiedAt)}</td>
                          <td className="px-4 py-3 text-xs text-brand-ink/65">{formatDateTime(voter.votedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>

      </div>
    </main>
  );
}
