"use client";
import { useState, useEffect } from "react";
import AutoTaker from "@/components/AutoTaker";
import { LoadingProvider } from "@/components/LoadingOverlay";

export default function GlobalWidgets({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <LoadingProvider>
      {children}
      {mounted && <AutoTaker />}
    </LoadingProvider>
  );
}
