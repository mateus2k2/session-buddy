import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../context/AppContext";

const PRIVATE_STORE = "firefox-private";

interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  storeId?: string;
  firstPartyDomain?: string;
  hostOnly?: boolean;
  session?: boolean;
}

function cookieUrl(c: BrowserCookie) {
  return `http${c.secure ? "s" : ""}://${c.domain.replace(/^\./, "")}${c.path}`;
}

async function getPrivateCookies(): Promise<BrowserCookie[]> {
  try { return await browser.cookies.getAll({ storeId: PRIVATE_STORE }) as BrowserCookie[]; }
  catch { return []; }
}

async function removeCookie(c: BrowserCookie) {
  return browser.cookies.remove({
    url: cookieUrl(c),
    name: c.name,
    storeId: c.storeId,
    firstPartyDomain: c.firstPartyDomain ?? "",
  }).catch(() => {});
}

async function clearPrivateCookies(): Promise<number> {
  const list = await getPrivateCookies();
  await Promise.all(list.map(removeCookie));
  return list.length;
}

async function clearDomainCookies(domain: string): Promise<number> {
  const list = await getPrivateCookies();
  const match = list.filter(c => c.domain.replace(/^\./, "").toLowerCase().includes(domain.toLowerCase()));
  await Promise.all(match.map(removeCookie));
  return match.length;
}

async function exportCookiesJson(includeTabs: boolean) {
  const cookies = await getPrivateCookies();
  const payload: Record<string, unknown> = { cookies };
  if (includeTabs && typeof browser.windows !== "undefined") {
    const allWindows = await browser.windows.getAll({ populate: true });
    payload.tabs = allWindows
      .filter(w => w.incognito)
      .flatMap(w => (w.tabs ?? []).map(t => t.url))
      .filter((url): url is string => !!url && !url.startsWith("about:") && !url.startsWith("moz-extension:"));
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename: "private-cookies.json", saveAs: true });
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.download = "private-cookies.json";
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function CookieView() {
  const { showModal, hideModal, toast } = useApp();
  const [cookies, setCookies] = useState<BrowserCookie[]>([]);
  const [privOpen, setPrivOpen] = useState(false);
  const [incogAllowed, setIncogAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [includeTabs, setIncludeTabs] = useState(true);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [isPriv, allowed, cookieList] = await Promise.all([
        (async () => {
          if (typeof browser.windows === "undefined") return false;
          const windows = await browser.windows.getAll();
          return windows.some(w => w.incognito);
        })(),
        browser.extension.isAllowedIncognitoAccess().catch(() => false),
        getPrivateCookies(),
      ]);
      setPrivOpen(isPriv);
      setIncogAllowed(allowed);
      setCookies(cookieList);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);
  useEffect(() => {
    browser.storage.local.get("cookieIncludeTabs").then(r => {
      setIncludeTabs((r as Record<string, boolean>).cookieIncludeTabs ?? true);
    }).catch(() => {});
  }, []);

  function handleClearAll() {
    showModal(
      "Clear all cookies",
      `<p>Delete all ${cookies.length} private window cookie${cookies.length !== 1 ? "s" : ""}? This cannot be undone.</p>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Clear All", cls: "btn-danger", action: async () => {
            hideModal();
            const n = await clearPrivateCookies();
            toast(`Cleared ${n} cookie${n !== 1 ? "s" : ""}`);
            void fetchData();
          }
        },
      ]
    );
  }

  async function handleClearDomain(domain: string) {
    const n = await clearDomainCookies(domain);
    toast(`Cleared ${n} cookie${n !== 1 ? "s" : ""} for ${domain}`);
    void fetchData();
  }

  async function handleImport(file: File) {
    let data: Record<string, unknown>;
    try { data = JSON.parse(await file.text()); }
    catch { toast("Invalid JSON"); return; }

    const list = Array.isArray(data) ? data : ((data.cookies as BrowserCookie[]) || []);
    await clearPrivateCookies();

    let ok = 0, fail = 0;
    for (const raw of list) {
      const c = { ...raw, storeId: PRIVATE_STORE } as BrowserCookie;
      delete (c as Record<string, unknown>).hostOnly;
      delete (c as Record<string, unknown>).session;
      if (c.sameSite === "unspecified") c.sameSite = "no_restriction";
      try {
        await browser.cookies.set({ url: cookieUrl(c), ...c });
        ok++;
      } catch { fail++; }
    }

    if (data.tabs && Array.isArray(data.tabs) && data.tabs.length > 0 && typeof browser.windows !== "undefined") {
      try {
        const allWindows = await browser.windows.getAll();
        const existing = allWindows.find(w => w.incognito);
        const windowId = existing
          ? existing.id!
          : (await browser.windows.create({ incognito: true })).id!;
        for (const url of data.tabs as string[]) {
          await browser.tabs.create({ windowId, url });
        }
      } catch (e) {
        console.warn("[tabkeeper] Could not restore private tabs", e);
      }
    }

    toast(`Restored ${ok} cookie${ok !== 1 ? "s" : ""}${fail ? `, ${fail} failed` : ""}`);
    void fetchData();
  }

  // Group by domain
  const byDomain: Record<string, BrowserCookie[]> = {};
  for (const c of cookies) {
    const d = c.domain.replace(/^\./, "");
    (byDomain[d] = byDomain[d] || []).push(c);
  }
  const domains = Object.keys(byDomain).sort();
  const filteredDomains = filterQuery
    ? domains.filter(d => d.toLowerCase().includes(filterQuery.toLowerCase()))
    : domains;

  const sub = `${cookies.length} cookie${cookies.length !== 1 ? "s" : ""} · ${domains.length} domain${domains.length !== 1 ? "s" : ""}`;

  return (
    <>
      <div className="content-header">
        <div className="content-header-info">
          <div className="content-header-title">Private Window Cookies</div>
          <div className="content-header-sub">{loading ? "" : sub}</div>
        </div>
        <div className="content-header-buttons" />
      </div>

      <div className="content-area">
        {loading ? (
          <div className="empty-state"><p>Loading…</p></div>
        ) : !incogAllowed ? (
          <div className="cookie-warning">
            <strong>Private window access disabled</strong>
            Go to Firefox → Add-ons → TabKeeper → Allow in private windows to use this feature.
          </div>
        ) : (
          <>
            <div className="cookie-actions">
              <button
                className="btn btn-primary"
                disabled={!privOpen || cookies.length === 0}
                onClick={() => void exportCookiesJson(includeTabs)}
              >
                Export JSON
              </button>
              <button
                className="btn btn-ghost"
                disabled={!privOpen}
                onClick={() => fileRef.current?.click()}
              >
                Import JSON
              </button>
              <button
                className="btn btn-danger"
                disabled={!privOpen || cookies.length === 0}
                onClick={handleClearAll}
              >
                Clear All
              </button>
              <label className="cookie-tabs-label">
                <input
                  type="checkbox"
                  checked={includeTabs}
                  onChange={e => {
                    setIncludeTabs(e.target.checked);
                    void browser.storage.local.set({ cookieIncludeTabs: e.target.checked });
                  }}
                />
                {" "}Include tabs
              </label>
            </div>

            <input
              type="file"
              ref={fileRef}
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleImport(f); e.target.value = ""; }}
            />

            {!privOpen && (
              <div className="cookie-info">
                No private window is currently open. Open one to capture cookies.
              </div>
            )}

            {cookies.length === 0 ? (
              <div className="empty-state"><p>No cookies in private windows</p></div>
            ) : (
              <>
                <div className="cookie-domain-filter">
                  <input
                    type="text"
                    placeholder="Filter by domain…"
                    value={filterQuery}
                    onChange={e => setFilterQuery(e.target.value)}
                  />
                  <button
                    className="btn btn-ghost"
                    onClick={() => { if (filterQuery) void handleClearDomain(filterQuery); }}
                  >
                    Clear domain
                  </button>
                </div>

                <div className="cookie-list">
                  {filteredDomains.map(domain => {
                    const domCookies = byDomain[domain];
                    const isExpanded = expandedDomains.has(domain);
                    return (
                      <div key={domain} className="cookie-domain-group" data-domain={domain}>
                        <div
                          className="cookie-domain-header"
                          onClick={() => setExpandedDomains(prev => {
                            const next = new Set(prev);
                            if (next.has(domain)) next.delete(domain);
                            else next.add(domain);
                            return next;
                          })}
                        >
                          <span className="cookie-domain-name">{domain}</span>
                          <span className="cookie-domain-count">
                            {domCookies.length} cookie{domCookies.length !== 1 ? "s" : ""}
                          </span>
                          <button
                            className="cookie-domain-del"
                            onClick={e => { e.stopPropagation(); void handleClearDomain(domain); }}
                          >
                            Clear
                          </button>
                        </div>
                        {isExpanded && (
                          <div className="cookie-domain-body">
                            {domCookies.map((c, i) => (
                              <div
                                key={i}
                                className="cookie-item"
                                title={`${c.name}${c.httpOnly ? " · httpOnly" : ""}${c.secure ? " · secure" : ""}`}
                              >
                                {c.name || "(unnamed)"}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
