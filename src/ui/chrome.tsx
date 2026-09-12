/**
 * Who owns the top of the screen.
 *
 * A detail page is full-screen over its tab with a back chevron — SPEC §1. It was not:
 * the tab's own header ("Today", the date, the gear) stayed put above it, so the Sleep
 * page opened with two headings, two type scales and a date that had nothing to do with
 * the week being shown.
 *
 * A detail page cannot simply render its own header, because the tab header lives a
 * level up in `App`. So it says so instead: `useOwnsScreen()` tells the shell to stand
 * down for as long as that page is mounted.
 *
 * It is a COUNT, not a flag. Strict mode mounts an effect, tears it down and mounts it
 * again, and a flag would come back false while the page is still on screen. A count
 * survives that, and survives one detail page replacing another mid-transition.
 *
 * It runs in a LAYOUT effect: a passive effect lands after paint, which is one frame of
 * the tab header flashing above every detail page you open.
 */

import {
  createContext, useCallback, useContext, useLayoutEffect, useMemo, useState,
  type ReactNode,
} from "react";

interface Chrome {
  /** True while any full-screen page is mounted. */
  hidden: boolean;
  claim: (n: 1 | -1) => void;
}

const ChromeContext = createContext<Chrome>({ hidden: false, claim: () => {} });

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState(0);
  const claim = useCallback((n: 1 | -1) => setClaims((c) => Math.max(0, c + n)), []);
  const value = useMemo(() => ({ hidden: claims > 0, claim }), [claims, claim]);
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): Chrome {
  return useContext(ChromeContext);
}

/**
 * Called by every full-screen page. Also puts the scroll back to the top: opening a
 * detail page from a card halfway down a long tab used to land you halfway down the
 * detail page, at whatever the old scroll position happened to be.
 */
export function useOwnsScreen(): void {
  const { claim } = useChrome();
  useLayoutEffect(() => {
    claim(1);
    window.scrollTo({ top: 0, behavior: "auto" });
    return () => claim(-1);
  }, [claim]);
}
