/** 2D roving focus for TV rails — vertical between rows, horizontal within a row. */

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
    const preferred = options.preferredKey ? this.findKey(options.preferredKey) : null;
    if (preferred) {
      this.rowIndex = preferred.row;
      this.colIndex = preferred.col;
    } else if (options.fallbackPosition) {
      this.rowIndex = clamp(options.fallbackPosition.row, 0, this.rows.length - 1);
      this.colIndex = clamp(options.fallbackPosition.col, 0, this.currentRow().length - 1);
    } else {
      this.rowIndex = clamp(this.rowIndex, 0, this.rows.length - 1);
      this.colIndex = clamp(this.colIndex, 0, this.currentRow().length - 1);
    }
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

  private findKey(key: string): { row: number; col: number } | null {
    for (let row = 0; row < this.rows.length; row += 1) {
      const col = this.rows[row].findIndex((element) => element.dataset.focusKey === key);
      if (col >= 0) {
        return { row, col };
      }
    }
    return null;
  }

  private applyFocus(): void {
    const target = this.focused;
    if (target === null) {
      return;
    }
    target.focus({ preventScroll: true });
    if (this.pendingScroll !== 0) {
      window.cancelAnimationFrame(this.pendingScroll);
    }
    this.pendingScroll = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
      this.pendingScroll = 0;
    });
    this.onFocus?.(target);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
