import { ChevronRight } from "lucide-react";

export function DisclosureSummary({ children }) {
  return (
    <summary className="disclosure-summary">
      <ChevronRight className="disclosure-chevron" aria-hidden="true" />
      {children}
    </summary>
  );
}
