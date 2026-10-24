const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
function makeId() { return crypto.randomUUID(); }
function isAuthorized(request, env) {
  return !!env.ADMIN_TOKEN && request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}
function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS readers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS recitations (id TEXT PRIMARY KEY, title TEXT NOT NULL, reader_id TEXT DEFAULT '', type TEXT DEFAULT '', url TEXT NOT NULL, notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS duas (id TEXT PRIMARY KEY, title TEXT NOT NULL, text TEXT NOT NULL, source TEXT DEFAULT '', category TEXT DEFAULT '', repetitions INTEGER DEFAULT 1, is_visible INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS content_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT DEFAULT '', type TEXT DEFAULT 'page', url TEXT DEFAULT '', is_visible INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  ]);
}
function boolInt(value, fallback = 1) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}
async function getSetting(db, key, fallback = null) {
  const row = await db.prepare("SELECT value FROM site_settings WHERE key = ?").bind(key).first();
  return row ? parseJson(row.value, fallback) : fallback;
}
async function putSetting(db, key, value) {
  await db.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).bind(key, JSON.stringify(value)).run();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;
    if (path === "/" && method === "GET") return response({ ok: true, service: "QURAA API STAGING", message: "نسخة اختبار مستقلة" });
    if (!path.startsWith("/api/")) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return response({ ok: false, error: "هذا المسار غير متاح في نسخة الاختبار." }, 404);
    }
    if (!env.DB) return response({ ok: false, error: "قاعدة بيانات الاختبار DB غير مربوطة." }, 500);
    try {
      await ensureSchema(env.DB);
      if (path === "/api/health" && method === "GET") return response({ ok: true, service: "QURAA API STAGING", database: "connected" });
      if (path === "/api/auth/check" && method === "GET") {
        if (!env.ADMIN_TOKEN) return response({ ok: false, error: "رمز الإدارة غير مضبوط على Worker الاختبار." }, 503);
        if (!isAuthorized(request, env)) return response({ ok: false, error: "رمز الإدارة غير صحيح." }, 401);
        return response({ ok: true, message: "تم التحقق من صلاحيات الإدارة." });
      }

      // واجهات القراءة العامة: القراء والتلاوات الظاهرة فقط.
      if (path === "/api/readers" && method === "GET") {
        const result = await env.DB.prepare("SELECT * FROM readers ORDER BY name").all();
        return response({ ok: true, readers: result.results || [] });
      }
      if (path === "/api/recitations" && method === "GET") {
        const result = await env.DB.prepare(`SELECT recitations.*, readers.name AS reader_name FROM recitations LEFT JOIN readers ON readers.id=recitations.reader_id ORDER BY recitations.created_at DESC`).all();
        return response({ ok: true, recitations: result.results || [] });
      }
      if (path === "/api/public/dua-reminder" && method === "GET") {
        const settings = await getSetting(env.DB, "dua_reminder", { enabled: false, dua_id: "", size: "medium", position: "bottom-left", interval_hours: 6, auto_hide_seconds: 0 });
        if (!settings.enabled) return response({ ok: true, enabled: false, settings, dua: null });
        let dua = null;
        if (settings.dua_id) dua = await env.DB.prepare("SELECT id,title,text,source,category,repetitions FROM duas WHERE id=? AND is_visible=1").bind(settings.dua_id).first();
        if (!dua) dua = await env.DB.prepare("SELECT id,title,text,source,category,repetitions FROM duas WHERE is_visible=1 ORDER BY RANDOM() LIMIT 1").first();
        return response({ ok: true, enabled: !!dua, settings, dua: dua || null });
      }
      if (path === "/api/duas" && method === "GET" && url.searchParams.get("public") === "1") {
        const result = await env.DB.prepare("SELECT id,title,text,source,category,repetitions FROM duas WHERE is_visible=1 ORDER BY category,title").all();
        return response({ ok: true, duas: result.results || [] });
      }

      // كل ما يلي محمي برمز الإدارة.
      if (!isAuthorized(request, env)) return response({ ok: false, error: "يلزم تسجيل الدخول بصلاحية الإدارة." }, env.ADMIN_TOKEN ? 401 : 503);

      if (path === "/api/readers" && method === "POST") {
        const b = await request.json(); if (!String(b.name || "").trim()) return response({ ok: false, error: "اسم القارئ مطلوب." }, 400);
        const id = b.id || makeId();
        await env.DB.prepare("INSERT INTO readers (id,name,type,notes) VALUES (?,?,?,?)").bind(id, String(b.name).trim(), b.type || "", b.notes || "").run();
        return response({ ok: true, id, message: "تمت إضافة القارئ." }, 201);
      }
      if (path.startsWith("/api/readers/")) {
        const id = decodeURIComponent(path.slice("/api/readers/".length));
        if (method === "DELETE") { await env.DB.prepare("DELETE FROM readers WHERE id=?").bind(id).run(); return response({ ok: true, message: "تم حذف القارئ." }); }
        if (method === "PUT" || method === "PATCH") {
          const b = await request.json(), old = await env.DB.prepare("SELECT * FROM readers WHERE id=?").bind(id).first();
          if (!old) return response({ ok: false, error: "القارئ غير موجود." }, 404);
          await env.DB.prepare("UPDATE readers SET name=?,type=?,notes=? WHERE id=?").bind(b.name ?? old.name, b.type ?? old.type, b.notes ?? old.notes, id).run();
          return response({ ok: true, message: "تم تحديث بيانات القارئ." });
        }
      }
      if (path === "/api/recitations/bulk" && method === "POST") {
        const b = await request.json(), items = Array.isArray(b) ? b : b.recitations;
        if (!Array.isArray(items) || !items.length) return response({ ok: false, error: "أرسل قائمة تلاوات صحيحة." }, 400);
        if (items.length > 200) return response({ ok: false, error: "الحد الأقصى 200 تلاوة في الطلب الواحد." }, 400);
        const statements = [];
        for (const item of items) {
          if (!item.title || !item.url) return response({ ok: false, error: "كل تلاوة تحتاج إلى عنوان ورابط." }, 400);
          statements.push(env.DB.prepare(`INSERT INTO recitations (id,title,reader_id,type,url,notes) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,reader_id=excluded.reader_id,type=excluded.type,url=excluded.url,notes=excluded.notes`).bind(item.id || makeId(), String(item.title), item.reader_id || "", item.type || "", String(item.url), item.notes || ""));
        }
        await env.DB.batch(statements); return response({ ok: true, imported: statements.length, message: "تم استيراد التلاوات." });
      }
      if (path === "/api/recitations" && method === "POST") {
        const b = await request.json(); if (!b.title || !b.url) return response({ ok: false, error: "عنوان التلاوة ورابطها مطلوبان." }, 400);
        const id = b.id || makeId(); await env.DB.prepare("INSERT INTO recitations (id,title,reader_id,type,url,notes) VALUES (?,?,?,?,?,?)").bind(id, String(b.title), b.reader_id || "", b.type || "", String(b.url), b.notes || "").run();
        return response({ ok: true, id, message: "تمت إضافة التلاوة." }, 201);
      }
      if (path.startsWith("/api/recitations/")) {
        const id = decodeURIComponent(path.slice("/api/recitations/".length));
        if (method === "DELETE") { await env.DB.prepare("DELETE FROM recitations WHERE id=?").bind(id).run(); return response({ ok: true, message: "تم حذف التلاوة." }); }
        if (method === "PUT" || method === "PATCH") {
          const b = await request.json(), old = await env.DB.prepare("SELECT * FROM recitations WHERE id=?").bind(id).first();
          if (!old) return response({ ok: false, error: "التلاوة غير موجودة." }, 404);
          await env.DB.prepare("UPDATE recitations SET title=?,reader_id=?,type=?,url=?,notes=? WHERE id=?").bind(b.title ?? old.title, b.reader_id ?? old.reader_id, b.type ?? old.type, b.url ?? old.url, b.notes ?? old.notes, id).run();
          return response({ ok: true, message: "تم تحديث التلاوة." });
        }
      }

      // إدارة الأدعية: حقول مستقلة وليست JSON مخزنًا من الواجهة.
      if (path === "/api/duas" && method === "GET") {
        const result = await env.DB.prepare("SELECT * FROM duas ORDER BY updated_at DESC, title").all(); return response({ ok: true, duas: result.results || [] });
      }
      if (path === "/api/duas" && method === "POST") {
        const b = await request.json(); if (!String(b.title || "").trim() || !String(b.text || "").trim()) return response({ ok: false, error: "عنوان الدعاء ونصه مطلوبان." }, 400);
        const id = b.id || makeId(); await env.DB.prepare("INSERT INTO duas (id,title,text,source,category,repetitions,is_visible) VALUES (?,?,?,?,?,?,?)").bind(id, String(b.title).trim(), String(b.text).trim(), b.source || "", b.category || "عام", Math.max(1, Number(b.repetitions) || 1), boolInt(b.is_visible, 1)).run();
        return response({ ok: true, id, message: "تم حفظ الدعاء." }, 201);
      }
      if (path.startsWith("/api/duas/")) {
        const id = decodeURIComponent(path.slice("/api/duas/".length));
        if (method === "DELETE") { await env.DB.prepare("DELETE FROM duas WHERE id=?").bind(id).run(); return response({ ok: true, message: "تم حذف الدعاء." }); }
        if (method === "PUT" || method === "PATCH") {
          const b = await request.json(), old = await env.DB.prepare("SELECT * FROM duas WHERE id=?").bind(id).first(); if (!old) return response({ ok: false, error: "الدعاء غير موجود." }, 404);
          await env.DB.prepare("UPDATE duas SET title=?,text=?,source=?,category=?,repetitions=?,is_visible=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.title ?? old.title, b.text ?? old.text, b.source ?? old.source, b.category ?? old.category, Math.max(1, Number(b.repetitions ?? old.repetitions) || 1), boolInt(b.is_visible, old.is_visible), id).run();
          return response({ ok: true, message: "تم تحديث الدعاء." });
        }
      }

      // إدارة محتوى عام بسيط (صفحات/روابط/عناصر).
      if (path === "/api/content" && method === "GET") {
        const result = await env.DB.prepare("SELECT * FROM content_items ORDER BY sort_order,title").all(); return response({ ok: true, content: result.results || [], items: result.results || [] });
      }
      if (path === "/api/content" && method === "POST") {
        const b = await request.json(); if (!String(b.title || "").trim()) return response({ ok: false, error: "عنوان المحتوى مطلوب." }, 400);
        const id = b.id || makeId(); await env.DB.prepare("INSERT INTO content_items (id,title,content,type,url,is_visible,sort_order) VALUES (?,?,?,?,?,?,?)").bind(id, String(b.title).trim(), b.content || "", b.type || "page", b.url || "", boolInt(b.is_visible, 1), Number(b.sort_order) || 0).run(); return response({ ok: true, id, message: "تمت إضافة المحتوى." }, 201);
      }
      if (path.startsWith("/api/content/")) {
        const id = decodeURIComponent(path.slice("/api/content/".length));
        if (method === "DELETE") { await env.DB.prepare("DELETE FROM content_items WHERE id=?").bind(id).run(); return response({ ok: true, message: "تم حذف المحتوى." }); }
        if (["PUT", "PATCH"].includes(method)) {
          const b = await request.json(), old = await env.DB.prepare("SELECT * FROM content_items WHERE id=?").bind(id).first(); if (!old) return response({ ok: false, error: "عنصر المحتوى غير موجود." }, 404);
          await env.DB.prepare("UPDATE content_items SET title=?,content=?,type=?,url=?,is_visible=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.title ?? old.title, b.content ?? old.content, b.type ?? old.type, b.url ?? old.url, boolInt(b.is_visible, old.is_visible), Number(b.sort_order ?? old.sort_order) || 0, id).run(); return response({ ok: true, message: "تم تحديث المحتوى." });
        }
      }

      // إعدادات بطاقة تذكير الدعاء.
      if (path === "/api/dua-reminder" && method === "GET") {
        return response({ ok: true, settings: await getSetting(env.DB, "dua_reminder", { enabled: false, dua_id: "", size: "medium", position: "bottom-left", interval_hours: 6, auto_hide_seconds: 0 }) });
      }
      if (path === "/api/dua-reminder" && ["PUT", "POST", "PATCH"].includes(method)) {
        const b = await request.json();
        const settings = {
          enabled: !!b.enabled,
          dua_id: String(b.dua_id || ""),
          size: ["small", "medium", "large"].includes(b.size) ? b.size : "medium",
          position: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(b.position) ? b.position : "bottom-left",
          interval_hours: Math.min(168, Math.max(1, Number(b.interval_hours) || 6)),
          auto_hide_seconds: Math.min(3600, Math.max(0, Number(b.auto_hide_seconds) || 0))
        };
        if (settings.dua_id) { const d = await env.DB.prepare("SELECT id FROM duas WHERE id=?").bind(settings.dua_id).first(); if (!d) return response({ ok: false, error: "الدعاء المحدد غير موجود؛ اختر دعاءً محفوظًا." }, 400); }
        await putSetting(env.DB, "dua_reminder", settings); return response({ ok: true, settings, message: "تم حفظ إعدادات بطاقة الدعاء." });
      }

      return response({ ok: false, error: "المسار أو طريقة الطلب غير مدعومين." }, 404);
    } catch (error) {
      console.error("QURAA API STAGING error:", error);
      return response({ ok: false, error: "حدث خطأ أثناء تنفيذ الطلب." }, 500);
    }
  }
};
