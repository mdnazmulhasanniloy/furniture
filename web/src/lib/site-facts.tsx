"use client";

import { createContext, useContext } from "react";

// Facts computed from the live site settings, shared with client components (CR-011 fix 3): the number of
// ACTIVE delivery cities. Copy must never claim more than this ("in N Saudi cities", never "across Saudi Arabia").
const Ctx = createContext<{ cityCount: number }>({ cityCount: 0 });

export function SiteFactsProvider({ cityCount, children }: { cityCount: number; children: React.ReactNode }) {
  return <Ctx.Provider value={{ cityCount }}>{children}</Ctx.Provider>;
}

/** Active delivery cities (0 when settings are unavailable: callers then hide the line). */
export function useCityCount(): number {
  return useContext(Ctx).cityCount;
}
