/**
 * HTTP handlers for native Aether Kanban API (/api/hermes/kanban/...).
 */
const kanbanApi = require('./hermes-kanban-api.js');
const { kanbanAvailable, KANBAN_INIT_HINT, pollTaskEvents } = require('./hermes-kanban.js');

const SSE_POLL_MS = 2500;

function boardFromUrl(u) {
  return u.searchParams.get('board') || undefined;
}

function kanbanErrorStatus(err) {
  return err.status || 502;
}

async function handleKanbanApi(req, res, pathname, u, helpers) {
  const { sendJson, readBody, sendSseHeaders, writeSse } = helpers;
  const board = boardFromUrl(u);

  if (!kanbanAvailable() && pathname !== '/api/hermes/kanban/boards') {
    sendJson(res, 503, { ok: false, error: 'Kanban not initialized', hint: KANBAN_INIT_HINT });
    return true;
  }

  try {
    if (req.method === 'GET' && pathname === '/api/hermes/kanban/bootstrap') {
      const data = await kanbanApi.getBootstrap(board, {
        tenant: u.searchParams.get('tenant') || undefined,
        include_archived: u.searchParams.get('include_archived') === 'true',
      });
      sendJson(res, 200, data);
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/hermes/kanban/board') {
      const data = await kanbanApi.getBoard(board, {
        tenant: u.searchParams.get('tenant') || undefined,
        include_archived: u.searchParams.get('include_archived') === 'true',
      });
      sendJson(res, 200, data);
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/hermes/kanban/config') {
      sendJson(res, 200, await kanbanApi.getKanbanConfig());
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/hermes/kanban/orchestration') {
      sendJson(res, 200, await kanbanApi.getOrchestration());
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/hermes/kanban/profiles') {
      sendJson(res, 200, await kanbanApi.listProfiles());
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/hermes/kanban/stats') {
      sendJson(res, 200, await kanbanApi.getStats(board));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/hermes/kanban/assignees') {
      sendJson(res, 200, await kanbanApi.getAssignees(board));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/hermes/kanban/boards-list') {
      sendJson(res, 200, await kanbanApi.listBoards({
        include_archived: u.searchParams.get('include_archived') === 'true',
      }));
      return true;
    }

    const taskMatch = pathname.match(/^\/api\/hermes\/kanban\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const taskId = decodeURIComponent(taskMatch[1]);
      if (req.method === 'GET') {
        sendJson(res, 200, await kanbanApi.getTask(board, taskId));
        return true;
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        sendJson(res, 200, await kanbanApi.updateTask(board, taskId, body || {}));
        return true;
      }
      if (req.method === 'DELETE') {
        sendJson(res, 200, await kanbanApi.deleteTask(board, taskId));
        return true;
      }
    }

    const commentMatch = pathname.match(/^\/api\/hermes\/kanban\/tasks\/([^/]+)\/comments$/);
    if (commentMatch && req.method === 'POST') {
      const taskId = decodeURIComponent(commentMatch[1]);
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.addComment(board, taskId, body || {}));
      return true;
    }

    const specifyMatch = pathname.match(/^\/api\/hermes\/kanban\/tasks\/([^/]+)\/specify$/);
    if (specifyMatch && req.method === 'POST') {
      const taskId = decodeURIComponent(specifyMatch[1]);
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.specifyTask(board, taskId, body || {}));
      return true;
    }

    const decomposeMatch = pathname.match(/^\/api\/hermes\/kanban\/tasks\/([^/]+)\/decompose$/);
    if (decomposeMatch && req.method === 'POST') {
      const taskId = decodeURIComponent(decomposeMatch[1]);
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.decomposeTask(board, taskId, body || {}));
      return true;
    }

    const logMatch = pathname.match(/^\/api\/hermes\/kanban\/tasks\/([^/]+)\/log$/);
    if (logMatch && req.method === 'GET') {
      const taskId = decodeURIComponent(logMatch[1]);
      const tail = Number(u.searchParams.get('tail')) || 8192;
      sendJson(res, 200, await kanbanApi.getTaskLog(board, taskId, tail));
      return true;
    }

    const homeMatch = pathname.match(/^\/api\/hermes\/kanban\/tasks\/([^/]+)\/home-channels$/);
    if (homeMatch && req.method === 'GET') {
      const taskId = decodeURIComponent(homeMatch[1]);
      sendJson(res, 200, await kanbanApi.getHomeChannels(board, taskId));
      return true;
    }

    const homeSubMatch = pathname.match(/^\/api\/hermes\/kanban\/tasks\/([^/]+)\/home-subscribe\/([^/]+)$/);
    if (homeSubMatch && req.method === 'POST') {
      const taskId = decodeURIComponent(homeSubMatch[1]);
      const platform = decodeURIComponent(homeSubMatch[2]);
      sendJson(res, 200, await kanbanApi.subscribeHome(board, taskId, platform));
      return true;
    }
    if (homeSubMatch && req.method === 'DELETE') {
      const taskId = decodeURIComponent(homeSubMatch[1]);
      const platform = decodeURIComponent(homeSubMatch[2]);
      sendJson(res, 200, await kanbanApi.unsubscribeHome(board, taskId, platform));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/hermes/kanban/tasks') {
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.createTask(board, body || {}));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/hermes/kanban/tasks/bulk') {
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.bulkUpdate(board, body || {}));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/hermes/kanban/links') {
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.addLink(board, body || {}));
      return true;
    }

    if (req.method === 'DELETE' && pathname === '/api/hermes/kanban/links') {
      sendJson(res, 200, await kanbanApi.deleteLink(
        board,
        u.searchParams.get('parent_id'),
        u.searchParams.get('child_id'),
      ));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/hermes/kanban/dispatch') {
      sendJson(res, 200, await kanbanApi.dispatchNudge(board, {
        dry_run: u.searchParams.get('dry_run') === 'true',
        max: Number(u.searchParams.get('max')) || 8,
      }));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/hermes/kanban/boards-create') {
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.createBoard(body || {}));
      return true;
    }

    const renameBoardMatch = pathname.match(/^\/api\/hermes\/kanban\/boards-create\/([^/]+)$/);
    if (renameBoardMatch && req.method === 'PATCH') {
      const slug = decodeURIComponent(renameBoardMatch[1]);
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.renameBoard(slug, body || {}));
      return true;
    }

    const deleteBoardMatch = pathname.match(/^\/api\/hermes\/kanban\/boards-create\/([^/]+)$/);
    if (deleteBoardMatch && req.method === 'DELETE') {
      const slug = decodeURIComponent(deleteBoardMatch[1]);
      sendJson(res, 200, await kanbanApi.deleteBoard(slug, u.searchParams.get('delete') === 'true'));
      return true;
    }

    const profileMatch = pathname.match(/^\/api\/hermes\/kanban\/profiles\/([^/]+)$/);
    if (profileMatch && req.method === 'PATCH') {
      const name = decodeURIComponent(profileMatch[1]);
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.updateProfile(name, body || {}));
      return true;
    }

    const profileAutoMatch = pathname.match(/^\/api\/hermes\/kanban\/profiles\/([^/]+)\/describe-auto$/);
    if (profileAutoMatch && req.method === 'POST') {
      const name = decodeURIComponent(profileAutoMatch[1]);
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.describeProfileAuto(name, body || {}));
      return true;
    }

    if (req.method === 'PUT' && pathname === '/api/hermes/kanban/orchestration') {
      const body = await readBody(req);
      sendJson(res, 200, await kanbanApi.setOrchestration(body || {}));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/hermes/kanban/events/stream') {
      sendSseHeaders(res);
      let cursor = Number(u.searchParams.get('since') || 0);
      let closed = false;
      req.on('close', () => { closed = true; });

      const tick = () => {
        if (closed) return;
        try {
          const payload = pollTaskEvents(board, cursor);
          cursor = payload.cursor ?? cursor;
          writeSse(res, 'message', payload);
        } catch (e) {
          writeSse(res, 'error', { error: e.message || 'poll failed' });
        }
        if (!closed) setTimeout(tick, SSE_POLL_MS);
      };
      tick();
      return true;
    }
  } catch (e) {
    console.error('[kanban-api]', pathname, e.message || e);
    sendJson(res, kanbanErrorStatus(e), { ok: false, error: e.message || 'Kanban API error' });
    return true;
  }

  return false;
}

module.exports = { handleKanbanApi, boardFromUrl };
