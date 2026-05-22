/**
 * Native Aether Kanban board — Hermes kanban_db backend, Aether HUD styling.
 */
(function (global) {
  'use strict';

  const COLUMN_META = {
    triage: { label: 'Triage', hint: 'Raw ideas — specify or decompose to fan out' },
    todo: { label: 'Todo', hint: 'Waiting on dependencies or unassigned' },
    scheduled: { label: 'Scheduled', hint: 'Time-delayed follow-ups' },
    ready: { label: 'Ready', hint: 'Dependencies satisfied — assign to dispatch' },
    running: { label: 'In Progress', hint: 'Claimed by a worker' },
    blocked: { label: 'Blocked', hint: 'Needs human input' },
    review: { label: 'Review', hint: 'Awaiting review' },
    done: { label: 'Done', hint: 'Completed' },
    archived: { label: 'Archived', hint: 'Hidden from default view' },
  };

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const sec = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    return `${Math.floor(sec / 86400)}d`;
  }

  class AetherKanbanBoard {
    constructor(ai, options = {}) {
      this.ai = ai;
      this.root = options.root;
      this.drawerRoot = options.drawerRoot;
      this.onStatus = options.onStatus || (() => {});
      this.onReady = options.onReady || (() => {});
      this.board = options.board || localStorage.getItem('aether_kanban_board') || '';
      this.filters = {
        search: '',
        tenant: '',
        assignee: '',
        includeArchived: false,
        lanesByProfile: true,
      };
      this.selection = new Set();
      this.boardData = null;
      this.config = null;
      this.orchestration = null;
      this.boardsMeta = null;
      this.openTaskId = null;
      this.eventCursor = 0;
      this.unsubscribeEvents = null;
      this.refreshTimer = null;
      this._mounted = false;
    }

    mount() {
      if (!this.root || this._mounted) return;
      this._mounted = true;
      this.root.innerHTML = '';
      this.root.classList.add('aether-kanban');
      this.renderShell();
      this.loadAll();
      this.unsubscribeEvents = this.ai.subscribeNativeKanbanEvents(
        this.board,
        this.eventCursor,
        (payload) => {
          if (payload.cursor) this.eventCursor = payload.cursor;
          this.scheduleRefresh();
          if (this.openTaskId && payload.events?.some((e) => e.task_id === this.openTaskId)) {
            this.openDrawer(this.openTaskId);
          }
        },
        () => {},
      );
    }

    unmount() {
      this._mounted = false;
      if (this.unsubscribeEvents) this.unsubscribeEvents();
      this.unsubscribeEvents = null;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      if (this.root) this.root.innerHTML = '';
      if (this.drawerRoot) this.drawerRoot.innerHTML = '';
      this.openTaskId = null;
    }

    scheduleRefresh() {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.loadBoard(), 300);
    }

    async loadAll() {
      try {
        this.onStatus('');
        const data = await this.ai.getNativeKanbanBootstrap(this.board, {
          tenant: this.filters.tenant || undefined,
          include_archived: this.filters.includeArchived ? 'true' : undefined,
        });
        this.config = data.config || {};
        this.orchestration = data.orchestration || {};
        if (this.config?.default_tenant) this.filters.tenant = this.config.default_tenant;
        if (this.config?.include_archived_by_default) this.filters.includeArchived = true;
        if (this.config?.lane_by_profile !== undefined) this.filters.lanesByProfile = !!this.config.lane_by_profile;
        this.boardsMeta = {
          boards: data.boards || [],
          current: data.current || this.board || 'default',
        };
        if (data.board?.latest_event_id) {
          this.eventCursor = Math.max(this.eventCursor, data.board.latest_event_id);
        } else if (this.boardData?.latest_event_id) {
          this.eventCursor = Math.max(this.eventCursor, this.boardData.latest_event_id);
        }
        this.boardData = data.board || null;
        this.board = this.boardsMeta.current || this.board;
        localStorage.setItem('aether_kanban_board', this.board);
        this.renderToolbar();
        this.renderBoard();
        this.onReady();
      } catch (e) {
        this.onStatus(e.message || 'Failed to load Kanban', true);
        this.onReady();
      }
    }

    async loadBoard() {
      const data = await this.ai.getNativeKanbanBoard(this.board, {
        tenant: this.filters.tenant || undefined,
        include_archived: this.filters.includeArchived ? 'true' : undefined,
      });
      this.boardData = data;
      if (data.latest_event_id) this.eventCursor = Math.max(this.eventCursor, data.latest_event_id);
      this.renderBoard();
    }

    renderShell() {
      this.root.innerHTML = `
        <div class="ak-toolbar" id="akToolbar"></div>
        <div class="ak-bulk-bar" id="akBulkBar" hidden></div>
        <div class="ak-columns-wrap"><div class="ak-columns" id="akColumns"></div></div>
      `;
      this.toolbarEl = this.root.querySelector('#akToolbar');
      this.bulkEl = this.root.querySelector('#akBulkBar');
      this.columnsEl = this.root.querySelector('#akColumns');
      this.renderToolbar();
    }

    renderToolbar() {
      const orch = this.orchestration || {};
      const autoOn = orch.auto_decompose !== false;
      this.toolbarEl.innerHTML = `
        <div class="ak-toolbar-row">
          <select class="ak-select" id="akBoardSelect" aria-label="Board"></select>
          <button type="button" class="ak-btn ak-btn-ghost" id="akNewBoardBtn">+ New board</button>
          <button type="button" class="ak-btn ${autoOn ? 'ak-btn-accent' : 'ak-btn-ghost'}" id="akOrchToggle">
            Orchestration: ${autoOn ? 'Auto' : 'Manual'}
          </button>
          <button type="button" class="ak-btn ak-btn-ghost" id="akOrchSettingsBtn">Orchestration settings</button>
        </div>
        <div class="ak-toolbar-row">
          <input class="ak-input" id="akSearch" placeholder="Filter cards…" value="${esc(this.filters.search)}" />
          <select class="ak-select" id="akTenant"><option value="">All tenants</option></select>
          <select class="ak-select" id="akAssignee"><option value="">All assignees</option></select>
          <label class="ak-check"><input type="checkbox" id="akArchived" ${this.filters.includeArchived ? 'checked' : ''}/> Show archived</label>
          <label class="ak-check"><input type="checkbox" id="akLanes" ${this.filters.lanesByProfile ? 'checked' : ''}/> Lanes by profile</label>
          <button type="button" class="ak-btn" id="akDispatchBtn">Nudge dispatcher</button>
          <button type="button" class="ak-btn ak-btn-ghost" id="akRefreshBtn">Refresh</button>
          <button type="button" class="ak-btn ak-btn-ghost" id="akClearBtn">Clear filters</button>
        </div>
      `;

      this.toolbarEl.querySelector('#akSearch').addEventListener('input', (e) => {
        this.filters.search = e.target.value;
        this.renderBoard();
      });
      this.toolbarEl.querySelector('#akTenant').addEventListener('change', (e) => {
        this.filters.tenant = e.target.value;
        this.loadBoard();
      });
      this.toolbarEl.querySelector('#akAssignee').addEventListener('change', (e) => {
        this.filters.assignee = e.target.value;
        this.renderBoard();
      });
      this.toolbarEl.querySelector('#akArchived').addEventListener('change', (e) => {
        this.filters.includeArchived = e.target.checked;
        this.loadBoard();
      });
      this.toolbarEl.querySelector('#akLanes').addEventListener('change', (e) => {
        this.filters.lanesByProfile = e.target.checked;
        this.renderBoard();
      });
      this.toolbarEl.querySelector('#akRefreshBtn').addEventListener('click', () => this.loadBoard());
      this.toolbarEl.querySelector('#akClearBtn').addEventListener('click', () => {
        this.filters.search = '';
        this.filters.tenant = '';
        this.filters.assignee = '';
        this.loadBoard();
      });
      this.toolbarEl.querySelector('#akDispatchBtn').addEventListener('click', async () => {
        await this.ai.dispatchNativeKanban(this.board, { max: 8 });
        this.loadBoard();
      });
      this.toolbarEl.querySelector('#akOrchToggle').addEventListener('click', async () => {
        const next = !(this.orchestration?.auto_decompose !== false);
        this.orchestration = await this.ai.setNativeKanbanOrchestration({ auto_decompose: !next });
        this.renderToolbar();
      });
      this.toolbarEl.querySelector('#akNewBoardBtn').addEventListener('click', () => this.promptNewBoard());
      this.toolbarEl.querySelector('#akOrchSettingsBtn').addEventListener('click', () => this.openOrchestrationPanel());
      this.populateBoardSelect();
    }

    async refreshBoardList() {
      const data = await this.ai.listNativeKanbanBoards();
      this.boardsMeta = {
        boards: data.boards || [],
        current: data.current || this.board || 'default',
      };
      this.populateBoardSelect();
    }

    populateBoardSelect() {
      const sel = this.toolbarEl?.querySelector('#akBoardSelect');
      if (!sel) return;
      const meta = this.boardsMeta || { boards: [], current: this.board || 'default' };
      const boards = meta.boards || [];
      const current = meta.current || this.board || 'default';
      this.board = current;
      localStorage.setItem('aether_kanban_board', current);
      sel.innerHTML = boards.map((b) =>
        `<option value="${esc(b.slug)}" ${b.slug === current ? 'selected' : ''}>${esc(b.name || b.slug)}</option>`,
      ).join('');
      if (!sel.dataset.bound) {
        sel.dataset.bound = '1';
        sel.onchange = async () => {
          this.board = sel.value;
          localStorage.setItem('aether_kanban_board', this.board);
          await this.ai.switchNativeKanbanBoard(this.board);
          this.eventCursor = 0;
          this.loadAll();
        };
      }

      this.updateFilterSelects();
    }

    updateFilterSelects() {
      const tenantSel = this.toolbarEl?.querySelector('#akTenant');
      const assigneeSel = this.toolbarEl?.querySelector('#akAssignee');
      if (!tenantSel || !assigneeSel) return;
      const tenants = this.boardData?.tenants || [];
      tenantSel.innerHTML = '<option value="">All tenants</option>' +
        tenants.map((t) => `<option value="${esc(t)}" ${t === this.filters.tenant ? 'selected' : ''}>${esc(t)}</option>`).join('');

      const assignees = this.boardData?.assignees || [];
      assigneeSel.innerHTML = '<option value="">All assignees</option>' +
        assignees.map((a) => `<option value="${esc(a)}" ${a === this.filters.assignee ? 'selected' : ''}>${esc(a)}</option>`).join('');
    }

    async promptNewBoard() {
      const slug = window.prompt('Board slug (lowercase):');
      if (!slug) return;
      const name = window.prompt('Display name:', slug) || slug;
      await this.ai.createNativeKanbanBoard({ slug, name, switch: true });
      await this.refreshBoardList();
      this.loadBoard();
    }

    filterTasks(tasks) {
      let list = tasks || [];
      const q = this.filters.search.trim().toLowerCase();
      if (q) {
        list = list.filter((t) =>
          (t.title || '').toLowerCase().includes(q) ||
          (t.id || '').toLowerCase().includes(q) ||
          (t.assignee || '').toLowerCase().includes(q),
        );
      }
      if (this.filters.assignee) {
        list = list.filter((t) => t.assignee === this.filters.assignee);
      }
      return list;
    }

    renderBoard() {
      if (!this.columnsEl || !this.boardData) return;
      this.updateFilterSelects();
      const cols = this.boardData.columns || [];
      this.columnsEl.innerHTML = cols.map((col) => this.renderColumn(col)).join('');
      this.bindDragDrop();
      this.renderBulkBar();
    }

    renderColumn(col) {
      const meta = COLUMN_META[col.name] || { label: col.name, hint: '' };
      const tasks = this.filterTasks(col.tasks);
      const grouped = this.filters.lanesByProfile && col.name === 'running'
        ? this.groupByAssignee(tasks)
        : [{ label: null, tasks }];

      return `
        <section class="ak-column" data-status="${esc(col.name)}">
          <header class="ak-column-header">
            <div>
              <span class="ak-column-title">${esc(meta.label)}</span>
              <span class="ak-column-count">${tasks.length}</span>
            </div>
            <button type="button" class="ak-column-add" data-add-status="${esc(col.name)}" title="Add task">+</button>
          </header>
          <p class="ak-column-hint">${esc(meta.hint)}</p>
          ${grouped.map((g) => `
            ${g.label ? `<div class="ak-lane-label">${esc(g.label)}</div>` : ''}
            <div class="ak-column-cards" data-drop-status="${esc(col.name)}">
              ${g.tasks.length ? g.tasks.map((t) => this.renderCard(t)).join('') : '<div class="ak-empty">— no tasks —</div>'}
            </div>
          `).join('')}
        </section>
      `;
    }

    groupByAssignee(tasks) {
      const map = new Map();
      for (const t of tasks) {
        const key = t.assignee || '(unassigned)';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(t);
      }
      return [...map.entries()].map(([label, list]) => ({ label, tasks: list }));
    }

    renderCard(task) {
      const selected = this.selection.has(task.id);
      const progress = task.progress ? `${task.progress.done}/${task.progress.total}` : '';
      return `
        <article class="ak-card ${selected ? 'ak-card-selected' : ''}" draggable="true" data-task-id="${esc(task.id)}">
          <div class="ak-card-top">
            <input type="checkbox" class="ak-card-check" data-select-id="${esc(task.id)}" ${selected ? 'checked' : ''} />
            <span class="ak-card-id">${esc(task.id)}</span>
            ${task.priority ? `<span class="ak-chip">P${esc(task.priority)}</span>` : ''}
          </div>
          <h4 class="ak-card-title">${esc(task.title)}</h4>
          <div class="ak-card-meta">
            ${task.assignee ? `<span class="ak-chip">${esc(task.assignee)}</span>` : ''}
            ${task.tenant ? `<span class="ak-chip ak-chip-muted">${esc(task.tenant)}</span>` : ''}
            ${progress ? `<span class="ak-chip">${esc(progress)}</span>` : ''}
            ${task.comment_count ? `<span class="ak-chip">💬 ${task.comment_count}</span>` : ''}
          </div>
          <div class="ak-card-age">${timeAgo(task.created_at)} ago</div>
        </article>
      `;
    }

    bindDragDrop() {
      this.columnsEl.querySelectorAll('.ak-card').forEach((el) => {
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/task-id', el.dataset.taskId);
          el.classList.add('ak-dragging');
        });
        el.addEventListener('dragend', () => el.classList.remove('ak-dragging'));
        el.addEventListener('click', (e) => {
          if (e.target.matches('.ak-card-check')) {
            e.stopPropagation();
            this.toggleSelect(el.dataset.taskId, e.target.checked);
            return;
          }
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) this.openDrawer(el.dataset.taskId);
        });
      });

      this.columnsEl.querySelectorAll('[data-drop-status]').forEach((zone) => {
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('ak-drop-target'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('ak-drop-target'));
        zone.addEventListener('drop', async (e) => {
          e.preventDefault();
          zone.classList.remove('ak-drop-target');
          const taskId = e.dataTransfer.getData('text/task-id');
          const status = zone.dataset.dropStatus;
          if (!taskId || !status) return;
          await this.moveTask(taskId, status);
        });
      });

      this.columnsEl.querySelectorAll('[data-add-status]').forEach((btn) => {
        btn.addEventListener('click', () => this.inlineCreate(btn.dataset.addStatus));
      });
    }

    toggleSelect(id, on) {
      if (on) this.selection.add(id);
      else this.selection.delete(id);
      this.renderBulkBar();
      this.renderBoard();
    }

    renderBulkBar() {
      if (!this.bulkEl) return;
      if (!this.selection.size) {
        this.bulkEl.hidden = true;
        return;
      }
      this.bulkEl.hidden = false;
      this.bulkEl.innerHTML = `
        <span>${this.selection.size} selected</span>
        <button type="button" class="ak-btn ak-btn-ghost" data-bulk="ready">→ Ready</button>
        <button type="button" class="ak-btn ak-btn-ghost" data-bulk="done">Complete</button>
        <button type="button" class="ak-btn ak-btn-ghost" data-bulk="archived">Archive</button>
        <button type="button" class="ak-btn ak-btn-ghost" id="akClearSelection">Clear</button>
      `;
      this.bulkEl.querySelectorAll('[data-bulk]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const status = btn.dataset.bulk;
          if (status === 'archived') {
            await this.ai.bulkNativeKanbanTasks(this.board, { ids: [...this.selection], archive: true });
          } else {
            await this.ai.bulkNativeKanbanTasks(this.board, { ids: [...this.selection], status });
          }
          this.selection.clear();
          this.loadBoard();
        });
      });
      this.bulkEl.querySelector('#akClearSelection')?.addEventListener('click', () => {
        this.selection.clear();
        this.renderBulkBar();
        this.renderBoard();
      });
    }

    async moveTask(taskId, status) {
      const destructive = ['done', 'blocked', 'archived'].includes(status);
      if (destructive && !window.confirm(`Move ${taskId} to ${status}?`)) return;
      try {
        const body = { status };
        if (status === 'blocked') body.block_reason = window.prompt('Block reason:') || 'Blocked from board';
        await this.ai.patchNativeKanbanTask(this.board, taskId, body);
        this.loadBoard();
      } catch (e) {
        this.onStatus(e.message, true);
      }
    }

    async inlineCreate(status) {
      const title = window.prompt('Task title:');
      if (!title) return;
      const assignee = window.prompt('Assignee profile (optional):') || undefined;
      await this.ai.createNativeKanbanTask(this.board, {
        title,
        assignee: assignee || null,
        triage: status === 'triage',
      });
      this.loadBoard();
    }

    async openDrawer(taskId) {
      this.openTaskId = taskId;
      const data = await this.ai.getNativeKanbanTask(this.board, taskId);
      const task = data.task || {};
      const comments = data.comments || [];
      const events = (data.events || []).slice(-20);
      const links = data.links || { parents: [], children: [] };

      if (!this.drawerRoot) return;
      this.drawerRoot.hidden = false;
      this.drawerRoot.innerHTML = `
        <div class="ak-drawer">
          <header class="ak-drawer-header">
            <h3>${esc(task.id)}</h3>
            <button type="button" class="ak-drawer-close" id="akDrawerClose">×</button>
          </header>
          <div class="ak-drawer-body">
            <label class="ak-field">Title<input class="ak-input" id="akDrawerTitle" value="${esc(task.title || '')}" /></label>
            <label class="ak-field">Assignee<input class="ak-input" id="akDrawerAssignee" value="${esc(task.assignee || '')}" placeholder="profile or empty" /></label>
            <label class="ak-field">Priority<input class="ak-input" id="akDrawerPriority" type="number" value="${esc(task.priority || 0)}" /></label>
            <label class="ak-field">Body<textarea class="ak-textarea" id="akDrawerBody" rows="6">${esc(task.body || '')}</textarea></label>
            <div class="ak-drawer-actions">
              ${task.status === 'triage' ? `
                <button type="button" class="ak-btn" id="akDecomposeBtn">⚗ Decompose</button>
                <button type="button" class="ak-btn ak-btn-ghost" id="akSpecifyBtn">✨ Specify</button>
              ` : ''}
              <button type="button" class="ak-btn ak-btn-ghost" data-status="ready">→ Ready</button>
              <button type="button" class="ak-btn ak-btn-ghost" data-status="blocked">Block</button>
              <button type="button" class="ak-btn" data-status="done">Complete</button>
              <button type="button" class="ak-btn ak-btn-ghost" data-status="archived">Archive</button>
            </div>
            <section class="ak-drawer-section">
              <h4>Comments</h4>
              <div class="ak-comments">${comments.map((c) => `<div class="ak-comment"><strong>${esc(c.author)}</strong> ${esc(c.body)}</div>`).join('') || '<div class="ak-empty">No comments</div>'}</div>
              <div class="ak-comment-compose">
                <input class="ak-input" id="akCommentInput" placeholder="Add comment…" />
                <button type="button" class="ak-btn" id="akCommentBtn">Send</button>
              </div>
            </section>
            <section class="ak-drawer-section">
              <h4>Links</h4>
              <p>Parents: ${(links.parents || []).map(esc).join(', ') || '—'}</p>
              <p>Children: ${(links.children || []).map(esc).join(', ') || '—'}</p>
            </section>
            <section class="ak-drawer-section">
              <h4>Recent events</h4>
              <div class="ak-events">${events.map((ev) => `<div class="ak-event"><code>${esc(ev.kind)}</code> ${timeAgo(ev.created_at)} ago</div>`).join('')}</div>
            </section>
          </div>
          <footer class="ak-drawer-footer">
            <button type="button" class="ak-btn" id="akSaveTaskBtn">Save changes</button>
          </footer>
        </div>
      `;

      this.drawerRoot.querySelector('#akDrawerClose').addEventListener('click', () => this.closeDrawer());
      this.drawerRoot.querySelector('#akSaveTaskBtn').addEventListener('click', async () => {
        await this.ai.patchNativeKanbanTask(this.board, taskId, {
          title: this.drawerRoot.querySelector('#akDrawerTitle').value,
          assignee: this.drawerRoot.querySelector('#akDrawerAssignee').value || null,
          priority: Number(this.drawerRoot.querySelector('#akDrawerPriority').value) || 0,
          body: this.drawerRoot.querySelector('#akDrawerBody').value,
        });
        this.loadBoard();
        this.openDrawer(taskId);
      });
      this.drawerRoot.querySelector('#akCommentBtn').addEventListener('click', async () => {
        const body = this.drawerRoot.querySelector('#akCommentInput').value.trim();
        if (!body) return;
        await this.ai.addNativeKanbanComment(this.board, taskId, { body, author: 'aether' });
        this.openDrawer(taskId);
      });
      this.drawerRoot.querySelector('#akDecomposeBtn')?.addEventListener('click', async () => {
        const res = await this.ai.decomposeNativeKanbanTask(this.board, taskId);
        this.onStatus(res.ok ? `Decomposed: ${res.fanout || 0} tasks` : (res.reason || 'Decompose failed'), !res.ok);
        this.loadBoard();
      });
      this.drawerRoot.querySelector('#akSpecifyBtn')?.addEventListener('click', async () => {
        const res = await this.ai.specifyNativeKanbanTask(this.board, taskId);
        this.onStatus(res.ok ? 'Task specified' : (res.reason || 'Specify failed'), !res.ok);
        this.loadBoard();
      });
      this.drawerRoot.querySelectorAll('[data-status]').forEach((btn) => {
        btn.addEventListener('click', () => this.moveTask(taskId, btn.dataset.status));
      });
    }

    closeDrawer() {
      this.openTaskId = null;
      if (this.drawerRoot) {
        this.drawerRoot.hidden = true;
        this.drawerRoot.innerHTML = '';
      }
    }

    openOrchestrationPanel() {
      const o = this.orchestration || {};
      const orch = window.prompt('Orchestrator profile:', o.orchestrator_profile || o.resolved_orchestrator_profile || '');
      if (orch === null) return;
      const def = window.prompt('Default assignee:', o.default_assignee || o.resolved_default_assignee || '');
      if (def === null) return;
      this.ai.setNativeKanbanOrchestration({
        orchestrator_profile: orch,
        default_assignee: def,
      }).then((res) => {
        this.orchestration = res;
        this.renderToolbar();
      });
    }
  }

  global.AetherKanbanBoard = AetherKanbanBoard;
})(window);
