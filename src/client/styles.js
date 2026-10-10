/**
 * 面板样式：优先复用宿主的 `--dsw-*` 设计令牌，拿不到时退回自己的回退值，
 * 这样在 Desktop 里跟主题一致，在 Node 里做渲染自测也能跑。
 *
 * 布局用容器查询而不是媒体查询：面板宽度由宿主分配，与视口宽度无关。
 */

export const styles = `
.pmplan {
  --pm-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --pm-bg-soft: var(--dsw-alias-bg-layer-2, #f6f7f9);
  --pm-bg-sunken: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2, #eef0f4));
  --pm-fg: var(--dsw-alias-label-primary, #1b1d21);
  --pm-fg-soft: var(--dsw-alias-label-secondary, #5b6270);
  --pm-fg-muted: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-caption, #8b93a2));
  --pm-border: var(--dsw-alias-border-l2, #e2e5ea);
  --pm-border-strong: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2, #cdd2da));
  --pm-accent: var(--dsw-alias-brand-primary, var(--dsw-alias-button-primary-fill, #2f6fed));
  --pm-accent-soft: color-mix(in srgb, var(--pm-accent) 12%, transparent);
  --pm-danger: var(--dsw-alias-state-error-primary, #d93a3a);
  --pm-warn: var(--dsw-alias-state-warn-primary, #d9820a);
  --pm-ok: var(--dsw-alias-state-success-primary, #1f9d63);
  --pm-info: var(--dsw-alias-state-business-primary, var(--pm-accent));
  --pm-radius: var(--dsw-radius-md, 12px);
  --pm-radius-s: var(--dsw-radius-sm, 8px);
  --pm-shadow: 0 6px 24px rgba(15, 23, 42, 0.12);
  --pm-gap: 12px;

  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  container-type: inline-size;
  container-name: pmplan;
  background: var(--pm-bg);
  color: var(--pm-fg);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);
  font-size: 13px;
  line-height: 1.5;
}

.pmplan *,
.pmplan *::before,
.pmplan *::after { box-sizing: border-box; }

.pmplan :focus-visible {
  outline: 2px solid var(--pm-accent);
  outline-offset: 1px;
}

/* ---------- 顶栏 ---------- */

.pmplan-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  padding-left: calc(12px + var(--dsh-frame-leading-clearance, 0px));
  min-height: 48px;
  border-bottom: 1px solid var(--pm-border);
  background: var(--pm-bg);
  position: relative;
  z-index: 3;
}

.pmplan-brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
}

.pmplan-brand-icon { font-size: 16px; }

.pmplan-topbar-spacer { flex: 1 1 auto; min-width: 4px; }

.pmplan-topbar-status {
  color: var(--pm-fg-muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.pmplan-topbar-status[data-tone="danger"] { color: var(--pm-danger); }

/* ---------- 布局 ---------- */

.pmplan-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

.pmplan-side {
  width: 216px;
  flex: 0 0 216px;
  border-right: 1px solid var(--pm-border);
  background: var(--pm-bg-soft);
  padding: 10px 8px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pmplan-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pmplan-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--pm-border);
  overflow-x: auto;
  scrollbar-width: thin;
}

.pmplan-tab {
  appearance: none;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--pm-fg-soft);
  font: inherit;
  padding: 6px 10px;
  border-radius: var(--pm-radius-s) var(--pm-radius-s) 0 0;
  cursor: pointer;
  white-space: nowrap;
}

.pmplan-tab[aria-selected="true"] {
  background: var(--pm-bg);
  border-color: var(--pm-border);
  color: var(--pm-fg);
  font-weight: 600;
  margin-bottom: -1px;
  border-bottom: 1px solid var(--pm-bg);
}

.pmplan-tab:hover { color: var(--pm-fg); }

.pmplan-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: var(--pm-gap);
}

/* ---------- 侧栏分组 ---------- */

.pmplan-side-group { display: flex; flex-direction: column; gap: 2px; }

.pmplan-side-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--pm-fg-muted);
  padding: 4px 8px 2px;
  text-transform: uppercase;
}

.pmplan-side-item {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--pm-fg-soft);
  font: inherit;
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--pm-radius-s);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.pmplan-side-item:hover { background: var(--pm-bg-sunken); }

.pmplan-side-item[aria-current="true"] {
  background: var(--pm-accent-soft);
  color: var(--pm-fg);
  font-weight: 600;
}

.pmplan-side-item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pmplan-side-count {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--pm-fg-muted);
  font-variant-numeric: tabular-nums;
}

.pmplan-side-risk {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--pm-danger);
  font-variant-numeric: tabular-nums;
}

.pmplan-side-foot {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 4px 2px;
  border-top: 1px solid var(--pm-border);
}

/* ---------- 通用块 ---------- */

.pmplan-card {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius);
  background: var(--pm-bg);
  padding: 12px;
  min-width: 0;
}

.pmplan-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.pmplan-card-title { font-weight: 600; font-size: 13px; }

.pmplan-muted { color: var(--pm-fg-muted); }
.pmplan-soft { color: var(--pm-fg-soft); }
.pmplan-small { font-size: 11.5px; }
.pmplan-nowrap { white-space: nowrap; }
.pmplan-nums { font-variant-numeric: tabular-nums; }

.pmplan-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--pm-fg-soft);
  letter-spacing: 0.02em;
}

.pmplan-grid {
  display: grid;
  gap: var(--pm-gap);
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  min-width: 0;
}

.pmplan-grid-wide { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }

.pmplan-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.pmplan-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pmplan-spacer { flex: 1 1 auto; }

/* ---------- KPI ---------- */

.pmplan-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
}

.pmplan-kpi {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius);
  padding: 9px 11px;
  background: var(--pm-bg-soft);
  min-width: 0;
}

.pmplan-kpi-label { font-size: 11.5px; color: var(--pm-fg-muted); }
.pmplan-kpi-value { font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
.pmplan-kpi-hint { font-size: 11px; color: var(--pm-fg-muted); }

.pmplan-headline {
  border-left: 3px solid var(--pm-accent);
  background: var(--pm-bg-soft);
  padding: 8px 10px;
  border-radius: 0 var(--pm-radius-s) var(--pm-radius-s) 0;
  color: var(--pm-fg-soft);
}

/* ---------- 徽标 / 进度 ---------- */

.pmplan-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  border: 1px solid var(--pm-border-strong);
  color: var(--pm-fg-soft);
  background: var(--pm-bg-soft);
  white-space: nowrap;
}

.pmplan-badge[data-tone="danger"] { color: var(--pm-danger); border-color: color-mix(in srgb, var(--pm-danger) 45%, transparent); background: color-mix(in srgb, var(--pm-danger) 10%, transparent); }
.pmplan-badge[data-tone="warn"] { color: var(--pm-warn); border-color: color-mix(in srgb, var(--pm-warn) 45%, transparent); background: color-mix(in srgb, var(--pm-warn) 10%, transparent); }
.pmplan-badge[data-tone="info"] { color: var(--pm-info); border-color: color-mix(in srgb, var(--pm-info) 45%, transparent); background: color-mix(in srgb, var(--pm-info) 10%, transparent); }
.pmplan-badge[data-tone="ok"] { color: var(--pm-ok); border-color: color-mix(in srgb, var(--pm-ok) 45%, transparent); background: color-mix(in srgb, var(--pm-ok) 10%, transparent); }
.pmplan-badge[data-tone="muted"] { color: var(--pm-fg-muted); }

.pmplan-progress {
  height: 6px;
  border-radius: 999px;
  background: var(--pm-bg-sunken);
  overflow: hidden;
  min-width: 48px;
}

.pmplan-progress > span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--pm-accent);
}

.pmplan-progress[data-tone="danger"] > span { background: var(--pm-danger); }
.pmplan-progress[data-tone="warn"] > span { background: var(--pm-warn); }
.pmplan-progress[data-tone="ok"] > span { background: var(--pm-ok); }

/* ---------- 按钮 / 输入 ---------- */

.pmplan-btn {
  appearance: none;
  font: inherit;
  border: 1px solid var(--pm-border-strong);
  background: var(--pm-bg);
  color: var(--pm-fg);
  border-radius: var(--pm-radius-s);
  padding: 4px 10px;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.pmplan-btn:hover { background: var(--pm-bg-sunken); }
.pmplan-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pmplan-btn[data-variant="primary"] { background: var(--pm-accent); border-color: var(--pm-accent); color: #fff; }
.pmplan-btn[data-variant="primary"]:hover { filter: brightness(1.06); background: var(--pm-accent); }
.pmplan-btn[data-variant="ghost"] { border-color: transparent; background: transparent; color: var(--pm-fg-soft); }
.pmplan-btn[data-variant="ghost"]:hover { background: var(--pm-bg-sunken); }
.pmplan-btn[data-variant="danger"] { color: var(--pm-danger); border-color: color-mix(in srgb, var(--pm-danger) 45%, transparent); }
.pmplan-btn[data-size="small"] { padding: 2px 7px; font-size: 11.5px; }

.pmplan-input,
.pmplan-select,
.pmplan-textarea {
  font: inherit;
  color: var(--pm-fg);
  background: var(--pm-bg);
  border: 1px solid var(--pm-border-strong);
  border-radius: var(--pm-radius-s);
  padding: 4px 8px;
  min-width: 0;
  width: 100%;
}

.pmplan-textarea { min-height: 62px; resize: vertical; }
.pmplan-input[type="date"] { min-width: 128px; }
.pmplan-input[type="number"] { min-width: 72px; }
.pmplan-select { min-width: 96px; }

.pmplan-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pmplan-field > label { font-size: 11.5px; color: var(--pm-fg-muted); }
.pmplan-field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 8px; }
.pmplan-search { max-width: 240px; }

/* ---------- 表格 ---------- */

.pmplan-table-wrap { overflow: auto; border: 1px solid var(--pm-border); border-radius: var(--pm-radius); }

.pmplan-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }

.pmplan-table th,
.pmplan-table td {
  text-align: left;
  padding: 6px 9px;
  border-bottom: 1px solid var(--pm-border);
  vertical-align: middle;
}

.pmplan-table thead th {
  position: sticky;
  top: 0;
  background: var(--pm-bg-soft);
  font-size: 11.5px;
  color: var(--pm-fg-muted);
  font-weight: 600;
  z-index: 1;
}

.pmplan-table tbody tr:hover { background: var(--pm-bg-soft); }
.pmplan-table td.pmplan-cell-actions { text-align: right; white-space: nowrap; }
.pmplan-title-cell { font-weight: 600; }
.pmplan-clickable { cursor: pointer; }

/* ---------- 看板 ---------- */

.pmplan-board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(230px, 1fr);
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  min-width: 0;
}

.pmplan-board-col {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius);
  background: var(--pm-bg-soft);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 96px;
}

.pmplan-board-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--pm-border);
  font-weight: 600;
  font-size: 12.5px;
}

.pmplan-board-body { padding: 7px; display: flex; flex-direction: column; gap: 7px; }

.pmplan-item {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius-s);
  background: var(--pm-bg);
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  width: 100%;
}

.pmplan-item:hover { border-color: var(--pm-accent); }
.pmplan-item-title { font-weight: 600; overflow-wrap: anywhere; }
.pmplan-item-meta { font-size: 11.5px; color: var(--pm-fg-muted); display: flex; gap: 6px; flex-wrap: wrap; }

.pmplan-module-section { display: flex; flex-direction: column; gap: 8px; }

.pmplan-module-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  border-bottom: 1px dashed var(--pm-border-strong);
  padding-bottom: 4px;
  flex-wrap: wrap;
}

.pmplan-module-name { font-weight: 700; font-size: 13px; }

/* ---------- 条形图 / 环形图 ---------- */

.pmplan-bars { display: flex; flex-direction: column; gap: 6px; }

.pmplan-bar-row { display: grid; grid-template-columns: minmax(58px, 22%) 1fr auto; align-items: center; gap: 8px; }

.pmplan-bar-track { height: 12px; border-radius: 999px; background: var(--pm-bg-sunken); overflow: hidden; }
.pmplan-bar-fill { height: 100%; border-radius: 999px; background: var(--pm-accent); }
.pmplan-bar-fill[data-tone="danger"] { background: var(--pm-danger); }
.pmplan-bar-fill[data-tone="warn"] { background: var(--pm-warn); }
.pmplan-bar-fill[data-tone="ok"] { background: var(--pm-ok); }
.pmplan-bar-fill[data-tone="muted"] { background: var(--pm-border-strong); }

.pmplan-donut-wrap { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pmplan-legend { display: flex; flex-direction: column; gap: 3px; font-size: 12px; min-width: 128px; }
.pmplan-legend-row { display: flex; align-items: center; gap: 6px; }
.pmplan-dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; background: var(--pm-border-strong); }
.pmplan-dot[data-tone="danger"] { background: var(--pm-danger); }
.pmplan-dot[data-tone="warn"] { background: var(--pm-warn); }
.pmplan-dot[data-tone="info"] { background: var(--pm-info); }
.pmplan-dot[data-tone="ok"] { background: var(--pm-ok); }
.pmplan-dot[data-tone="muted"] { background: var(--pm-border-strong); }

/* ---------- 日历 ---------- */

.pmplan-calendar { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.pmplan-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(84px, 1fr));
  gap: 4px;
  min-width: 0;
}

.pmplan-calendar-weekday {
  text-align: center;
  font-size: 11.5px;
  color: var(--pm-fg-muted);
  padding: 2px 0;
}

.pmplan-day {
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius-s);
  min-height: 76px;
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--pm-bg);
  min-width: 0;
  overflow: hidden;
}

.pmplan-day[data-outside="true"] { background: var(--pm-bg-soft); opacity: 0.62; }
.pmplan-day[data-today="true"] { border-color: var(--pm-accent); box-shadow: inset 0 0 0 1px var(--pm-accent); }

.pmplan-day-head { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--pm-fg-muted); }
.pmplan-day-num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--pm-fg-soft); }

.pmplan-day-item {
  font-size: 11px;
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--pm-bg-sunken);
  border-left: 3px solid var(--pm-border-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
  width: 100%;
}

.pmplan-day-item[data-tone="danger"] { border-left-color: var(--pm-danger); }
.pmplan-day-item[data-tone="warn"] { border-left-color: var(--pm-warn); }
.pmplan-day-item[data-tone="info"] { border-left-color: var(--pm-info); }
.pmplan-day-item[data-tone="ok"] { border-left-color: var(--pm-ok); }

/* ---------- 时间线 ---------- */

.pmplan-timeline { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-x: auto; }

.pmplan-timeline-row {
  display: grid;
  grid-template-columns: minmax(140px, 200px) 1fr;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.pmplan-timeline-label { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pmplan-timeline-track {
  position: relative;
  height: 20px;
  background: var(--pm-bg-sunken);
  border-radius: 4px;
  min-width: 240px;
  overflow: hidden;
}

.pmplan-timeline-bar {
  position: absolute;
  top: 4px;
  height: 12px;
  border-radius: 999px;
  background: var(--pm-accent);
  border: none;
  padding: 0;
  cursor: pointer;
  min-width: 3px;
}

.pmplan-timeline-bar[data-tone="danger"] { background: var(--pm-danger); }
.pmplan-timeline-bar[data-tone="warn"] { background: var(--pm-warn); }
.pmplan-timeline-bar[data-tone="info"] { background: var(--pm-info); }
.pmplan-timeline-bar[data-tone="ok"] { background: var(--pm-ok); }
.pmplan-timeline-bar[data-tone="muted"] { background: var(--pm-border-strong); }

.pmplan-timeline-today {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--pm-accent);
  opacity: 0.7;
}

.pmplan-timeline-scale {
  display: grid;
  grid-template-columns: minmax(140px, 200px) 1fr;
  gap: 8px;
  font-size: 11px;
  color: var(--pm-fg-muted);
}

.pmplan-timeline-ticks { display: flex; justify-content: space-between; min-width: 240px; }

/* ---------- 抽屉 / 弹窗 ---------- */

.pmplan-scrim {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.28);
  display: flex;
  justify-content: flex-end;
  z-index: 20;
}

.pmplan-scrim[data-center="true"] { justify-content: center; align-items: center; }

.pmplan-drawer {
  width: min(520px, 100%);
  max-width: 100%;
  background: var(--pm-bg);
  border-left: 1px solid var(--pm-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow: var(--pm-shadow);
}

.pmplan-drawer-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--pm-border);
}

.pmplan-drawer-title { font-weight: 700; font-size: 14px; overflow-wrap: anywhere; }
.pmplan-drawer-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.pmplan-drawer-foot { border-top: 1px solid var(--pm-border); padding: 8px 12px; display: flex; gap: 6px; flex-wrap: wrap; }

.pmplan-modal {
  width: min(620px, 100%);
  max-height: 100%;
  background: var(--pm-bg);
  border-radius: var(--pm-radius);
  border: 1px solid var(--pm-border);
  box-shadow: var(--pm-shadow);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.pmplan-modal-body { padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; min-height: 0; }

.pmplan-kv { display: grid; grid-template-columns: minmax(72px, auto) 1fr; gap: 4px 10px; font-size: 12.5px; }
.pmplan-kv dt { color: var(--pm-fg-muted); }
.pmplan-kv dd { margin: 0; overflow-wrap: anywhere; }

.pmplan-log { display: flex; flex-direction: column; gap: 6px; }
.pmplan-log-item { border-left: 3px solid var(--pm-border-strong); padding: 2px 0 2px 8px; }
.pmplan-log-item[data-kind="阻塞"] { border-left-color: var(--pm-danger); }
.pmplan-log-item[data-kind="进展"] { border-left-color: var(--pm-info); }
.pmplan-log-item[data-kind="决策"] { border-left-color: var(--pm-warn); }
.pmplan-log-item[data-kind="变更"] { border-left-color: var(--pm-warn); }
.pmplan-log-item[data-kind="上线"] { border-left-color: var(--pm-ok); }

.pmplan-report {
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--pm-bg-soft);
  border: 1px solid var(--pm-border);
  border-radius: var(--pm-radius-s);
  padding: 10px;
  max-height: 420px;
  overflow: auto;
  margin: 0;
  min-height: 120px;
}

.pmplan-toast {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  background: var(--pm-fg);
  color: var(--pm-bg);
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  z-index: 40;
  max-width: 80%;
  box-shadow: var(--pm-shadow);
}

.pmplan-banner {
  border: 1px solid color-mix(in srgb, var(--pm-warn) 45%, transparent);
  background: color-mix(in srgb, var(--pm-warn) 10%, transparent);
  color: var(--pm-fg);
  border-radius: var(--pm-radius-s);
  padding: 8px 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.pmplan-banner[data-tone="danger"] {
  border-color: color-mix(in srgb, var(--pm-danger) 45%, transparent);
  background: color-mix(in srgb, var(--pm-danger) 10%, transparent);
}

.pmplan-empty {
  border: 1px dashed var(--pm-border-strong);
  border-radius: var(--pm-radius);
  padding: 18px;
  text-align: center;
  color: var(--pm-fg-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

/* ---------- 会话抽屉 ---------- */

.pmplan-chat {
  width: min(420px, 46%);
  min-width: 300px;
  border-left: 1px solid var(--pm-border);
  background: var(--pm-bg);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.pmplan-chat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--pm-border);
}

.pmplan-chat-body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; }

/* ---------- 窄容器适配（按业务容器宽度，不是视口） ---------- */

@container pmplan (max-width: 1080px) {
  .pmplan-side { width: 186px; flex-basis: 186px; }
  .pmplan-timeline-row,
  .pmplan-timeline-scale { grid-template-columns: minmax(110px, 150px) 1fr; }
  .pmplan-calendar-grid { grid-template-columns: repeat(7, minmax(72px, 1fr)); }
}

@container pmplan (max-width: 900px) {
  .pmplan-body { flex-direction: column; }
  .pmplan-side {
    width: auto;
    flex: 0 0 auto;
    border-right: none;
    border-bottom: 1px solid var(--pm-border);
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px;
    max-height: 34%;
  }
  .pmplan-side-group { flex-direction: row; flex-wrap: wrap; align-items: center; }
  .pmplan-side-title { padding: 0 4px; }
  .pmplan-side-foot { margin: 0; border-top: none; padding: 0; }
  .pmplan-side-item { width: auto; padding: 4px 8px; }
  .pmplan-calendar-grid { grid-template-columns: repeat(7, minmax(58px, 1fr)); }
  .pmplan-day { min-height: 62px; }
  .pmplan-chat { width: 100%; min-width: 0; }
  .pmplan-scrim { flex-direction: column; }
  .pmplan-drawer { width: 100%; border-left: none; border-top: 1px solid var(--pm-border); }
}

@container pmplan (max-width: 620px) {
  .pmplan-kpis { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
  .pmplan-content { padding: 8px; }
  .pmplan-calendar-grid { grid-template-columns: repeat(7, minmax(44px, 1fr)); }
  .pmplan-day { min-height: 54px; padding: 3px; }
  .pmplan-day-item { font-size: 10px; }
  .pmplan-search { max-width: 100%; }
}
`

export default styles
