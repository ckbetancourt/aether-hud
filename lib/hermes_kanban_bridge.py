#!/usr/bin/env python3
"""JSON stdin/stdout bridge to Hermes kanban plugin_api (kanban_db layer)."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
HERMES_AGENT_ROOT = Path(os.environ.get("HERMES_AGENT_ROOT", HERMES_HOME / "hermes-agent"))
PLUGIN_API_PATH = HERMES_AGENT_ROOT / "plugins" / "kanban" / "dashboard" / "plugin_api.py"


def _load_plugin_api():
    if not PLUGIN_API_PATH.exists():
        raise RuntimeError(f"Hermes kanban plugin not found at {PLUGIN_API_PATH}")
    spec = importlib.util.spec_from_file_location("hermes_kanban_plugin_api", PLUGIN_API_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Failed to load kanban plugin_api module spec")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    types_ns = {
        "Optional": Optional,
        "Any": Any,
        "list": list,
        "str": str,
        "int": int,
        "bool": bool,
        "dict": dict,
    }
    for attr in dir(mod):
        obj = getattr(mod, attr)
        if isinstance(obj, type) and hasattr(obj, "model_rebuild"):
            try:
                obj.model_rebuild(_types_namespace=types_ns)
            except Exception:
                pass
    return mod


def _http_error(exc: Exception) -> dict[str, Any]:
    try:
        from fastapi import HTTPException

        if isinstance(exc, HTTPException):
            detail = exc.detail
            if not isinstance(detail, str):
                detail = json.dumps(detail)
            return {"ok": False, "status": exc.status_code, "error": str(detail)}
    except Exception:
        pass
    return {"ok": False, "status": 500, "error": str(exc)}


def poll_events(params: dict[str, Any]) -> dict[str, Any]:
    from hermes_cli import kanban_db

    board = params.get("board")
    since = int(params.get("since") or 0)
    if board:
        board = kanban_db._normalize_board_slug(board)
    conn = kanban_db.connect(board=board)
    try:
        rows = conn.execute(
            "SELECT id, task_id, run_id, kind, payload, created_at "
            "FROM task_events WHERE id > ? ORDER BY id ASC LIMIT 200",
            (since,),
        ).fetchall()
        events = []
        cursor = since
        for r in rows:
            try:
                payload = json.loads(r["payload"]) if r["payload"] else None
            except Exception:
                payload = None
            events.append(
                {
                    "id": r["id"],
                    "task_id": r["task_id"],
                    "run_id": r["run_id"],
                    "kind": r["kind"],
                    "payload": payload,
                    "created_at": r["created_at"],
                }
            )
            cursor = r["id"]
        return {"ok": True, "events": events, "cursor": cursor}
    finally:
        conn.close()


def _pick(params: dict[str, Any], *keys: str) -> dict[str, Any]:
    out = {}
    for k in keys:
        if k in params and params[k] is not None:
            out[k] = params[k]
    return out


def dispatch_op(api, op: str, params: dict[str, Any]) -> dict[str, Any]:
    if op == "poll_events":
        return poll_events(params)

    board = params.get("board")
    rest = {k: v for k, v in params.items() if k != "board"}

    if op == "bootstrap":
        include_archived = bool(rest.get("include_archived", False))
        tenant = rest.get("tenant")
        board_payload = api.get_board(
            board=board,
            tenant=tenant,
            include_archived=include_archived,
            workflow_template_id=rest.get("workflow_template_id"),
            current_step_key=rest.get("current_step_key"),
        )
        boards_payload = api.list_boards(include_archived=include_archived)
        return {
            "ok": True,
            "board": board_payload,
            "config": api.get_config(),
            "orchestration": api.get_orchestration_settings(),
            "boards": boards_payload.get("boards", []),
            "current": boards_payload.get("current"),
        }

    if op == "get_board":
        return {
            "ok": True,
            **api.get_board(
                board=board,
                tenant=rest.get("tenant"),
                include_archived=bool(rest.get("include_archived", False)),
                workflow_template_id=rest.get("workflow_template_id"),
                current_step_key=rest.get("current_step_key"),
            ),
        }
    if op == "get_task":
        return {
            "ok": True,
            **api.get_task(
                task_id=rest["task_id"],
                board=board,
                run_state_type=rest.get("run_state_type"),
                run_state_name=rest.get("run_state_name"),
            ),
        }
    if op == "create_task":
        raw = dict(rest.get("body", rest))
        title = str(raw.get("title") or "").strip()
        if not title:
            raise ValueError("title is required")
        conn = api._conn(board=api._resolve_board(board))
        try:
            from hermes_cli import kanban_db

            parents = raw.get("parents") or []
            if isinstance(parents, str):
                parents = [parents] if parents else []
            skills = raw.get("skills")
            if isinstance(skills, str):
                skills = [s.strip() for s in skills.split(",") if s.strip()]

            task_id = kanban_db.create_task(
                conn,
                title=title,
                body=raw.get("body"),
                assignee=raw.get("assignee"),
                created_by="dashboard",
                workspace_kind=raw.get("workspace_kind") or "scratch",
                workspace_path=raw.get("workspace_path"),
                tenant=raw.get("tenant"),
                priority=int(raw.get("priority") or 0),
                parents=list(parents),
                triage=bool(raw.get("triage", False)),
                idempotency_key=raw.get("idempotency_key"),
                max_runtime_seconds=raw.get("max_runtime_seconds"),
                skills=skills,
            )
            task = kanban_db.get_task(conn, task_id)
            result: dict[str, Any] = {"ok": True, "task": api._task_dict(task) if task else None}
            if task and task.status == "ready" and task.assignee:
                try:
                    from hermes_cli.kanban import _check_dispatcher_presence

                    running, message = _check_dispatcher_presence()
                    if not running and message:
                        result["warning"] = message
                except Exception:
                    pass
            return result
        finally:
            conn.close()
    if op == "update_task":
        body = api.UpdateTaskBody(**rest.get("body", rest))
        return {"ok": True, **api.update_task(rest["task_id"], body, board=board)}
    if op == "delete_task":
        return {"ok": True, **api.delete_task(rest["task_id"], board=board)}
    if op == "add_comment":
        body = api.CommentBody(**rest.get("body", rest))
        return {"ok": True, **api.add_comment(rest["task_id"], body, board=board)}
    if op == "add_link":
        body = api.LinkBody(**rest.get("body", rest))
        return {"ok": True, **api.add_link(body, board=board)}
    if op == "delete_link":
        return {"ok": True, **api.delete_link(board=board, parent_id=rest["parent_id"], child_id=rest["child_id"])}
    if op == "bulk_update":
        body = api.BulkTaskBody(**rest.get("body", rest))
        return {"ok": True, **api.bulk_update(body, board=board)}
    if op == "list_diagnostics":
        return {"ok": True, **api.list_diagnostics(board=board, tenant=rest.get("tenant"))}
    if op == "list_active_workers":
        return {"ok": True, **api.list_active_workers(board=board)}
    if op == "get_run":
        return {"ok": True, **api.get_run_endpoint(board=board, run_id=rest["run_id"])}
    if op == "inspect_run":
        return {"ok": True, **api.inspect_run_endpoint(board=board, run_id=rest["run_id"])}
    if op == "reclaim_task":
        body = api.ReclaimBody(**rest.get("body", {}))
        return {"ok": True, **api.reclaim_task_endpoint(rest["task_id"], body, board=board)}
    if op == "specify_task":
        body = api.SpecifyBody(**rest.get("body", {}))
        return {"ok": True, **api.specify_task_endpoint(rest["task_id"], body, board=board)}
    if op == "reassign_task":
        body = api.ReassignBody(**rest.get("body", rest))
        return {"ok": True, **api.reassign_task_endpoint(rest["task_id"], body, board=board)}
    if op == "get_config":
        return {"ok": True, **api.get_config()}
    if op == "get_home_channels":
        return {"ok": True, **api.get_home_channels(rest["task_id"], board=board)}
    if op == "subscribe_home":
        return {"ok": True, **api.subscribe_home(rest["task_id"], rest["platform"], board=board)}
    if op == "unsubscribe_home":
        return {"ok": True, **api.unsubscribe_home(rest["task_id"], rest["platform"], board=board)}
    if op == "get_stats":
        return {"ok": True, **api.get_stats(board=board)}
    if op == "get_assignees":
        return {"ok": True, **api.get_assignees(board=board)}
    if op == "get_task_log":
        return {
            "ok": True,
            **api.get_task_log(
                task_id=rest["task_id"],
                board=board,
                tail=int(rest.get("tail", 8192)),
            ),
        }
    if op == "dispatch":
        return {
            "ok": True,
            **api.dispatch(
                board=board,
                dry_run=bool(rest.get("dry_run", False)),
                max_n=int(rest.get("max", 8)),
            ),
        }
    if op == "list_boards":
        return {"ok": True, **api.list_boards(include_archived=bool(rest.get("include_archived", False)))}
    if op == "create_board":
        body = api.CreateBoardBody(**rest.get("body", rest))
        return {"ok": True, **api.create_board_endpoint(body)}
    if op == "rename_board":
        body = api.RenameBoardBody(**rest.get("body", rest))
        return {"ok": True, **api.rename_board(rest["slug"], body)}
    if op == "delete_board":
        return {"ok": True, **api.delete_board(rest["slug"], delete=bool(rest.get("delete", False)))}
    if op == "switch_board":
        return {"ok": True, **api.switch_board(rest["slug"])}
    if op == "list_profiles":
        return {"ok": True, **api.list_profile_roster()}
    if op == "update_profile":
        body = api.DescribeBody(**rest.get("body", rest))
        return {"ok": True, **api.update_profile_description(rest["profile_name"], body)}
    if op == "describe_profile_auto":
        body = api.DescribeAutoBody(**rest.get("body", {}))
        return {"ok": True, **api.auto_describe_profile(rest["profile_name"], body)}
    if op == "decompose_task":
        body = api.DecomposeBody(**rest.get("body", {}))
        return {"ok": True, **api.decompose_task_endpoint(rest["task_id"], body, board=board)}
    if op == "get_orchestration":
        return {"ok": True, **api.get_orchestration_settings()}
    if op == "set_orchestration":
        body = api.OrchestrationSettingsBody(**rest.get("body", rest))
        return {"ok": True, **api.set_orchestration_settings(body)}

    raise ValueError(f"unknown op: {op}")


def _respond(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, default=str), flush=True)


def worker_loop() -> None:
    try:
        api = _load_plugin_api()
    except Exception as exc:
        _respond({"ready": False, "error": str(exc)})
        return

    _respond({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as exc:
            _respond({"ok": False, "error": f"invalid json: {exc}"})
            continue

        req_id = req.get("id")
        op = req.get("op")
        params = req.get("params") or {}
        if not op:
            _respond({"id": req_id, "ok": False, "error": "missing op"})
            continue
        try:
            result = dispatch_op(api, op, dict(params))
            result["id"] = req_id
            _respond(result)
        except Exception as exc:
            err = _http_error(exc)
            err["id"] = req_id
            if err.get("status") != 500 or "HTTPException" in type(exc).__name__:
                _respond(err)
            else:
                _respond(
                    {
                        "id": req_id,
                        "ok": False,
                        "status": 500,
                        "error": str(exc),
                        "trace": traceback.format_exc(),
                    }
                )


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"ok": False, "error": "empty request"}))
        return
    req = json.loads(raw)
    op = req.get("op")
    params = req.get("params") or {}
    if not op:
        print(json.dumps({"ok": False, "error": "missing op"}))
        return
    try:
        api = _load_plugin_api()
        result = dispatch_op(api, op, dict(params))
        print(json.dumps(result, default=str))
    except Exception as exc:
        err = _http_error(exc)
        if err.get("status") != 500 or "HTTPException" in type(exc).__name__:
            print(json.dumps(err))
        else:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "status": 500,
                        "error": str(exc),
                        "trace": traceback.format_exc(),
                    }
                )
            )


if __name__ == "__main__":
    if "--worker" in sys.argv:
        worker_loop()
    else:
        main()
