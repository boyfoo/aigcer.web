"use client";

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
  BookOutlined,
  BookFilled,
  CopyOutlined,
  DownOutlined,
  FileTextOutlined,
  FolderOutlined,
  PlayCircleFilled,
  SearchOutlined,
  SettingOutlined,
  StarFilled,
} from "@ant-design/icons";
import { TagSettings } from "./TagSettings.jsx";
import { ContentEntry } from "./ContentEntry.jsx";
import { useContentCases } from "./ContentProvider.jsx";
import { VideoStudy } from "./VideoStudy.jsx";
import { useReferenceProjects } from "./ReferenceProjects.jsx";
import { usePreferences } from "./Providers.jsx";
import { casePath, collectionPath } from "./lib/content.js";
import { displayTags, tagValues } from "./lib/contentEntries.js";
import { caseLearningFocus } from "./lib/learningPresentation.js";
import { createInitialTagFilters, matchesTagFilters, reconcileTagFilters } from "./tagSettings.js";

export function App({ page = "home", initialCaseId, collection, previewItem, serverItem }) {
  const { message, modal } = AntApp.useApp();
  const router = useRouter();
  const { openLibrary } = useReferenceProjects();
  const { tagGroups, tagRevision, saveTags, tagsLoaded, savedIds, toggleFavorite, favoritesError } = usePreferences();
  const { items: allItems } = useContentCases();
  const items = useMemo(() => collection?.kind ? allItems.filter((item) => item.kind === collection.kind) : allItems, [allItems, collection]);
  const searchRef = useRef(null);
  const settingsDirtyRef = useRef(false);
  const curatedLabel = "午夜精选";
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(() => createInitialTagFilters(tagGroups));
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [selectedId, setSelectedId] = useState(initialCaseId ?? items[0]?.id);
  const [savedOpen, setSavedOpen] = useState(false);
  const [expandedFilters, setExpandedFilters] = useState({});
  const hasActiveFilters = Object.values(filters).some((values) => tagValues(values).length);
  const isDiscovery = !collection && !query && !hasActiveFilters;

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
    setFilters((current) => reconcileTagFilters(tagGroups, current));
  }, [tagGroups]);

  const guardNavigation = (event) => {
    if (!settingsDirtyRef.current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = event.currentTarget.getAttribute("href");
    confirmLeaveSettings(() => router.push(href));
  };

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const filterMatch =
        !filtersApplied ||
        matchesTagFilters(item, tagGroups, filters);
      const haystack = [
        item.title,
        item.description,
        item.analysis,
        item.prompt,
        item.kind,
        item.type,
        item.emotion,
        item.lighting,
        item.movement,
        ...item.tags,
        ...Object.values(item.tagValues ?? {}).flat(),
      ]
        .join(" ")
        .toLowerCase();
      return filterMatch && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [items, filters, filtersApplied, query, tagGroups]);

  const selectedItem = page === "case" ? previewItem ?? items.find((item) => item.id === initialCaseId) ?? serverItem : (
    filteredItems.find((item) => item.id === selectedId) ??
    filteredItems[0] ??
    items.find((item) => item.id === selectedId) ??
    items[0]);

  const supportingItems = filteredItems.filter((item) => item.id !== selectedItem?.id);
  const savedItems = allItems.filter((item) =>
    savedIds.has(item.id),
  );

  const applySearch = (value) => {
    const nextQuery = value.trim();
    setQuery(nextQuery);
  };

  const updateFilter = (key, option) => {
    setFiltersApplied(true);
    setFilters((current) => ({
      ...current,
      [key]: option ? (tagValues(current[key]).includes(option) ? tagValues(current[key]).filter((id) => id !== option) : [...tagValues(current[key]), option]) : [],
    }));
  };

  const resetFilters = () => {
    setDraftQuery("");
    setQuery("");
    setFilters(createInitialTagFilters(tagGroups));
    setFiltersApplied(false);
    setSelectedId(items[0]?.id);
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
      setFilters((current) => reconcileTagFilters(next.groups, current));
      message.success("标签设置已保存，左侧菜单已更新");
      return next;
    } catch (error) {
      message.error(error.message || "保存失败，修改仍保留在设置中");
    }
  };

  const renderFilters = () => (
    <div className="filters" aria-label="镜头筛选">
      {!tagGroups.length && <p className="sidebar-empty">还没有标签，可在个人中心的设置中添加。</p>}
      {tagGroups.map((group) => {
        const activeValues = tagValues(filters[group.id]);
        return (
          <section className="filter-group" key={group.id}>
            <h2 className="filter-heading"><button type="button" aria-expanded={Boolean(expandedFilters[group.id])} aria-controls={`filter-${group.id}`} onClick={() => setExpandedFilters((current) => ({ ...current, [group.id]: !current[group.id] }))}>{group.label}<span>{activeValues.length ? `已选 ${activeValues.length}` : "不限"}<DownOutlined /></span></button></h2>
            <div className="filter-options" id={`filter-${group.id}`} hidden={!expandedFilters[group.id]}>
              {[{ id: "", label: "全部" }, ...group.options].map((option) => {
                const active = option.id ? activeValues.includes(option.id) : !activeValues.length;
                return (
                  <button
                    className={active ? "filter-option is-active" : "filter-option"}
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => updateFilter(group.id, option.id)}
                  >
                    <span className="option-dot" aria-hidden="true" />
                    <span>{option.label}</span>
                    {active && option.id ? (
                      <PlayCircleFilled className="option-arrow" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );

  const profileMenu = {
    items: [
      { key: "projects", label: "镜头收藏夹", icon: <FolderOutlined /> },
      { key: "content", label: "内容录入", icon: <FileTextOutlined /> },
      { key: "settings", label: "标签设置", icon: <SettingOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === "settings") navigateTo("settings");
      else if (key === "content") navigateTo("content");
      else if (key === "projects") openLibrary(guardNavigation);
      else message.info(`已选择：${key}`);
    },
  };

  return (
    <div className="app-shell">
      <div className="paper-texture" aria-hidden="true" />

      <header className="topbar">
        <Link className="brand" href="/" onClick={(event) => { guardNavigation(event); if (!event.defaultPrevented) resetFilters(); }} aria-label="返回案例首页">
          镜界
        </Link>
        <nav className="primary-nav" aria-label="主要导航">
          <Link href="/" className={`nav-link${page === "home" || page === "case" ? " is-active" : ""}`} onClick={guardNavigation}>看案例</Link>
          <button type="button" className="nav-link" aria-label={`我的收藏，共 ${savedIds.size} 条`} onClick={() => setSavedOpen(true)}>我的收藏{savedIds.size > 0 && <span className="nav-count">{savedIds.size}</span>}</button>
        </nav>
        <div className="top-actions">
          <Dropdown menu={profileMenu} trigger={["click"]}>
            <button className="profile-button" type="button" aria-label="打开个人中心">
              <Avatar size={38} src="/images/avatar-curator.png" />
              <DownOutlined aria-hidden="true" />
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
            <header className="case-heading"><p>{selectedItem.kind} · {selectedItem.duration}</p><h1>{selectedItem.title}</h1><p>{selectedItem.description}</p></header>
            {selectedItem.video?.src ? <video className="case-simple-video" src={selectedItem.video.src} poster={selectedItem.image} controls playsInline preload="metadata" aria-label={`${selectedItem.title}视频播放器`}>浏览器暂不支持视频播放，可使用<a href={selectedItem.video.src}>视频原链接</a>观看。</video> : <img className="case-image" src={selectedItem.image} alt={selectedItem.title} />}
            <div className="case-body case-reading-body">
              <section><h2>看懂这个画面</h2><p className="case-prompt">{selectedItem.analysis || selectedItem.description || caseLearningFocus(selectedItem)}</p></section>
              <details><summary>查看画面信息</summary><dl className="case-facts">{[["类型", selectedItem.type], ["情绪", selectedItem.emotion], ["光影", selectedItem.lighting], ["运镜", selectedItem.movement]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{displayTags(value) || "—"}</dd></div>)}</dl><div className="tag-row">{selectedItem.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div></details>
              <details><summary>查看提示词参考</summary><p className="case-prompt">{selectedItem.prompt || "暂未提供提示词"}</p><Button disabled={!selectedItem.prompt} icon={<CopyOutlined />} onClick={copyPrompt}>复制提示词</Button></details>
              <div className="case-actions"><Button icon={savedIds.has(selectedItem.id) ? <BookFilled /> : <BookOutlined />} onClick={() => toggleSaved(selectedItem.id)}>{savedIds.has(selectedItem.id) ? "已收藏" : "收藏案例"}</Button></div>
            </div>
          </article>
          </>
          )}
        </main>
      ) : (
      <div className="page-layout">
        <aside className="sidebar"><p className="filter-intro">按兴趣找案例</p>{renderFilters()}<p className="filter-hint">可以直接浏览，也可以展开分类细选。</p></aside>

        <main className="main-content">
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
              <SearchOutlined className="hero-search-icon" aria-hidden="true" />
              <input
                ref={searchRef}
                value={draftQuery}
                aria-label="搜索镜头参考"
                placeholder="搜索案例、画面或风格，例如：雨夜"
                onChange={(event) => setDraftQuery(event.target.value)}
              />
              <Button className="hero-search-button" type="primary" htmlType="submit">
                搜索
              </Button>
            </form>
          </section>

          <div className="browse-toolbar"><nav className="browse-categories" aria-label="案例分类">{[[undefined, "全部案例"], ["videos", "视频"], ["storyboards", "分镜图片"], ["prompts", "提示词参考"]].map(([slug, label]) => <Link key={slug || "all"} href={slug ? collectionPath(slug) : "/"} aria-current={collection?.slug === slug ? "page" : undefined}>{label}</Link>)}</nav><span role="status">{query ? `“${query}” · ` : ""}{filteredItems.length} 个案例</span>{(query || hasActiveFilters) && <Button size="small" type="text" onClick={resetFilters}>清除条件</Button>}</div>

          {filteredItems.length && isDiscovery ? (
            <section className="storyboard-layout" aria-label="镜头参考结果">
              <article className="featured-card">
                <Link
                  href={casePath(selectedItem.id)}
                  className="featured-visual"
                  aria-label={`查看案例：${selectedItem.title}`}
                >
                  <img src={selectedItem.image} alt={selectedItem.title} />
                  <span className="featured-badge">
                    <StarFilled /> {curatedLabel}
                  </span>
                  <span className="duration-badge">
                    <PlayCircleFilled /> {selectedItem.duration}
                  </span>
                </Link>
                <div className="featured-details">
                  <h2><Link href={casePath(selectedItem.id)}>{selectedItem.title}</Link></h2>
                  <p className="case-learning-focus"><span>看点</span>{caseLearningFocus(selectedItem)}</p>
                  <p className="description">{selectedItem.description}</p>
                  <div className="featured-actions">
                    <Link className="case-read-link" href={casePath(selectedItem.id)}>{selectedItem.video?.shots.length ? "看视频与拆解" : "查看案例"} <span aria-hidden="true">→</span></Link>
                    <Button
                      type="text"
                      className={savedIds.has(selectedItem.id) ? "is-saved" : ""}
                      icon={savedIds.has(selectedItem.id) ? <BookFilled /> : <BookOutlined />}
                      onClick={() => toggleSaved(selectedItem.id)}
                    >
                      {savedIds.has(selectedItem.id) ? "已收藏" : "收藏案例"}
                    </Button>
                  </div>
                </div>
              </article>

              <div className="supporting-grid" aria-label="更多镜头参考">
                {supportingItems.slice(0, 5).map((item, index) => (
                  <Link
                    href={casePath(item.id)}
                    key={item.id}
                    className={`gallery-card gallery-card-${index + 1}`}
                    aria-label={`查看案例：${item.title}`}
                  >
                    <img src={item.image} alt="" />
                    <span className="gallery-caption"><strong>{item.title}</strong><span>{caseLearningFocus(item)}</span></span>
                    <span className="duration-badge">
                      <PlayCircleFilled /> {item.duration}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : filteredItems.length ? (
            <section className="case-results-grid" aria-label="镜头参考结果">{filteredItems.map((item) => <Link href={casePath(item.id)} className="browse-case" key={item.id} aria-label={`查看案例：${item.title}`}><div className="browse-case-image"><img src={item.image} alt="" /><span className="duration-badge">{item.kind} · {item.duration}</span></div><h2>{item.title}</h2><p>{caseLearningFocus(item)}</p>{collection?.slug === "prompts" && <p className="browse-prompt-excerpt">{item.prompt || "进入案例查看逐镜头提示词"}</p>}<span className="browse-case-action">{collection?.slug === "prompts" ? "查看案例与提示词" : item.video?.shots.length ? "看视频与拆解" : "查看案例"} <span aria-hidden="true">→</span></span></Link>)}</section>
          ) : (
            <section className="empty-state">
              <Empty description="暂时没有匹配的镜头参考">
                <Button type="primary" onClick={resetFilters}>
                  清除筛选
                </Button>
              </Empty>
            </section>
          )}
          {isDiscovery && supportingItems.length > 5 && <section className="case-results-grid more-case-results" aria-label="更多案例">{supportingItems.slice(5).map((item) => <Link className="browse-case" href={casePath(item.id)} key={item.id}><div className="browse-case-image"><img src={item.image} alt="" /></div><h2>{item.title}</h2><p>{caseLearningFocus(item)}</p></Link>)}</section>}
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
        <Button className="saved-folders-link" icon={<FolderOutlined />} onClick={() => { setSavedOpen(false); openLibrary(guardNavigation); }}>打开镜头收藏夹</Button>
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
