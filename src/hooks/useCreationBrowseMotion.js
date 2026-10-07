import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const easing = "cubic-bezier(0.23, 1, 0.32, 1)";

function measure(root, selector, attribute, clone = false) {
  const records = new Map();
  const bounds = root.getBoundingClientRect();
  for (const element of root.querySelectorAll(selector)) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    records.set(element.getAttribute(attribute), {
      element,
      x: rect.left - bounds.left + root.scrollLeft,
      y: rect.top - bounds.top + root.scrollTop,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      visible: rect.bottom > Math.max(0, bounds.top) && rect.top < Math.min(innerHeight, bounds.bottom),
      opacity: Number(style.opacity),
      transform: style.transform,
      groupId: element.closest("[data-condition-group]")?.dataset.conditionGroup,
      clone: clone ? element.cloneNode(true) : null,
    });
  }
  return records;
}

export function useCreationBrowseMotion(scope) {
  const rootRef = useRef(null);
  const pendingRef = useRef(null);
  const animationsRef = useRef(new Set());
  const overlayRef = useRef(null);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    for (const animation of animationsRef.current) {
      animation.onfinish = null;
      animation.cancel();
    }
    animationsRef.current.clear();
    overlayRef.current?.remove();
    overlayRef.current = null;
  }, []);

  const prepare = useCallback((animate) => {
    const root = rootRef.current;
    if (!animate || !root || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancel();
      return;
    }
    // Read the visible positions before interrupting an in-flight transition.
    const snapshot = {
      groups: measure(root, "[data-condition-group]", "data-condition-group", true),
      options: measure(root, "[data-condition-option]", "data-condition-option", true),
      cards: measure(root, "[data-reference-id]", "data-reference-id"),
    };
    cancel();
    pendingRef.current = snapshot;
  }, [cancel]);

  useLayoutEffect(() => cancel(), [scope, cancel]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const stopForPreference = () => { if (preference.matches) cancel(); };
    preference.addEventListener("change", stopForPreference);
    window.addEventListener("resize", cancel);
    window.addEventListener("scroll", cancel, { passive: true });
    root?.addEventListener("scroll", cancel, { passive: true });
    root?.addEventListener("load", cancel, true);
    return () => {
      preference.removeEventListener("change", stopForPreference);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("scroll", cancel);
      root?.removeEventListener("scroll", cancel);
      root?.removeEventListener("load", cancel, true);
      cancel();
    };
  }, [scope, cancel]);

  useLayoutEffect(() => {
    const previous = pendingRef.current;
    pendingRef.current = null;
    const root = rootRef.current;
    if (!previous || !root) return;
    const groups = measure(root, "[data-condition-group]", "data-condition-group");
    const options = measure(root, "[data-condition-option]", "data-condition-option");
    const cards = measure(root, "[data-reference-id]", "data-reference-id");

    const play = (element, frames, duration = 160, onFinish) => {
      if (typeof element.animate !== "function") {
        onFinish?.();
        return;
      }
      const animation = element.animate(frames, { duration, easing, fill: "both" });
      animationsRef.current.add(animation);
      animation.onfinish = () => {
        animationsRef.current.delete(animation);
        animation.cancel();
        onFinish?.();
      };
    };

    const move = (current, old, offsetX = 0, offsetY = 0) => {
      if (!current.visible) return;
      if (!old?.visible) {
        play(current.element, [{ transform: "translateY(4px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }]);
        return;
      }
      const x = old.x - current.x - offsetX;
      const y = old.y - current.y - offsetY;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && old.opacity === 1) return;
      // Large masonry reflows settle directly instead of flying across columns.
      if (Math.hypot(x, y) > 240) {
        play(current.element, [{ opacity: 0.5 }, { opacity: 1 }], 180);
      } else {
        play(current.element, [
          { transform: `translate(${x}px, ${y}px)`, opacity: old.opacity },
          { transform: "translate(0, 0)", opacity: 1 },
        ], 180);
      }
    };

    for (const [id, group] of groups) move(group, previous.groups.get(id));
    for (const [id, option] of options) {
      const groupId = option.element.closest("[data-condition-group]").dataset.conditionGroup;
      const oldGroup = previous.groups.get(groupId);
      const group = groups.get(groupId);
      if (!oldGroup) continue;
      move(option, previous.options.get(id), oldGroup.x - group.x, oldGroup.y - group.y);
    }
    for (const [id, card] of cards) move(card, previous.cards.get(id));

    const exit = (old, wholeGroup) => {
      if (!old.visible) return;
      if (!overlayRef.current) {
        const bounds = root.getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.className = "creation-motion-overlay";
        overlay.inert = true;
        overlay.setAttribute("aria-hidden", "true");
        const top = Math.max(0, bounds.top);
        Object.assign(overlay.style, {
          left: `${bounds.left}px`, top: `${top}px`, width: `${bounds.width}px`,
          height: `${Math.max(0, Math.min(innerHeight, bounds.bottom) - top)}px`,
        });
        root.append(overlay);
        overlayRef.current = overlay;
      }
      const overlay = overlayRef.current;
      const bounds = overlay.getBoundingClientRect();
      const ghost = document.createElement("ul");
      ghost.className = "creation-selected-conditions creation-condition-ghost";
      const item = wholeGroup ? old.clone : document.createElement("li");
      if (wholeGroup) {
        // A DOM clone does not retain an interrupted button's Web Animation.
        for (const button of item.querySelectorAll("[data-condition-option]")) {
          const option = previous.options.get(button.dataset.conditionOption);
          button.style.transform = option.transform;
          button.style.opacity = String(option.opacity);
        }
      } else {
        item.className = "creation-selected-group is-option-ghost";
        item.append(old.clone);
      }
      for (const element of [item, ...item.querySelectorAll("*")]) {
        element.removeAttribute("data-condition-group");
        element.removeAttribute("data-condition-option");
        element.removeAttribute("id");
      }
      ghost.append(item);
      Object.assign(ghost.style, {
        left: `${old.left - bounds.left}px`, top: `${old.top - bounds.top}px`,
        width: `${old.width}px`, height: `${old.height}px`,
      });
      overlay.append(ghost);
      play(ghost, [{ transform: "translateY(0)", opacity: old.opacity }, { transform: "translateY(-4px)", opacity: 0 }], 140, () => {
        ghost.remove();
        if (!overlay.childElementCount) {
          overlay.remove();
          if (overlayRef.current === overlay) overlayRef.current = null;
        }
      });
    };

    for (const [id, old] of previous.groups) if (!groups.has(id)) exit(old, true);
    for (const [id, old] of previous.options) {
      if (!options.has(id) && groups.has(old.groupId)) exit(old, false);
    }
  });

  return { rootRef, prepare, cancel };
}
