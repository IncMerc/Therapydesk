# two-browser call + recording. needs livekit, api (RECORDINGS_DIR=/tmp/rec-e2e), vite
import datetime, re, glob, os, time, subprocess
from playwright.sync_api import sync_playwright, expect

REC = "/tmp/rec-e2e"
def chunks(speaker=None):
    return sorted(glob.glob(f"{REC}/*/*/{speaker or '*'}/*/*.chunk"))

def api(pg, method, path, body=None):
    return pg.evaluate("""async ([m, p, b]) => {
      const r = await fetch('/api' + p, {method: m, headers: {'Content-Type': 'application/json',
        Authorization: 'Bearer ' + localStorage.getItem('therapydesk.token')}, body: b ? JSON.stringify(b) : undefined});
      return r.json(); }""", [method, path, body])

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    errs = []
    t = b.new_context(viewport={"width": 1280, "height": 800}, permissions=["camera", "microphone", "clipboard-read", "clipboard-write"]).new_page()
    c = b.new_context(viewport={"width": 390, "height": 780}, permissions=["camera", "microphone"]).new_page()  # client on a phone-sized screen
    for pg, who in ((t, "therapist"), (c, "client")):
        pg.on("pageerror", lambda e, who=who: errs.append(f"{who}: {e}"))
        pg.on("dialog", lambda d: d.accept())

    # therapist: sign up, client, session today
    t.goto("http://localhost:5173")
    t.get_by_role("button", name="New here? Create an account").click()
    t.get_by_label("Your name").fill("Dr Meera Rao"); t.get_by_label("Email").fill("meera@example.com")
    t.get_by_label("Password").fill("a-long-password-1"); t.get_by_role("button", name="Create account").click()
    expect(t.get_by_text("Dr Meera Rao")).to_be_visible()
    api(t, "POST", "/clients", {"name": "Asha Kulkarni", "clientType": "professional"})
    cid = api(t, "GET", "/state")["clients"][0]["id"]
    today = datetime.date.today().isoformat()
    api(t, "POST", "/sessions", {"clientId": cid, "date": today, "time": "23:00"})
    t.reload(); t.get_by_role("button", name="Sessions").click()

    # copy client link from the row menu
    t.locator("button:has(svg.lucide-ellipsis-vertical), button:has(svg.lucide-more-vertical)").first.click()
    t.get_by_role("button", name="Copy client join link").click()
    expect(t.get_by_role("button", name="Link copied")).to_be_visible()
    link = t.evaluate("navigator.clipboard.readText()")
    assert "/join/" in link, link
    print("1 client link copied:", link)

    # therapist starts, consents, joins
    t.get_by_role("button", name="Start").click()
    expect(t.get_by_text("Session with Asha Kulkarni")).to_be_visible()
    t.get_by_role("checkbox").check()
    t.get_by_role("button", name="Join session").click()
    expect(t.get_by_text("Waiting for Asha to join…")).to_be_visible(timeout=15000)
    expect(t.get_by_role("status")).to_have_text("Recording starts when Asha agrees")
    print("2 therapist in room, waiting")

    # client opens link (no account), sees details, joins WITHOUT consenting first
    c.goto(link)
    expect(c.get_by_text("Session with Dr Meera Rao")).to_be_visible()
    expect(c.get_by_text(re.compile("Hi Asha"))).to_be_visible()
    c.get_by_role("button", name="Join session").click()
    expect(c.get_by_role("status")).to_contain_text("Dr Meera Rao agreed to recording", timeout=15000)

    # both see each other's video
    for pg in (t, c):
        pg.wait_for_function("() => [...document.querySelectorAll('video')][0].videoWidth > 0", timeout=20000)
    print("3 both connected, remote video flowing both ways")
    time.sleep(6)
    assert chunks() == [], "nothing must be recorded before the client agrees"
    print("4 no audio stored before both consented")

    # client allows recording from inside the call
    c.get_by_role("button", name="Allow recording").click()
    expect(c.get_by_role("status")).to_have_text("Recording audio for session notes")
    expect(t.get_by_role("status")).to_have_text("Recording audio for session notes", timeout=10000)
    time.sleep(12)
    nt, nc = len(chunks("therapist")), len(chunks("client"))
    assert nt >= 2 and nc >= 2, (nt, nc)
    head = open(chunks("client")[0], "rb").read(4)
    assert head == b"\x1aE\xdf\xa3", head  # WebM/EBML magic: a real, playable audio file starts here
    print(f"5 recording: {nt} therapist chunks, {nc} client chunks, valid WebM")
    t.screenshot(path="/tmp/v_therapist.png"); c.screenshot(path="/tmp/v_client.png")

    # client withdraws -> everything deleted, therapist sees it
    c.get_by_role("button", name="Stop recording").click()
    expect(c.get_by_role("status")).to_contain_text("Dr Meera Rao agreed to recording")
    expect(t.get_by_role("status")).to_have_text("Recording starts when Asha agrees", timeout=10000)
    time.sleep(6)
    assert chunks() == [], chunks()
    print("6 client stopped recording: all audio deleted, nothing new stored")

    # leave
    c.get_by_role("button", name="Leave session").click()
    expect(c.get_by_text("You left the session")).to_be_visible()
    expect(t.get_by_text("Waiting for Asha to join…")).to_be_visible(timeout=15000)
    t.get_by_role("button", name="Leave session").click()
    expect(t.get_by_role("heading", name="Sessions")).to_be_visible()
    print("7 both left cleanly")
    print("page errors:", errs)
    b.close()
