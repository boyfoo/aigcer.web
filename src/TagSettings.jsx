import { useEffect, useState } from "react";
import { App, Button, Empty, Input, Popconfirm, Tooltip } from "antd";
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { moveTagEntry, validateTagGroups } from "./tagSettings.js";

export function TagSettings({ groups, onBack, onSave, onDirtyChange }) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState(() => structuredClone(groups));
  const [selectedId, setSelectedId] = useState(groups[0]?.id);
  const selected = draft.find((group) => group.id === selectedId);
  const selectedIndex = draft.findIndex((group) => group.id === selectedId);
  const dirty = JSON.stringify(draft) !== JSON.stringify(groups);

  useEffect(() => {
    onDirtyChange(dirty);
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    if (dirty) window.addEventListener("beforeunload", beforeUnload);
    return () => {
      onDirtyChange(false);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, onDirtyChange]);

  const updateGroup = (changes) => {
    setDraft((current) => current.map((group) => group.id === selectedId ? { ...group, ...changes } : group));
  };

  const addGroup = () => {
    const group = { id: `group-${crypto.randomUUID()}`, label: "", options: [] };
    setDraft((current) => [...current, group]);
    setSelectedId(group.id);
  };

  const removeGroup = () => {
    const next = draft.filter((group) => group.id !== selectedId);
    setDraft(next);
    setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id);
  };

  const save = () => {
    const error = validateTagGroups(draft);
    if (error) return message.error(error);
    const saved = onSave(draft);
    if (saved) setDraft(saved);
  };

  return (
    <main className="tag-settings-page" aria-labelledby="settings-page-title">
      <div className="tag-settings-page-nav">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回镜头参考</Button>
        <span>个人中心 / 设置</span>
      </div>
      <div className="tag-settings-intro">
        <h1 id="settings-page-title">标签管理</h1>
        <p>一级标签是左侧菜单分组，二级标签是分组下的筛选项。</p>
        <span>保存后更新菜单，仅在当前浏览器生效。</span>
      </div>
      <div className="tag-settings-layout">
        <section className="tag-group-list" aria-label="一级标签">
          <div className="tag-section-heading"><h3>一级标签</h3><span>{draft.length}</span></div>
          <div className="tag-group-options">
            {draft.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`tag-group-button${group.id === selectedId ? " is-active" : ""}`}
                aria-pressed={group.id === selectedId}
                onClick={() => setSelectedId(group.id)}
              >
                <span>{group.label.trim() || "未命名标签"}</span>
                <small>{group.options.length}</small>
              </button>
            ))}
          </div>
          <Button block type="dashed" icon={<PlusOutlined />} onClick={addGroup}>新增一级标签</Button>
        </section>
        <section className="tag-group-editor" aria-label="标签编辑">
          {selected ? (
            <div key={selected.id}>
              <div className="tag-section-heading">
                <h3>编辑一级标签</h3>
                <div className="tag-row-actions">
                  <Tooltip title="一级标签上移">
                    <Button type="text" icon={<ArrowUpOutlined />} aria-label="一级标签上移" disabled={selectedIndex === 0} onClick={() => setDraft(moveTagEntry(draft, selectedId, -1))} />
                  </Tooltip>
                  <Tooltip title="一级标签下移">
                    <Button type="text" icon={<ArrowDownOutlined />} aria-label="一级标签下移" disabled={selectedIndex === draft.length - 1} onClick={() => setDraft(moveTagEntry(draft, selectedId, 1))} />
                  </Tooltip>
                  <Popconfirm title="删除这个一级标签？" description="该分组及其二级标签将从菜单移除，已有案例不受影响。" onConfirm={removeGroup} okText="删除" cancelText="取消">
                    <Button type="text" danger icon={<DeleteOutlined />} aria-label="删除一级标签" />
                  </Popconfirm>
                </div>
              </div>
              <label className="tag-name-label" htmlFor="tag-group-name">名称</label>
              <Input id="tag-group-name" value={selected.label} placeholder="例如：视觉风格" maxLength={20} showCount autoFocus={!selected.label} onChange={(event) => updateGroup({ label: event.target.value })} />
              <div className="tag-section-heading tag-options-heading"><h3>二级标签</h3><span>{selected.options.length}</span></div>
              <div className="tag-option-list">
                {selected.options.map((option, index) => (
                  <div className="tag-option-row" key={option.id}>
                    <span className="tag-option-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <Input
                      value={option.label}
                      aria-label={`第 ${index + 1} 个二级标签名称`}
                      placeholder="输入二级标签名称"
                      maxLength={20}
                      autoFocus={option.value === null}
                      onChange={(event) => updateGroup({ options: selected.options.map((entry) => entry.id === option.id ? { ...entry, label: event.target.value } : entry) })}
                    />
                    <div className="tag-row-actions">
                      <Button type="text" icon={<ArrowUpOutlined />} aria-label={`上移二级标签 ${option.label || index + 1}`} disabled={index === 0} onClick={() => updateGroup({ options: moveTagEntry(selected.options, option.id, -1) })} />
                      <Button type="text" icon={<ArrowDownOutlined />} aria-label={`下移二级标签 ${option.label || index + 1}`} disabled={index === selected.options.length - 1} onClick={() => updateGroup({ options: moveTagEntry(selected.options, option.id, 1) })} />
                      <Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除二级标签 ${option.label || index + 1}`} onClick={() => updateGroup({ options: selected.options.filter((entry) => entry.id !== option.id) })} />
                    </div>
                  </div>
                ))}
                {!selected.options.length && <p className="tag-options-empty">还没有二级标签，添加后可在左侧菜单中筛选。</p>}
              </div>
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => updateGroup({ options: [...selected.options, { id: `tag-${crypto.randomUUID()}`, label: "", value: null }] })}>新增二级标签</Button>
              <p className="tag-settings-hint">菜单自动包含“全部”，无需添加。</p>
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先新增一个一级标签，再添加二级标签" />
          )}
        </section>
      </div>
      <div className="tag-settings-footer">
        <span role="status">{dirty ? "有未保存的修改" : "暂无修改"}</span>
        <div>
          <Button onClick={onBack}>返回</Button>
          <Button type="primary" onClick={save} disabled={!dirty}>保存设置</Button>
        </div>
      </div>
    </main>
  );
}
