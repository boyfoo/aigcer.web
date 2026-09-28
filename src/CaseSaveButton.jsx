import { Button } from "antd";
import { BookFilled, BookOutlined } from "@ant-design/icons";

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
          <BookOutlined className="case-save-idle" />
          <BookFilled className="case-save-selected" />
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
