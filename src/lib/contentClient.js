export const contentReadOnly = process.env.NEXT_PUBLIC_CONTENT_READ_ONLY === "1";
export async function requestContent(path, body, signal) {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(path, { cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout, ...(body !== undefined && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "暂时无法连接网站，请稍后重试；当前输入仍然保留。");
  return data;
}
