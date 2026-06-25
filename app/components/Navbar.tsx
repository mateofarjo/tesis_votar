"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { BarChart3, LogIn, LogOut, Menu, ShieldCheck, UserPlus, Vote, X } from "lucide-react";
import { useState } from "react";

export function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isAdmin = session?.user.role === "AUTORIDAD";
  const isVotante = session?.user.role === "VOTANTE";
  const isAuth = status === "authenticated";
  const isLoading = status === "loading";

  return (
    <header className="sticky top-0 z-50 border-b border-brand-line/50 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">

        {/* Logo */}
        <Link
          href="/"
          className="group flex items-center gap-2.5 focus:outline-none"
          onClick={() => setOpen(false)}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-teal text-white transition group-hover:bg-brand-ink">
            <Vote size={15} strokeWidth={2.3} />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-heading text-[17px] font-semibold tracking-tight text-brand-ink">
              Vot.Ar
            </span>
            <span className="hidden text-[11px] font-medium text-brand-ink/40 sm:inline">
              Blockchain
            </span>
          </div>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden items-center gap-0.5 sm:flex">
          <NavPill href="/" active={pathname === "/"} label="Inicio" />
          <NavPill
            href="/resultados"
            active={pathname.startsWith("/resultados")}
            icon={<BarChart3 size={13} />}
            label="Resultados"
          />
          {isVotante && (
            <NavPill
              href="/votar"
              active={pathname.startsWith("/votar")}
              icon={<Vote size={13} />}
              label="Votar"
            />
          )}
          {isAdmin && (
            <NavPill
              href="/admin"
              active={pathname.startsWith("/admin")}
              icon={<ShieldCheck size={13} />}
              label="Admin"
            />
          )}
        </nav>

        {/* Desktop auth area */}
        <div className="hidden items-center gap-2 sm:flex">
          {isLoading && (
            <div className="h-8 w-24 animate-pulse rounded-full bg-brand-line/40" />
          )}

          {isAuth && (
            <button
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-line bg-white/90 px-4 py-2 text-sm font-medium text-brand-ink/70 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={13} />
              Salir
            </button>
          )}

          {!isAuth && !isLoading && (
            <>
              <Link
                href="/registro"
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-line bg-white/80 px-4 py-2 text-sm font-medium text-brand-ink/75 transition hover:border-brand-teal hover:text-brand-teal"
              >
                <UserPlus size={13} />
                Registro
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-teal"
              >
                <LogIn size={13} />
                Ingresar
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand-line/60 bg-white/80 sm:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
        >
          {open ? (
            <X size={17} className="text-brand-ink" />
          ) : (
            <Menu size={17} className="text-brand-ink" />
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="animate-fade-in border-t border-brand-line/40 bg-white/96 px-4 pb-4 pt-2 sm:hidden">
          <nav className="grid gap-1.5">
            <MobileLink href="/" label="Inicio" onClick={() => setOpen(false)} />
            <MobileLink
              href="/resultados"
              label="Resultados públicos"
              onClick={() => setOpen(false)}
            />
            {isVotante && (
              <MobileLink
                href="/votar"
                label="Cabina de votación"
                onClick={() => setOpen(false)}
              />
            )}
            {isAdmin && (
              <MobileLink
                href="/admin"
                label="Panel de autoridad"
                onClick={() => setOpen(false)}
              />
            )}

            <div className="my-1 border-t border-brand-line/40" />

            {isAuth ? (
              <button
                onClick={() => {
                  void signOut({ callbackUrl: "/login" });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-2.5 text-sm font-medium text-red-600"
              >
                <LogOut size={14} />
                Cerrar sesión
              </button>
            ) : (
              <>
                <MobileLink
                  href="/registro"
                  label="Registrarse"
                  onClick={() => setOpen(false)}
                />
                <MobileLink
                  href="/login"
                  label="Ingresar"
                  onClick={() => setOpen(false)}
                />
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

/* ─── Sub-components ─── */

function NavPill({
  href,
  active,
  icon,
  label
}: {
  href: string;
  active: boolean;
  icon?: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-brand-teal/10 text-brand-teal"
          : "text-brand-ink/60 hover:bg-brand-mint/70 hover:text-brand-teal"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function MobileLink({
  href,
  label,
  onClick
}: {
  href: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center rounded-2xl border border-brand-line/50 bg-white/70 px-4 py-2.5 text-sm font-medium text-brand-ink transition hover:border-brand-teal/40 hover:text-brand-teal"
    >
      {label}
    </Link>
  );
}
