import { useEffect, useState } from "react";
import { getIbkrStatus } from "@/lib/api";

export function IbkrBanner() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    getIbkrStatus()
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false));

    const id = setInterval(() => {
      getIbkrStatus()
        .then((s) => setConnected(s.connected))
        .catch(() => setConnected(false));
    }, 60_000);

    return () => clearInterval(id);
  }, []);

  if (connected === null || connected) return null;

  return (
    <div className="bg-yellow-900/50 border-b border-yellow-700 text-yellow-200 text-sm text-center py-2 px-4">
      IBKR gateway is not connected. Manual refresh and IBKR sync are unavailable.
    </div>
  );
}
