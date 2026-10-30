(function () {
  'use strict';

  const CFG = window.APP_CONFIG;
  const $ = (sel) => document.querySelector(sel);

  const state = {
    places: [],       // [{id, name, address, lng, lat, is_gym, created_by, notes: [...]}]
    filter: 'all',
    selectedId: null,
    temp: null,       // 尚未保存的地点 {name, address, lng, lat}
    picking: false,
    overlays: [],
    tempOverlay: null,
  };
  let map = null;
  let lastOverlayClick = 0;

  // ---------- 工具 ----------
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg, ms = 2200) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, ms);
  }
  function fmtTime(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function storeGet(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } }

  // ---------- 后端接口 ----------
  async function api(method, path, body) {
    const res = await fetch('/api/' + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-passcode': storeGet('passcode') },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      showLogin('口令不正确，请重新输入');
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      const msg = (await res.text()) || res.statusText;
      toast('出错了：' + msg);
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  async function loadData() {
    state.places = await api('GET', 'places');
    render();
    if (state.selectedId) openPlace(state.selectedId, false);
  }

  // ---------- 登录 ----------
  function showLogin(err) {
    $('#login-name').value = storeGet('author');
    $('#login-error').textContent = err || '';
    $('#login').hidden = false;
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    storeSet('author', $('#login-name').value.trim());
    storeSet('passcode', $('#login-pass').value);
    $('#login').hidden = true;
    try { await loadData(); } catch { /* api() 已处理 */ }
  });

  // ---------- 地图 ----------
  function loadBaidu() {
    if (!CFG.BAIDU_AK) {
      $('#map').innerHTML = '<div class="map-error">还没有配置百度地图 AK。<br>请在 config.js 中填写 BAIDU_AK。</div>';
      return;
    }
    window.__onBaiduReady = initMap;
    const s = document.createElement('script');
    s.src = `https://api.map.baidu.com/api?type=webgl&v=1.0&ak=${encodeURIComponent(CFG.BAIDU_AK)}&callback=__onBaiduReady`;
    s.onerror = () => { $('#map').innerHTML = '<div class="map-error">百度地图加载失败，请检查网络或 AK。</div>'; };
    document.head.appendChild(s);
  }

  function initMap() {
    map = new BMapGL.Map('map');
    map.centerAndZoom(new BMapGL.Point(CFG.CENTER[0], CFG.CENTER[1]), CFG.ZOOM);
    map.enableScrollWheelZoom(true);
    map.addEventListener('zoomend', render);
    map.addEventListener('moveend', render);
    map.addEventListener('click', onMapClick);
    render();
  }

  function addHtmlOverlay(point, html, onClick) {
    const label = new BMapGL.Label(html, { position: point, offset: new BMapGL.Size(0, 0) });
    label.setStyle({ border: 'none', background: 'transparent', padding: '0', zIndex: 1 });
    label.addEventListener('click', (e) => {
      lastOverlayClick = Date.now();
      if (e && e.domEvent) e.domEvent.stopPropagation();
      if (state.picking) setPicking(false);
      onClick();
    });
    map.addOverlay(label);
    return label;
  }

  function visiblePlaces() {
    return state.places.filter((p) => {
      if (state.filter === 'gym') return p.is_gym;
      if (state.filter === 'note') return p.notes.length > 0 || !p.is_gym;
      return true;
    });
  }

  // 简单网格聚合：屏幕上距离近的点合并成一个带数字的圆圈
  function render() {
    if (!map) return;
    state.overlays.forEach((o) => map.removeOverlay(o));
    state.overlays = [];

    const GRID = 56;
    const cells = new Map();
    const singleZoom = map.getZoom() >= 17;
    for (const p of visiblePlaces()) {
      const pt = new BMapGL.Point(p.lng, p.lat);
      const px = map.pointToPixel(pt);
      const key = singleZoom || p.id === state.selectedId ? p.id : Math.floor(px.x / GRID) + ':' + Math.floor(px.y / GRID);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(p);
    }

    for (const group of cells.values()) {
      if (group.length === 1) {
        const p = group[0];
        const cls = ['pin', p.is_gym ? 'gym' : 'note', p.id === state.selectedId ? 'selected' : ''].join(' ');
        const text = p.is_gym ? '健' + (p.notes.length ? ' ' + p.notes.length : '') : '✎ ' + p.notes.length;
        const html = `<div class="${cls}"><div class="pin-body">${esc(text)}</div><div class="pin-tail"></div></div>`;
        state.overlays.push(addHtmlOverlay(new BMapGL.Point(p.lng, p.lat), html, () => openPlace(p.id)));
      } else {
        const lng = group.reduce((s, p) => s + p.lng, 0) / group.length;
        const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
        const hasGym = group.some((p) => p.is_gym);
        const html = `<div class="cluster${hasGym ? ' has-gym' : ''}">${group.length}</div>`;
        state.overlays.push(addHtmlOverlay(new BMapGL.Point(lng, lat), html, () => {
          map.setViewport(group.map((p) => new BMapGL.Point(p.lng, p.lat)), { margins: [120, 40, 120, 40] });
        }));
      }
    }
  }

  function showTempPin(lng, lat) {
    clearTempPin();
    const html = '<div class="pin temp"><div class="pin-body">新</div><div class="pin-tail"></div></div>';
    state.tempOverlay = addHtmlOverlay(new BMapGL.Point(lng, lat), html, () => {});
  }
  function clearTempPin() {
    if (state.tempOverlay) map.removeOverlay(state.tempOverlay);
    state.tempOverlay = null;
  }

  function onMapClick(e) {
    if (Date.now() - lastOverlayClick < 400) return;
    if (state.picking) {
      setPicking(false);
      const pt = e.latlng;
      new BMapGL.Geocoder().getLocation(new BMapGL.Point(pt.lng, pt.lat), (rs) => {
        const poi = rs && rs.surroundingPois && rs.surroundingPois[0];
        openTemp({
          name: poi ? poi.title : '',
          address: (rs && rs.address) || '',
          lng: pt.lng,
          lat: pt.lat,
        });
      });
      return;
    }
    if (!$('#sheet').hidden) closeSheet();
  }

  function setPicking(on) {
    state.picking = on;
    $('#pick-hint').hidden = !on;
    $('#pick-btn').style.opacity = on ? 0.5 : 1;
    if (on) closeSheet();
  }
  $('#pick-btn').addEventListener('click', () => setPicking(!state.picking));
  $('#pick-cancel').addEventListener('click', () => setPicking(false));

  $('#locate-btn').addEventListener('click', () => {
    if (!map) return;
    toast('正在定位…');
    const geo = new BMapGL.Geolocation();
    geo.getCurrentPosition(function (r) {
      if (this.getStatus() === BMAP_STATUS_SUCCESS) {
        map.centerAndZoom(r.point, 16);
        toast('已定位');
      } else {
        toast('定位失败，请允许位置权限');
      }
    }, { enableHighAccuracy: true });
  });

  // ---------- 搜索 ----------
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const kw = $('#search-input').value.trim();
    const box = $('#search-results');
    if (!kw || !map) { box.hidden = true; return; }
    $('#search-input').blur();
    const local = new BMapGL.LocalSearch(CFG.CITY, {
      pageCapacity: 10,
      onSearchComplete: (results) => {
        const items = [];
        if (local.getStatus() === BMAP_STATUS_SUCCESS && results) {
          for (let i = 0; i < results.getCurrentNumPois(); i++) items.push(results.getPoi(i));
        }
        if (!items.length) {
          box.innerHTML = '<li>没有找到结果</li>';
        } else {
          box.innerHTML = items.map((poi, i) =>
            `<li data-i="${i}">${esc(poi.title)}<small>${esc(poi.address || '')}</small></li>`).join('');
          box.querySelectorAll('li[data-i]').forEach((li) => {
            li.addEventListener('click', () => {
              const poi = items[+li.dataset.i];
              box.hidden = true;
              openTemp({ name: poi.title, address: poi.address || '', lng: poi.point.lng, lat: poi.point.lat });
            });
          });
        }
        box.hidden = false;
      },
    });
    local.search(kw);
  });
  $('#search-input').addEventListener('input', (e) => { if (!e.target.value) $('#search-results').hidden = true; });

  // ---------- 筛选 / 列表 ----------
  document.querySelectorAll('.chip[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter;
      document.querySelectorAll('.chip[data-filter]').forEach((c) => c.classList.toggle('active', c === chip));
      render();
    });
  });

  $('#list-btn').addEventListener('click', () => {
    const items = visiblePlaces().slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    $('#list-items').innerHTML = items.length ? items.map((p) => `
      <li data-id="${esc(p.id)}">
        <i class="dot ${p.is_gym ? 'gym' : 'note'}"></i>
        <div>${esc(p.name || '未命名地点')}<small>${esc(p.address)} · ${p.notes.length} 条笔记</small></div>
      </li>`).join('') : '<li>暂无地点</li>';
    $('#list-items').querySelectorAll('li[data-id]').forEach((li) => {
      li.addEventListener('click', () => { $('#list-panel').hidden = true; openPlace(li.dataset.id); });
    });
    $('#list-panel').hidden = false;
  });
  $('#list-close').addEventListener('click', () => { $('#list-panel').hidden = true; });

  // ---------- 导出 ----------
  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // 先从服务器取最新数据，保证导出的是两个人的全部内容
  async function exportData(kind) {
    try {
      const places = await api('GET', 'places');
      if (kind === 'json') {
        const data = { app: 'chengdu-map-notes', version: 1, exported_at: new Date().toISOString(), places };
        download(`地图笔记备份-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
      } else {
        const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [['地点名称', '地址', '健身房', '经度', '纬度', '添加人', '笔记作者', '笔记时间', '笔记内容']];
        for (const p of places) {
          const base = [p.name, p.address, p.is_gym ? '是' : '否', p.lng, p.lat, p.created_by];
          if (!p.notes.length) rows.push([...base, '', '', '']);
          for (const n of p.notes) rows.push([...base, n.author, fmtTime(n.created_at), n.content]);
        }
        // 开头加 BOM，Excel 打开中文才不会乱码
        download(`地图笔记-${stamp()}.csv`, '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
      }
      toast(`已导出 ${places.length} 个地点`);
    } catch { /* api() 已提示 */ }
  }
  $('#export-json').addEventListener('click', () => exportData('json'));
  $('#export-csv').addEventListener('click', () => exportData('csv'));

  // ---------- 底部卡片 ----------
  function closeSheet() {
    $('#sheet').hidden = true;
    state.selectedId = null;
    state.temp = null;
    if (map) { clearTempPin(); render(); }
  }

  // 把地点移到底部卡片上方的可见区域（手机上卡片会挡住地图下半部分）
  function focusPoint(lng, lat) {
    if (!map) return;
    const sheet = $('#sheet');
    const covered = !sheet.hidden && window.innerWidth < 720 ? sheet.offsetHeight : 0;
    const visibleH = window.innerHeight - covered;
    const px = map.pointToPixel(new BMapGL.Point(lng, lat));
    const center = map.pixelToPoint(new BMapGL.Pixel(px.x, px.y + (window.innerHeight - visibleH) / 2));
    map.panTo(center);
  }

  function navUrl(p) {
    const q = new URLSearchParams({
      location: `${p.lat},${p.lng}`, title: p.name || '目的地', content: p.address || '',
      output: 'html', coord_type: 'bd09ll', src: 'webapp.chengdu-map-notes',
    });
    return 'https://api.map.baidu.com/marker?' + q.toString();
  }

  // 新地点（来自搜索或地图选点）
  function openTemp(t) {
    state.temp = t;
    state.selectedId = null;
    if (map) {
      showTempPin(t.lng, t.lat);
      map.centerAndZoom(new BMapGL.Point(t.lng, t.lat), Math.max(map.getZoom(), 16));
    }
    $('#sheet-body').innerHTML = `
      <div class="sheet-title"><h3>添加新地点</h3><button class="icon-btn" data-act="close">✕</button></div>
      <p class="addr">${esc(t.address)}</p>
      <label class="field"><span>名称</span><input id="new-name" value="${esc(t.name)}" placeholder="给这个地点起个名字"></label>
      <div class="row"><label><input type="checkbox" id="new-gym"> 这是健身房</label></div>
      <label class="field"><span>笔记（可选）</span><textarea id="new-note" placeholder="写点什么…"></textarea></label>
      <div class="row"><button class="btn primary" data-act="save-new">保存</button><button class="btn" data-act="close">取消</button></div>`;
    $('#sheet').hidden = false;
    render();
    focusPoint(t.lng, t.lat);
  }

  function openPlace(id, recenter = true) {
    const p = state.places.find((x) => x.id === id);
    if (!p) { closeSheet(); return; }
    state.temp = null;
    state.selectedId = id;
    if (map) clearTempPin();
    const notes = p.notes.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    $('#sheet-body').innerHTML = `
      <div class="sheet-title"><h3>${esc(p.name || '未命名地点')}</h3>
        <button class="icon-btn" data-act="rename">改名</button><button class="icon-btn" data-act="close">✕</button></div>
      <p class="addr">${esc(p.address)}</p>
      <div class="row">
        <button class="btn ${p.is_gym ? 'gym-on' : ''}" data-act="toggle-gym">${p.is_gym ? '✓ 健身房' : '标记为健身房'}</button>
        <a class="btn" href="${esc(navUrl(p))}" target="_blank" rel="noopener">导航</a>
        <button class="btn danger" data-act="delete-place">删除地点</button>
      </div>
      <h4>笔记（${notes.length}）</h4>
      <ul class="notes">${notes.map((n) => `
        <li data-note="${esc(n.id)}">
          <div class="meta"><span class="grow">${esc(n.author || '匿名')} · ${fmtTime(n.created_at)}${n.updated_at && n.updated_at !== n.created_at ? '（已编辑）' : ''}</span>
            <button data-act="edit-note">编辑</button><button data-act="delete-note">删除</button></div>
          <div class="content">${esc(n.content)}</div>
        </li>`).join('')}</ul>
      ${notes.length ? '' : '<p class="empty">还没有笔记</p>'}
      <textarea id="add-note" placeholder="添加一条笔记…"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" data-act="add-note">添加笔记</button></div>`;
    $('#sheet').hidden = false;
    render();
    if (recenter) focusPoint(p.lng, p.lat);
  }

  $('#sheet').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const p = state.places.find((x) => x.id === state.selectedId);
    const noteId = btn.closest('[data-note]')?.dataset.note;
    const author = storeGet('author');

    try {
      if (act === 'close') return closeSheet();

      if (act === 'save-new') {
        const t = state.temp;
        btn.disabled = true;
        const place = await api('POST', 'places', {
          name: $('#new-name').value.trim(), address: t.address, lng: t.lng, lat: t.lat,
          is_gym: $('#new-gym').checked, note: $('#new-note').value.trim(), author,
        });
        state.places.push(place);
        toast('已保存');
        return openPlace(place.id, false);
      }

      if (!p) return;

      if (act === 'rename') {
        const name = prompt('新名称', p.name);
        if (name === null) return;
        Object.assign(p, await api('PATCH', 'places/' + p.id, { name: name.trim() }));
      } else if (act === 'toggle-gym') {
        Object.assign(p, await api('PATCH', 'places/' + p.id, { is_gym: !p.is_gym }));
      } else if (act === 'delete-place') {
        if (!confirm(`删除「${p.name || '该地点'}」及其所有笔记？`)) return;
        await api('DELETE', 'places/' + p.id);
        state.places = state.places.filter((x) => x.id !== p.id);
        toast('已删除');
        return closeSheet();
      } else if (act === 'add-note') {
        const content = $('#add-note').value.trim();
        if (!content) return toast('请先输入笔记内容');
        btn.disabled = true;
        p.notes.push(await api('POST', `places/${p.id}/notes`, { content, author }));
      } else if (act === 'edit-note') {
        const n = p.notes.find((x) => x.id === noteId);
        const content = prompt('编辑笔记', n.content);
        if (content === null || !content.trim()) return;
        Object.assign(n, await api('PATCH', 'notes/' + n.id, { content: content.trim() }));
      } else if (act === 'delete-note') {
        if (!confirm('删除这条笔记？')) return;
        await api('DELETE', 'notes/' + noteId);
        p.notes = p.notes.filter((x) => x.id !== noteId);
      }
      openPlace(p.id, false);
    } catch (err) {
      btn.disabled = false;
      console.error(err);
    }
  });

  // ---------- 启动 ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  loadBaidu();
  if (!storeGet('passcode') || !storeGet('author')) showLogin();
  else loadData().catch(() => {});
  // 回到前台时刷新，看到对方新加的笔记
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && storeGet('passcode')) loadData().catch(() => {});
  });
})();
