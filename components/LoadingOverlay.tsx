"use client";
import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";

interface LoadingCtx {
  showLoading: (message?: string, waitForTradeId?: string) => void;
  hideLoading: () => void;
  isLoading: boolean;
  pendingTradeId: string | null;
}

const Ctx = createContext<LoadingCtx>({
  showLoading: () => {},
  hideLoading: () => {},
  isLoading: false,
  pendingTradeId: null,
});

export function useLoading() { return useContext(Ctx); }

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Processing...");
  const [pendingTradeId, setPendingTradeId] = useState<string | null>(null);
  const timeoutRef = useRef<any>(null);

  const showLoading = useCallback((msg?: string, waitForTradeId?: string) => {
    setMessage(msg || "Processing...");
    setLoading(true);
    if (waitForTradeId) setPendingTradeId(waitForTradeId);

    // Safety: auto-dismiss after 20s to prevent stuck state
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setLoading(false);
      setPendingTradeId(null);
    }, 20000);
  }, []);

  const hideLoading = useCallback(() => {
    setLoading(false);
    setPendingTradeId(null);
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  useEffect(() => { return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }; }, []);

  return (
    <Ctx.Provider value={{ showLoading, hideLoading, isLoading: loading, pendingTradeId }}>
      {children}
      {loading && <LoadingOverlay message={message} />}
    </Ctx.Provider>
  );
}

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9998,
      background: "rgba(8,8,12,0.85)",
      backdropFilter: "blur(6px)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.15s ease",
    }}>
      {/* Pulsing line */}
      <div style={{ width: 120, height: 2, background: "var(--surface-3)", overflow: "hidden", marginBottom: 16 }}>
        <div style={{
          width: "40%", height: "100%",
          background: "var(--accent)",
          animation: "loaderSlide 1.2s ease-in-out infinite",
        }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color: "var(--t2)", letterSpacing: "0.5px" }}>{message}</span>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes loaderSlide {
          0% { transform: translateX(-120px); }
          50% { transform: translateX(180px); }
          100% { transform: translateX(-120px); }
        }
      `}} />
    </div>
  );
}
