import { Button } from "antd";
import { Bookmark, BookmarkCheck } from "lucide-react";

export function CaseSaveButton({ saved, onClick, type = "default" }) {
  return (
    <Button
      type={type}
      className={`case-save${saved ? " is-saved" : ""}`}
      aria-label="收藏案例"
      aria-pressed={saved}
      onClick={onClick}
      icon={
        <span className="case-save-symbol" aria-hidden="true">
          <Bookmark className="case-save-idle" />
          <BookmarkCheck className="case-save-selected" />
        </span>
      }
    >
      <span className="case-save-label" aria-hidden="true">
        <span className="case-save-idle">收藏案例</span>
        <span className="case-save-selected">已收藏</span>
      </span>
    </Button>
  );
}
