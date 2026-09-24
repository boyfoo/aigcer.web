import { useEffect } from "react";

export function useUnsavedChanges(hasUnsavedChanges, onDirtyChange) {
  useEffect(() => {
    onDirtyChange(hasUnsavedChanges);
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    if (hasUnsavedChanges) window.addEventListener("beforeunload", beforeUnload);
    return () => {
      onDirtyChange(false);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [hasUnsavedChanges, onDirtyChange]);
}
