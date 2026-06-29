"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertCircle, Home, RefreshCcw } from "lucide-react";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page-shell flex items-center justify-center">
      <div className="glass-panel w-full max-w-md px-8 py-10 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
          <AlertCircle size={28} />
        </div>
        <span className="eyebrow">Error inesperado</span>
        <h1 className="mt-4 text-2xl font-semibold text-brand-ink">
          Algo salió mal
        </h1>
        <p className="mt-3 text-sm text-brand-ink/60">
          {error.message || "Ocurrió un error al cargar esta página."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-brand-ink/35">
            ref: {error.digest}
          </p>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button className="cta-button" onClick={reset} type="button">
            <RefreshCcw size={14} />
            Reintentar
          </button>
          <Link className="secondary-button" href="/">
            <Home size={14} />
            Ir al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
