import Link from "next/link";
import { BarChart3, ChevronRight, Fingerprint, Key, Link2, LogIn, ShieldCheck, UserPlus, Vote } from "lucide-react";

const quickLinks = [
  {
    href: "/registro",
    label: "Registro",
    badge: "Paso 1",
    detail: "Alta con DNI, liveness y biometría hasheada.",
    icon: <UserPlus size={18} strokeWidth={1.8} />
  },
  {
    href: "/login",
    label: "Ingreso",
    badge: "Paso 2",
    detail: "Sesión de votante o autoridad electoral.",
    icon: <LogIn size={18} strokeWidth={1.8} />
  },
  {
    href: "/votar",
    label: "Votar",
    badge: "Paso 3",
    detail: "Segunda verificación biométrica y voto en cadena.",
    icon: <Vote size={18} strokeWidth={1.8} />
  },
  {
    href: "/resultados",
    label: "Resultados",
    badge: "Público",
    detail: "Escrutinio público en tiempo real desde Sepolia.",
    icon: <BarChart3 size={18} strokeWidth={1.8} />
  },
  {
    href: "/admin",
    label: "Admin",
    badge: "Autoridad",
    detail: "Control de urna, auditoría y exportación JSON.",
    icon: <ShieldCheck size={18} strokeWidth={1.8} />
  }
];

const trustBadges = [
  { icon: <Key size={12} />, label: "Blind signatures RSA" },
  { icon: <Link2 size={12} />, label: "On-chain inmutable" },
  { icon: <Fingerprint size={12} />, label: "Cero PII en cadena" },
  { icon: <ShieldCheck size={12} />, label: "Sepolia testnet" }
];

export default function HomePage() {
  return (
    <main className="page-shell flex items-center">
      <div className="grid w-full gap-8 lg:grid-cols-[1.2fr_0.8fr]">

        {/* ─── Hero left ─── */}
        <section className="glass-panel flex flex-col justify-between gap-10 overflow-hidden p-8 sm:p-10">
          <div className="space-y-6">
            <span className="eyebrow">Vot.Ar Blockchain</span>

            <div className="space-y-4">
              <h1 className="max-w-2xl text-4xl font-semibold leading-[1.12] text-brand-ink sm:text-5xl lg:text-[3.4rem]">
                Identidad verificada,{" "}
                <span className="text-brand-teal">voto anónimo</span> y escrutinio
                público en una sola urna.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-brand-ink/68 sm:text-lg">
                Plataforma para elecciones universitarias o municipales de hasta 5.000
                votantes, con doble verificación biométrica, tokens anónimos firmados
                ciegamente y conteo inmutable en Sepolia.
              </p>
            </div>

            {/* CTA buttons */}
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/registro" className="cta-button">
                <UserPlus size={16} />
                Registrarse
              </Link>
              <Link href="/resultados" className="secondary-button">
                <BarChart3 size={16} />
                Ver resultados
              </Link>
            </div>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap gap-2">
            {trustBadges.map((b) => (
              <span
                key={b.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-line/70 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-brand-ink/65"
              >
                <span className="text-brand-teal">{b.icon}</span>
                {b.label}
              </span>
            ))}
          </div>
        </section>

        {/* ─── Quick links right ─── */}
        <div className="grid gap-3 content-start">
          {quickLinks.map((link, index) => (
            <Link
              key={link.href}
              href={link.href}
              className="group glass-card animate-fade-up flex items-start gap-4 rounded-[24px] p-5 hover:-translate-y-0.5"
              style={{ animationDelay: `${index * 80}ms` }}
            >
              {/* Icon box */}
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-mint/80 text-brand-teal transition group-hover:bg-brand-teal group-hover:text-white">
                {link.icon}
              </div>

              {/* Text */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-brand-ink">{link.label}</h2>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full border border-brand-line/60 bg-brand-sand/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink/55">
                      {link.badge}
                    </span>
                    <ChevronRight
                      size={14}
                      className="text-brand-ink/30 transition group-hover:translate-x-0.5 group-hover:text-brand-teal"
                    />
                  </div>
                </div>
                <p className="mt-0.5 text-sm text-brand-ink/60">{link.detail}</p>
              </div>
            </Link>
          ))}
        </div>

      </div>
    </main>
  );
}
