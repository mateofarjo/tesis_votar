"use client";

import { ShieldOff } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";

export default function UnauthorizedPage() {
  const { data: session } = useSession();

  const backHref =
    session?.user.role === "AUTORIDAD"
      ? "/admin"
      : session?.user.role === "VOTANTE"
        ? "/votar"
        : "/login";

  const backLabel =
    session?.user.role === "AUTORIDAD"
      ? "Ir al panel de administración"
      : session?.user.role === "VOTANTE"
        ? "Ir a votar"
        : "Iniciar sesión";

  return (
    <main className="page-shell flex items-center justify-center">
      <div className="glass-panel w-full max-w-md px-8 py-10 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
          <ShieldOff size={28} aria-hidden />
        </div>

        <h1 className="mb-2 font-heading text-2xl font-semibold text-brand-ink">
          Acceso no autorizado
        </h1>
        <p className="mb-8 text-sm text-brand-ink/60">
          No tenés permiso para ver esta página. Si creés que es un error,
          iniciá sesión con la cuenta correcta.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href={backHref} className="cta-button">
            {backLabel}
          </Link>
          <Link href="/" className="secondary-button">
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
