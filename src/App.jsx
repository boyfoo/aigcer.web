import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  Avatar,
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Empty,
  Modal,
  Tag,
  Tooltip,
  theme as antdTheme,
} from "antd";
import {
  BookOutlined,
  BookFilled,
  CloseOutlined,
  CopyOutlined,
  DownOutlined,
  FileTextOutlined,
  MenuOutlined,
  PlayCircleFilled,
  SearchOutlined,
  SettingOutlined,
  StarFilled,
} from "@ant-design/icons";
import { storyboardItems } from "./data.js";
import { TagSettings } from "./TagSettings.jsx";
import { createInitialTagFilters, loadTagGroups, matchesTagFilters, reconcileTagFilters, saveTagGroups } from "./tagSettings.js";

const getCurrentPage = () => window.location.pathname.replace(/\/$/, "") === "/settings" ? "settings" : "home";

function AppContent() {
  const { message, modal } = AntApp.useApp();
  const searchRef = useRef(null);
  const settingsDirtyRef = useRef(false);
  const curatedLabel = "午夜精选";
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [tagGroups, setTagGroups] = useState(loadTagGroups);
  const [filters, setFilters] = useState(() => createInitialTagFilters(tagGroups));
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [selectedId, setSelectedId] = useState("night-cinema");
  const [activeSection, setActiveSection] = useState("本周精选");
  const [promptOpen, setPromptOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [page, setPage] = useState(getCurrentPage);
  const [savedIds, setSavedIds] = useState(new Set());

  const updateSettingsDirty = useCallback((dirty) => {
    settingsDirtyRef.current = dirty;
  }, []);

  const confirmLeaveSettings = useCallback((onLeave, onCancel) => {
    if (!settingsDirtyRef.current) return onLeave();
    modal.confirm({
      title: "放弃未保存的标签修改？",
      content: "左侧菜单会保留上次保存的配置。",
      okText: "放弃修改",
      cancelText: "继续编辑",
      onOk: onLeave,
      onCancel,
    });
  }, [modal]);

  const navigateTo = (nextPage, afterNavigate) => {
    const navigate = () => {
      if (page !== nextPage) {
        window.history.pushState(null, "", `${nextPage === "settings" ? "/settings" : "/"}${window.location.search}`);
        setPage(nextPage);
      }
      afterNavigate?.();
    };
    if (page === "settings" && nextPage !== page) confirmLeaveSettings(navigate);
    else navigate();
  };

  useEffect(() => {
    const handlePopState = () => {
      const nextPage = getCurrentPage();
      if (nextPage === page) return;
      if (page === "settings") {
        confirmLeaveSettings(
          () => setPage(nextPage),
          () => window.history.pushState(null, "", `/settings${window.location.search}`),
        );
      } else setPage(nextPage);
    };
    window.addEventListener("popstate", handlePopState);
    window.scrollTo({ top: 0, behavior: "instant" });
    return () => window.removeEventListener("popstate", handlePopState);
  }, [page, confirmLeaveSettings]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return storyboardItems.filter((item) => {
      const sectionMatch =
        activeSection === "本周精选" ||
        activeSection === "提示词" ||
        item.kind === activeSection;
      const filterMatch =
        !filtersApplied ||
        matchesTagFilters(item, tagGroups, filters);
      const haystack = [
        item.title,
        item.description,
        item.prompt,
        item.kind,
        item.type,
        item.emotion,
        item.lighting,
        item.movement,
        ...item.tags,
      ]
        .join(" ")
        .toLowerCase();
      return sectionMatch && filterMatch && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [activeSection, filters, filtersApplied, query, tagGroups]);

  const selectedItem =
    filteredItems.find((item) => item.id === selectedId) ??
    filteredItems[0] ??
    storyboardItems.find((item) => item.id === selectedId) ??
    storyboardItems[0];

  const supportingItems = filteredItems.filter((item) => item.id !== selectedItem.id);
  const savedItems = storyboardItems.filter((item) =>
    savedIds.has(item.id),
  );

  const applySearch = (value) => {
    const nextQuery = value.trim();
    setQuery(nextQuery);
    if (nextQuery) message.success(`正在寻找“${nextQuery}”相关镜头`);
  };

  const updateFilter = (key, option) => {
    setFiltersApplied(true);
    setFilters((current) => ({
      ...current,
      [key]: option,
    }));
  };

  const resetFilters = () => {
    setDraftQuery("");
    setQuery("");
    setFilters(createInitialTagFilters(tagGroups));
    setFiltersApplied(false);
    setActiveSection("本周精选");
    setSelectedId("night-cinema");
  };

  const toggleSaved = (itemId) => {
    const wasSaved = savedIds.has(itemId);
    setSavedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    message.success(wasSaved ? "已移出收藏" : "已收藏这条镜头参考");
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(selectedItem.prompt);
      message.success("提示词已复制");
    } catch {
      message.info("请选择提示词后复制");
    }
  };

  const handleSaveTagSettings = (draft) => {
    try {
      const nextGroups = saveTagGroups(draft);
      setTagGroups(nextGroups);
      setFilters((current) => reconcileTagFilters(nextGroups, current));
      message.success("标签设置已保存，左侧菜单已更新");
      return nextGroups;
    } catch {
      message.error("保存失败，请检查浏览器是否允许本地存储后重试；修改仍保留在设置中");
    }
  };

  const renderFilters = () => (
    <div className="filters" aria-label="镜头筛选">
      {!tagGroups.length && <p className="sidebar-empty">还没有标签，可在个人中心的设置中添加。</p>}
      {tagGroups.map((group) => {
        const activeValue = filters[group.id] || "";
        return (
          <section className="filter-group" key={group.id}>
            <div className="filter-heading">
              <h2>{group.label}</h2>
              <span aria-hidden="true" />
            </div>
            <div className="filter-options">
              {[{ id: "", label: "全部" }, ...group.options].map((option) => {
                const active = activeValue === option.id;
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
      { key: "profile", label: "个人资料" },
      { key: "projects", label: "我的项目" },
      { key: "settings", label: "设置", icon: <SettingOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === "settings") navigateTo("settings");
      else message.info(`已选择：${key}`);
    },
  };

  return (
    <div className="app-shell">
      <div className="paper-texture" aria-hidden="true" />

      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigateTo("home", resetFilters)} aria-label="返回本周精选">
          镜界
        </button>
        <nav className="primary-nav" aria-label="主要导航">
          {[curatedLabel, "分镜", "视频", "提示词"].map((item, index) => (
            <button
              key={item}
              type="button"
              className={
                page === "home" && ((index === 0 && activeSection === "本周精选") || activeSection === item)
                  ? "nav-link is-active"
                  : "nav-link"
              }
              onClick={() => navigateTo("home", () => setActiveSection(index === 0 ? "本周精选" : item))}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <Tooltip title="定位到搜索">
            <Button
              type="text"
              shape="circle"
              aria-label="定位到搜索"
              icon={<SearchOutlined />}
              onClick={() => navigateTo("home", () => requestAnimationFrame(() => searchRef.current?.focus?.()))}
            />
          </Tooltip>
          <Tooltip title="我的收藏">
            <Button
              type="text"
              shape="circle"
              aria-label={`我的收藏，共 ${savedIds.size} 条`}
              icon={savedIds.size ? <BookFilled /> : <BookOutlined />}
              onClick={() => setSavedOpen(true)}
            />
          </Tooltip>
          <Dropdown menu={profileMenu} trigger={["click"]}>
            <button className="profile-button" type="button" aria-label="打开个人中心">
              <Avatar size={38} src="/images/avatar-curator.png" />
              <DownOutlined aria-hidden="true" />
            </button>
          </Dropdown>
        </div>
      </header>

      {page === "settings" ? (
        <TagSettings groups={tagGroups} onBack={() => navigateTo("home")} onSave={handleSaveTagSettings} onDirtyChange={updateSettingsDirty} />
      ) : (
      <div className="page-layout">
        <aside className="sidebar">{renderFilters()}</aside>

        <main className="main-content">
          <section className="hero-copy" aria-labelledby="page-title">
            <div className="hero-topline">
              <p>午夜夜间 · CURATED</p>
              <Button
                className="mobile-filter-button"
                icon={<MenuOutlined />}
                onClick={() => setFilterOpen(true)}
              >
                筛选
              </Button>
            </div>
            <h1 id="page-title">
              为下一个镜头，找到它的<span>情绪</span>
            </h1>
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
                placeholder="描述你想要的画面、气氛或光线"
                onChange={(event) => setDraftQuery(event.target.value)}
              />
              <Button className="hero-search-button" type="primary" htmlType="submit">
                开始寻找
              </Button>
            </form>
          </section>

          {filteredItems.length ? (
            <section className="storyboard-layout" aria-label="镜头参考结果">
              <article className="featured-card">
                <button
                  type="button"
                  className="featured-visual"
                  onClick={() => setPromptOpen(true)}
                  aria-label={`查看${selectedItem.title}完整提示词`}
                >
                  <img src={selectedItem.image} alt={selectedItem.title} />
                  <span className="featured-badge">
                    <StarFilled /> {curatedLabel}
                  </span>
                  <span className="duration-badge">
                    <PlayCircleFilled /> {selectedItem.duration}
                  </span>
                </button>
                <div className="featured-details">
                  <p className="description">{selectedItem.description}</p>
                  <div className="tag-row" aria-label="镜头标签">
                    {selectedItem.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                  <div className="prompt-preview">
                    <strong>提示词</strong>
                    <p>{selectedItem.prompt}</p>
                  </div>
                  <div className="featured-actions">
                    <Button type="text" icon={<FileTextOutlined />} onClick={() => setPromptOpen(true)}>
                      查看完整提示词
                    </Button>
                    <Button
                      type="text"
                      className={savedIds.has(selectedItem.id) ? "is-saved" : ""}
                      icon={savedIds.has(selectedItem.id) ? <BookFilled /> : <BookOutlined />}
                      onClick={() => toggleSaved(selectedItem.id)}
                    >
                      {savedIds.has(selectedItem.id) ? "已收藏" : "收藏参考"}
                    </Button>
                  </div>
                </div>
              </article>

              <div className="supporting-grid" aria-label="更多镜头参考">
                {supportingItems.slice(0, 6).map((item, index) => (
                  <button
                    key={item.id}
                    className={`gallery-card gallery-card-${index + 1}`}
                    type="button"
                    aria-label={`选择镜头：${item.title}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <img src={item.image} alt="" />
                    <span className="gallery-title">{item.title}</span>
                    <span className="duration-badge">
                      <PlayCircleFilled /> {item.duration}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="empty-state">
              <Empty description="暂时没有匹配的镜头参考">
                <Button type="primary" onClick={resetFilters}>
                  清除筛选
                </Button>
              </Empty>
            </section>
          )}
        </main>
      </div>
      )}

      <Modal
        open={promptOpen}
        width={640}
        title={selectedItem.title}
        onCancel={() => setPromptOpen(false)}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={copyPrompt}>
            复制提示词
          </Button>,
          <Button
            key="save"
            type="primary"
            icon={savedIds.has(selectedItem.id) ? <BookFilled /> : <BookOutlined />}
            onClick={() => toggleSaved(selectedItem.id)}
          >
            {savedIds.has(selectedItem.id) ? "已收藏" : "收藏参考"}
          </Button>,
        ]}
      >
        <img className="modal-image" src={selectedItem.image} alt={selectedItem.title} />
        <div className="modal-meta">
          {[selectedItem.type, selectedItem.emotion, selectedItem.lighting, selectedItem.movement].map(
            (tag) => (
              <Tag key={tag}>{tag}</Tag>
            ),
          )}
        </div>
        <h3>提示词原文</h3>
        <p className="modal-prompt">{selectedItem.prompt}</p>
      </Modal>

      <Drawer
        open={filterOpen}
        title="筛选镜头"
        placement="left"
        size={310}
        closeIcon={<CloseOutlined />}
        onClose={() => setFilterOpen(false)}
      >
        {renderFilters()}
      </Drawer>

      <Drawer
        open={savedOpen}
        title={`我的收藏 · ${savedItems.length}`}
        placement="right"
        size={380}
        onClose={() => setSavedOpen(false)}
      >
        {savedItems.length ? (
          <div className="saved-list">
            {savedItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="saved-item"
                onClick={() => navigateTo("home", () => {
                  setSelectedId(item.id);
                  setSavedOpen(false);
                })}
              >
                <img src={item.image} alt="" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.tags.slice(0, 3).join(" · ")}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty description="还没有收藏镜头" />
        )}
      </Drawer>
    </div>
  );
}

export function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: "#fcd535",
          colorPrimaryHover: "#ffe36b",
          colorPrimaryActive: "#e0b920",
          colorBgBase: "#0b0d0c",
          colorBgContainer: "#111411",
          colorTextBase: "#ede7dc",
          colorBorder: "#494439",
          borderRadius: 8,
          controlHeight: 40,
          fontFamily:
            '"Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: {
            fontWeight: 500,
            primaryColor: "#0b0d0c",
          },
          Input: { activeShadow: "none" },
          Tag: { borderRadiusSM: 999 },
        },
      }}
    >
      <AntApp>
        <AppContent />
      </AntApp>
    </ConfigProvider>
  );
}
