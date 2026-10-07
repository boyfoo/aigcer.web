import { X } from "lucide-react";

export function CreationSelectedConditions({ selections, onRemove }) {
  if (!selections.length) return null;
  return (
    <ul className="creation-selected-conditions" aria-label="已选创作条件">
      {selections.map(({ group, options }) => (
        <li className="creation-selected-group" key={group.id} data-condition-group={group.id}>
          <span className="creation-selected-group-label">{group.label}：</span>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              data-condition-option={JSON.stringify([group.id, option.id])}
              aria-label={`清除${group.label}：${option.label}`}
              onClick={(event) => onRemove(group.id, option.id, event.detail > 0)}
            >
              <span>{option.label}</span><X aria-hidden="true" />
            </button>
          ))}
        </li>
      ))}
    </ul>
  );
}
