"use client";

import NumberFlow from "@number-flow/react";

interface AnimatedNumberProps {
  value: number;
  className?: string;
}

export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  return (
    <NumberFlow
      value={value}
      className={className}
      willChange
      transformTiming={{ duration: 600, easing: "ease-out" }}
      spinTiming={{ duration: 600, easing: "ease-out" }}
    />
  );
}
