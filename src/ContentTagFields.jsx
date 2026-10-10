"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Select } from "antd";
import { Check, ChevronDown, Search, Plus } from "lucide-react";
import { useAppMessage } from "./hooks/useAppMessage.jsx";
import { usePreferences } from "./Providers.jsx";
import { contentReadOnly, requestContent } from "./lib/contentClient.js";
import { groupCreationFilters } from "./lib/creationNavigation.js";
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
  const [expandedEntry, setExpandedEntry] = useState(null);
  const expandedHeadingRef = useRef(null);
  const pendingRef = useRef(null);
  const entries = groupCreationFilters(tagGroups);
  const headingId = `${idPrefix}-title`;
  const newNameId = `${idPrefix}-new-name`;
  const firstNameId = `${idPrefix}-first-name`;
  useLayoutEffect(() => {
    expandedHeadingRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [expandedEntry]);
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
      const selected = tagValues[groupId] || [];
      const selectionFull = savedOption && !singleGroupIds.includes(groupId) && selected.length >= 30 && !selected.includes(savedOption.value);
      if (savedOption && !selectionFull) onSelect(groupId, [savedOption.value], true);
      setExpandedEntry(groupCreationFilters(next.groups).find((entry) => entry.groups.some((group) => group.id === groupId)).id);
      setAdding(null);
      message.success(selectionFull ? "标签已新增，本组已选满 30 个，请先取消一个再选择" : savedOption ? "标签已新增并选中，继续录入即可" : "一级标签已新增，可继续添加二级标签");
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
    const options = group.options.map((option) => ({ id: option.id, value: option.value ?? option.label, label: option.label }));
    selected.forEach((value) => {
      if (!options.some((option) => option.value === value)) options.push({ id: `original-${value}`, value, label: `${value}（原标签）` });
    });
    const labelId = `${idPrefix}-${group.id}-label`;
    return <section className="entry-tag-group" key={group.id} aria-labelledby={labelId}>
      <div className="entry-tag-label">
        <h5 id={labelId}>{group.label}<small>{single ? "单选" : "可多选"}</small></h5>
        <div>
          {selected.length > 0 && <Button type="text" size="small" aria-label={`${title}：清空${group.label}`} disabled={disabled} onClick={() => onSelect(group.id, [])}>清空</Button>}
          <Button type="text" size="small" icon={<Plus />} aria-label={`${title}：在${group.label}中新增二级标签`} disabled={disabled || contentReadOnly} onClick={() => open(group)}>新增二级标签</Button>
        </div>
      </div>
      <div className="entry-tag-options">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return <button
            className={`filter-option${active ? " is-active" : ""}`}
            key={option.id}
            type="button"
            aria-label={`${title}：${group.label}：${option.label}`}
            aria-pressed={active}
            disabled={disabled || (!single && selected.length >= 30 && !active)}
            onClick={() => onSelect(group.id, active
              ? selected.filter((value) => value !== option.value)
              : single ? [option.value] : [...selected, option.value])}
          >
            <span>{option.label}</span>
            <Check className="option-check" aria-hidden="true" />
          </button>;
        })}
      </div>
      {!options.length && <p className="entry-hint">还没有二级标签，可以直接新增。</p>}
      {!single && selected.length >= 30 && <p className="entry-hint">每组最多选择 30 个标签，请先取消或清空后再添加。</p>}
    </section>;
  };

  return <section className="entry-section" aria-labelledby={headingId}>
    <div className="entry-tags-heading">
      <h3 id={headingId}>{title}</h3>
      <Button type="text" size="small" icon={<Plus />} disabled={disabled || contentReadOnly} onClick={() => open()}>新增一级标签</Button>
    </div>
    <p className="entry-hint">{hint}</p>
    <div className="entry-tag-categories">
      {entries.map((entry) => {
        const isExpanded = expandedEntry === entry.id;
        const selectedCount = entry.groups.reduce((count, group) => count + (tagValues[group.id]?.length || 0), 0);
        const panelId = `${idPrefix}-category-${entry.id}`;
        return <section className="entry-tag-category" key={entry.id}>
          <h4 className="entry-tag-category-heading">
            <button
              ref={isExpanded ? expandedHeadingRef : undefined}
              type="button"
              aria-expanded={isExpanded}
              aria-controls={panelId}
              disabled={disabled}
              onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
            >
              {entry.label}
              <span className={selectedCount ? "is-active" : undefined}>{selectedCount ? `已选 ${selectedCount}` : "未选"}<ChevronDown aria-hidden="true" /></span>
            </button>
          </h4>
          <div className="entry-tag-groups" id={panelId} hidden={!isExpanded}>
            {entry.groups.map(renderGroup)}
          </div>
        </section>;
      })}
    </div>
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
