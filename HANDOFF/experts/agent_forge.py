# expert: agent_forge
# description: «Собрать агента» (вкладка Агенты): роль + выбранные умения → в UI-копию агента. Роль universal собирает инструкцию сама; именные роли прошиваются через agent_flash_role. Выбранные сервисы svc_* провижинятся в скоуп агента; подключённые MCP-серверы (mcpx:*) получают mcp_call. Параметры: agent_id, role_id, tools_csv

def agent_forge(agent_id="", role_id="universal", tools_csv="") -> str:
    import json, os, ssl, urllib.request, urllib.error
    def err(m): return json.dumps({"status": "error", "message": m}, ensure_ascii=False)
    agent_id = "" if (not agent_id or str(agent_id).startswith("{{")) else str(agent_id).strip()
    role_id = "universal" if (not role_id or str(role_id).startswith("{{")) else str(role_id).strip()
    tools_csv = "" if (not tools_csv or str(tools_csv).startswith("{{")) else str(tools_csv).strip()
    if not agent_id.startswith("agent_"):
        return err("нужен ID агента-копии (agent_...). Создайте копию базового агента в Extella и вставьте её ID.")

    SVC_DESC = {
        "svc_currency":  "курсы валют и пересчёт сумм (USD, EUR, KZT, RUB и другие)",
        "svc_crypto":    "текущие цены криптовалют",
        "svc_weather":   "погода в любом городе прямо сейчас",
        "svc_translate": "перевод текста между языками",
        "svc_wiki":      "короткая справка по теме из Википедии",
        "svc_github":    "данные о репозитории GitHub (звёзды, язык, описание)",
        "svc_ipgeo":     "страна, город и провайдер по IP-адресу",
        "svc_qr":        "QR-код из ссылки или текста",
    }
    raw = [t.strip() for t in tools_csv.split(",") if t.strip()]
    svc_tools = [t for t in raw if t in SVC_DESC]
    mcpx_keys = [t.split(":", 1)[1] for t in raw if t.startswith("mcpx:") and ":" in t]
    if not svc_tools and not mcpx_keys and role_id == "universal":
        return err("отметьте хотя бы одно умение")

    tok = ""
    try: tok = json.load(open(os.path.expanduser("~/extella_wizard/app/config.json"))).get("auth_token", "")
    except Exception: pass
    if not tok: return err("нет токена (config.json)")
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

    def api(path, payload, aid):
        H = {"Content-Type": "application/json", "X-Auth-Token": tok, "X-Profile-Id": "default", "X-Agent-Id": aid}
        req = urllib.request.Request("https://api.extella.ai" + path, data=json.dumps(payload).encode(), headers=H)
        try:
            return json.loads(urllib.request.urlopen(req, timeout=60, context=ctx).read())
        except urllib.error.HTTPError as he:
            return {"_http": he.code}
        except Exception as e:
            return {"_err": str(e)[:100]}

    role_name = "Универсальный помощник"
    if role_id != "universal":
        # Именная роль: инструкцию и её сервисы прошивает проверенный agent_flash_role.
        fr = api("/api/expert/run", {"name": "agent_flash_role", "params": {"agent_id": agent_id, "role_id": role_id}, "global": True}, "agent_extella_default")
        out = fr.get("result") or fr.get("output") or fr
        if isinstance(out, str):
            try: out = json.loads(out)
            except Exception: pass
        if not (isinstance(out, dict) and out.get("status") == "success"):
            m = (isinstance(out, dict) and out.get("message")) or "не удалось назначить роль"
            return err(m)
        role_name = out.get("name") or role_id
    else:
        lines = ["- " + SVC_DESC[t] for t in svc_tools]
        if mcpx_keys:
            lines.append("- вызов инструментов подключённых MCP-серверов (" + ", ".join(mcpx_keys) + ") через эксперта mcp_call")
        instruction = (
            "Ты — универсальный AI-помощник на платформе Extella (модель Qwen). "
            "Помогаешь по-русски: деловым, спокойным и уважительным тоном, без воды и выдумок.\n\n"
            "У тебя подключены живые инструменты (эксперты). Когда вопрос касается их области — "
            "вызывай эксперта и отвечай по его данным, а не по памяти:\n" + "\n".join(lines) + "\n\n"
            "Если данных не хватает или инструмент не отвечает — честно скажи об этом и предложи, "
            "что уточнить. Не придумывай цифры и факты."
        )
        upd = api("/api/agent/update", {"agent_id": agent_id, "instructions": instruction}, "agent_extella_default")
        if isinstance(upd, dict) and upd.get("_http") == 404:
            return err("агент с таким ID не найден — проверьте ID копии агента")
        if isinstance(upd, dict) and (upd.get("_err") or upd.get("_http")):
            return err("не удалось настроить агента (" + str(upd.get("_err") or upd.get("_http")) + ")")

    prov = 0
    to_copy = list(svc_tools)
    if mcpx_keys: to_copy.append("mcp_call")
    for nm in to_copy:
        g = api("/api/expert/get", {"name": nm}, "agent_extella_default")
        code = g.get("expert_code") if isinstance(g, dict) else None
        if not code: continue
        sv = api("/api/expert/save", {"name": nm, "description": g.get("expert_description", nm), "code": code, "kwargs": {}, "cspl": "fython"}, agent_id)
        if isinstance(sv, dict) and sv.get("status") == "success": prov += 1
    return json.dumps({"status": "success", "agent_id": agent_id, "role": role_name, "tools": prov}, ensure_ascii=False)
