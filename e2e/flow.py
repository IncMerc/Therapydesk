# basic UI flow. needs api on :8000 + vite on :5173, empty db
import re, json
from playwright.sync_api import sync_playwright, expect

def signup(pg, name, email):
    pg.get_by_role("button", name="New here? Create an account").click()
    pg.get_by_label("Your name").fill(name)
    pg.get_by_label("Email").fill(email)
    pg.get_by_label("Password").fill("a-long-password-1")
    pg.get_by_role("button", name="Create account").click()
    expect(pg.get_by_text(name)).to_be_visible()

def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => {
      const r = await fetch('/api' + p, {method: m, headers: {'Content-Type': 'application/json',
        Authorization: 'Bearer ' + localStorage.getItem('therapydesk.token')}, body: b ? JSON.stringify(b) : undefined});
      return r.json(); }""", [method, path, body])

def schedule(pg, date):
    pg.get_by_role("button", name="Sessions").click()
    pg.get_by_role("button", name=re.compile("Schedule Session")).first.click()
    form = pg.locator("form").last
    sel = form.locator("select").first
    sel.select_option(label=[o for o in sel.locator("option").all_inner_texts() if "Asha" in o][0])
    form.locator("input[type=date]").fill(date)
    form.locator("input[type=time]").fill("18:30")
    pg.get_by_role("button", name="Schedule", exact=True).click()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:5173")
    signup(pg, "Dr Meera Rao", "meera@example.com")

    # 1. a failed save keeps the modal open, shows the reason, and keeps what was typed
    pg.route("**/api/clients", lambda r: r.fulfill(status=500, content_type="application/json", body=json.dumps({"detail": "Database is unavailable"})))
    pg.get_by_role("button", name="Clients").click()
    pg.get_by_role("button", name=re.compile("Add Client")).first.click()
    pg.get_by_role("button", name=re.compile("Forms Completed")).click()
    pg.get_by_placeholder("Enter client name").fill("Asha Kulkarni")
    pg.get_by_role("button", name="Add Client").last.click()
    expect(pg.get_by_role("alert")).to_have_text("Database is unavailable")
    expect(pg.get_by_placeholder("Enter client name")).to_have_value("Asha Kulkarni")
    print("1 modal error kept form: ok")
    pg.unroute("**/api/clients")
    pg.get_by_role("button", name="Add Client").last.click()
    expect(pg.get_by_text("Asha Kulkarni").first).to_be_visible()

    # 2. one prepaid credit, then schedule -> confirmation screen survives the state refresh
    cid = api(pg, "GET", "/state")["clients"][0]["id"]
    api(pg, "POST", "/payments", {"clientId": cid, "amount": 999, "type": "prepaid", "prepaidSessions": 1})
    pg.reload()
    schedule(pg, "2026-10-20")
    expect(pg.get_by_text("Session Scheduled!")).to_be_visible()
    expect(pg.get_by_text("No link yet. Add one from the Sessions page.")).to_be_visible()
    pg.screenshot(path="/tmp/5_confirmation.png")
    pg.get_by_role("button", name="Skip").click()
    print("2 confirmation screen: ok")

    # 3. mark done spends the credit -> Prepaid; second session has no credit -> unpaid -> toggle Paid
    pg.get_by_role("button", name="Mark done").first.click()
    expect(pg.get_by_text("Prepaid", exact=True)).to_be_visible()
    schedule(pg, "2026-10-27"); pg.get_by_role("button", name="Skip").click()
    pg.get_by_role("button", name="Mark done").first.click()
    unpaid = pg.locator("button", has_text=re.compile("Unpaid|Mark paid|Due", re.I)).first
    unpaid.click()
    pg.reload(); pg.get_by_role("button", name="Sessions").click()
    expect(pg.get_by_text("Paid", exact=True)).to_be_visible()
    st = api(pg, "GET", "/state")
    assert st["credits"] == {} and sorted(s["prepaid"] for s in st["sessions"]) == [False, True] and all(s["paid"] for s in st["sessions"])
    assert [p["type"] for p in st["payments"]] == ["prepaid", "session"]
    pg.screenshot(path="/tmp/6_sessions.png")
    print("3 credits + payments persisted: ok")

    # 4. another therapist sees none of it
    pg.get_by_role("button", name="Sign out").click()
    signup(pg, "Dr Bob Iyer", "bob@example.com")
    pg.get_by_role("button", name="Clients").click()
    expect(pg.get_by_text("Asha Kulkarni")).to_have_count(0)
    assert api(pg, "GET", "/state")["clients"] == []
    print("4 isolation in UI: ok")
    print("page errors:", errors)
    b.close()
