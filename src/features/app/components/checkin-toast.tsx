"use client";

import { useEffect, useState } from "react";
import { CheckInResult } from "../types";

interface CheckInToastProps {
  result: CheckInResult | null;
  onDismiss: () => void;
}

export function CheckInToast({ result, onDismiss }: CheckInToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!result) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 3000);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  if (!result) return null;

  return (
    <div
      className={`
        fixed top-4 left-1/2 -translate-x-1/2 z-50
        transition-all duration-300
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"}
      `}
    >
      <div
        className="rounded-xl border border-[#00ff41]/40 bg-black px-5 py-3 shadow-lg"
        style={{ boxShadow: "0 0 20px rgba(0,255,65,0.3)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">
            {result.alreadyCheckedIn ? "⚠" : result.multiplier >= 3 ? "⚡" : "✓"}
          </span>
          <div>
            <p className="font-mono text-sm font-bold text-[#00ff41]">
              {result.alreadyCheckedIn
                ? "Already checked in"
                : `+${result.pointsEarned.toLocaleString()} ZP`}
            </p>
            <p className="font-mono text-[10px] text-[#00ff41]/60">
              {result.message}
            </p>
          </div>
          {!result.alreadyCheckedIn && result.multiplier > 1 && (
            <span className="font-mono text-xs font-black text-[#00ff41] border border-[#00ff41]/40 rounded px-1">
              {result.multiplier}x
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
