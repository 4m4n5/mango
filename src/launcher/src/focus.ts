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

/**
 * Column-stable D-pad step. Down/Up keep the intended column when a row is
 * shorter (Search recents beside a 10-key keyboard, a short last Home rail).
 */
export function stepGridPosition(
  rowLengths: number[],
  current: { row: number; col: number; desiredCol: number },
  axis: "row" | "col",
  delta: number,
): { row: number; col: number; desiredCol: number } {
  if (rowLengths.length === 0) {
    return { row: 0, col: 0, desiredCol: 0 };
  }
  if (axis === "col") {
    const length = rowLengths[current.row] ?? 0;
    if (length === 0) return current;
    const col = clamp(current.col + delta, 0, length - 1);
    return { row: current.row, col, desiredCol: col };
  }
  const row = clamp(current.row + delta, 0, rowLengths.length - 1);
  if (row === current.row) return current;
  const length = rowLengths[row] ?? 0;
  const col = length === 0 ? 0 : clamp(current.desiredCol, 0, length - 1);
  return { row, col, desiredCol: current.desiredCol };
}

export class FocusGrid {
  private rows: HTMLElement[][] = [];
  private rowIndex = 0;
  private colIndex = 0;
  private desiredCol = 0;
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
      this.desiredCol = 0;
      return;
    }
    const previous = this.focused;
    const position = resolveFocusPosition(this.rows, options, {
      row: this.rowIndex,
      col: this.colIndex,
    });
    this.rowIndex = position.row;
    this.colIndex = position.col;
    this.desiredCol = position.col;
    const next = this.focused;
    if (next !== null && next === previous && document.activeElement === next) {
      return;
    }
    this.applyFocus();
  }

  moveRow(delta: number): void {
    const next = stepGridPosition(
      this.rows.map((row) => row.length),
      { row: this.rowIndex, col: this.colIndex, desiredCol: this.desiredCol },
      "row",
      delta,
    );
    if (next.row === this.rowIndex && next.col === this.colIndex) {
      return;
    }
    this.rowIndex = next.row;
    this.colIndex = next.col;
    this.desiredCol = next.desiredCol;
    this.applyFocus();
  }

  moveCol(delta: number): void {
    const next = stepGridPosition(
      this.rows.map((row) => row.length),
      { row: this.rowIndex, col: this.colIndex, desiredCol: this.desiredCol },
      "col",
      delta,
    );
    if (next.col === this.colIndex) {
      return;
    }
    this.colIndex = next.col;
    this.desiredCol = next.desiredCol;
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
    this.desiredCol = this.colIndex;
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
        this.pendingScroll = 0;
      }
      // Pinned Search scopes / Home tabs are already on screen. scrollIntoView
      // still walks ancestor scrollports (and Search's named scroll timeline),
      // which is what made Up from the first result rail hitch before the
      // D-pad move registered.
      if (focusedTargetNeedsScroll(target.getBoundingClientRect(), nearestScrollportRect(target))) {
        this.pendingScroll = window.requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
          this.pendingScroll = 0;
        });
      }
      this.onFocus?.(target);
    }
  }
}

/** Focus glow can extend a few pixels past the control box. */
const FOCUS_SCROLL_SLACK_PX = 8;

export function focusedTargetNeedsScroll(
  target: { top: number; right: number; bottom: number; left: number },
  port: { top: number; right: number; bottom: number; left: number },
  slack = FOCUS_SCROLL_SLACK_PX,
): boolean {
  return target.top < port.top - slack
    || target.bottom > port.bottom + slack
    || target.left < port.left - slack
    || target.right > port.right + slack;
}

function parseCssPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nearestScrollportRect(
  element: HTMLElement,
): { top: number; right: number; bottom: number; left: number } {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const canY = style.overflowY === "auto" || style.overflowY === "scroll";
    const canX = style.overflowX === "auto" || style.overflowX === "scroll";
    const scrollsY = canY && current.scrollHeight > current.clientHeight + 1;
    const scrollsX = canX && current.scrollWidth > current.clientWidth + 1;
    if (scrollsY || scrollsX) {
      const rect = current.getBoundingClientRect();
      return {
        top: rect.top + parseCssPx(style.scrollPaddingTop),
        right: rect.right - parseCssPx(style.scrollPaddingRight),
        bottom: rect.bottom - parseCssPx(style.scrollPaddingBottom),
        left: rect.left + parseCssPx(style.scrollPaddingLeft),
      };
    }
    current = current.parentElement;
  }
  return {
    top: 0,
    left: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
