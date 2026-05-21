/**
 * Read Hermes model config and curated model lists via the installed Hermes Python env.
 * The gateway /v1/models endpoint only advertises "hermes-agent"; real model/provider
 * live in ~/.hermes/config.yaml and hermes_cli.inventory.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERMES_HOME = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes');
const HERMES_AGENT_ROOT = process.env.HERMES_AGENT_ROOT || path.join(HERMES_HOME, 'hermes-agent');

function resolveHermesPythonBin() {
  const candidates = [
    process.env.HERMES_PYTHON,
    path.join(HERMES_AGENT_ROOT, 'venv', 'bin', 'python'),
    path.join(HERMES_AGENT_ROOT, 'venv', 'bin', 'python3'),
    'python3',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) return candidate;
      if (!candidate.includes(path.sep)) return candidate;
    } catch {
      /* continue */
    }
  }
  return 'python3';
}

function hermesPythonEnv() {
  return {
    ...process.env,
    HERMES_HOME,
    PYTHONPATH: [HERMES_AGENT_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
}

function runHermesPython(code, timeoutMs = 20000) {
  const python = resolveHermesPythonBin();
  const stdout = execFileSync(
    python,
    ['-c', code],
    {
      cwd: HERMES_AGENT_ROOT,
      timeout: timeoutMs,
      encoding: 'utf-8',
      env: hermesPythonEnv(),
      maxBuffer: 1024 * 1024 * 4,
    }
  );
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function readHermesConfigModel() {
  try {
    return runHermesPython(`
import json
from hermes_cli.config import load_config
cfg = load_config()
model_cfg = cfg.get("model", {})
if isinstance(model_cfg, dict):
    model = model_cfg.get("default") or model_cfg.get("name") or ""
    provider = model_cfg.get("provider") or ""
else:
    model = str(model_cfg or "")
    provider = ""
print(json.dumps({"model": model, "provider": provider}))
`, 8000);
  } catch (e) {
    return { model: '', provider: '', error: e.message };
  }
}

function fetchHermesModelOptionsViaPython(maxModels = 50) {
  return runHermesPython(`
import json
from hermes_cli.inventory import build_models_payload, load_picker_context
payload = build_models_payload(
    load_picker_context(),
    include_unconfigured=True,
    picker_hints=True,
    canonical_order=True,
    max_models=${Number(maxModels) || 50},
)
print(json.dumps(payload))
`);
}

function applyHermesModelSwitch(provider, model, persistGlobal = true) {
  const safeProvider = JSON.stringify(String(provider || ''));
  const safeModel = JSON.stringify(String(model || ''));
  const result = runHermesPython(`
import json
from hermes_cli.inventory import load_picker_context
from hermes_cli.model_switch import switch_model
from hermes_cli.config import load_config, save_config

provider = ${safeProvider}
model = ${safeModel}
persist_global = ${persistGlobal ? 'True' : 'False'}
ctx = load_picker_context()
result = switch_model(
    raw_input=model,
    current_provider=ctx.current_provider or "",
    current_model=ctx.current_model or "",
    current_base_url=ctx.current_base_url or "",
    current_api_key="",
    is_global=persist_global,
    explicit_provider=provider,
    user_providers=ctx.user_providers,
    custom_providers=ctx.custom_providers,
)
if not result.success:
    print(json.dumps({"ok": False, "error": result.error_message or "model switch failed"}))
else:
    if persist_global:
        cfg = load_config()
        model_cfg = cfg.get("model")
        if not isinstance(model_cfg, dict):
            model_cfg = {}
        model_cfg["default"] = result.new_model
        model_cfg["provider"] = result.target_provider
        if result.base_url:
            model_cfg["base_url"] = result.base_url
        elif model_cfg.get("base_url"):
            model_cfg["base_url"] = ""
        model_cfg.pop("context_length", None)
        cfg["model"] = model_cfg
        save_config(cfg)

    saved = load_config()
    saved_model_cfg = saved.get("model", {})
    saved_model = ""
    saved_provider = ""
    if isinstance(saved_model_cfg, dict):
        saved_model = saved_model_cfg.get("default") or saved_model_cfg.get("name") or ""
        saved_provider = saved_model_cfg.get("provider") or ""
    else:
        saved_model = str(saved_model_cfg or "")

    print(json.dumps({
        "ok": True,
        "model": saved_model or result.new_model,
        "provider": saved_provider or result.target_provider,
        "warning": result.warning_message or "",
        "persisted": bool(persist_global),
    }))
`, 30000);

  if (!result?.ok) {
    const err = new Error(result?.error || 'Hermes model switch failed');
    throw err;
  }
  return result;
}

/** @deprecated use applyHermesModelSwitch */
function setHermesConfigModel(provider, model) {
  return applyHermesModelSwitch(provider, model, true);
}

module.exports = {
  readHermesConfigModel,
  fetchHermesModelOptionsViaPython,
  applyHermesModelSwitch,
  setHermesConfigModel,
};
