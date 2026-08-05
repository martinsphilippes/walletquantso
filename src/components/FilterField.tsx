"use client";

// Small labeled wrapper for filter controls, so every filter shows a caption
// of what it is (e.g. "Data inicial" above the bare date input).

export function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      <span className="muted" style={{ fontSize: "0.75rem" }}>{label}</span>
      {children}
    </label>
  );
}
