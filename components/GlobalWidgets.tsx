"use client";
import { useState, useEffect } from "react";
import AutoTaker from "@/components/AutoTaker";

export default function GlobalWidgets({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <>
      {children}
      {mounted && <AutoTaker />}
    </>
  );
}
