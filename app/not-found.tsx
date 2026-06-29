import Link from "next/link";
import { BarChart3, Home, SearchX } from "lucide-react";

export default function NotFoundPage() {
  return (
    <main className="page-shell flex items-center justify-center">
      <div className="glass-panel w-full max-w-md px-8 py-10 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-mint text-brand-teal">
          <SearchX size={28} />
        </div>
        <span className="eyebrow">404 — Página no encontrada</span>
        <h1 className="mt-4 text-2xl font-semibold text-brand-ink">
          Esta ruta no existe
        </h1>
        <p className="mt-3 text-sm text-brand-ink/60">
          La página que buscás no existe o fue movida.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link className="cta-button" href="/">
            <Home size={14} />
            Ir al inicio
          </Link>
          <Link className="secondary-button" href="/resultados">
            <BarChart3 size={14} />
            Ver resultados
          </Link>
        </div>
      </div>
    </main>
  );
}
