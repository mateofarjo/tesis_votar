"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Clock,
  ExternalLink,
  Link2,
  RefreshCcw,
  ShieldCheck,
  Trophy
} from "lucide-react";

type ResultadoCandidato = { id: number; nombre: string; votos: number };
type ResultadosResponse = {
  candidatos: ResultadoCandidato[];
  contractAddress: string;
  estadoUrna: "CERRADA" | "ABIERTA" | "FINALIZADA";
  fechaApertura: string | null;
  fechaCierre: string | null;
  totalVotos: number;
  updatedAt: string;
};

const REFRESH_INTERVAL_MS = 8_000;

function formatDateTime(value: string | null) {
  if (!value) return "Sin registro";
  const n = Number(value);
  const date = Number.isFinite(n) ? new Date(n * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin registro";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function UrnaStatusBadge({ estado }: { estado: ResultadosResponse["estadoUrna"] | undefined }) {
  if (!estado) return <div className="skeleton h-7 w-20" />;
  if (estado === "ABIERTA")
    return (
      <span className="live-badge">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-live-pulse" />
        En vivo · Abierta
      </span>
    );
  if (estado === "FINALIZADA")
    return <span className="status-chip-warning"><Trophy size={12} /> Finalizada</span>;
  return <span className="status-chip"><Clock size={12} /> Cerrada</span>;
}

export default function ResultadosPage() {
  const [data, setData] = useState<ResultadosResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchResultados() {
      try {
        const res = await fetch("/api/resultados", { cache: "no-store" });
        const payload = (await res.json()) as ResultadosResponse & { error?: string };
        if (!res.ok) throw new Error(payload.error ?? "No se pudieron cargar los resultados");
        if (!isMounted) return;
        startTransition(() => setData(payload));
        setLastFetch(new Date());
        setErrorMessage(null);
      } catch (error) {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : "No se pudieron cargar los resultados");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void fetchResultados();
    const id = window.setInterval(() => void fetchResultados(), REFRESH_INTERVAL_MS);
    return () => { isMounted = false; window.clearInterval(id); };
  }, []);

  const totalVotes = data?.totalVotos ?? 0;

  /* Find winner (only show if urna is FINALIZADA or there's a clear lead) */
  const sortedCandidates = data
    ? [...data.candidatos].sort((a, b) => b.votos - a.votos)
    : [];
  const winner = data?.estadoUrna === "FINALIZADA" && sortedCandidates[0]?.votos > 0
    ? sortedCandidates[0]
    : null;

  return (
    <main className="page-shell">
      <div className="grid gap-6">

        {/* Header */}
        <section className="glass-panel p-7 sm:p-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-3">
              <span className="eyebrow">Escrutinio público</span>
              <h1 className="section-title">Resultados en tiempo real desde Sepolia</h1>
              <p className="max-w-xl text-sm text-brand-ink/65 sm:text-base">
                La identidad nunca llega a cadena. Solo se contabilizan tokens anónimos
                validados por la clave pública oficial.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <UrnaStatusBadge estado={data?.estadoUrna} />
              {lastFetch && (
                <span className="inline-flex items-center gap-1.5 text-xs text-brand-ink/45">
                  <RefreshCcw size={10} />
                  {lastFetch.toLocaleTimeString("es-AR", { timeStyle: "short" })}
                </span>
              )}
            </div>
          </div>

          {/* Metrics row */}
          <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="metric-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">Total votos</p>
              {isLoading
                ? <div className="skeleton mt-3 h-10 w-24" />
                : <p className="mt-3 text-4xl font-semibold text-brand-ink">{totalVotes}</p>
              }
            </div>
            <div className="metric-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">Candidatos</p>
              {isLoading
                ? <div className="skeleton mt-3 h-10 w-16" />
                : <p className="mt-3 text-4xl font-semibold text-brand-ink">{data?.candidatos.length ?? 0}</p>
              }
            </div>
            <div className="metric-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">Apertura</p>
              {isLoading
                ? <div className="skeleton mt-3 h-5 w-32" />
                : <p className="mt-3 text-sm font-medium text-brand-ink">{formatDateTime(data?.fechaApertura ?? null)}</p>
              }
            </div>
            <div className="metric-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">Cierre</p>
              {isLoading
                ? <div className="skeleton mt-3 h-5 w-32" />
                : <p className="mt-3 text-sm font-medium text-brand-ink">{formatDateTime(data?.fechaCierre ?? null)}</p>
              }
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">

          {/* Candidate bars */}
          <section className="glass-panel p-7 sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold text-brand-ink">Conteo por candidato</h2>
              <BarChart3 size={20} className="text-brand-ink/30" />
            </div>

            {errorMessage && (
              <div className="alert-error mt-5">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Winner highlight */}
            {winner && (
              <div className="mt-5 flex items-center gap-3 rounded-[22px] border border-amber-200 bg-amber-50/70 px-5 py-4">
                <Trophy size={20} className="flex-shrink-0 text-brand-amber" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-amber">Ganador</p>
                  <p className="mt-0.5 text-lg font-semibold text-brand-ink">{winner.nombre}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-2xl font-bold text-brand-ink">{winner.votos}</p>
                  <p className="text-xs text-brand-ink/55">{totalVotes > 0 ? ((winner.votos / totalVotes) * 100).toFixed(1) : 0}%</p>
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-4">
              {isLoading
                ? [1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-24 w-full" />
                ))
                : sortedCandidates.map((candidate, index) => {
                const percentage = totalVotes === 0 ? 0 : (candidate.votos / totalVotes) * 100;
                const isLeader = index === 0 && candidate.votos > 0 && totalVotes > 0;

                return (
                  <article
                    key={candidate.id}
                    className={`animate-fade-up rounded-[22px] border p-5 ${
                      isLeader && data?.estadoUrna === "FINALIZADA"
                        ? "border-amber-200 bg-amber-50/50"
                        : "border-brand-line/60 bg-white/75"
                    }`}
                    style={{ animationDelay: `${index * 80}ms` }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-teal">
                          Candidato {candidate.id}
                        </p>
                        <h3 className="mt-1.5 text-lg font-semibold text-brand-ink">{candidate.nombre}</h3>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-brand-ink">{candidate.votos}</p>
                        <p className="text-sm text-brand-ink/55">{percentage.toFixed(1)}%</p>
                      </div>
                    </div>
                    <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-brand-line/35">
                      <div
                        className={`h-full rounded-full transition-[width] duration-700 ${
                          isLeader
                            ? "bg-gradient-to-r from-brand-teal to-brand-amber"
                            : "bg-brand-teal/60"
                        }`}
                        style={{ width: `${totalVotes > 0 ? Math.max(percentage, 3) : 0}%` }}
                      />
                    </div>
                  </article>
                );
              })}

              {!isLoading && (data?.candidatos.length ?? 0) === 0 && (
                <div className="rounded-[22px] border border-brand-line/60 bg-white/75 px-6 py-8 text-center text-sm text-brand-ink/55">
                  El contrato aún no expone candidatos o no se sincronizó el despliegue.
                </div>
              )}
            </div>
          </section>

          {/* Right sidebar */}
          <aside className="grid gap-4 content-start">

            {/* Contract */}
            <section className="metric-card">
              <div className="flex items-center gap-2">
                <Link2 size={15} className="text-brand-teal" />
                <p className="text-sm font-semibold text-brand-ink">Contrato en Sepolia</p>
              </div>
              {isLoading
                ? <div className="skeleton mt-4 h-10 w-full" />
                : <>
                  <p className="mt-3 break-all font-mono text-xs text-brand-ink/65">
                    {data?.contractAddress ?? "Sin configurar"}
                  </p>
                  {data?.contractAddress && (
                    <a
                      className="secondary-button mt-4"
                      href={`https://sepolia.etherscan.io/address/${data.contractAddress}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink size={14} />
                      Ver en Etherscan
                    </a>
                  )}
                </>
              }
            </section>

            {/* Guarantees */}
            <section className="metric-card">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={15} className="text-brand-teal" />
                <h2 className="text-base font-semibold text-brand-ink">Garantías del escrutinio</h2>
              </div>
              <ul className="grid gap-2.5">
                {[
                  "Los votos se almacenan como eventos on-chain inmutables.",
                  "El doble voto se bloquea por tokenHash en el contrato.",
                  "La identidad del padrón solo existe en PostgreSQL, nunca en cadena."
                ].map((text, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-brand-ink/68">
                    <ShieldCheck size={13} className="mt-0.5 flex-shrink-0 text-brand-teal/70" />
                    {text}
                  </li>
                ))}
              </ul>
            </section>

            {/* Navigation */}
            <div className="flex flex-col gap-2">
              <Link className="secondary-button" href="/login">
                Ir al login
              </Link>
              <Link className="cta-button" href="/votar">
                <span>Ir a votar</span>
              </Link>
            </div>
          </aside>

        </div>
      </div>
    </main>
  );
}
