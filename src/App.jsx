"use client";

import { DisclosureSummary } from "./DisclosureSummary.jsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  App as AntApp,
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Tag,
} from "antd";
import {
  Copy,
  ChevronDown,
  FileText,
  Folder,
  Search,
  Settings,
} from "lucide-react";
import { TagSettings } from "./TagSettings.jsx";
import { useAppMessage } from "./hooks/useAppMessage.jsx";
import { CaseSaveButton } from "./CaseSaveButton.jsx";
import { CreationFilters } from "./CreationFilters.jsx";
import { CreationSelectedConditions } from "./CreationSelectedConditions.jsx";
import { CreationReferenceResults } from "./CreationReferenceResults.jsx";
import { CreationCategoryNav } from "./CreationCategoryNav.jsx";
import { useCreationBrowseMotion } from "./hooks/useCreationBrowseMotion.js";
import { ContentEntry } from "./ContentEntry.jsx";
import { useContentCases } from "./ContentProvider.jsx";
import { VideoStudy } from "./VideoStudy.jsx";
import { useReferenceProjects } from "./ReferenceProjects.jsx";
import { usePreferences } from "./Providers.jsx";
import { casePath } from "./lib/content.js";
import { displayTags, tagValues } from "./lib/contentEntries.js";
import { caseLearningFocus } from "./lib/learningPresentation.js";
import { createCreationReferences, filterCreationReferences } from "./lib/creationReferences.js";
import { createInitialTagFilters, reconcileTagFilters } from "./tagSettings.js";

export function App({ page = "home", initialCaseId, collection, previewItem, serverItem }) {
  const { modal } = AntApp.useApp();
  const message = useAppMessage();
  const router = useRouter();
  const { openLibrary } = useReferenceProjects();
  const { tagGroups, tagRevision, saveTags, tagsLoaded, savedIds, toggleFavorite, favoritesError } = usePreferences();
  const { items: allItems } = useContentCases();
  const items = useMemo(() => collection?.kind ? allItems.filter((item) => item.kind === collection.kind) : allItems, [allItems, collection]);
  const searchRef = useRef(null);
  const settingsDirtyRef = useRef(false);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(() => createInitialTagFilters(tagGroups));
  const [filterMotionGroup, setFilterMotionGroup] = useState(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const browsePointerRef = useRef(false);
  const browseMotion = useCreationBrowseMotion(`${page}:${collection?.slug ?? "all"}`);
  const hasActiveFilters = Object.values(filters).some((values) => tagValues(values).length);
  const selectedConditionGroups = tagGroups
    .map((group) => ({
      group,
      options: group.options.filter((option) => tagValues(filters[group.id]).includes(option.id)),
    }))
    .filter(({ options }) => options.length > 0);
  const references = useMemo(() => createCreationReferences(items), [items]);
  const filteredReferences = useMemo(() => filterCreationReferences(references, { groups: tagGroups, filters, query }), [references, tagGroups, filters, query]);

  const updateSettingsDirty = useCallback((dirty) => {
    settingsDirtyRef.current = dirty;
  }, []);

  const confirmLeaveSettings = useCallback((onLeave, onCancel) => {
    if (!settingsDirtyRef.current) return onLeave();
    modal.confirm({
      title: page === "content" ? "放弃未保存的内容？" : "放弃未保存的标签修改？",
      content: "页面会保留上次保存的内容。",
      okText: "放弃修改",
      cancelText: "继续编辑",
      onOk: onLeave,
      onCancel,
    });
  }, [modal, page]);

  const navigateTo = (nextPage, afterNavigate) => {
    const href = nextPage === "home" ? "/" : nextPage === "settings" ? "/settings" : nextPage === "content" ? "/content" : nextPage;
    const navigate = () => {
      afterNavigate?.();
      router.push(href);
    };
    if (settingsDirtyRef.current) confirmLeaveSettings(navigate);
    else navigate();
  };

  useEffect(() => {
    setFilterMotionGroup(null);
    setFilters((current) => reconcileTagFilters(tagGroups, current));
  }, [tagGroups]);

  const guardNavigation = (event) => {
    if (!settingsDirtyRef.current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = event.currentTarget.getAttribute("href");
    confirmLeaveSettings(() => router.push(href));
  };

  const resultCount = filteredReferences.length;

  const selectedItem = previewItem ?? items.find((item) => item.id === initialCaseId) ?? serverItem;
  const savedItems = allItems.filter((item) =>
    savedIds.has(item.id),
  );

  const applySearch = (value) => {
    const nextQuery = value.trim();
    if (nextQuery === query) return;
    browseMotion.prepare(browsePointerRef.current);
    setQuery(nextQuery);
  };

  const updateFilter = (key, option, animate) => {
    browseMotion.prepare(animate);
    setFilterMotionGroup(animate ? key : null);
    setFilters((current) => ({
      ...current,
      [key]: option ? (tagValues(current[key]).includes(option) ? tagValues(current[key]).filter((id) => id !== option) : [...tagValues(current[key]), option]) : [],
    }));
  };

  const resetFilters = (event) => {
    browseMotion.prepare(event?.detail > 0);
    setFilterMotionGroup(null);
    setDraftQuery("");
    setQuery("");
    setFilters(createInitialTagFilters(tagGroups));
  };

  const toggleSaved = (itemId) => {
    try { message.success(toggleFavorite(itemId) ? "已收藏，刷新后仍会保留" : "已移出收藏"); }
    catch (error) { message.error(error.message || "收藏保存失败，请检查浏览器存储权限"); }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(selectedItem.prompt);
      message.success("提示词已复制");
    } catch {
      message.info("请选择提示词后复制");
    }
  };

  const handleSaveTagSettings = async (draft, revision) => {
    try {
      const next = await saveTags(draft, revision);
      setFilterMotionGroup(null);
      setFilters((current) => reconcileTagFilters(next.groups, current));
      message.success("标签设置已保存，左侧菜单已更新");
      return next;
    } catch (error) {
      message.error(error.message || "保存失败，修改仍保留在设置中");
    }
  };

  const profileMenu = {
    items: [
      { key: "projects", label: "镜头收藏夹", icon: <Folder /> },
      { key: "content", label: "内容录入", icon: <FileText /> },
      { key: "settings", label: "标签设置", icon: <Settings /> },
    ],
    onClick: ({ key }) => {
      if (key === "settings") navigateTo("settings");
      else if (key === "content") navigateTo("content");
      else if (key === "projects") openLibrary(guardNavigation);
      else message.info(`已选择：${key}`);
    },
  };

  return (
    <div className={`app-shell${page === "home" ? " is-browsing" : ""}`}>
      <div className="paper-texture" aria-hidden="true" />

      <header className="topbar">
        <Link className="brand" href="/" onClick={(event) => { guardNavigation(event); if (!event.defaultPrevented) resetFilters(); }} aria-label="返回案例首页">
          <img className="brand-icon" src="/logo.png?v=8" width="32" height="32" alt="" />
          <span>镜界</span>
        </Link>
        <nav className="primary-nav" aria-label="主要导航">
          <Link href="/" className={`nav-link${page === "home" || page === "case" ? " is-active" : ""}`} onClick={guardNavigation}>看案例</Link>
          <button type="button" className="nav-link" aria-label={`我的收藏，共 ${savedIds.size} 条`} onClick={() => setSavedOpen(true)}>我的收藏{savedIds.size > 0 && <span className="nav-count">{savedIds.size}</span>}</button>
        </nav>
        <div className="top-actions">
          <Dropdown menu={profileMenu} trigger={["click"]}>
            <button className="profile-button" type="button" aria-label="打开个人中心">
              <Avatar size={38} src="/images/avatar-curator.png" />
              <ChevronDown aria-hidden="true" />
            </button>
          </Dropdown>
        </div>
      </header>

      {page === "settings" ? (
        <TagSettings key={String(tagsLoaded)} groups={tagGroups} revision={tagRevision} onBack={() => navigateTo("home")} onSave={handleSaveTagSettings} onDirtyChange={updateSettingsDirty} />
      ) : page === "content" ? (
        <ContentEntry onBack={() => navigateTo("home")} onNavigate={navigateTo} onDirtyChange={updateSettingsDirty} />
      ) : page === "case" && !selectedItem ? (
        <main className="tag-settings-page"><h1>这个案例已不存在</h1><Link href="/content">返回内容录入</Link></main>
      ) : page === "case" ? (
        <main className={`case-page${(selectedItem.video?.src && selectedItem.video?.shots.length) ? " has-video-study" : ""}`}>
          {(selectedItem.video?.src && selectedItem.video?.shots.length) ? (
            <VideoStudy key={selectedItem.id} item={selectedItem} saved={savedIds.has(selectedItem.id)} onToggleSaved={() => toggleSaved(selectedItem.id)} />
          ) : (
          <>
          <nav className="case-breadcrumb" aria-label="面包屑"><Link href="/">镜头参考</Link><span>/</span><span>{selectedItem.title}</span></nav>
          <article>
            <header className="case-heading"><p>{[selectedItem.kind, selectedItem.duration].filter(Boolean).join(" · ")}</p><h1>{selectedItem.title}</h1><p>{selectedItem.description}</p></header>
            {selectedItem.video?.src ? <video className="case-simple-video" src={selectedItem.video.src} poster={selectedItem.image} controls playsInline preload="metadata" aria-label={`${selectedItem.title}视频播放器`}>浏览器暂不支持视频播放，可使用<a href={selectedItem.video.src}>视频原链接</a>观看。</video> : <img className="case-image" src={selectedItem.image} alt={selectedItem.title} />}
            <div className="case-body case-reading-body">
              <section><h2>看懂这个画面</h2><p className="case-prompt">{selectedItem.analysis || selectedItem.description || caseLearningFocus(selectedItem)}</p></section>
              <details><DisclosureSummary>查看画面信息</DisclosureSummary><dl className="case-facts">{[["类型", selectedItem.type], ["情绪", selectedItem.emotion], ["光影", selectedItem.lighting], ["运镜", selectedItem.movement]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{displayTags(value) || "—"}</dd></div>)}</dl><div className="tag-row">{selectedItem.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div></details>
              <details><DisclosureSummary>查看提示词参考</DisclosureSummary><p className="case-prompt">{selectedItem.prompt || "暂未提供提示词"}</p><Button disabled={!selectedItem.prompt} icon={<Copy />} onClick={copyPrompt}>复制提示词</Button></details>
              <div className="case-actions"><CaseSaveButton saved={savedIds.has(selectedItem.id)} onClick={() => toggleSaved(selectedItem.id)} /></div>
            </div>
          </article>
          </>
          )}
        </main>
      ) : (
      <div
        className="page-layout"
        onPointerDownCapture={() => { browsePointerRef.current = true; }}
        onKeyDownCapture={() => {
          browsePointerRef.current = false;
          setFilterMotionGroup(null);
          browseMotion.cancel();
        }}
      >
        <aside className="sidebar" aria-label="创作条件筛选" tabIndex={0}>
          <p className="filter-intro">按创作条件找参考</p>
          <CreationFilters groups={tagGroups} filters={filters} motionGroup={filterMotionGroup} onChange={updateFilter} />
          <p className="filter-hint">先选主体、动作和表现目标，再按需要细选拍法。</p>
        </aside>

        <main ref={browseMotion.rootRef} className="main-content" aria-label="镜头参考浏览" tabIndex={0}>
          <section className="search-section" aria-labelledby="page-title">
            <h1 id="page-title" className="visually-hidden">{collection?.title ?? "AI 视频与分镜参考"}</h1>
            <form
              className="hero-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                applySearch(draftQuery);
              }}
            >
              <Search className="hero-search-icon" aria-hidden="true" />
              <input
                ref={searchRef}
                value={draftQuery}
                aria-label="搜索镜头参考"
                placeholder="描述想做的镜头，例如：第一视角 剑 重击"
                onChange={(event) => setDraftQuery(event.target.value)}
              />
              <Button className="hero-search-button" type="primary" htmlType="submit" autoInsertSpace={false}>
                搜索
              </Button>
            </form>
          </section>

          <div className="browse-toolbar">
            <CreationCategoryNav slug={collection?.slug} />
            <span role="status">{query ? `“${query}” · ` : ""}{resultCount} 个参考</span>
            {(query || hasActiveFilters) && <Button size="small" type="text" onClick={resetFilters}>清除条件</Button>}
          </div>

          <CreationSelectedConditions selections={selectedConditionGroups} onRemove={updateFilter} />

          {resultCount > 0 ? (
            <CreationReferenceResults references={filteredReferences} groups={tagGroups} showPrompts={collection?.slug === "prompts"} />
          ) : (
            <section className="empty-state">
              <Empty description="暂时没有符合这些条件的镜头参考，可减少条件或换个关键词。">
                <Button type="primary" onClick={resetFilters}>
                  清除筛选
                </Button>
              </Empty>
            </section>
          )}
        </main>
      </div>
      )}

      <Drawer
        open={savedOpen}
        title={`我的收藏 · ${savedItems.length}`}
        placement="right"
        size={380}
        onClose={() => setSavedOpen(false)}
      >
        <p className="saved-explanation">收藏整条案例，方便下次回看。</p>
        <Button className="saved-folders-link" icon={<Folder />} onClick={() => { setSavedOpen(false); openLibrary(guardNavigation); }}>打开镜头收藏夹</Button>
        <p className="saved-explanation">想把不同案例里的镜头放在一起？可在拆解页将镜头加入收藏夹。</p>
        {favoritesError && <p role="alert">{favoritesError}</p>}
        {savedIds.size > savedItems.length && <p>有 {savedIds.size - savedItems.length} 条收藏暂未公开，重新上架后可继续查看。</p>}
        {savedItems.length ? (
          <div className="saved-list">
            {savedItems.map((item) => (
              <Link
                href={casePath(item.id)}
                key={item.id}
                className="saved-item"
                onClick={(event) => { guardNavigation(event); if (!event.defaultPrevented) setSavedOpen(false); }}
              >
                <img src={item.image} alt="" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.tags.slice(0, 3).join(" · ")}</small>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty description="还没有收藏案例" />
        )}
      </Drawer>
    </div>
  );
}
