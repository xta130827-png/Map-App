// Cloudflare Pages Functions：处理所有 /api/* 请求，数据存在 D1（绑定名 DB）

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const text = (msg, status) => new Response(msg, { status });
const now = () => new Date().toISOString();

function rowToPlace(r) {
  return { ...r, is_gym: !!r.is_gym, notes: [] };
}

async function getPlace(db, id) {
  const r = await db.prepare('SELECT * FROM places WHERE id = ?').bind(id).first();
  if (!r) return null;
  const place = rowToPlace(r);
  const { results } = await db.prepare('SELECT * FROM notes WHERE place_id = ? ORDER BY created_at').bind(id).all();
  place.notes = results;
  return place;
}

export async function onRequest({ request, env, params }) {
  if (!env.APP_PASSWORD || request.headers.get('x-passcode') !== env.APP_PASSWORD) {
    return text('unauthorized', 401);
  }

  const db = env.DB;
  const method = request.method;
  const [resource, id, sub] = params.path || [];
  const body = ['POST', 'PATCH'].includes(method) ? await request.json().catch(() => ({})) : {};

  // GET /api/places —— 所有地点及其笔记
  if (resource === 'places' && !id && method === 'GET') {
    const [places, notes] = await db.batch([
      db.prepare('SELECT * FROM places ORDER BY created_at'),
      db.prepare('SELECT * FROM notes ORDER BY created_at'),
    ]);
    const byId = new Map(places.results.map((r) => [r.id, rowToPlace(r)]));
    for (const n of notes.results) byId.get(n.place_id)?.notes.push(n);
    return json([...byId.values()]);
  }

  // POST /api/places —— 新建地点（可附带第一条笔记）
  if (resource === 'places' && !id && method === 'POST') {
    const lng = Number(body.lng), lat = Number(body.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return text('缺少坐标', 400);
    const pid = crypto.randomUUID();
    const t = now();
    const stmts = [
      db.prepare(`INSERT INTO places (id, name, address, lng, lat, is_gym, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(pid, String(body.name || ''), String(body.address || ''), lng, lat, body.is_gym ? 1 : 0,
              String(body.author || ''), t, t),
    ];
    if (body.note) {
      stmts.push(db.prepare('INSERT INTO notes (id, place_id, content, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), pid, String(body.note), String(body.author || ''), t, t));
    }
    await db.batch(stmts);
    return json(await getPlace(db, pid), 201);
  }

  // PATCH /api/places/:id —— 改名 / 切换健身房
  if (resource === 'places' && id && !sub && method === 'PATCH') {
    const sets = [], vals = [];
    if ('name' in body) { sets.push('name = ?'); vals.push(String(body.name)); }
    if ('address' in body) { sets.push('address = ?'); vals.push(String(body.address)); }
    if ('is_gym' in body) { sets.push('is_gym = ?'); vals.push(body.is_gym ? 1 : 0); }
    if (!sets.length) return text('没有要修改的内容', 400);
    sets.push('updated_at = ?');
    vals.push(now(), id);
    await db.prepare(`UPDATE places SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    const place = await getPlace(db, id);
    return place ? json(place) : text('地点不存在', 404);
  }

  // DELETE /api/places/:id
  if (resource === 'places' && id && !sub && method === 'DELETE') {
    await db.batch([
      db.prepare('DELETE FROM notes WHERE place_id = ?').bind(id),
      db.prepare('DELETE FROM places WHERE id = ?').bind(id),
    ]);
    return new Response(null, { status: 204 });
  }

  // POST /api/places/:id/notes
  if (resource === 'places' && id && sub === 'notes' && method === 'POST') {
    const content = String(body.content || '').trim();
    if (!content) return text('笔记内容为空', 400);
    if (!(await db.prepare('SELECT 1 FROM places WHERE id = ?').bind(id).first())) return text('地点不存在', 404);
    const note = { id: crypto.randomUUID(), place_id: id, content, author: String(body.author || ''), created_at: now() };
    note.updated_at = note.created_at;
    await db.batch([
      db.prepare('INSERT INTO notes (id, place_id, content, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(note.id, id, note.content, note.author, note.created_at, note.updated_at),
      db.prepare('UPDATE places SET updated_at = ? WHERE id = ?').bind(note.created_at, id),
    ]);
    return json(note, 201);
  }

  // PATCH /api/notes/:id
  if (resource === 'notes' && id && method === 'PATCH') {
    const content = String(body.content || '').trim();
    if (!content) return text('笔记内容为空', 400);
    await db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').bind(content, now(), id).run();
    const note = await db.prepare('SELECT * FROM notes WHERE id = ?').bind(id).first();
    return note ? json(note) : text('笔记不存在', 404);
  }

  // DELETE /api/notes/:id
  if (resource === 'notes' && id && method === 'DELETE') {
    await db.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  }

  return text('not found', 404);
}
