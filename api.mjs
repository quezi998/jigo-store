import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ST = ["new", "confirmed", "ready", "done", "cancelled"], ACT = ["new", "confirmed", "ready"];
const COL = ["pink", "lavender", "mint", "yellow"];
const store = () => getStore({ name: "jigo", consistency: "strong" });
const seed = () => [["pink", "Розовая", 6], ["lavender", "Лаванда", 6], ["mint", "Мятная", 5], ["yellow", "Жёлтая", 5]]
  .map(([c, n, s], i) => ({ id: c, color: c, name: "JIGO " + n, price: 1500, stock: s, active: true, ts: i }));
const load = async () => (await store().get("db", { type: "json" })) || { products: seed(), orders: [] };
const save = (d) => store().setJSON("db", d);
const pw = () => process.env.ADMIN_PASSWORD || "";
const sign = (p) => crypto.createHmac("sha256", "jigo:" + pw()).update(p).digest("hex");
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const authed = (req) => { if (!pw()) return false; const [e, s] = (req.headers.get("authorization") || "").replace("Bearer ", "").split("."); return !!(e && s && +e > Date.now() && eq(s, sign(e))); };
const reserved = (d, id) => d.orders.filter(o => ACT.includes(o.status)).reduce((a, o) => a + o.items.filter(i => i.pid === id).reduce((s, i) => s + i.qty, 0), 0);
const pub = (d) => d.products.map(p => ({ ...p, reserved: reserved(d, p.id) }));
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const int = (v) => Math.max(0, Math.min(1e6, Math.floor(+v || 0)));
const mkcode = () => { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return "JG-" + [...crypto.randomBytes(6)].map(b => A[b % 32]).join(""); };

export default async (req) => {
  const r = new URL(req.url).pathname.replace(/^\/api\//, "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  try {
    if (r === "state") return J({ products: pub(await load()) });
    if (r === "login") {
      await new Promise(f => setTimeout(f, 600));
      if (!pw()) return J({ error: "Пароль владельца не задан на сервере" }, 500);
      if (!eq(str(body.password, 200), pw())) return J({ error: "Неверный пароль" }, 401);
      const e = String(Date.now() + 12 * 3600e3); return J({ token: e + "." + sign(e) });
    }
    if (r === "reserve") {
      const d = await load(), name = str(body.name, 80), phone = str(body.phone, 30);
      if (name.length < 2 || phone.replace(/\D/g, "").length < 6) return J({ error: "Укажите имя и телефон" }, 400);
      const items = []; let total = 0;
      for (const i of (Array.isArray(body.items) ? body.items : []).slice(0, 20)) {
        const p = d.products.find(x => x.id === i.pid), q = int(i.qty);
        if (!p || p.active === false || q < 1 || q > p.stock - reserved(d, p.id)) return J({ error: "Недостаточно остатка: " + (p ? p.name : "товар") }, 409);
        items.push({ pid: p.id, name: p.name, qty: q, price: p.price }); total += q * p.price;
      }
      if (!items.length) return J({ error: "Корзина пуста" }, 400);
      let code; do { code = mkcode(); } while (d.orders.some(o => o.code === code));
      d.orders.push({ code, name, phone, comment: str(body.comment, 300), items, total, status: "new", ts: Date.now() });
      await save(d); return J({ code });
    }
    if (!authed(req)) return J({ error: "Нет доступа" }, 401);
    const d = await load();
    if (r === "orders") return J(d.orders);
    if (r === "status") {
      const o = d.orders.find(x => x.code === body.code);
      if (!o || !ST.includes(body.status)) return J({ error: "Неверные данные" }, 400);
      const was = o.status === "done", now = body.status === "done";
      if (was !== now) for (const i of o.items) { const p = d.products.find(x => x.id === i.pid); if (p) p.stock = Math.max(0, p.stock + (now ? -i.qty : i.qty)); }
      o.status = body.status; await save(d); return J({ ok: 1 });
    }
    if (r === "product") {
      const x = body.product || {};
      if (body.op === "delete") d.products = d.products.filter(p => p.id !== x.id);
      else {
        let p = d.products.find(q => q.id === x.id);
        if (!p) { p = { id: crypto.randomBytes(5).toString("hex"), color: "pink", name: "JIGO", price: 1500, stock: 0, active: true, ts: Date.now() }; d.products.push(p); }
        if ("name" in x) p.name = str(x.name, 80) || p.name;
        if ("color" in x && COL.includes(x.color)) p.color = x.color;
        if ("price" in x) p.price = int(x.price);
        if ("stock" in x) p.stock = int(x.stock);
        if ("active" in x) p.active = !!x.active;
      }
      await save(d); return J({ ok: 1 });
    }
    return J({ error: "Не найдено" }, 404);
  } catch (e) { return J({ error: "Ошибка сервера" }, 500); }
};
export const config = { path: "/api/*" };
