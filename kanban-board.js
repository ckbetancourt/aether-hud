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

  const STALENESS = {
    ready: { amber: 3600, red: 86400 },
    running: { amber: 600, red: 3600 },
    blocked: { amber: 3600, red: 86400 },
    todo: { amber: 604800, red: 2592000 },
  };

  const DIAGNOSTIC_EVENT_LABELS = {
    completion_blocked_hallucination: 'Completion blocked — phantom card ids',
    suspected_hallucinated_references: 'Prose referenced phantom card ids',
  };

  function cardStalenessClass(task) {
    if (!task?.age) return '';
    const age = task.status === 'running'
      ? task.age.started_age_seconds
      : task.age.created_age_seconds;
    const tier = STALENESS[task.status];
    if (!tier || age == null) return '';
    if (age >= tier.red) return 'ak-card-stale-red';
    if (age >= tier.amber) return 'ak-card-stale-amber';
    return '';
  }

  function withCompletionSummary(patch, count) {
    if (!patch || patch.status !== 'done') return patch;
    const label = count && count > 1 ? `${count} selected tasks` : 'this task';
    const value = window.prompt(
      `Completion summary for ${label}. This is stored as the task result.`,
      '',
    );
    if (value === null) return null;
    const summary = value.trim();
    if (!summary) {
      window.alert('Completion summary is required before marking a task done.');
      return null;
    }
    return { ...patch, result: summary, summary };
  }

  function isDiagnosticEvent(kind) {
    return Object.prototype.hasOwnProperty.call(DIAGNOSTIC_EVENT_LABELS, kind);
  }

  function phantomIdsFromEvent(ev) {
    if (!ev?.payload) return [];
    return ev.payload.phantom_cards || ev.payload.phantom_refs || [];
  }

  function taskSearchHaystack(task) {
    return [
      task.id,
      task.title,
      task.body,
      task.result,
      task.latest_summary,
      task.assignee,
      task.tenant,
    ].filter(Boolean).join(' ').toLowerCase();
  }

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
      this.inlineCreateStatus = null;
      this.inlineCreateDraft = null;
      this.pendingRefresh = false;
      this.drawerUi = this.createDrawerUiState();
    }

    createDrawerUiState() {
      return {
        editingTitle: false,
        editingBody: false,
        editingAssignee: false,
        editingPriority: false,
        commentDraft: '',
        titleDraft: '',
        bodyDraft: '',
        assigneeDraft: '',
        priorityDraft: '',
      };
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
      if (this.inlineCreateStatus) {
        this.pendingRefresh = true;
        return;
      }
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.loadBoard(), 300);
    }

    flushPendingRefresh() {
      if (!this.pendingRefresh || this.inlineCreateStatus) return;
      this.pendingRefresh = false;
      this.scheduleRefresh();
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
        <div class="ak-attention" id="akAttention" hidden></div>
        <div class="ak-columns-wrap"><div class="ak-columns" id="akColumns"></div></div>
      `;
      this.toolbarEl = this.root.querySelector('#akToolbar');
      this.bulkEl = this.root.querySelector('#akBulkBar');
      this.attentionEl = this.root.querySelector('#akAttention');
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
        list = list.filter((t) => taskSearchHaystack(t).includes(q));
      }
      if (this.filters.assignee) {
        list = list.filter((t) => t.assignee === this.filters.assignee);
      }
      return list;
    }

    collectAttentionTasks() {
      const out = [];
      const seen = new Set();
      for (const col of this.boardData?.columns || []) {
        for (const task of col.tasks || []) {
          if (!task?.id || seen.has(task.id)) continue;
          if (task.warnings?.count > 0 || (task.diagnostics && task.diagnostics.length)) {
            seen.add(task.id);
            out.push(task);
          }
        }
      }
      return out.sort((a, b) => {
        const sev = { critical: 3, error: 2, warning: 1 };
        const aSev = sev[a.warnings?.highest_severity] || 1;
        const bSev = sev[b.warnings?.highest_severity] || 1;
        if (bSev !== aSev) return bSev - aSev;
        return (b.warnings?.latest_at || 0) - (a.warnings?.latest_at || 0);
      });
    }

    renderAttentionStrip() {
      if (!this.attentionEl) return;
      const tasks = this.collectAttentionTasks();
      if (!tasks.length) {
        this.attentionEl.hidden = true;
        this.attentionEl.innerHTML = '';
        return;
      }
      this.attentionEl.hidden = false;
      this.attentionEl.innerHTML = `
        <div class="ak-attention-head">Needs attention (${tasks.length})</div>
        <div class="ak-attention-list">
          ${tasks.map((task) => {
            const sev = task.warnings?.highest_severity || 'warning';
            const kinds = task.warnings?.kinds ? Object.keys(task.warnings.kinds).join(', ') : 'diagnostic';
            return `
              <button type="button" class="ak-attention-item ak-attention-${esc(sev)}" data-attention-task="${esc(task.id)}">
                <span class="ak-attention-id">${esc(task.id)}</span>
                <span class="ak-attention-title">${esc(String(task.title || '').slice(0, 60))}</span>
                <span class="ak-attention-kind">${esc(kinds)}</span>
              </button>
            `;
          }).join('')}
        </div>
      `;
      this.attentionEl.querySelectorAll('[data-attention-task]').forEach((btn) => {
        btn.addEventListener('click', () => this.openDrawer(btn.dataset.attentionTask));
      });
    }

    renderBoard() {
      if (!this.columnsEl || !this.boardData) return;
      if (this.inlineCreateStatus) {
        const form = this.columnsEl.querySelector(`[data-inline-create="${this.inlineCreateStatus}"]`);
        if (form) this.syncInlineCreateDraft(form);
      }
      this.updateFilterSelects();
      const cols = this.boardData.columns || [];
      this.columnsEl.innerHTML = cols.map((col) => this.renderColumn(col)).join('');
      this.bindDragDrop();
      this.bindInlineCreate();
      this.renderAttentionStrip();
      this.renderBulkBar();
      this.restoreInlineCreateFocus();
    }

    renderColumn(col) {
      const meta = COLUMN_META[col.name] || { label: col.name, hint: '' };
      const tasks = this.filterTasks(col.tasks);
      const grouped = this.filters.lanesByProfile && col.name === 'running'
        ? this.groupByAssignee(tasks)
        : [{ label: null, tasks }];

      const creating = this.inlineCreateStatus === col.name;

      return `
        <section class="ak-column" data-status="${esc(col.name)}">
          <header class="ak-column-header">
            <div>
              <span class="ak-column-title">${esc(meta.label)}</span>
              <span class="ak-column-count">${tasks.length}</span>
            </div>
            <button type="button" class="ak-column-add ${creating ? 'is-active' : ''}" data-add-status="${esc(col.name)}" title="${creating ? 'Cancel' : 'Create task in this column'}" aria-label="${creating ? 'Cancel new task' : 'Add task'}">${creating ? '×' : '+'}</button>
          </header>
          <p class="ak-column-hint">${esc(meta.hint)}</p>
          ${creating ? this.renderInlineCreate(col.name) : ''}
          ${grouped.map((g) => `
            ${g.label ? `<div class="ak-lane-label">${esc(g.label)}</div>` : ''}
            <div class="ak-column-cards" data-drop-status="${esc(col.name)}">
              ${g.tasks.length ? g.tasks.map((t) => this.renderCard(t)).join('') : '<div class="ak-empty">— no tasks —</div>'}
            </div>
          `).join('')}
        </section>
      `;
    }

    collectAllTasks() {
      const out = [];
      const seen = new Set();
      for (const col of this.boardData?.columns || []) {
        for (const task of col.tasks || []) {
          if (!task?.id || seen.has(task.id)) continue;
          seen.add(task.id);
          out.push(task);
        }
      }
      return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }

    syncInlineCreateDraft(formRoot) {
      if (!formRoot) return;
      const status = formRoot.dataset.inlineCreate;
      if (!status) return;
      const focusEl = formRoot.querySelector(':focus');
      let focusSelector = this.inlineCreateDraft?.focusSelector || '.ak-inline-title';
      if (focusEl) {
        for (const cls of focusEl.classList) {
          if (cls.startsWith('ak-inline-')) {
            focusSelector = `.${cls}`;
            break;
          }
        }
      }
      this.inlineCreateDraft = {
        status,
        title: formRoot.querySelector('.ak-inline-title')?.value ?? '',
        assignee: formRoot.querySelector('.ak-inline-assignee')?.value ?? '',
        priority: formRoot.querySelector('.ak-inline-priority')?.value ?? '0',
        skills: formRoot.querySelector('.ak-inline-skills')?.value ?? '',
        workspaceKind: formRoot.querySelector('.ak-inline-workspace-kind')?.value ?? 'scratch',
        workspacePath: formRoot.querySelector('.ak-inline-workspace-path')?.value ?? '',
        parent: formRoot.querySelector('.ak-inline-parent')?.value ?? '',
        focusSelector,
      };
    }

    restoreInlineCreateFocus() {
      const draft = this.inlineCreateDraft;
      if (!draft || draft.status !== this.inlineCreateStatus) return;
      requestAnimationFrame(() => {
        const form = this.columnsEl?.querySelector(`[data-inline-create="${draft.status}"]`);
        if (!form) return;
        const el = form.querySelector(draft.focusSelector) || form.querySelector('.ak-inline-title');
        if (!el) return;
        el.focus();
        if (typeof el.setSelectionRange === 'function') {
          const len = el.value?.length ?? 0;
          el.setSelectionRange(len, len);
        }
      });
    }

    renderInlineCreate(columnName) {
      const isTriage = columnName === 'triage';
      const draft = this.inlineCreateDraft?.status === columnName ? this.inlineCreateDraft : null;
      const workspaceKind = draft?.workspaceKind || 'scratch';
      const showWorkspacePath = workspaceKind !== 'scratch';
      const parentOptions = this.collectAllTasks().map((task) =>
        `<option value="${esc(task.id)}"${draft?.parent === task.id ? ' selected' : ''}>${esc(task.id)} — ${esc(String(task.title || '').slice(0, 50))}</option>`,
      ).join('');

      return `
        <div class="ak-inline-create" data-inline-create="${esc(columnName)}">
          <textarea class="ak-textarea ak-inline-title" rows="2" placeholder="${isTriage ? 'Rough idea — AI will spec it…' : 'New task title…'}">${esc(draft?.title || '')}</textarea>
          <div class="ak-inline-row">
            <input class="ak-input ak-inline-assignee" type="text" placeholder="${isTriage ? 'specifier' : 'assignee'}" autocomplete="off" spellcheck="false" value="${esc(draft?.assignee || '')}" />
            <input class="ak-input ak-inline-priority" type="number" value="${esc(draft?.priority ?? '0')}" placeholder="pri" title="Priority — higher values dispatch first" />
          </div>
          <input class="ak-input ak-inline-skills" type="text" placeholder="skills (optional, comma-separated)" title="Extra skills loaded for the worker" value="${esc(draft?.skills || '')}" />
          <div class="ak-inline-row ak-inline-workspace-row">
            <select class="ak-select ak-inline-workspace-kind" title="scratch: temp dir · worktree: git worktree · dir: exact path">
              <option value="scratch"${workspaceKind === 'scratch' ? ' selected' : ''}>scratch</option>
              <option value="worktree"${workspaceKind === 'worktree' ? ' selected' : ''}>worktree</option>
              <option value="dir"${workspaceKind === 'dir' ? ' selected' : ''}>dir</option>
            </select>
            <input class="ak-input ak-inline-workspace-path" type="text" placeholder="workspace path (optional)" value="${esc(draft?.workspacePath || '')}"${showWorkspacePath ? '' : ' hidden'} />
          </div>
          <select class="ak-select ak-inline-parent" title="Child tasks stay blocked until the parent is done">
            <option value=""${!draft?.parent ? ' selected' : ''}>— no parent —</option>
            ${parentOptions}
          </select>
          <div class="ak-inline-actions">
            <button type="button" class="ak-btn" data-inline-submit="${esc(columnName)}">Create</button>
            <button type="button" class="ak-btn ak-btn-ghost" data-inline-cancel>Cancel</button>
          </div>
        </div>
      `;
    }

    buildCreateTaskBody(status, formRoot) {
      const title = formRoot.querySelector('.ak-inline-title')?.value?.trim();
      if (!title) return null;

      const assignee = formRoot.querySelector('.ak-inline-assignee')?.value?.trim() || null;
      const priority = Number(formRoot.querySelector('.ak-inline-priority')?.value) || 0;
      const skillsRaw = formRoot.querySelector('.ak-inline-skills')?.value || '';
      const skillList = skillsRaw.split(',').map((s) => s.trim()).filter(Boolean);
      const workspaceKind = formRoot.querySelector('.ak-inline-workspace-kind')?.value || 'scratch';
      const workspacePath = formRoot.querySelector('.ak-inline-workspace-path')?.value?.trim() || '';
      const parent = formRoot.querySelector('.ak-inline-parent')?.value || '';

      const body = {
        title,
        assignee,
        priority,
        triage: status === 'triage',
      };
      if (parent) body.parents = [parent];
      if (skillList.length) body.skills = skillList;
      if (workspaceKind && workspaceKind !== 'scratch') body.workspace_kind = workspaceKind;
      if (workspacePath) body.workspace_path = workspacePath;
      const tenant = this.filters.tenant || this.config?.default_tenant;
      if (tenant) body.tenant = tenant;
      return body;
    }

    async submitInlineCreate(status) {
      const formRoot = this.columnsEl?.querySelector(`[data-inline-create="${status}"]`);
      if (!formRoot) return;
      const body = this.buildCreateTaskBody(status, formRoot);
      if (!body) return;

      try {
        const res = await this.ai.createNativeKanbanTask(this.board, body);
        this.inlineCreateStatus = null;
        this.inlineCreateDraft = null;
        if (res.warning) {
          this.onStatus(res.warning, false);
        }
        await this.loadBoard();
        this.flushPendingRefresh();
      } catch (e) {
        this.onStatus(e.message || 'Failed to create task', true);
      }
    }

    cancelInlineCreate() {
      this.inlineCreateStatus = null;
      this.inlineCreateDraft = null;
      this.renderBoard();
      this.flushPendingRefresh();
    }

    toggleInlineCreate(status) {
      const prev = this.inlineCreateStatus;
      const closing = prev === status;
      this.inlineCreateStatus = closing ? null : status;
      if (closing || (prev && prev !== status)) {
        this.inlineCreateDraft = null;
      }
      this.renderBoard();
      if (closing) {
        this.flushPendingRefresh();
      } else if (this.inlineCreateStatus) {
        requestAnimationFrame(() => {
          const titleEl = this.columnsEl?.querySelector('.ak-inline-title');
          titleEl?.focus();
        });
      }
    }

    bindInlineCreate() {
      this.columnsEl?.querySelectorAll('[data-add-status]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggleInlineCreate(btn.dataset.addStatus);
        });
      });

      this.columnsEl?.querySelectorAll('.ak-inline-workspace-kind').forEach((sel) => {
        const row = sel.closest('.ak-inline-workspace-row');
        const pathInput = row?.querySelector('.ak-inline-workspace-path');
        const syncPath = () => {
          if (!pathInput) return;
          const kind = sel.value;
          const show = kind !== 'scratch';
          pathInput.hidden = !show;
          pathInput.placeholder = kind === 'dir'
            ? 'workspace path (required, e.g. ~/projects/my-app)'
            : 'workspace path (optional, derived from assignee if blank)';
          if (!show) pathInput.value = '';
        };
        sel.addEventListener('change', syncPath);
        syncPath();
      });

      this.columnsEl?.querySelectorAll('[data-inline-submit]').forEach((btn) => {
        btn.addEventListener('click', () => this.submitInlineCreate(btn.dataset.inlineSubmit));
      });

      this.columnsEl?.querySelectorAll('[data-inline-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => this.cancelInlineCreate());
      });

      this.columnsEl?.querySelectorAll('.ak-inline-create').forEach((form) => {
        form.addEventListener('input', () => this.syncInlineCreateDraft(form));
        form.addEventListener('change', () => this.syncInlineCreateDraft(form));
      });

      this.columnsEl?.querySelectorAll('.ak-inline-title').forEach((el) => {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const status = el.closest('[data-inline-create]')?.dataset.inlineCreate;
            if (status) this.submitInlineCreate(status);
          }
          if (e.key === 'Escape') this.cancelInlineCreate();
        });
      });
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
      const linkTotal = task.link_counts
        ? (task.link_counts.parents || 0) + (task.link_counts.children || 0)
        : 0;
      const needsAssignee = task.status === 'ready' && !task.assignee;
      const warnings = task.warnings;
      const warningBadge = warnings?.count > 0
        ? `<span class="ak-warning-badge ak-warning-${esc(warnings.highest_severity || 'warning')}" title="${esc(warnings.count)} active diagnostic(s)">${
          warnings.highest_severity === 'critical' ? '!!!'
            : warnings.highest_severity === 'error' ? '!!' : '⚠'
        }</span>`
        : '';
      const ageSec = task.status === 'running'
        ? task.age?.started_age_seconds
        : task.age?.created_age_seconds;
      const ageLabel = ageSec != null
        ? timeAgo(Math.floor(Date.now() / 1000 - ageSec))
        : timeAgo(task.created_at);
      return `
        <article class="ak-card ${selected ? 'ak-card-selected' : ''} ${cardStalenessClass(task)}" draggable="true" data-task-id="${esc(task.id)}">
          <div class="ak-card-top">
            <input type="checkbox" class="ak-card-check" data-select-id="${esc(task.id)}" ${selected ? 'checked' : ''} />
            <span class="ak-card-id">${esc(task.id)}</span>
            ${warningBadge}
            ${task.priority ? `<span class="ak-chip">P${esc(task.priority)}</span>` : ''}
          </div>
          <h4 class="ak-card-title">${esc(task.title || '(untitled)')}</h4>
          ${task.latest_summary ? `<p class="ak-card-summary">${esc(String(task.latest_summary).slice(0, 120))}</p>` : ''}
          <div class="ak-card-meta">
            ${task.assignee
              ? `<span class="ak-chip">@${esc(task.assignee)}</span>`
              : `<span class="ak-chip ak-chip-muted">${needsAssignee ? 'Needs assignee' : 'unassigned'}</span>`}
            ${task.tenant ? `<span class="ak-chip ak-chip-muted">${esc(task.tenant)}</span>` : ''}
            ${progress ? `<span class="ak-chip">${esc(progress)}</span>` : ''}
            ${linkTotal ? `<span class="ak-chip" title="Dependencies">↔ ${linkTotal}</span>` : ''}
            ${task.comment_count ? `<span class="ak-chip">💬 ${task.comment_count}</span>` : ''}
          </div>
          <div class="ak-card-age">${esc(ageLabel)} ago</div>
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
    }

    toggleSelect(id, on) {
      if (on) this.selection.add(id);
      else this.selection.delete(id);
      this.renderBulkBar();
      const card = this.columnsEl?.querySelector(`.ak-card[data-task-id="${CSS.escape(id)}"]`);
      const checkbox = card?.querySelector('.ak-card-check');
      if (checkbox) checkbox.checked = on;
      else this.renderBoard();
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
          } else if (status === 'done') {
            const patch = withCompletionSummary({ status: 'done' }, this.selection.size);
            if (!patch) return;
            await this.ai.bulkNativeKanbanTasks(this.board, {
              ids: [...this.selection],
              status: 'done',
              result: patch.result,
              summary: patch.summary,
            });
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

    formatWorkspace(task) {
      const kind = String(task.workspace_kind || 'scratch').toUpperCase();
      if (task.workspace_path) return `${kind}:${task.workspace_path}`;
      return kind;
    }

    formatRunElapsed(run) {
      if (!run?.started_at) return '';
      const end = run.ended_at || Math.floor(Date.now() / 1000);
      const secs = Math.max(0, end - run.started_at);
      if (secs < 60) return `${secs}s`;
      if (secs < 3600) return `${Math.round(secs / 60)}m`;
      return `${(secs / 3600).toFixed(1)}h`;
    }

    formatEventPayload(payload) {
      if (payload == null) return '';
      try {
        return JSON.stringify(payload);
      } catch {
        return String(payload);
      }
    }

    captureDrawerDraft() {
      if (!this.drawerRoot || this.drawerRoot.hidden) return;
      const ui = this.drawerUi || this.createDrawerUiState();
      const comment = this.drawerRoot.querySelector('#akCommentInput');
      if (comment) ui.commentDraft = comment.value;
      const titleEdit = this.drawerRoot.querySelector('#akDrawerTitleEdit');
      if (titleEdit) ui.titleDraft = titleEdit.value;
      const bodyEdit = this.drawerRoot.querySelector('#akDrawerBodyEdit');
      if (bodyEdit) ui.bodyDraft = bodyEdit.value;
      const assigneeEdit = this.drawerRoot.querySelector('#akDrawerAssigneeEdit');
      if (assigneeEdit) ui.assigneeDraft = assigneeEdit.value;
      const priorityEdit = this.drawerRoot.querySelector('#akDrawerPriorityEdit');
      if (priorityEdit) ui.priorityDraft = priorityEdit.value;
      this.drawerUi = ui;
    }

    renderDrawerMetaRow(label, valueHtml, editable = false) {
      return `
        <div class="ak-drawer-meta-row">
          <span class="ak-drawer-meta-label">${esc(label)}</span>
          <span class="ak-drawer-meta-value${editable ? ' ak-drawer-editable' : ''}">${valueHtml}</span>
        </div>
      `;
    }

    renderDrawerTitle(task) {
      const ui = this.drawerUi || this.createDrawerUiState();
      if (ui.editingTitle) {
        const draft = ui.titleDraft || task.title || '';
        return `
          <div class="ak-drawer-title-edit">
            <input class="ak-input" id="akDrawerTitleEdit" value="${esc(draft)}" />
            <button type="button" class="ak-btn" id="akDrawerTitleSave">Save</button>
            <button type="button" class="ak-btn ak-btn-ghost" id="akDrawerTitleCancel">Cancel</button>
          </div>
        `;
      }
      return `
        <div class="ak-drawer-title" id="akDrawerTitleView" title="Click to edit">
          ${esc(task.title || '(untitled)')}
        </div>
      `;
    }

    renderDrawerStatusActions(task) {
      const status = task.status || '';
      const buttons = [];
      if (status === 'triage') {
        buttons.push('<button type="button" class="ak-btn" id="akDecomposeBtn">⚗ Decompose</button>');
        buttons.push('<button type="button" class="ak-btn ak-btn-ghost" id="akSpecifyBtn">✨ Specify</button>');
      }
      if (status !== 'triage') {
        buttons.push('<button type="button" class="ak-btn ak-btn-ghost" data-status="triage">→ Triage</button>');
      }
      if (status !== 'ready') {
        buttons.push('<button type="button" class="ak-btn ak-btn-ghost" data-status="ready">→ Ready</button>');
      }
      if (status === 'running' || status === 'ready') {
        buttons.push('<button type="button" class="ak-btn ak-btn-ghost" data-status="blocked">Block</button>');
      }
      if (status === 'blocked') {
        buttons.push('<button type="button" class="ak-btn ak-btn-ghost" data-status="ready" data-unblock="1">Unblock</button>');
      }
      if (status === 'running' || status === 'ready' || status === 'blocked') {
        buttons.push('<button type="button" class="ak-btn" data-status="done">Complete</button>');
      }
      if (status !== 'archived') {
        buttons.push('<button type="button" class="ak-btn ak-btn-ghost" data-status="archived">Archive</button>');
      }
      return `<div class="ak-drawer-actions">${buttons.join('')}</div>`;
    }

    renderDrawerDescription(task) {
      const ui = this.drawerUi || this.createDrawerUiState();
      const body = task.body || '';
      const draft = ui.bodyDraft || body;
      return `
        <section class="ak-drawer-section">
          <div class="ak-drawer-section-head">
            <h4>Description</h4>
            ${ui.editingBody
              ? `<div class="ak-drawer-section-actions">
                  <button type="button" class="ak-btn" id="akDrawerBodySave">Save</button>
                  <button type="button" class="ak-btn ak-btn-ghost" id="akDrawerBodyCancel">Cancel</button>
                </div>`
              : `<button type="button" class="ak-drawer-edit-link" id="akDrawerBodyEditBtn">edit</button>`}
          </div>
          ${ui.editingBody
            ? `<textarea class="ak-textarea" id="akDrawerBodyEdit" rows="8">${esc(draft)}</textarea>`
            : `<div class="ak-drawer-description">${body ? esc(body) : '<span class="ak-empty-inline">— no description —</span>'}</div>`}
        </section>
      `;
    }

    renderDrawerDependencies(task, links, allTasks) {
      const parents = links.parents || [];
      const children = links.children || [];
      const parentExclude = new Set([task.id, ...parents]);
      const childExclude = new Set([task.id, ...children]);
      const parentOptions = allTasks
        .filter((t) => !parentExclude.has(t.id))
        .map((t) => `<option value="${esc(t.id)}">${esc(t.id)} — ${esc(String(t.title || '').slice(0, 50))}</option>`)
        .join('');
      const childOptions = allTasks
        .filter((t) => !childExclude.has(t.id))
        .map((t) => `<option value="${esc(t.id)}">${esc(t.id)} — ${esc(String(t.title || '').slice(0, 50))}</option>`)
        .join('');

      const renderChips = (ids, removeKind) => (ids.length
        ? ids.map((id) => `
            <span class="ak-dep-chip">
              ${esc(id)}
              <button type="button" class="ak-dep-chip-x" data-remove-link="${removeKind}" data-link-id="${esc(id)}" title="Remove">×</button>
            </span>
          `).join('')
        : '<span class="ak-empty-inline">none</span>');

      return `
        <section class="ak-drawer-section">
          <h4>Dependencies</h4>
          <div class="ak-deps-row">
            <span class="ak-deps-label">Parents:</span>
            <div class="ak-deps-chips">${renderChips(parents, 'parent')}</div>
          </div>
          <div class="ak-deps-row ak-deps-add">
            <select class="ak-select" id="akAddParentSelect">
              <option value="">— add parent —</option>
              ${parentOptions}
            </select>
            <button type="button" class="ak-btn" id="akAddParentBtn">+ Parent</button>
          </div>
          <div class="ak-deps-row">
            <span class="ak-deps-label">Children:</span>
            <div class="ak-deps-chips">${renderChips(children, 'child')}</div>
          </div>
          <div class="ak-deps-row ak-deps-add">
            <select class="ak-select" id="akAddChildSelect">
              <option value="">— add child —</option>
              ${childOptions}
            </select>
            <button type="button" class="ak-btn" id="akAddChildBtn">+ Child</button>
          </div>
        </section>
      `;
    }

    renderDrawerComments(comments) {
      return `
        <section class="ak-drawer-section">
          <h4>Comments (${comments.length})</h4>
          <div class="ak-comments">
            ${comments.length
              ? comments.map((c) => `
                  <div class="ak-comment">
                    <div class="ak-comment-head">
                      <strong>${esc(c.author || 'anon')}</strong>
                      <span class="ak-comment-ago">${esc(timeAgo(c.created_at))}</span>
                    </div>
                    <div class="ak-comment-body">${esc(c.body || '')}</div>
                  </div>
                `).join('')
              : '<div class="ak-empty-inline">— no comments —</div>'}
          </div>
        </section>
      `;
    }

    renderDrawerEvents(events) {
      const rows = [...events].reverse().slice(0, 20).map((ev) => {
        const isDiag = isDiagnosticEvent(ev.kind);
        const phantoms = isDiag ? phantomIdsFromEvent(ev) : [];
        return `
        <div class="ak-event${isDiag ? ' ak-event-diagnostic' : ''}">
          <div class="ak-event-head">
            ${isDiag
              ? `<span class="ak-event-kind ak-event-warning">⚠ ${esc(DIAGNOSTIC_EVENT_LABELS[ev.kind] || ev.kind)}</span>`
              : `<span class="ak-event-kind">${esc(ev.kind || '')}</span>`}
            <span class="ak-event-ago">${esc(timeAgo(ev.created_at))}</span>
          </div>
          ${isDiag && phantoms.length
            ? `<div class="ak-event-phantoms">Phantom ids: ${phantoms.map((id) => `<code>${esc(id)}</code>`).join(' ')}</div>`
            : ''}
          ${!isDiag && ev.payload != null
            ? `<code class="ak-event-payload">${esc(this.formatEventPayload(ev.payload))}</code>`
            : ''}
        </div>
      `;
      }).join('');
      return `
        <section class="ak-drawer-section">
          <h4>Events (${events.length})</h4>
          <div class="ak-events">${rows || '<div class="ak-empty-inline">— no events —</div>'}</div>
        </section>
      `;
    }

    renderDrawerDiagnostics(task) {
      const diags = task.diagnostics || [];
      if (!diags.length) return '';
      const assignees = this.boardData?.assignees || [];
      const rows = diags.map((d, i) => {
        const actionBtns = (d.actions || []).map((a) => {
          if (a.kind === 'reassign') {
            return `
              <div class="ak-diag-reassign">
                <select class="ak-select" id="akDiagReassignProfile${i}">
                  ${assignees.map((p) => `<option value="${esc(p)}"${p === task.assignee ? ' selected' : ''}>${esc(p)}</option>`).join('')}
                </select>
                <button type="button" class="ak-btn ak-btn-ghost" data-diag-action="reassign" data-diag-index="${i}">${esc(a.label || 'Reassign')}</button>
              </div>
            `;
          }
          if (a.kind === 'cli_hint') {
            const cmd = a.payload?.command || a.label || '';
            return `<button type="button" class="ak-btn ak-btn-ghost" data-diag-action="cli_hint" data-diag-cmd="${esc(cmd)}">${esc(a.label || 'Copy CLI')}</button>`;
          }
          return `<button type="button" class="ak-btn ak-btn-ghost" data-diag-action="${esc(a.kind)}" data-diag-index="${i}">${esc(a.label || a.kind)}</button>`;
        }).join('');
        return `
          <div class="ak-diag-card ak-diag-${esc(d.severity || 'warning')}">
            <div class="ak-diag-head">
              <strong>${esc(d.title || d.kind)}</strong>
              <span class="ak-diag-severity">${esc(d.severity || 'warning')}</span>
            </div>
            ${d.detail ? `<div class="ak-diag-detail">${esc(d.detail)}</div>` : ''}
            <div class="ak-diag-actions">${actionBtns}</div>
          </div>
        `;
      }).join('');
      return `
        <section class="ak-drawer-section ak-drawer-diagnostics">
          <h4>⚠ Diagnostics (${diags.length})</h4>
          <div class="ak-diag-list">${rows}</div>
        </section>
      `;
    }

    renderDrawerRuns(runs) {
      if (!runs.length) return '';
      const showAll = runs.length <= 3;
      const visible = showAll ? runs : runs.slice(-3);
      const rows = visible.map((r) => {
        const active = !r.ended_at;
        const outcome = active ? 'active' : (r.outcome || r.status || 'ended');
        const metaJson = r.metadata && Object.keys(r.metadata).length
          ? JSON.stringify(r.metadata, null, 2)
          : '';
        return `
          <div class="ak-run ${active ? 'ak-run-active' : ''}">
            <div class="ak-run-head">
              <span class="ak-run-outcome">${esc(outcome)}</span>
              <span class="ak-run-profile">${r.profile ? `@${esc(r.profile)}` : '(no profile)'}</span>
              <span class="ak-run-elapsed">${esc(this.formatRunElapsed(r))}</span>
              <span class="ak-run-ago">${esc(timeAgo(r.started_at))}</span>
            </div>
            ${r.summary ? `<div class="ak-run-summary">${esc(r.summary)}</div>` : ''}
            ${r.error ? `<div class="ak-run-error">${esc(r.error)}</div>` : ''}
            ${metaJson ? `<details class="ak-run-meta-block"><summary>Metadata</summary><code class="ak-run-meta">${esc(metaJson)}</code></details>` : ''}
          </div>
        `;
      }).join('');
      return `
        <section class="ak-drawer-section">
          <h4>Run history (${runs.length})</h4>
          ${!showAll ? `<div class="ak-empty-inline">Showing latest 3 of ${runs.length}</div>` : ''}
          <div class="ak-runs">${rows}</div>
        </section>
      `;
    }

    renderDrawerWorkerLog(logData) {
      const sizeLabel = logData?.size_bytes ? ` (${logData.size_bytes} B)` : '';
      let body = '— no worker log yet (task hasn\'t spawned or log was rotated away) —';
      if (logData?.exists) body = logData.content || '(empty)';
      return `
        <section class="ak-drawer-section">
          <div class="ak-drawer-section-head">
            <h4 id="akWorkerLogHead">Worker log${esc(sizeLabel)}</h4>
            <button type="button" class="ak-drawer-edit-link" id="akWorkerLogRefresh">refresh</button>
          </div>
          <pre class="ak-worker-log" id="akWorkerLogPre">${esc(body)}</pre>
          ${logData?.truncated ? `<div class="ak-log-truncated">(showing tail — full log at ${esc(logData.path || '')})</div>` : ''}
        </section>
      `;
    }

    async patchDrawerTask(taskId, patch) {
      try {
        await this.ai.patchNativeKanbanTask(this.board, taskId, patch);
        await this.loadBoard();
        await this.openDrawer(taskId);
      } catch (e) {
        this.onStatus(e.message || 'Update failed', true);
      }
    }

    async refreshDrawerWorkerLog(taskId) {
      const pre = this.drawerRoot?.querySelector('#akWorkerLogPre');
      const head = this.drawerRoot?.querySelector('#akWorkerLogHead');
      if (pre) pre.textContent = 'Loading log…';
      try {
        const log = await this.ai.getNativeKanbanTaskLog(this.board, taskId, 100000);
        if (head) {
          head.textContent = `Worker log${log.size_bytes ? ` (${log.size_bytes} B)` : ''}`;
        }
        if (pre) {
          pre.textContent = log.exists
            ? (log.content || '(empty)')
            : '— no worker log yet (task hasn\'t spawned or log was rotated away) —';
        }
      } catch (e) {
        if (pre) pre.textContent = e.message || 'Failed to load log';
      }
    }

    bindDrawer(taskId, task) {
      const ui = this.drawerUi || this.createDrawerUiState();
      const root = this.drawerRoot;
      if (!root) return;

      root.querySelector('#akDrawerClose')?.addEventListener('click', () => this.closeDrawer());

      root.querySelector('#akDrawerTitleView')?.addEventListener('click', () => {
        ui.editingTitle = true;
        ui.titleDraft = task.title || '';
        this.openDrawer(taskId);
      });
      root.querySelector('#akDrawerTitleSave')?.addEventListener('click', () => {
        const title = root.querySelector('#akDrawerTitleEdit')?.value?.trim();
        if (!title) return;
        ui.editingTitle = false;
        this.patchDrawerTask(taskId, { title });
      });
      root.querySelector('#akDrawerTitleCancel')?.addEventListener('click', () => {
        ui.editingTitle = false;
        this.openDrawer(taskId);
      });
      root.querySelector('#akDrawerTitleEdit')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') root.querySelector('#akDrawerTitleSave')?.click();
        if (e.key === 'Escape') root.querySelector('#akDrawerTitleCancel')?.click();
      });

      root.querySelector('#akDrawerAssigneeView')?.addEventListener('click', () => {
        ui.editingAssignee = true;
        ui.assigneeDraft = task.assignee || '';
        this.openDrawer(taskId);
      });
      root.querySelector('#akDrawerAssigneeSave')?.addEventListener('click', () => {
        const assignee = root.querySelector('#akDrawerAssigneeEdit')?.value?.trim() || '';
        ui.editingAssignee = false;
        this.patchDrawerTask(taskId, { assignee });
      });
      root.querySelector('#akDrawerAssigneeCancel')?.addEventListener('click', () => {
        ui.editingAssignee = false;
        this.openDrawer(taskId);
      });

      root.querySelector('#akDrawerPriorityView')?.addEventListener('click', () => {
        ui.editingPriority = true;
        ui.priorityDraft = String(task.priority ?? 0);
        this.openDrawer(taskId);
      });
      root.querySelector('#akDrawerPrioritySave')?.addEventListener('click', () => {
        const priority = Number(root.querySelector('#akDrawerPriorityEdit')?.value) || 0;
        ui.editingPriority = false;
        this.patchDrawerTask(taskId, { priority });
      });
      root.querySelector('#akDrawerPriorityCancel')?.addEventListener('click', () => {
        ui.editingPriority = false;
        this.openDrawer(taskId);
      });

      root.querySelector('#akDrawerBodyEditBtn')?.addEventListener('click', () => {
        ui.editingBody = true;
        ui.bodyDraft = task.body || '';
        this.openDrawer(taskId);
      });
      root.querySelector('#akDrawerBodySave')?.addEventListener('click', () => {
        const body = root.querySelector('#akDrawerBodyEdit')?.value ?? '';
        ui.editingBody = false;
        this.patchDrawerTask(taskId, { body });
      });
      root.querySelector('#akDrawerBodyCancel')?.addEventListener('click', () => {
        ui.editingBody = false;
        this.openDrawer(taskId);
      });

      root.querySelector('#akDecomposeBtn')?.addEventListener('click', async () => {
        const res = await this.ai.decomposeNativeKanbanTask(this.board, taskId);
        this.onStatus(res.ok ? `Decomposed: ${res.fanout || 0} tasks` : (res.reason || 'Decompose failed'), !res.ok);
        await this.loadBoard();
        await this.openDrawer(taskId);
      });
      root.querySelector('#akSpecifyBtn')?.addEventListener('click', async () => {
        const res = await this.ai.specifyNativeKanbanTask(this.board, taskId);
        this.onStatus(res.ok ? 'Task specified' : (res.reason || 'Specify failed'), !res.ok);
        await this.loadBoard();
        await this.openDrawer(taskId);
      });

      root.querySelectorAll('[data-status]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const status = btn.dataset.status;
          if (status === 'blocked') {
            await this.moveTask(taskId, status);
            if (this.openTaskId === taskId) await this.openDrawer(taskId);
            return;
          }
          if (btn.dataset.unblock) {
            await this.moveTask(taskId, 'ready');
            if (this.openTaskId === taskId) await this.openDrawer(taskId);
            return;
          }
          await this.moveTask(taskId, status);
          if (this.openTaskId === taskId) await this.openDrawer(taskId);
        });
      });

      root.querySelector('#akAddParentBtn')?.addEventListener('click', async () => {
        const parentId = root.querySelector('#akAddParentSelect')?.value;
        if (!parentId) return;
        try {
          await this.ai.addNativeKanbanLink(this.board, { parent_id: parentId, child_id: taskId });
          await this.openDrawer(taskId);
        } catch (e) {
          this.onStatus(e.message || 'Failed to add parent', true);
        }
      });
      root.querySelector('#akAddChildBtn')?.addEventListener('click', async () => {
        const childId = root.querySelector('#akAddChildSelect')?.value;
        if (!childId) return;
        try {
          await this.ai.addNativeKanbanLink(this.board, { parent_id: taskId, child_id: childId });
          await this.openDrawer(taskId);
        } catch (e) {
          this.onStatus(e.message || 'Failed to add child', true);
        }
      });
      root.querySelectorAll('[data-remove-link]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const linkId = btn.dataset.linkId;
          const kind = btn.dataset.removeLink;
          if (!linkId) return;
          try {
            if (kind === 'parent') {
              await this.ai.deleteNativeKanbanLink(this.board, linkId, taskId);
            } else {
              await this.ai.deleteNativeKanbanLink(this.board, taskId, linkId);
            }
            await this.openDrawer(taskId);
          } catch (e) {
            this.onStatus(e.message || 'Failed to remove link', true);
          }
        });
      });

      root.querySelector('#akWorkerLogRefresh')?.addEventListener('click', () => {
        this.refreshDrawerWorkerLog(taskId);
      });

      root.querySelectorAll('[data-diag-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.diagAction;
          const idx = btn.dataset.diagIndex;
          if (action === 'cli_hint') {
            const cmd = btn.dataset.diagCmd || '';
            try {
              await navigator.clipboard.writeText(cmd);
              this.onStatus('CLI command copied', false);
            } catch {
              window.prompt('Copy this command:', cmd);
            }
            return;
          }
          if (action === 'comment') {
            root.querySelector('#akCommentInput')?.focus();
            return;
          }
          if (action === 'unblock') {
            await this.moveTask(taskId, 'ready');
            if (this.openTaskId === taskId) await this.openDrawer(taskId);
            return;
          }
          if (action === 'reclaim') {
            try {
              await this.ai.reclaimNativeKanbanTask(this.board, taskId, {
                reason: `recovery action from drawer`,
              });
              await this.loadBoard();
              await this.openDrawer(taskId);
            } catch (e) {
              this.onStatus(e.message || 'Reclaim failed', true);
            }
            return;
          }
          if (action === 'reassign') {
            const profile = root.querySelector(`#akDiagReassignProfile${idx}`)?.value;
            if (!profile) {
              this.onStatus('Pick a profile first', true);
              return;
            }
            try {
              await this.ai.reassignNativeKanbanTask(this.board, taskId, {
                profile,
                reclaim_first: true,
              });
              await this.loadBoard();
              await this.openDrawer(taskId);
            } catch (e) {
              this.onStatus(e.message || 'Reassign failed', true);
            }
          }
        });
      });

      const submitComment = async () => {
        const body = root.querySelector('#akCommentInput')?.value?.trim();
        if (!body) return;
        await this.ai.addNativeKanbanComment(this.board, taskId, { body, author: 'aether' });
        ui.commentDraft = '';
        await this.openDrawer(taskId);
      };
      root.querySelector('#akCommentBtn')?.addEventListener('click', submitComment);
      root.querySelector('#akCommentInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitComment();
        }
      });
      root.querySelector('#akCommentInput')?.addEventListener('input', (e) => {
        ui.commentDraft = e.target.value;
      });

      if (ui.commentDraft) {
        requestAnimationFrame(() => {
          const input = root.querySelector('#akCommentInput');
          if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
        });
      }
    }

    async moveTask(taskId, status) {
      const destructive = ['done', 'blocked', 'archived'].includes(status);
      if (destructive && status !== 'done' && !window.confirm(`Move ${taskId} to ${status}?`)) return;
      try {
        let body = { status };
        if (status === 'blocked') {
          body.block_reason = window.prompt('Block reason:') || 'Blocked from board';
        }
        if (status === 'done') {
          const patch = withCompletionSummary({ status: 'done' }, 1);
          if (!patch) return;
          body = patch;
        }
        await this.ai.patchNativeKanbanTask(this.board, taskId, body);
        await this.loadBoard();
      } catch (e) {
        this.onStatus(e.message || String(e), true);
      }
    }

    async openDrawer(taskId) {
      if (this.openTaskId === taskId) this.captureDrawerDraft();
      else this.drawerUi = this.createDrawerUiState();

      this.openTaskId = taskId;
      const ui = this.drawerUi;
      let data;
      let logData = null;
      try {
        [data, logData] = await Promise.all([
          this.ai.getNativeKanbanTask(this.board, taskId),
          this.ai.getNativeKanbanTaskLog(this.board, taskId, 100000).catch(() => null),
        ]);
      } catch (e) {
        this.onStatus(e.message || 'Failed to load task', true);
        return;
      }

      const task = data.task || {};
      const comments = data.comments || [];
      const events = data.events || [];
      const links = data.links || { parents: [], children: [] };
      const runs = data.runs || [];
      const allTasks = this.collectAllTasks();

      if (!this.drawerRoot) return;
      this.drawerRoot.hidden = false;

      const assigneeHtml = ui.editingAssignee
        ? `<div class="ak-drawer-inline-edit">
            <input class="ak-input" id="akDrawerAssigneeEdit" value="${esc(ui.assigneeDraft || task.assignee || '')}" placeholder="(empty = unassign)" />
            <button type="button" class="ak-btn" id="akDrawerAssigneeSave">Save</button>
            <button type="button" class="ak-btn ak-btn-ghost" id="akDrawerAssigneeCancel">Cancel</button>
          </div>`
        : `<span id="akDrawerAssigneeView" title="Click to edit">${esc(task.assignee || 'unassigned')}</span>`;

      const priorityHtml = ui.editingPriority
        ? `<div class="ak-drawer-inline-edit">
            <input class="ak-input ak-drawer-priority-input" id="akDrawerPriorityEdit" type="number" value="${esc(ui.priorityDraft ?? String(task.priority ?? 0))}" />
            <button type="button" class="ak-btn" id="akDrawerPrioritySave">Save</button>
            <button type="button" class="ak-btn ak-btn-ghost" id="akDrawerPriorityCancel">Cancel</button>
          </div>`
        : `<span id="akDrawerPriorityView" title="Click to edit">${esc(String(task.priority ?? 0))}</span>`;

      this.drawerRoot.innerHTML = `
        <div class="ak-drawer">
          <header class="ak-drawer-header">
            <h3>${esc(task.id)}</h3>
            <button type="button" class="ak-drawer-close" id="akDrawerClose">×</button>
          </header>
          <div class="ak-drawer-body">
            ${this.renderDrawerTitle(task)}
            <div class="ak-drawer-meta-grid">
              ${this.renderDrawerMetaRow('Status', esc((task.status || '').toUpperCase()))}
              ${this.renderDrawerMetaRow('Assignee', assigneeHtml, !ui.editingAssignee)}
              ${this.renderDrawerMetaRow('Priority', priorityHtml, !ui.editingPriority)}
              ${task.tenant ? this.renderDrawerMetaRow('Tenant', esc(task.tenant)) : ''}
              ${this.renderDrawerMetaRow('Workspace', esc(this.formatWorkspace(task)))}
              ${task.skills?.length ? this.renderDrawerMetaRow('Skills', esc(task.skills.join(', '))) : ''}
              ${task.created_by ? this.renderDrawerMetaRow('Created by', esc(task.created_by)) : ''}
              ${task.model_override ? this.renderDrawerMetaRow('Model', esc(task.model_override)) : ''}
              ${task.session_id ? this.renderDrawerMetaRow('Session', esc(task.session_id)) : ''}
              ${task.branch_name ? this.renderDrawerMetaRow('Branch', esc(task.branch_name)) : ''}
              ${task.consecutive_failures > 0
                ? this.renderDrawerMetaRow('Failures', esc(`${task.consecutive_failures}${task.max_retries != null ? ` / max ${task.max_retries}` : ''}`))
                : ''}
              ${task.last_failure_error
                ? this.renderDrawerMetaRow('Last error', esc(task.last_failure_error))
                : ''}
            </div>
            ${this.renderDrawerStatusActions(task)}
            ${this.renderDrawerDiagnostics(task)}
            ${this.renderDrawerDescription(task)}
            ${task.latest_summary && task.latest_summary !== task.body ? `
              <section class="ak-drawer-section">
                <h4>Latest worker summary</h4>
                <div class="ak-drawer-description">${esc(task.latest_summary)}</div>
              </section>
            ` : ''}
            ${this.renderDrawerDependencies(task, links, allTasks)}
            ${task.result ? `
              <section class="ak-drawer-section">
                <h4>Result</h4>
                <div class="ak-drawer-description">${esc(task.result)}</div>
              </section>
            ` : ''}
            ${this.renderDrawerComments(comments)}
            ${this.renderDrawerEvents(events)}
            ${this.renderDrawerWorkerLog(logData)}
            ${this.renderDrawerRuns(runs)}
          </div>
          <footer class="ak-drawer-footer ak-drawer-comment-row">
            <input class="ak-input" id="akCommentInput" placeholder="Add a comment… (Enter to submit)" value="${esc(ui.commentDraft || '')}" />
            <button type="button" class="ak-btn" id="akCommentBtn">Comment</button>
          </footer>
        </div>
      `;

      this.bindDrawer(taskId, task);
    }

    closeDrawer() {
      this.openTaskId = null;
      this.drawerUi = this.createDrawerUiState();
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
