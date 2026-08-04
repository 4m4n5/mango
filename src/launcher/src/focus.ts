/** 2D roving focus for TV rails — vertical between rows, horizontal within a row. */

export function resolveFocusPosition(
  rows: HTMLElement[][],
  options: { preferredKey?: string; fallbackPosition?: { row: number; col: number } },
  current: { row: number; col: number },
): { row: number; col: number } {
  if (rows.length === 0) return { row: 0, col: 0 };
  if (options.preferredKey) {
    for (let row = 0; row < rows.length; row += 1) {
      const col = rows[row]!.findIndex((element) => element.dataset.focusKey === options.preferredKey);
      if (col >= 0) return { row, col };
    }
  }
  const desired = options.fallbackPosition ?? current;
  const row = clamp(desired.row, 0, rows.length - 1);
  return { row, col: clamp(desired.col, 0, rows[row]!.length - 1) };
}

export class FocusGrid {
  private rows: HTMLElement[][] = [];
  private rowIndex = 0;
  private colIndex = 0;
  private onFocus?: (element: HTMLElement) => void;
  private pendingScroll = 0;

  constructor(onFocus?: (element: HTMLElement) => void) {
    this.onFocus = onFocus;
  }

  setRows(
    rows: HTMLElement[][],
    options: {
      preferredKey?: string;
      fallbackPosition?: { row: number; col: number };
    } = {},
  ): void {
    this.rows = rows.filter((row) => row.length > 0);
    if (this.rows.length === 0) {
      this.rowIndex = 0;
      this.colIndex = 0;
      return;
    }
    const position = resolveFocusPosition(this.rows, options, {
      row: this.rowIndex,
      col: this.colIndex,
    });
    this.rowIndex = position.row;
    this.colIndex = position.col;
    this.applyFocus();
  }

  moveRow(delta: number): void {
    if (this.rows.length === 0) {
      return;
    }
    const nextRow = clamp(this.rowIndex + delta, 0, this.rows.length - 1);
    if (nextRow === this.rowIndex) {
      return;
    }
    this.rowIndex = nextRow;
    this.colIndex = clamp(this.colIndex, 0, this.currentRow().length - 1);
    this.applyFocus();
  }

  moveCol(delta: number): void {
    const row = this.currentRow();
    if (row.length === 0) {
      return;
    }
    const nextCol = clamp(this.colIndex + delta, 0, row.length - 1);
    if (nextCol === this.colIndex) {
      return;
    }
    this.colIndex = nextCol;
    this.applyFocus();
  }

  get focused(): HTMLElement | null {
    const row = this.currentRow();
    return row[this.colIndex] ?? null;
  }

  get position(): { row: number; col: number } {
    return { row: this.rowIndex, col: this.colIndex };
  }

  setPosition(row: number, col: number): void {
    if (this.rows.length === 0) {
      return;
    }
    this.rowIndex = clamp(row, 0, this.rows.length - 1);
    this.colIndex = clamp(col, 0, this.currentRow().length - 1);
    this.applyFocus();
  }

  restoreFocus(): void {
    this.applyFocus();
  }

  private currentRow(): HTMLElement[] {
    return this.rows[this.rowIndex] ?? [];
  }

  private applyFocus(): void {
    const target = this.focused;
    if (target === null) {
      return;
    }
    if (document.activeElement !== target) {
      target.focus({ preventScroll: true });
      if (this.pendingScroll !== 0) {
        window.cancelAnimationFrame(this.pendingScroll);
      }
      this.pendingScroll = window.requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
        this.pendingScroll = 0;
      });
    }
    this.onFocus?.(target);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
