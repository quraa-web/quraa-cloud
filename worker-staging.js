const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS readers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS recitations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        reader_id TEXT DEFAULT '',
        type TEXT DEFAULT '',
        url TEXT NOT NULL,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  ]);
}

function isAuthorized(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;

  return request.headers.get("Authorization") === `Bearer ${token}`;
}

function makeId() {
  return crypto.randomUUID();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (path === "/" && method === "GET") {
      return response({
        ok: true,
        service: "QURAA API STAGING",
        message: "نسخة اختبار مستقلة"
      });
    }

    if (!path.startsWith("/api/")) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return response({
        ok: false,
        error: "هذا المسار غير متاح في نسخة الاختبار."
      }, 404);
    }

    if (!env.DB) {
      return response({
        ok: false,
        error: "قاعدة بيانات الاختبار DB غير مربوطة."
      }, 500);
    }

    try {
      await ensureSchema(env.DB);

      if (path === "/api/health" && method === "GET") {
        return response({
          ok: true,
          service: "QURAA API STAGING",
          database: "connected"
        });
      }

      if (path === "/api/readers" && method === "GET") {
        const result = await env.DB.prepare(
          "SELECT * FROM readers ORDER BY name"
        ).all();

        return response({
          ok: true,
          readers: result.results
        });
      }

      if (path === "/api/recitations" && method === "GET") {
        const result = await env.DB.prepare(`
          SELECT recitations.*, readers.name AS reader_name
          FROM recitations
          LEFT JOIN readers ON readers.id = recitations.reader_id
          ORDER BY recitations.created_at DESC
        `).all();

        return response({
          ok: true,
          recitations: result.results
        });
      }

      if (!isAuthorized(request, env)) {
        return response({
          ok: false,
          error: "يلزم تسجيل الدخول بصلاحية الإدارة."
        }, env.ADMIN_TOKEN ? 401 : 503);
      }

      if (path === "/api/readers" && method === "POST") {
        const body = await request.json();

        if (!body.name || !String(body.name).trim()) {
          return response({
            ok: false,
            error: "اسم القارئ مطلوب."
          }, 400);
        }

        const id = makeId();

        await env.DB.prepare(`
          INSERT INTO readers (id, name, type, notes)
          VALUES (?, ?, ?, ?)
        `).bind(
          id,
          String(body.name).trim(),
          body.type || "",
          body.notes || ""
        ).run();

        return response({
          ok: true,
          id,
          message: "تمت إضافة القارئ."
        }, 201);
      }

      if (path.startsWith("/api/readers/")) {
        const id = decodeURIComponent(
          path.slice("/api/readers/".length)
        );

        if (method === "DELETE") {
          await env.DB.prepare(
            "DELETE FROM readers WHERE id = ?"
          ).bind(id).run();

          return response({
            ok: true,
            message: "تم حذف القارئ."
          });
        }

        if (method === "PUT" || method === "PATCH") {
          const body = await request.json();

          const current = await env.DB.prepare(
            "SELECT * FROM readers WHERE id = ?"
          ).bind(id).first();

          if (!current) {
            return response({
              ok: false,
              error: "القارئ غير موجود."
            }, 404);
          }

          await env.DB.prepare(`
            UPDATE readers
            SET name = ?, type = ?, notes = ?
            WHERE id = ?
          `).bind(
            body.name ?? current.name,
            body.type ?? current.type,
            body.notes ?? current.notes,
            id
          ).run();

          return response({
            ok: true,
            message: "تم تحديث بيانات القارئ."
          });
        }
      }

      if (path === "/api/recitations/bulk" && method === "POST") {
        const body = await request.json();
        const items = Array.isArray(body) ? body : body.recitations;

        if (!Array.isArray(items) || items.length === 0) {
          return response({
            ok: false,
            error: "أرسل قائمة تلاوات صحيحة."
          }, 400);
        }

        if (items.length > 200) {
          return response({
            ok: false,
            error: "الحد الأقصى 200 تلاوة في الطلب الواحد."
          }, 400);
        }

        const statements = [];

        for (const item of items) {
          if (!item.title || !item.url) {
            return response({
              ok: false,
              error: "كل تلاوة تحتاج إلى عنوان ورابط."
            }, 400);
          }

          statements.push(
            env.DB.prepare(`
              INSERT INTO recitations
                (id, title, reader_id, type, url, notes)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                reader_id = excluded.reader_id,
                type = excluded.type,
                url = excluded.url,
                notes = excluded.notes
            `).bind(
              item.id || makeId(),
              String(item.title),
              item.reader_id || "",
              item.type || "",
              String(item.url),
              item.notes || ""
            )
          );
        }

        await env.DB.batch(statements);

        return response({
          ok: true,
          imported: statements.length,
          message: "تم استيراد التلاوات."
        });
      }

      if (path === "/api/recitations" && method === "POST") {
        const body = await request.json();

        if (!body.title || !body.url) {
          return response({
            ok: false,
            error: "عنوان التلاوة ورابطها مطلوبان."
          }, 400);
        }

        const id = makeId();

        await env.DB.prepare(`
          INSERT INTO recitations
            (id, title, reader_id, type, url, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          String(body.title),
          body.reader_id || "",
          body.type || "",
          String(body.url),
          body.notes || ""
        ).run();

        return response({
          ok: true,
          id,
          message: "تمت إضافة التلاوة."
        }, 201);
      }

      if (path.startsWith("/api/recitations/")) {
        const id = decodeURIComponent(
          path.slice("/api/recitations/".length)
        );

        if (method === "DELETE") {
          await env.DB.prepare(
            "DELETE FROM recitations WHERE id = ?"
          ).bind(id).run();

          return response({
            ok: true,
            message: "تم حذف التلاوة."
          });
        }

        if (method === "PUT" || method === "PATCH") {
          const body = await request.json();

          const current = await env.DB.prepare(
            "SELECT * FROM recitations WHERE id = ?"
          ).bind(id).first();

          if (!current) {
            return response({
              ok: false,
              error: "التلاوة غير موجودة."
            }, 404);
          }

          await env.DB.prepare(`
            UPDATE recitations
            SET title = ?, reader_id = ?, type = ?, url = ?, notes = ?
            WHERE id = ?
          `).bind(
            body.title ?? current.title,
            body.reader_id ?? current.reader_id,
            body.type ?? current.type,
            body.url ?? current.url,
            body.notes ?? current.notes,
            id
          ).run();

          return response({
            ok: true,
            message: "تم تحديث التلاوة."
          });
        }
      }

      return response({
        ok: false,
        error: "المسار أو طريقة الطلب غير مدعومين."
      }, 404);

    } catch (error) {
      console.error("QURAA API STAGING error:", error);

      return response({
        ok: false,
        error: "حدث خطأ أثناء تنفيذ الطلب."
      }, 500);
    }
  }
};
