"use client";

// Reusable multi-row selection + bulk delete.
//
// `useBulkSelect` tracks a set of selected ids scoped to the currently visible
// rows. `SelectAllCheckbox` is the header toggle (with an indeterminate state),
// `RowCheckbox` is the per-row box, and `BulkBar` is the action bar with a
// two-step inline confirmation (no native confirm(), which misbehaves on iPad).

import { useEffect, useMemo, useRef, useState } from "react";

export interface BulkSelection {
  selectedIds: string[];
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  clear: () => void;
}

export function useBulkSelect<T>(
  rows: T[],
  getId: (row: T) => string | undefined,
): BulkSelection {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const ids = useMemo(
    () => rows.map(getId).filter((x): x is string => !!x),
    [rows, getId],
  );

  const selectedIds = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);
  const allVisibleSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someVisibleSelected = ids.some((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  const clear = () => setSelected(new Set());

  return {
    selectedIds,
    count: selectedIds.length,
    isSelected: (id) => selected.has(id),
    toggle,
    toggleAll,
    allVisibleSelected,
    someVisibleSelected,
    clear,
  };
}

export function SelectAllCheckbox({ sel }: { sel: BulkSelection }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = sel.someVisibleSelected && !sel.allVisibleSelected;
    }
  }, [sel.someVisibleSelected, sel.allVisibleSelected]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={sel.allVisibleSelected}
      onChange={sel.toggleAll}
      aria-label="Selecionar todos"
    />
  );
}

export function RowCheckbox({ sel, id }: { sel: BulkSelection; id?: string }) {
  return (
    <input
      type="checkbox"
      checked={id ? sel.isSelected(id) : false}
      onChange={() => id && sel.toggle(id)}
      aria-label="Selecionar linha"
      disabled={!id}
    />
  );
}

/**
 * Bulk action bar. Renders nothing when no rows are selected. The delete button
 * asks for confirmation inline (two clicks) before calling `onDelete`.
 */
export function BulkBar({
  sel,
  onDelete,
  busy,
  noun = "item",
  extra,
}: {
  sel: BulkSelection;
  onDelete: () => void | Promise<void>;
  busy?: boolean;
  /** Singular noun for the message, e.g. "lançamento", "título", "conta". */
  noun?: string;
  /** Extra inline actions rendered next to the delete/clear buttons. */
  extra?: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (sel.count === 0 && confirming) setConfirming(false);
  }, [sel.count, confirming]);

  if (sel.count === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: "0.6rem",
        alignItems: "center",
        flexWrap: "wrap",
        padding: "0.5rem 0.75rem",
        marginBottom: "0.75rem",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg)",
      }}
    >
      <strong>{sel.count} selecionado(s)</strong>
      {!confirming ? (
        <>
          <button style={{ background: "var(--err)" }} disabled={busy} onClick={() => setConfirming(true)}>
            Excluir selecionados
          </button>
          <button style={{ background: "var(--border)" }} onClick={sel.clear}>
            Limpar seleção
          </button>
          {extra}
        </>
      ) : (
        <>
          <span className="muted">
            Excluir {sel.count} {sel.count === 1 ? noun : `${noun}s`}? Esta ação não pode ser desfeita.
          </span>
          <button
            style={{ background: "var(--err)" }}
            disabled={busy}
            onClick={async () => {
              await onDelete();
              setConfirming(false);
            }}
          >
            {busy ? "Excluindo…" : "Confirmar exclusão"}
          </button>
          <button style={{ background: "var(--border)" }} disabled={busy} onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </>
      )}
    </div>
  );
}
