"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { AlertCircle, Eye, EyeOff, Fingerprint, Lock, LogIn, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

type LoginMode = "VOTANTE" | "AUTORIDAD";

function getLoginErrorMessage(error: string | null | undefined) {
  if (!error) return "No se pudo iniciar sesión";
  if (error === "CredentialsSignin") return "Las credenciales no son válidas para el rol seleccionado";
  return error;
}

export default function LoginPage() {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<LoginMode>("VOTANTE");
  const [dni, setDni] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      window.location.href = session?.user.role === "AUTORIDAD" ? "/admin" : "/votar";
    }
  }, [session?.user.role, status]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await signIn("credentials", {
      dni,
      password,
      redirect: false,
      role: mode,
      username
    });

    setIsSubmitting(false);

    if (!result || !result.ok) {
      setErrorMessage(getLoginErrorMessage(result?.error));
      return;
    }

    window.location.href = mode === "AUTORIDAD" ? "/admin" : "/votar";
  }

  return (
    <main className="page-shell flex items-center">
      <div className="grid w-full gap-6 lg:grid-cols-[0.9fr_1.1fr]">

        {/* ─── Info panel ─── */}
        <aside className="glass-panel flex flex-col gap-6 p-8 sm:p-10">
          <div className="space-y-4">
            <span className="eyebrow">Acceso seguro</span>
            <h1 className="text-3xl font-semibold leading-tight text-brand-ink sm:text-4xl">
              Ingreso diferenciado para votante y autoridad electoral
            </h1>
            <p className="text-sm leading-relaxed text-brand-ink/68 sm:text-base">
              El votante ingresa con su DNI registrado y activa el segundo factor
              biométrico. La autoridad administra la urna con credenciales separadas y
              firma de servidor.
            </p>
          </div>

          <div className="grid gap-3">
            <div
              className={`rounded-[22px] border p-5 transition ${
                mode === "VOTANTE"
                  ? "border-brand-teal/40 bg-brand-mint/60"
                  : "border-brand-line/60 bg-white/60"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-teal/15 text-brand-teal">
                  <Fingerprint size={16} />
                </div>
                <p className="text-sm font-semibold text-brand-teal">Votante</p>
              </div>
              <p className="mt-2 text-sm text-brand-ink/65">
                Accede a la boleta solo después del liveness final y la emisión del
                token anónimo.
              </p>
            </div>

            <div
              className={`rounded-[22px] border p-5 transition ${
                mode === "AUTORIDAD"
                  ? "border-brand-amber/40 bg-amber-50/60"
                  : "border-brand-line/60 bg-white/60"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-brand-amber">
                  <ShieldCheck size={16} />
                </div>
                <p className="text-sm font-semibold text-brand-amber">Autoridad</p>
              </div>
              <p className="mt-2 text-sm text-brand-ink/65">
                Controla apertura y cierre de urna, padrón sin datos sensibles y
                exportación del escrutinio.
              </p>
            </div>
          </div>
        </aside>

        {/* ─── Form panel ─── */}
        <section className="glass-panel p-8 sm:p-10">
          <h2 className="text-2xl font-semibold text-brand-ink">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-brand-ink/60">Seleccioná tu rol y completá los datos.</p>

          {/* Role tabs */}
          <div className="mt-6 flex rounded-2xl border border-brand-line/60 bg-white/60 p-1">
            <button
              type="button"
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                mode === "VOTANTE"
                  ? "bg-brand-teal text-white shadow-sm"
                  : "text-brand-ink/60 hover:text-brand-ink"
              }`}
              onClick={() => { setMode("VOTANTE"); setErrorMessage(null); }}
            >
              <Fingerprint size={14} />
              Votante
            </button>
            <button
              type="button"
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                mode === "AUTORIDAD"
                  ? "bg-brand-ink text-white shadow-sm"
                  : "text-brand-ink/60 hover:text-brand-ink"
              }`}
              onClick={() => { setMode("AUTORIDAD"); setErrorMessage(null); }}
            >
              <ShieldCheck size={14} />
              Autoridad
            </button>
          </div>

          <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
            {mode === "VOTANTE" ? (
              <label className="grid gap-2">
                <span className="field-label">DNI registrado</span>
                <div className="relative">
                  <UserRound
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-ink/35"
                  />
                  <input
                    className="field-input field-input-icon"
                    inputMode="numeric"
                    onChange={(e) => setDni(e.target.value)}
                    placeholder="30111222"
                    required
                    value={dni}
                  />
                </div>
              </label>
            ) : (
              <>
                <label className="grid gap-2">
                  <span className="field-label">Usuario de autoridad</span>
                  <div className="relative">
                    <ShieldCheck
                      size={15}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-ink/35"
                    />
                    <input
                      className="field-input field-input-icon"
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="autoridad"
                      required
                      value={username}
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className="field-label">Contraseña</span>
                  <div className="relative">
                    <Lock
                      size={15}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-ink/35"
                    />
                    <input
                      className="field-input field-input-icon pr-11"
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-ink/40 transition hover:text-brand-ink"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>
              </>
            )}

            {errorMessage && (
              <div className="alert-error">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <button
                className="cta-button"
                disabled={isSubmitting || status === "loading"}
                type="submit"
              >
                {isSubmitting ? (
                  <>
                    <span className="spinner-sm" />
                    Validando...
                  </>
                ) : (
                  <>
                    <LogIn size={15} />
                    Iniciar sesión
                  </>
                )}
              </button>
              <Link className="secondary-button" href="/registro">
                Registrarse
              </Link>
            </div>
          </form>
        </section>

      </div>
    </main>
  );
}
