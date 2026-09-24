export function EntryField({ label, children, hint, required }) {
  return (
    <div className="entry-field">
      <div className="entry-field-label">
        {label}{required && <span aria-hidden="true"> *</span>}
      </div>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
