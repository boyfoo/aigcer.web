import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { FilterSelectionSummary } from "./FilterSelectionSummary.jsx";
import { tagValues } from "./lib/contentEntries.js";
import { groupCreationFilters } from "./lib/creationNavigation.js";

export function CreationFilters({ groups, filters, motionGroup, onChange }) {
  const [expandedEntry, setExpandedEntry] = useState(null);
  const expandedHeadingRef = useRef(null);
  const entries = groupCreationFilters(groups);

  useLayoutEffect(() => {
    // Closing a long entry above the clicked one can move its heading out of view.
    expandedHeadingRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [expandedEntry]);

  const renderGroup = (group) => {
    const activeValues = tagValues(filters[group.id]);
    return (
      <section className="creation-filter-group" key={group.id} aria-labelledby={`filter-label-${group.id}`} data-filter-motion={motionGroup === group.id || undefined}>
        <h3 className="creation-filter-label" id={`filter-label-${group.id}`}>
          {group.label}
          {activeValues.length > 0 && <span>已选 {activeValues.length}</span>}
        </h3>
        <div className="filter-options" id={`filter-${group.id}`}>
          {[{ id: "", label: "全部" }, ...group.options].map((option) => {
            const active = option.id ? activeValues.includes(option.id) : !activeValues.length;
            return (
              <button
                className={active ? "filter-option is-active" : "filter-option"}
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={(event) => onChange(group.id, option.id, event.detail > 0)}
              >
                <span>{option.label}</span>
                {option.id && <Check className="option-check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div className="creation-filters">
      {!groups.length && <p className="sidebar-empty">还没有标签，可在个人菜单的设置中添加。</p>}
      <div className="filters creation-entry-list" aria-label="创作条件">
        {entries.map((entry) => {
          const isExpanded = expandedEntry === entry.id;
          const selectedCount = entry.groups.reduce((count, group) => count + tagValues(filters[group.id]).length, 0);
          const animate = entry.groups.some((group) => group.id === motionGroup);
          return (
            <section className="filter-group creation-filter-entry" key={entry.id}>
              <h2 className="filter-heading creation-entry-heading">
                <button
                  ref={isExpanded ? expandedHeadingRef : undefined}
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`creation-entry-${entry.id}`}
                  onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                >
                  {entry.label}
                  <span className={`filter-summary${selectedCount ? " is-active" : ""}`}>
                    <FilterSelectionSummary count={selectedCount} animate={animate} />
                    <ChevronDown aria-hidden="true" />
                  </span>
                </button>
              </h2>
              <div className="creation-entry-conditions" id={`creation-entry-${entry.id}`} hidden={!isExpanded}>
                {entry.groups.map(renderGroup)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
