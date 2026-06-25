"use client";

import { MouseEvent, ReactNode, useRef } from "react";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
  borderRadius?: string;
}

export function SpotlightCard({
  children,
  className = "",
  spotlightColor = "rgba(14, 95, 90, 0.09)",
  borderRadius = "22px"
}: SpotlightCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!containerRef.current || !overlayRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    overlayRef.current.style.background = `radial-gradient(380px circle at ${x}px ${y}px, ${spotlightColor}, transparent 65%)`;
  }

  function handleMouseLeave() {
    if (overlayRef.current) overlayRef.current.style.background = "transparent";
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`relative ${className}`}
    >
      <div
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-all duration-200"
        style={{ borderRadius, background: "transparent" }}
      />
      {children}
    </div>
  );
}
