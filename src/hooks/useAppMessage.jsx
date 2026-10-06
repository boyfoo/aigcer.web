"use client";

import { useMemo } from "react";
import { App } from "antd";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";

const icons = {
  success: <CircleCheck />,
  error: <CircleX />,
  info: <Info />,
  warning: <CircleAlert />,
};

export function useAppMessage() {
  const { message } = App.useApp();
  // Ant Design 的消息图标没有全局配置入口，集中设置以保持所有提示一致。
  return useMemo(() => Object.fromEntries(
    Object.entries(icons).map(([type, icon]) => [
      type,
      (content) => message[type]({ content, icon }),
    ]),
  ), [message]);
}
