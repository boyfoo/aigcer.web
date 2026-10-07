import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { collectionPath } from "./lib/content.js";

const CategoryMotionContext = createContext(null);
const categories = [[undefined, "全部"], ["videos", "视频"], ["storyboards", "分镜图片"], ["prompts", "提示词参考"]];

export function CreationCategoryMotionProvider({ children }) {
  const pending = useRef(null);
  const pathname = usePathname();

  useEffect(() => {
    if (pending.current?.to !== pathname) pending.current = null;
  }, [pathname]);

  useEffect(() => {
    const clear = () => { pending.current = null; };
    window.addEventListener("popstate", clear);
    return () => window.removeEventListener("popstate", clear);
  }, []);

  return <CategoryMotionContext.Provider value={pending}>{children}</CategoryMotionContext.Provider>;
}

export function CreationCategoryNav({ slug }) {
  const pending = useContext(CategoryMotionContext);
  const navRef = useRef(null);
  const indicatorRef = useRef(null);
  const animationRef = useRef(null);
  const incomingRef = useRef(null);
  const layoutRef = useRef(null);
  const positionRef = useRef(null);
  const activePath = slug ? collectionPath(slug) : "/";

  const stopAnimation = () => {
    if (!animationRef.current) return;
    animationRef.current.onfinish = null;
    animationRef.current.cancel();
    animationRef.current = null;
  };

  const resetPosition = () => {
    pending.current = null;
    layoutRef.current = null;
    positionRef.current?.();
  };

  useLayoutEffect(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let mounted = true;
    // Keep the consumed source for StrictMode's effect setup/cleanup replay.
    if (pending.current?.to === activePath) incomingRef.current = pending.current;
    pending.current = null;
    layoutRef.current = null;

    const position = (source) => {
      const active = nav.querySelector('[aria-current="page"]');
      const bounds = nav.getBoundingClientRect();
      const target = active.getBoundingClientRect();
      const layout = { x: target.left - bounds.left, y: target.bottom - bounds.top - 2, width: target.width, navWidth: bounds.width };
      if (!source && layoutRef.current && Object.keys(layout).every((key) => Math.abs(layout[key] - layoutRef.current[key]) < 0.5)) return;
      stopAnimation();
      layoutRef.current = layout;
      indicator.style.width = `${layout.width}px`;
      indicator.style.transform = `translate(${layout.x}px, ${layout.y}px)`;
      nav.dataset.indicatorReady = "true";
      if (!source || preference.matches || typeof indicator.animate !== "function" ||
          Math.abs(source.navWidth - layout.navWidth) > 0.5 || Math.abs(source.y - layout.y) > 0.5) return;
      const sourceCenter = source.x + source.width / 2;
      const targetCenter = layout.x + layout.width / 2;
      const distance = targetCenter - sourceCenter;
      const stretch = Math.min(6, Math.min(source.width, layout.width) * 0.2, Math.abs(distance) * 0.05);
      const rebound = Math.sign(distance) * Math.min(3, Math.abs(distance) * 0.06);
      // Reserve a visible return phase without stretching across the tab spacing.
      const frame = (center, width, offset, easing = "linear") => ({
        transform: `translate(${center - width / 2}px, ${layout.y}px)`,
        width: `${width}px`,
        offset,
        easing,
      });
      const animation = indicator.animate([
        frame(sourceCenter, source.width, 0, "cubic-bezier(0.25, 0.5, 0.55, 1)"),
        frame(targetCenter + rebound, layout.width + stretch, 0.68, "cubic-bezier(0.35, 0, 0.45, 1)"),
        frame(targetCenter, layout.width, 1),
      ], { duration: 300, easing: "linear" });
      animationRef.current = animation;
      animation.onfinish = () => {
        if (animationRef.current !== animation) return;
        animationRef.current = null;
        animation.cancel();
      };
    };

    positionRef.current = position;
    const incoming = incomingRef.current;
    position(incoming?.to === activePath && performance.now() - incoming.at < 2000 ? incoming.from : null);
    const observer = new ResizeObserver(() => position());
    observer.observe(nav);
    const measureFonts = () => { if (mounted) position(); };
    document.fonts.ready.then(measureFonts);
    document.fonts.addEventListener("loadingdone", measureFonts);
    const stopForPreference = () => {
      pending.current = null;
      layoutRef.current = null;
      position();
    };
    preference.addEventListener("change", stopForPreference);
    return () => {
      mounted = false;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measureFonts);
      preference.removeEventListener("change", stopForPreference);
      positionRef.current = null;
      stopAnimation();
    };
  }, [activePath, pending]);

  const prepareNavigation = (event, to) => {
    pending.current = null;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        event.detail === 0 || to === activePath || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      resetPosition();
      return;
    }
    const nav = navRef.current.getBoundingClientRect();
    const line = indicatorRef.current.getBoundingClientRect();
    const from = { x: line.left - nav.left, y: line.top - nav.top, width: line.width, navWidth: nav.width };
    // Freeze the current visual position before the next route replaces this nav.
    stopAnimation();
    layoutRef.current = null;
    indicatorRef.current.style.transform = `translate(${from.x}px, ${from.y}px)`;
    indicatorRef.current.style.width = `${from.width}px`;
    pending.current = { to, from, at: performance.now() };
  };

  return (
    <nav className="browse-categories" aria-label="案例分类" ref={navRef} onKeyDownCapture={resetPosition}>
      {categories.map(([categorySlug, label]) => {
        const href = categorySlug ? collectionPath(categorySlug) : "/";
        return <Link key={categorySlug || "all"} href={href} aria-current={slug === categorySlug ? "page" : undefined} onClick={(event) => prepareNavigation(event, href)}>{label}</Link>;
      })}
      <span className="browse-category-indicator" aria-hidden="true" ref={indicatorRef} />
    </nav>
  );
}
