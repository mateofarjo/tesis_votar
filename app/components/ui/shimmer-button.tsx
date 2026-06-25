import { ButtonHTMLAttributes, ReactNode } from "react";

interface ShimmerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function ShimmerButton({ children, className = "", ...props }: ShimmerButtonProps) {
  return (
    <button
      {...props}
      className={`relative overflow-hidden inline-flex items-center justify-center gap-2 rounded-full bg-brand-ink px-5 py-2.5 text-sm font-semibold text-white shadow-sm
        transition hover:-translate-y-px hover:bg-brand-teal hover:shadow-md
        active:translate-y-0 active:shadow-sm
        disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-brand-ink
        ${className}`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent bg-[length:200%_100%] animate-shimmer"
      />
      {children}
    </button>
  );
}
