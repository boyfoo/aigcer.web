"use client";
import { useState } from "react";
import { Alert, App, Button, Input, Modal, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { usePreferences } from "./Providers.jsx";
import { caseTagValues } from "./lib/contentEntries.js";
import { contentReadOnly, requestContent } from "./lib/contentClient.js";
import { normalizeTagGroups } from "./tagSettings.js";

export function ContentTagFields({ draft, disabled, onSelect, onBusyChange, onExtraTagsChange }) {
  const { tagGroups, saveTags } = usePreferences();
  const { message } = App.useApp();
  const [adding, setAdding] = useState(null);
  const [name, setName] = useState("");
  const [firstOption, setFirstOption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const open = (group) => {
    setName(""); setFirstOption(""); setError("");
    setAdding(group ? { groupId: group.id, groupLabel: group.label } : {});
  };
  const save = async () => {
    if (saving || !adding || contentReadOnly) return;
    const label = name.trim();
    if (!label) { setError(`请填写${adding.groupId ? "二级" : "一级"}标签名称`); return; }
    setSaving(true); onBusyChange(true); setError("");
    try {
      // Append to the latest settings so another page's additions are retained.
      // A concurrent write after this read is still rejected by the revision check.
      const { tags } = await requestContent("/api/public");
      const groupId = adding.groupId || `group-${crypto.randomUUID()}`;
      const optionLabel = adding.groupId ? label : firstOption.trim();
      const option = optionLabel ? { id: `tag-${crypto.randomUUID()}`, label: optionLabel, value: null } : null;
      if (adding.groupId && !tags.groups.some((group) => group.id === groupId)) throw new Error("这个一级标签已被删除，请取消后重新选择分组");
      const groups = adding.groupId
        ? tags.groups.map((group) => group.id === groupId ? { ...group, options: [...group.options, option] } : group)
        : [...tags.groups, { id: groupId, label, options: option ? [option] : [] }];
      const next = await saveTags(normalizeTagGroups(groups), tags.revision);
      const savedOption = next.groups.find((group) => group.id === groupId)?.options.find((entry) => entry.id === option?.id);
      if (savedOption) onSelect(groupId, [savedOption.value], true);
      setAdding(null);
      message.success(savedOption ? "标签已新增并选中，继续录入即可" : "一级标签已新增，可继续添加二级标签");
    } catch (failure) { setError(failure.message || "新增失败，请重试；已输入的内容仍保留"); }
    finally { setSaving(false); onBusyChange(false); }
  };
  const submitOnEnter = (event) => {
    event.preventDefault(); event.stopPropagation();
    if (!event.nativeEvent.isComposing) save();
  };

  return <section className="entry-section" aria-labelledby="entry-tags">
    <div className="entry-tags-heading"><h3 id="entry-tags">分类与标签</h3><Button type="text" size="small" icon={<PlusOutlined />} disabled={disabled || contentReadOnly} onClick={() => open()}>新增一级标签</Button></div>
    <p className="entry-hint">每组可以多选，也可以在这里新增一级、二级标签。</p>
    <div className="entry-two-columns">{tagGroups.map((group) => {
      const selected = caseTagValues(draft, group.id);
      const options = group.options.map((option) => ({ value: option.value ?? option.label, label: option.label }));
      selected.forEach((value) => { if (!options.some((option) => option.value === value)) options.push({ value, label: `${value}（原标签）` }); });
      return <div className="entry-field" key={group.id}>
        <div className="entry-tag-label"><span className="entry-field-label">{group.label}</span><Button type="text" size="small" icon={<PlusOutlined />} aria-label={`在${group.label}中新增二级标签`} disabled={disabled || contentReadOnly} onClick={() => open(group)}>新增二级标签</Button></div>
        <Select aria-label={`分类：${group.label}`} mode="multiple" disabled={disabled} value={selected} options={options} allowClear placeholder="选择标签，可多选" onChange={(values) => onSelect(group.id, values)} />
      </div>;
    })}</div>
    <div className="entry-field"><div className="entry-field-label">补充标签</div><Select aria-label="画面标签" mode="tags" disabled={disabled} value={draft.tags} tokenSeparators={[",", "，"]} placeholder="输入后按回车添加" onChange={onExtraTagsChange} /></div>
    <Modal title={adding?.groupId ? "新增二级标签" : "新增一级标签"} open={Boolean(adding)} onCancel={() => { if (!saving) setAdding(null); }} onOk={save} okText="新增" cancelText="取消" confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }} destroyOnHidden>
      <div className="entry-tag-dialog">
        {adding?.groupId && <p className="entry-hint">所属一级标签：{adding.groupLabel}</p>}
        <div className="entry-field"><label className="entry-field-label" htmlFor="entry-new-tag-name">{adding?.groupId ? "二级标签名称" : "一级标签名称"}</label><Input id="entry-new-tag-name" autoFocus value={name} maxLength={20} showCount disabled={saving} status={error ? "error" : undefined} placeholder={adding?.groupId ? "例如：柔光" : "例如：视觉风格"} onChange={(event) => { setName(event.target.value); setError(""); }} onPressEnter={submitOnEnter} /></div>
        {!adding?.groupId && <div className="entry-field"><label className="entry-field-label" htmlFor="entry-first-tag-name">首个二级标签（可选）</label><Input id="entry-first-tag-name" value={firstOption} maxLength={20} showCount disabled={saving} placeholder="可以一起新增，例如：写实" onChange={(event) => { setFirstOption(event.target.value); setError(""); }} onPressEnter={submitOnEnter} /></div>}
        <p className="entry-hint">新增后同步到全站标签设置。二级标签会自动选中，当前案例的其他内容会保留。</p>
        {error && <Alert type="error" title={error} showIcon />}
      </div>
    </Modal>
  </section>;
}
