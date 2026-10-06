"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Select } from "antd";
import { Search, X, Plus } from "lucide-react";
import { useAppMessage } from "./hooks/useAppMessage.jsx";
import { usePreferences } from "./Providers.jsx";
import { DisclosureSummary } from "./DisclosureSummary.jsx";
import { contentReadOnly, requestContent } from "./lib/contentClient.js";
import { CREATION_TECHNIQUE_GROUP_IDS } from "./lib/creationTags.js";
import { normalizeTagGroups } from "./tagSettings.js";

export function ContentTagFields({
  tagValues,
  title,
  idPrefix,
  hint,
  disabled,
  onSelect,
  onBusyChange,
  singleGroupIds = [],
  extraTags,
  onExtraTagsChange,
}) {
  const { tagGroups, saveTags } = usePreferences();
  const message = useAppMessage();
  const [adding, setAdding] = useState(null);
  const [name, setName] = useState("");
  const [firstOption, setFirstOption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(null);
  const primaryGroups = tagGroups.filter((group) => !CREATION_TECHNIQUE_GROUP_IDS.includes(group.id));
  const techniqueGroups = tagGroups.filter((group) => CREATION_TECHNIQUE_GROUP_IDS.includes(group.id));
  const techniqueCount = techniqueGroups.reduce((count, group) => count + (tagValues[group.id]?.length || 0), 0);
  const headingId = `${idPrefix}-title`;
  const newNameId = `${idPrefix}-new-name`;
  const firstNameId = `${idPrefix}-first-name`;
  useEffect(() => () => {
    if (pendingRef.current) {
      pendingRef.current.abort();
      pendingRef.current = null;
      onBusyChange(false);
    }
  }, [onBusyChange]);

  const open = (group) => {
    setName("");
    setFirstOption("");
    setError("");
    setAdding(group ? { groupId: group.id, groupLabel: group.label } : {});
  };
  const save = async () => {
    if (pendingRef.current || !adding || contentReadOnly) return;
    const label = name.trim();
    if (!label) {
      setError(`请填写${adding.groupId ? "二级" : "一级"}标签名称`);
      return;
    }
    const controller = new AbortController();
    pendingRef.current = controller;
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      // Append to the latest settings; the revision check rejects subsequent concurrent changes.
      const { tags } = await requestContent("/api/public", undefined, controller.signal);
      if (controller.signal.aborted) return;
      const groupId = adding.groupId || `group-${crypto.randomUUID()}`;
      const optionLabel = adding.groupId ? label : firstOption.trim();
      const option = optionLabel ? { id: `tag-${crypto.randomUUID()}`, label: optionLabel, value: null } : null;
      if (adding.groupId && !tags.groups.some((group) => group.id === groupId)) {
        throw new Error("这个一级标签已被删除，请取消后重新选择分组");
      }
      const groups = adding.groupId
        ? tags.groups.map((group) => group.id === groupId ? { ...group, options: [...group.options, option] } : group)
        : [...tags.groups, { id: groupId, label, options: option ? [option] : [] }];
      const next = await saveTags(normalizeTagGroups(groups), tags.revision);
      if (controller.signal.aborted) return;
      const savedOption = next.groups.find((group) => group.id === groupId)?.options.find((entry) => entry.id === option?.id);
      if (savedOption) onSelect(groupId, [savedOption.value], true);
      setAdding(null);
      message.success(savedOption ? "标签已新增并选中，继续录入即可" : "一级标签已新增，可继续添加二级标签");
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || "新增失败，请重试；已输入的内容仍保留");
    } finally {
      if (pendingRef.current === controller) {
        pendingRef.current = null;
        setSaving(false);
        onBusyChange(false);
      }
    }
  };
  const submitOnEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.nativeEvent.isComposing) save();
  };
  const renderGroup = (group) => {
    const single = singleGroupIds.includes(group.id);
    const selected = tagValues[group.id] || [];
    const options = group.options.map((option) => ({ value: option.value ?? option.label, label: option.label }));
    selected.forEach((value) => {
      if (!options.some((option) => option.value === value)) options.push({ value, label: `${value}（原标签）` });
    });
    return <div className="entry-field" key={group.id}>
      <div className="entry-tag-label">
        <span className="entry-field-label">{group.label}</span>
        <Button type="text" size="small" icon={<Plus />} aria-label={`${title}：在${group.label}中新增二级标签`} disabled={disabled || contentReadOnly} onClick={() => open(group)}>新增二级标签</Button>
      </div>
      <Select
        aria-label={`${title}：${group.label}`}
        mode={single ? undefined : "multiple"}
        showSearch={{ searchIcon: <Search /> }}
        disabled={disabled}
        value={single ? selected[0] || undefined : selected}
        options={options}
        maxCount={single ? undefined : 30}
        allowClear={{ clearIcon: <X /> }}
        placeholder={single ? "选择标签，未知可留空" : "选择标签，可多选"}
        onChange={(values) => onSelect(group.id, single ? (values ? [values] : []) : values)}
      />
    </div>;
  };

  return <section className="entry-section" aria-labelledby={headingId}>
    <div className="entry-tags-heading">
      <h3 id={headingId}>{title}</h3>
      <Button type="text" size="small" icon={<Plus />} disabled={disabled || contentReadOnly} onClick={() => open()}>新增一级标签</Button>
    </div>
    <p className="entry-hint">{hint}</p>
    <div className="entry-two-columns">{primaryGroups.map(renderGroup)}</div>
    {techniqueGroups.length > 0 && <details className="entry-shot-context">
      <DisclosureSummary>拍法与剪辑（可选）{techniqueCount > 0 ? ` · 已选 ${techniqueCount} 个标签` : ""}</DisclosureSummary>
      <div className="entry-two-columns">{techniqueGroups.map(renderGroup)}</div>
    </details>}
    {extraTags !== undefined && <div className="entry-field">
      <div className="entry-field-label">补充标签</div>
      <Select aria-label={`${title}：补充标签`} mode="tags" showSearch={{ searchIcon: <Search /> }} disabled={disabled} value={extraTags} maxCount={30} tokenSeparators={[",", "，"]} placeholder="输入后按回车添加" onChange={onExtraTagsChange} />
    </div>}
    <Modal title={adding?.groupId ? "新增二级标签" : "新增一级标签"} open={Boolean(adding)} onCancel={() => { if (!saving) setAdding(null); }} onOk={save} okText="新增" cancelText="取消" confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }} destroyOnHidden>
      <div className="entry-tag-dialog">
        {adding?.groupId && <p className="entry-hint">所属一级标签：{adding.groupLabel}</p>}
        <div className="entry-field">
          <label className="entry-field-label" htmlFor={newNameId}>{adding?.groupId ? "二级标签名称" : "一级标签名称"}</label>
          <Input id={newNameId} autoFocus value={name} maxLength={20} showCount disabled={saving} status={error ? "error" : undefined} placeholder={adding?.groupId ? "例如：重击" : "例如：动作阶段"} onChange={(event) => { setName(event.target.value); setError(""); }} onPressEnter={submitOnEnter} />
        </div>
        {!adding?.groupId && <div className="entry-field">
          <label className="entry-field-label" htmlFor={firstNameId}>首个二级标签（可选）</label>
          <Input id={firstNameId} value={firstOption} maxLength={20} showCount disabled={saving} placeholder="可以一起新增，例如：蓄力" onChange={(event) => { setFirstOption(event.target.value); setError(""); }} onPressEnter={submitOnEnter} />
        </div>}
        <p className="entry-hint">新增后同步到全站标签设置。二级标签会自动选中，当前未保存的内容会保留。</p>
        {error && <Alert type="error" title={error} showIcon />}
      </div>
    </Modal>
  </section>;
}
