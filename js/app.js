/* PDF웍스 웹
 * - 화면 표시: pdf.js
 * - 저장: pdf-lib + fontkit
 *   글꼴은 세 가지 방식: 기본 글꼴(PDF에 넣지 않음), 글꼴 넣기(쓴 글자만), 이 컴퓨터의 글꼴(쓴 글자만)
 * 모든 처리는 브라우저 안에서만 이루어지며 파일은 어디에도 전송되지 않습니다.
 */
(function () {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  // ---------- 글꼴 ----------
  // group 'sys'   : PDF에 글꼴을 넣지 않음. PDF를 여는 컴퓨터의 기본 한글 글꼴로 보임 (용량 거의 0)
  // group 'embed' : 이 사이트의 나눔 글꼴에서 쓴 글자만 넣음 (보통 수십 KB)
  // group 'local' : 이 컴퓨터에 설치된 글꼴에서 쓴 글자만 넣음 (Chrome, Edge PC)
  const FONTS = [
    { key: 'sysGothic', group: 'sys', label: '기본 고딕', stack: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif', pdfName: 'HYGoThic-Medium', flags: 4 },
    { key: 'sysMyeongjo', group: 'sys', label: '기본 명조', stack: 'Batang, AppleMyungjo, "Noto Serif KR", "Noto Serif CJK KR", serif', pdfName: 'HYSMyeongJo-Medium', flags: 6 },
    { key: 'nanumGothic', group: 'embed', label: '나눔고딕', stack: '"NanumGothicPE"', file: 'fonts/NanumGothic-Regular.ttf' },
    { key: 'nanumGothicBold', group: 'embed', label: '나눔고딕 굵게', stack: '"NanumGothicBoldPE"', file: 'fonts/NanumGothic-Bold.ttf' },
    { key: 'nanumMyeongjo', group: 'embed', label: '나눔명조', stack: '"NanumMyeongjoPE"', file: 'fonts/NanumMyeongjo-Regular.ttf' },
    { key: 'nanumPen', group: 'embed', label: '나눔손글씨 펜', stack: '"NanumPenPE"', file: 'fonts/NanumPenScript-Regular.ttf' },
    { key: 'nanumBrush', group: 'embed', label: '나눔손글씨 붓', stack: '"NanumBrushPE"', file: 'fonts/NanumBrushScript-Regular.ttf' },
  ];
  const FONT_HINTS = {
    sys: 'PDF에 글꼴을 넣지 않아 용량이 늘지 않습니다. 글자 모양은 PDF를 여는 기기의 기본 한글 글꼴(예: 맑은 고딕)로 보입니다.',
    embed: '쓴 글자만 PDF에 넣습니다(보통 수십 KB). 어느 기기에서 열어도 이 모양 그대로 보입니다.',
    local: '이 컴퓨터의 글꼴에서 쓴 글자만 PDF에 넣습니다. 어느 기기에서 열어도 이 모양 그대로 보입니다.',
  };
  const SIG_FONTS = [
    { key: 'pen', label: '나눔 펜', css: 'NanumPenPE' },
    { key: 'brush', label: '나눔 붓', css: 'NanumBrushPE' },
    { key: 'dancing', label: '영문 필기체', css: 'DancingPE' },
  ];
  const fontByKey = (k) => FONTS.find((f) => f.key === k) || FONTS[0];
  const hasFont = (k) => FONTS.some((f) => f.key === k);
  const LINE_HEIGHT = 1.2;

  // ---------- 상태 ----------
  const state = {
    pdf: null,          // pdf.js 문서
    bytes: null,        // 원본 PDF 바이트
    fileName: 'document.pdf',
    page: 1,
    pageCount: 0,
    scale: 1,
    fit: true,
    baseSize: { w: 0, h: 0 }, // 현재 페이지 크기 (배율 1)
    objects: [],        // {id,page,type,x,y,...}
    selId: null,
    renderTask: null,
  };
  let nextId = 1;

  // ---------- 저장소 (localStorage 는 막혀 있을 수 있음) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const textDefaults = Object.assign({ font: 'sysGothic', size: 14, color: '#000000' }, store.get('pe.textDefaults', {}));
  if (!hasFont(textDefaults.font) && !/^local:/.test(textDefaults.font)) textDefaults.font = 'sysGothic';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    filePdf: $('filePdf'), fileImage: $('fileImage'),
    dropzone: $('dropzone'), viewerCard: $('viewerCard'), docName: $('docName'), workspace: $('workspace'),
    pageWrap: $('pageWrap'), canvas: $('pageCanvas'), overlay: $('overlay'),
    pageNum: $('pageNum'), pageCount: $('pageCount'),
    props: $('props'), propsTitle: $('propsTitle'), propsText: $('propsText'), propsImage: $('propsImage'),
    txtContent: $('txtContent'), txtFont: $('txtFont'), txtSize: $('txtSize'), txtColor: $('txtColor'),
    imgBgRemove: $('imgBgRemove'), imgTol: $('imgTol'), imgTolWrap: $('imgTolWrap'),
    busy: $('busy'), busyMsg: $('busyMsg'), toast: $('toast'),
  };

  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.hidden = true; }, ms || 2600);
  }
  function busy(on, msg) {
    el.busy.hidden = !on;
    if (msg) el.busyMsg.textContent = msg;
  }

  // ---------- PDF 열기 ----------
  async function openPdfFile(file) {
    if (!file) return;
    if (state.objects.length && !confirm('지금까지 편집한 내용이 사라집니다. 새 파일을 열까요?')) return;
    busy(true, 'PDF 여는 중...');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({
        data: buf.slice(),
        // 워커 기준이 아니라 페이지 기준 주소로 넘겨야 파일을 찾음
        cMapUrl: new URL('lib/cmaps/', location.href).href, cMapPacked: true,
        standardFontDataUrl: new URL('lib/standard_fonts/', location.href).href,
      }).promise;
      if (state.pdf) state.pdf.destroy();
      state.pdf = pdf;
      state.bytes = buf;
      state.fileName = file.name || 'document.pdf';
      state.pageCount = pdf.numPages;
      state.page = 1;
      state.objects = [];
      state.fit = true;
      select(null);
      el.dropzone.hidden = true;
      el.viewerCard.hidden = false;
      el.docName.textContent = state.fileName;
      el.docName.title = state.fileName;
      el.pageCount.textContent = pdf.numPages;
      el.pageNum.max = pdf.numPages;
      document.querySelectorAll('.needs-doc').forEach((b) => { b.disabled = false; });
      await renderPage();
    } catch (e) {
      console.error(e);
      toast(e && e.name === 'PasswordException' ? '암호가 걸린 PDF는 열 수 없습니다.' : 'PDF 파일을 열 수 없습니다.');
    } finally {
      busy(false);
    }
  }

  // ---------- 페이지 그리기 ----------
  function fitScale() {
    const avail = el.workspace.clientWidth - (window.innerWidth <= 820 ? 16 : 24);
    return Math.max(0.25, Math.min(2.5, avail / state.baseSize.w));
  }

  async function renderPage() {
    if (!state.pdf) return;
    const page = await state.pdf.getPage(state.page);
    const base = page.getViewport({ scale: 1 });
    state.baseSize = { w: base.width, h: base.height };
    if (state.fit) state.scale = fitScale();
    const vp = page.getViewport({ scale: state.scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const c = el.canvas;
    c.width = Math.floor(vp.width * dpr);
    c.height = Math.floor(vp.height * dpr);
    c.style.width = vp.width + 'px';
    c.style.height = vp.height + 'px';
    el.pageWrap.style.width = vp.width + 'px';
    el.pageWrap.style.height = vp.height + 'px';
    if (state.renderTask) { try { state.renderTask.cancel(); } catch (e) { /* 무시 */ } }
    const ctx = c.getContext('2d');
    const task = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
    state.renderTask = task;
    el.pageNum.value = state.page;
    renderObjects();
    try { await task.promise; } catch (e) { if (e && e.name !== 'RenderingCancelledException') console.error(e); }
  }

  function goPage(n) {
    n = Math.max(1, Math.min(state.pageCount, n | 0));
    if (n === state.page) { el.pageNum.value = n; return; }
    select(null);
    state.page = n;
    renderPage();
    el.workspace.scrollTop = 0;
  }
  function zoom(f) {
    state.fit = false;
    state.scale = Math.max(0.25, Math.min(5, state.scale * f));
    renderPage();
  }

  // ---------- 항목 화면 표시 ----------
  function renderObjects() {
    el.overlay.innerHTML = '';
    state.objects.filter((o) => o.page === state.page).forEach((o) => el.overlay.appendChild(buildObjEl(o)));
  }

  function buildObjEl(o) {
    const d = document.createElement('div');
    d.className = 'obj ' + o.type + (o.id === state.selId ? ' sel' : '');
    d.dataset.id = o.id;
    if (o.type === 'text') {
      const t = document.createElement('div');
      t.className = 't';
      d.appendChild(t);
    } else {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      d.appendChild(img);
    }
    const h = document.createElement('div'); h.className = 'h'; h.title = '크기 조절'; d.appendChild(h);
    const x = document.createElement('button'); x.className = 'x'; x.type = 'button'; x.title = '삭제'; x.textContent = '✕'; d.appendChild(x);
    updateObjEl(o, d);
    return d;
  }

  function objEl(o) { return el.overlay.querySelector('.obj[data-id="' + o.id + '"]'); }

  function updateObjEl(o, d) {
    d = d || objEl(o);
    if (!d) return;
    const s = state.scale;
    d.style.left = o.x * s + 'px';
    d.style.top = o.y * s + 'px';
    if (o.type === 'text') {
      const t = d.firstChild;
      t.textContent = o.text || ' ';
      t.style.fontFamily = fontByKey(o.font).stack;
      t.style.fontSize = o.size * s + 'px';
      t.style.color = o.color;
      d.style.width = d.style.height = '';
    } else {
      const img = d.firstChild;
      if (img.getAttribute('src') !== o.src) img.src = o.src;
      d.style.width = o.w * s + 'px';
      d.style.height = o.h * s + 'px';
    }
  }

  // ---------- 선택 / 속성 패널 ----------
  function getObj(id) { return state.objects.find((o) => o.id === id); }
  function selected() { return getObj(state.selId); }

  function select(id) {
    state.selId = id;
    el.overlay.querySelectorAll('.obj').forEach((d) => d.classList.toggle('sel', +d.dataset.id === id));
    const o = selected();
    document.body.classList.toggle('props-open', !!o);
    $('propsEmpty').hidden = !!o;
    $('propsBtns').hidden = !o;
    if (!o) {
      el.propsTitle.textContent = '선택한 항목';
      el.propsText.hidden = el.propsImage.hidden = true;
      return;
    }
    el.propsText.hidden = o.type !== 'text';
    el.propsImage.hidden = o.type !== 'image';
    if (o.type === 'image') el.propsImage.hidden = !!o.sig;
    if (o.type === 'text') {
      el.propsTitle.textContent = '텍스트';
      el.txtContent.value = o.text;
      el.txtFont.value = o.font;
      updateFontHint(o.font);
      el.txtSize.value = round1(o.size);
      el.txtColor.value = o.color;
    } else {
      el.propsTitle.textContent = o.sig ? '서명' : '이미지';
      el.imgBgRemove.checked = !!o.bgRemove;
      el.imgTol.value = o.tol || 40;
      el.imgTolWrap.hidden = !o.bgRemove;
    }
  }
  const round1 = (n) => Math.round(n * 10) / 10;

  function deleteObj(id) {
    state.objects = state.objects.filter((o) => o.id !== id);
    const d = el.overlay.querySelector('.obj[data-id="' + id + '"]');
    if (d) d.remove();
    if (state.selId === id) select(null);
  }

  function saveTextDefaults(o) {
    textDefaults.font = o.font; textDefaults.size = o.size; textDefaults.color = o.color;
    store.set('pe.textDefaults', textDefaults);
  }

  // 화면에 보이는 페이지 영역의 가운데 (배율 1 좌표)
  function visibleCenter() {
    const ws = el.workspace.getBoundingClientRect();
    const pg = el.pageWrap.getBoundingClientRect();
    const cx = (Math.max(ws.left, pg.left) + Math.min(ws.right, pg.right)) / 2 - pg.left;
    let bottom = ws.bottom;
    // 휴대폰에서는 아래에 뜬 설정 창이 페이지 일부를 가림
    if (getComputedStyle(el.props).position === 'fixed') bottom = Math.min(bottom, el.props.getBoundingClientRect().top);
    const cy = (Math.max(ws.top, pg.top) + Math.min(bottom, pg.bottom)) / 2 - pg.top;
    return { x: cx / state.scale, y: cy / state.scale };
  }

  function addText() {
    const o = {
      id: nextId++, page: state.page, type: 'text',
      text: '텍스트를 입력하세요', font: textDefaults.font, size: textDefaults.size, color: textDefaults.color,
      x: 0, y: 0,
    };
    state.objects.push(o);
    const d = buildObjEl(o);
    el.overlay.appendChild(d);
    select(o.id); // 패널을 먼저 열어야 보이는 영역의 가운데를 정확히 잼
    const c = visibleCenter();
    o.x = Math.max(0, c.x - d.offsetWidth / state.scale / 2);
    o.y = Math.max(0, c.y - d.offsetHeight / state.scale / 2);
    updateObjEl(o, d);
    el.txtContent.focus({ preventScroll: true });
    el.txtContent.select();
  }

  // 이미지/서명 넣기. src 는 data URL, (w,h) 는 원본 픽셀 크기
  function addImage(src, pw, ph, extra) {
    const maxW = Math.min(state.baseSize.w * (extra && extra.sig ? 0.3 : 0.4), 260);
    let w = maxW, h = (ph / pw) * w;
    const maxH = state.baseSize.h * 0.3;
    if (h > maxH) { h = maxH; w = (pw / ph) * h; }
    const o = Object.assign({
      id: nextId++, page: state.page, type: 'image', src, orig: src,
      x: 0, y: 0, w, h, bgRemove: false, tol: 40,
    }, extra || {});
    state.objects.push(o);
    const d = buildObjEl(o);
    el.overlay.appendChild(d);
    select(o.id);
    const c = visibleCenter();
    o.x = Math.max(0, c.x - w / 2);
    o.y = Math.max(0, c.y - h / 2);
    updateObjEl(o, d);
    return o;
  }

  // ---------- 끌기 / 크기 조절 (마우스 + 터치 공용) ----------
  let drag = null;
  el.overlay.addEventListener('pointerdown', (e) => {
    const d = e.target.closest('.obj');
    if (!d) return;
    const o = getObj(+d.dataset.id);
    if (!o) return;
    if (e.target.classList.contains('x')) { e.preventDefault(); deleteObj(o.id); return; }
    e.preventDefault();
    if (state.selId !== o.id) select(o.id);
    const mode = e.target.classList.contains('h') ? 'resize' : 'move';
    drag = {
      o, d, mode, pid: e.pointerId, sx: e.clientX, sy: e.clientY,
      ox: o.x, oy: o.y, ow: o.w, oh: o.h, osize: o.size,
      dw: d.offsetWidth / state.scale, dh: d.offsetHeight / state.scale, moved: false,
    };
    try { d.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = (e.clientX - drag.sx) / state.scale;
    const dy = (e.clientY - drag.sy) / state.scale;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) drag.moved = true;
    const o = drag.o;
    const W = state.baseSize.w, H = state.baseSize.h;
    if (drag.mode === 'move') {
      o.x = clamp(drag.ox + dx, -drag.dw * 0.8, W - drag.dw * 0.2);
      o.y = clamp(drag.oy + dy, -drag.dh * 0.8, H - drag.dh * 0.2);
    } else if (o.type === 'text') {
      // 글자 상자는 오른쪽 아래 손잡이로 글자 크기를 바꿈
      const f = Math.max((drag.dw + dx) / drag.dw, (drag.dh + dy) / drag.dh);
      o.size = clamp(round1(drag.osize * f), 4, 200);
      el.txtSize.value = o.size;
    } else {
      // 이미지는 비율 유지
      const f = Math.max((drag.ow + dx) / drag.ow, (drag.oh + dy) / drag.oh);
      const nf = Math.max(f, 8 / Math.min(drag.ow, drag.oh));
      o.w = drag.ow * nf; o.h = drag.oh * nf;
    }
    updateObjEl(o, drag.d);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (drag.mode === 'resize' && drag.o.type === 'text') saveTextDefaults(drag.o);
    drag = null;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  el.overlay.addEventListener('dblclick', (e) => {
    const d = e.target.closest('.obj.text');
    if (d) { el.txtContent.focus(); el.txtContent.select(); }
  });
  // 빈 곳을 누르면 선택 해제
  el.workspace.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.obj')) select(null);
  });
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---------- 속성 패널 입력 ----------
  function buildFontOptions() {
    const groups = [
      ['sys', '기본 글꼴 (PDF 용량 늘지 않음)'],
      ['embed', '글꼴 넣기 (쓴 글자만, 모양 고정)'],
      ['local', '이 컴퓨터의 글꼴 (쓴 글자만, 모양 고정)'],
    ];
    const cur = el.txtFont.value;
    el.txtFont.innerHTML = '';
    groups.forEach(([g, label]) => {
      const list = FONTS.filter((f) => f.group === g);
      if (!list.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      list.forEach((f) => { const op = document.createElement('option'); op.value = f.key; op.textContent = f.label; og.appendChild(op); });
      el.txtFont.appendChild(og);
    });
    if (cur) el.txtFont.value = cur;
  }
  function updateFontHint(key) {
    $('fontHint').textContent = FONT_HINTS[fontByKey(key).group] || '';
  }
  buildFontOptions();

  // 이 컴퓨터의 글꼴 (Chrome, Edge PC 에서만 가능. 처음에 권한을 물어봄)
  const canListLocalFonts = 'queryLocalFonts' in window;
  $('localFontsRow').hidden = !canListLocalFonts;
  async function loadLocalFonts(fromClick) {
    try {
      const all = await window.queryLocalFonts();
      const byFamily = new Map();
      for (const fd of all) {
        const prev = byFamily.get(fd.family);
        const regular = /^(regular|normal|book|roman|medium|표준|보통)$/i.test(fd.style);
        if (!prev || (regular && !prev.regular)) byFamily.set(fd.family, { fd, regular });
      }
      const families = [...byFamily.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
      for (let i = FONTS.length - 1; i >= 0; i--) if (FONTS[i].group === 'local') FONTS.splice(i, 1);
      families.forEach((fam) => {
        const { fd } = byFamily.get(fam);
        FONTS.push({ key: 'local:' + fd.postscriptName, group: 'local', label: fam, stack: '"' + fam.replace(/"/g, '') + '", sans-serif', fontData: fd });
      });
      buildFontOptions();
      $('localFontsRow').hidden = true;
      const o = selected();
      if (o && o.type === 'text') el.txtFont.value = o.font;
      if (fromClick) toast('이 컴퓨터의 글꼴 ' + families.length + '개를 목록에 넣었습니다.');
    } catch (e) {
      if (fromClick) toast('글꼴 목록을 볼 수 없습니다. 브라우저에서 글꼴 사용을 허용해 주세요.');
    }
  }
  $('btnLocalFonts').addEventListener('click', () => loadLocalFonts(true));
  if (canListLocalFonts && navigator.permissions) {
    navigator.permissions.query({ name: 'local-fonts' }).then((r) => { if (r.state === 'granted') loadLocalFonts(false); }).catch(() => {});
  }
  el.txtContent.addEventListener('input', () => {
    const o = selected(); if (!o || o.type !== 'text') return;
    o.text = el.txtContent.value; updateObjEl(o);
  });
  el.txtFont.addEventListener('change', () => {
    const o = selected(); if (!o || o.type !== 'text') return;
    o.font = el.txtFont.value; updateObjEl(o); saveTextDefaults(o); updateFontHint(o.font);
  });
  el.txtSize.addEventListener('input', () => {
    const o = selected(); if (!o || o.type !== 'text') return;
    const v = parseFloat(el.txtSize.value);
    if (v >= 4 && v <= 200) { o.size = v; updateObjEl(o); saveTextDefaults(o); }
  });
  el.txtColor.addEventListener('input', () => {
    const o = selected(); if (!o || o.type !== 'text') return;
    o.color = el.txtColor.value; updateObjEl(o); saveTextDefaults(o);
  });
  document.querySelectorAll('#propsText .swatches button').forEach((b) => b.addEventListener('click', () => {
    el.txtColor.value = b.dataset.c;
    el.txtColor.dispatchEvent(new Event('input'));
  }));

  async function reprocessSelectedImage() {
    const o = selected(); if (!o || o.type !== 'image') return;
    o.bgRemove = el.imgBgRemove.checked;
    o.tol = +el.imgTol.value;
    el.imgTolWrap.hidden = !o.bgRemove;
    o.src = o.bgRemove ? await removeBackground(o.orig, o.tol) : o.orig;
    updateObjEl(o);
  }
  el.imgBgRemove.addEventListener('change', reprocessSelectedImage);
  el.imgTol.addEventListener('change', reprocessSelectedImage);

  $('btnDelete').addEventListener('click', () => { if (state.selId) deleteObj(state.selId); });
  $('btnPropsClose').addEventListener('click', () => select(null));

  // ---------- 이미지 처리 ----------
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('이미지를 읽을 수 없습니다.'));
      img.src = src;
    });
  }
  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }

  // 파일을 읽어 최대 2000px 로 줄인 data URL 로 만듦
  async function fileToImageData(file, maxDim) {
    maxDim = maxDim || 2000;
    const url = await readAsDataURL(file);
    const img = await loadImage(url);
    let w = img.naturalWidth, h = img.naturalHeight;
    const isJpeg = /jpe?g/i.test(file.type);
    if (w <= maxDim && h <= maxDim && /^(image\/(png|jpeg))$/i.test(file.type)) {
      return { src: url, w, h };
    }
    const k = Math.min(1, maxDim / Math.max(w, h));
    w = Math.round(w * k); h = Math.round(h * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return { src: isJpeg ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png'), w, h };
  }

  // 모서리 색(보통 흰 종이)과 비슷한 픽셀을 투명하게 만듦
  async function removeBackground(src, tol) {
    const img = await loadImage(src);
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const p = id.data;
    // 네 모서리 근처의 평균 색을 배경색으로 봄 (가장 밝은 쪽 우선)
    const samples = [];
    const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, 0], [w >> 1, h - 1], [0, h >> 1], [w - 1, h >> 1]];
    for (const [x, y] of pts) {
      const i = (y * w + x) * 4;
      if (p[i + 3] > 0) samples.push([p[i], p[i + 1], p[i + 2]]);
    }
    let bg = [255, 255, 255];
    if (samples.length) {
      samples.sort((a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]));
      const top = samples.slice(0, Math.max(1, Math.ceil(samples.length / 2)));
      bg = [0, 1, 2].map((k) => top.reduce((s, v) => s + v[k], 0) / top.length);
    }
    const hard = tol, soft = tol * 1.6;
    for (let i = 0; i < p.length; i += 4) {
      const d = Math.max(Math.abs(p[i] - bg[0]), Math.abs(p[i + 1] - bg[1]), Math.abs(p[i + 2] - bg[2]));
      if (d <= hard) p[i + 3] = 0;
      else if (d < soft) p[i + 3] = Math.round(p[i + 3] * (d - hard) / (soft - hard));
    }
    ctx.putImageData(id, 0, 0);
    return c.toDataURL('image/png');
  }

  // 투명 여백을 잘라냄
  function trimCanvas(c, pad) {
    pad = pad == null ? 6 : pad;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const { width: w, height: h } = c;
    const p = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (p[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  async function onImageFile(file) {
    if (!file) return;
    try {
      const r = await fileToImageData(file);
      addImage(r.src, r.w, r.h, { mime: r.src.slice(5, r.src.indexOf(';')) });
    } catch (e) {
      toast('이미지를 넣을 수 없습니다.');
    }
  }

  // ---------- 서명 ----------
  const sig = {
    dlg: $('sigDialog'), tab: 'draw',
    pad: $('sigPad'), penColor: '#000000', strokes: 0,
    upload: null, typeColor: '#000000', typeFont: 'pen',
  };

  function openSignDialog() {
    const saved = store.get('pe.signatures', []);
    renderSaved();
    setSigTab(saved.length ? 'saved' : 'draw');
    if (typeof sig.dlg.showModal === 'function') sig.dlg.showModal(); else sig.dlg.setAttribute('open', '');
    requestAnimationFrame(setupPad);
  }

  function setSigTab(t) {
    sig.tab = t;
    sig.dlg.querySelectorAll('.sig-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    sig.dlg.querySelectorAll('section.tab').forEach((s) => s.classList.toggle('on', s.dataset.tab === t));
    $('sigFoot').hidden = t === 'saved';
    if (t === 'draw') requestAnimationFrame(setupPad);
    if (t === 'type') renderSigFonts();
  }
  sig.dlg.querySelectorAll('.sig-tabs button').forEach((b) => b.addEventListener('click', () => setSigTab(b.dataset.tab)));

  // 저장된 서명
  function renderSaved() {
    const list = store.get('pe.signatures', []);
    const box = $('savedList');
    box.innerHTML = '';
    $('savedEmpty').hidden = list.length > 0;
    list.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'saved-item checker';
      item.title = '이 서명 넣기';
      item.innerHTML = '<img alt="저장된 서명"><button type="button" class="del" title="삭제">✕</button>';
      item.querySelector('img').src = s.src;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) {
          const l = store.get('pe.signatures', []);
          l.splice(i, 1);
          store.set('pe.signatures', l);
          renderSaved();
          return;
        }
        closeSig();
        addImage(s.src, s.w, s.h, { sig: true, mime: 'image/png' });
      });
      box.appendChild(item);
    });
  }

  function saveSignature(src, w, h) {
    const list = store.get('pe.signatures', []);
    list.unshift({ src, w, h, at: Date.now() });
    while (list.length > 12) list.pop();
    let ok = store.set('pe.signatures', list);
    while (!ok && list.length > 1) { list.pop(); ok = store.set('pe.signatures', list); }
    if (!ok) toast('저장 공간이 부족해 서명을 저장하지 못했습니다.');
  }

  // 그리기 패드
  let padCtx = null, padDrawing = false, padLast = null, padMid = null;
  function setupPad() {
    const c = sig.pad;
    const r = c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (c.width === W && c.height === H && padCtx) return;
    c.width = W; c.height = H;
    padCtx = c.getContext('2d', { willReadFrequently: true });
    padCtx.scale(dpr, dpr);
    padCtx.lineCap = 'round';
    padCtx.lineJoin = 'round';
    sig.strokes = 0;
  }
  function padPoint(e) {
    const r = sig.pad.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  sig.pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setupPad();
    padDrawing = true;
    sig.pad.setPointerCapture(e.pointerId);
    padLast = padMid = padPoint(e);
    padCtx.strokeStyle = sig.penColor;
    padCtx.fillStyle = sig.penColor;
    padCtx.lineWidth = +$('penWidth').value;
    padCtx.beginPath();
    padCtx.arc(padLast.x, padLast.y, padCtx.lineWidth / 2, 0, Math.PI * 2);
    padCtx.fill();
    sig.strokes++;
  });
  sig.pad.addEventListener('pointermove', (e) => {
    if (!padDrawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = padPoint(ev);
      const mid = { x: (padLast.x + p.x) / 2, y: (padLast.y + p.y) / 2 };
      padCtx.beginPath();
      padCtx.moveTo(padMid.x, padMid.y);
      padCtx.quadraticCurveTo(padLast.x, padLast.y, mid.x, mid.y);
      padCtx.stroke();
      padLast = p; padMid = mid;
    }
  });
  const padEnd = () => { padDrawing = false; };
  sig.pad.addEventListener('pointerup', padEnd);
  sig.pad.addEventListener('pointercancel', padEnd);
  $('btnPadClear').addEventListener('click', () => {
    if (!padCtx) return;
    padCtx.save(); padCtx.setTransform(1, 0, 0, 1, 0, 0);
    padCtx.clearRect(0, 0, sig.pad.width, sig.pad.height);
    padCtx.restore();
    sig.strokes = 0;
  });
  function bindSwatches(boxId, cb) {
    const box = $(boxId);
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      cb(b.dataset.c);
    }));
  }
  bindSwatches('penColors', (c) => { sig.penColor = c; });
  bindSwatches('typeColors', (c) => { sig.typeColor = c; renderSigFonts(); });

  // 이미지 올리기
  $('btnSigFile').addEventListener('click', () => $('sigFile').click());
  $('sigFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      sig.upload = await fileToImageData(f, 1600);
      await refreshSigUpload();
    } catch (err) { toast('이미지를 읽을 수 없습니다.'); }
  });
  async function refreshSigUpload() {
    if (!sig.upload) return;
    const src = $('sigUpBg').checked ? await removeBackground(sig.upload.src, +$('sigUpTol').value) : sig.upload.src;
    sig.upload.out = src;
    $('sigUploadPreview').src = src;
  }
  $('sigUpBg').addEventListener('change', refreshSigUpload);
  $('sigUpTol').addEventListener('change', refreshSigUpload);

  // 이름 입력 → 필기체
  function renderSigFonts() {
    const name = $('sigName').value.trim() || '홍길동';
    const box = $('sigFontList');
    if (!box.children.length) {
      SIG_FONTS.forEach((f) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'font-opt';
        b.dataset.key = f.key;
        b.innerHTML = '<span class="nm"></span><span class="pv"></span>';
        b.querySelector('.nm').textContent = f.label;
        b.querySelector('.pv').style.fontFamily = '"' + f.css + '"';
        b.addEventListener('click', () => { sig.typeFont = f.key; renderSigFonts(); });
        box.appendChild(b);
      });
    }
    box.querySelectorAll('.font-opt').forEach((b) => {
      b.classList.toggle('on', b.dataset.key === sig.typeFont);
      const pv = b.querySelector('.pv');
      pv.textContent = name;
      pv.style.color = sig.typeColor;
    });
  }
  $('sigName').addEventListener('input', renderSigFonts);

  async function typedSignature() {
    const name = $('sigName').value.trim();
    if (!name) return null;
    const f = SIG_FONTS.find((x) => x.key === sig.typeFont);
    await document.fonts.load('100px "' + f.css + '"', name);
    const size = 160;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = size + 'px "' + f.css + '"';
    const m = ctx.measureText(name);
    c.width = Math.ceil(m.width + size);
    c.height = Math.ceil(size * 1.8);
    ctx.font = size + 'px "' + f.css + '"';
    ctx.fillStyle = sig.typeColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(name, size / 2, c.height / 2);
    return trimCanvas(c, 10);
  }

  async function insertSignature() {
    let src, w, h;
    if (sig.tab === 'draw') {
      if (!sig.strokes) { toast('먼저 서명을 그려 주세요.'); return; }
      const t = trimCanvas(sig.pad, 8);
      if (!t) { toast('먼저 서명을 그려 주세요.'); return; }
      src = t.toDataURL('image/png'); w = t.width; h = t.height;
    } else if (sig.tab === 'upload') {
      if (!sig.upload) { toast('서명 이미지를 선택해 주세요.'); return; }
      const img = await loadImage(sig.upload.out || sig.upload.src);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const t = $('sigUpBg').checked ? (trimCanvas(c, 6) || c) : c;
      src = t.toDataURL('image/png'); w = t.width; h = t.height;
    } else if (sig.tab === 'type') {
      const t = await typedSignature();
      if (!t) { toast('이름을 입력해 주세요.'); return; }
      src = t.toDataURL('image/png'); w = t.width; h = t.height;
    } else return;
    if ($('sigSave').checked) saveSignature(src, w, h);
    closeSig();
    addImage(src, w, h, { sig: true, mime: 'image/png' });
  }
  $('btnSigInsert').addEventListener('click', insertSignature);
  function closeSig() { if (sig.dlg.open) sig.dlg.close(); }

  // ---------- PDF 저장 ----------
  const fontBytesCache = {};
  async function fontBytes(file) {
    if (!fontBytesCache[file]) {
      const r = await fetch(file);
      if (!r.ok) throw new Error('글꼴을 불러오지 못했습니다: ' + file);
      fontBytesCache[file] = await r.arrayBuffer();
    }
    return fontBytesCache[file];
  }

  // 화면의 글자 줄 위쪽부터 기준선(baseline)까지 거리 / 글자 크기. 브라우저에서 직접 잼.
  const baselineCache = {};
  async function baselineRatio(css) {
    if (baselineCache[css] != null) return baselineCache[css];
    try { await document.fonts.load('100px ' + css, '가A'); } catch (e) { /* 시스템 글꼴 */ }
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:100px;line-height:' + LINE_HEIGHT + ';white-space:pre';
    box.style.fontFamily = css;
    box.innerHTML = '가A<span style="display:inline-block;width:1px;height:0;vertical-align:baseline"></span>';
    document.body.appendChild(box);
    const mark = box.lastChild;
    const v = (mark.getBoundingClientRect().bottom - box.getBoundingClientRect().top) / 100;
    box.remove();
    baselineCache[css] = v;
    return v;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // ----- 기본 글꼴: PDF에 글꼴 파일을 넣지 않는 한글 글꼴 (Adobe-Korea1, UniKS-UCS2-H) -----
  // PDF를 여는 프로그램이 그 기기의 한글 글꼴로 대신 그립니다.
  function sysFontRef(doc, f, cache) {
    if (cache[f.key]) return cache[f.key];
    const { PDFString } = PDFLib;
    const ctx = doc.context;
    const fd = ctx.register(ctx.obj({
      Type: 'FontDescriptor', FontName: f.pdfName, Flags: f.flags,
      FontBBox: [-100, -150, 1100, 900], ItalicAngle: 0, Ascent: 880, Descent: -120, CapHeight: 700, StemV: 80,
    }));
    const cid = ctx.register(ctx.obj({
      Type: 'Font', Subtype: 'CIDFontType0', BaseFont: f.pdfName,
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Korea1'), Supplement: 2 },
      FontDescriptor: fd, DW: 1000, W: asciiWidths(f.stack),
    }));
    cache[f.key] = ctx.register(ctx.obj({
      Type: 'Font', Subtype: 'Type0', BaseFont: f.pdfName + '-UniKS-UCS2-H', Encoding: 'UniKS-UCS2-H', DescendantFonts: [cid],
    }));
    return cache[f.key];
  }

  const measureCtx = document.createElement('canvas').getContext('2d');
  // 영문/숫자 폭 (Adobe-Korea1 의 비례폭 CID 1~95, 반각 CID 8094~8190 = 문자 0x20~0x7E)
  function asciiWidths(stack) {
    measureCtx.font = '1000px ' + stack;
    const ws = [];
    for (let c = 0x20; c <= 0x7e; c++) ws.push(Math.round(measureCtx.measureText(String.fromCharCode(c)).width));
    return [1, ws, 8094, ws];
  }
  // 글자마다 화면과 같은 자리에 놓이도록 간격을 맞춰 씀 (여는 기기의 글꼴 폭과 상관없이 위치 고정)
  function drawSysText(doc, page, fontRef, line, opt) {
    const L = PDFLib;
    const name = page.node.newFontDictionary('KoSys', fontRef);
    measureCtx.font = '100px ' + opt.stack;
    const chars = [...line].map((c) => (c.codePointAt(0) > 0xffff ? '?' : c));
    const xs = chars.map((_, i) => measureCtx.measureText(chars.slice(0, i).join('')).width * opt.size / 100);
    // PDF 안에 적어 둔 글자 폭 (영문은 asciiWidths, 나머지는 전각 1000)
    measureCtx.font = '1000px ' + opt.stack;
    const asciiW = {};
    for (let n = 0x20; n <= 0x7e; n++) asciiW[n] = Math.round(measureCtx.measureText(String.fromCharCode(n)).width) * opt.size / 1000;
    const advOf = (c) => { const n = c.charCodeAt(0); return asciiW[n] != null ? asciiW[n] : opt.size; };
    const arr = doc.context.obj([]);
    chars.forEach((c, i) => {
      if (i > 0) {
        const adj = (xs[i - 1] + advOf(chars[i - 1]) - xs[i]) * 1000 / opt.size;
        if (Math.abs(adj) > 0.01) arr.push(L.PDFNumber.of(Math.round(adj * 100) / 100));
      }
      arr.push(L.PDFHexString.of(c.charCodeAt(0).toString(16).padStart(4, '0')));
    });
    page.pushOperators(
      L.pushGraphicsState(),
      L.beginText(),
      L.setFillingColor(opt.color),
      L.setFontAndSize(name, opt.size),
      L.rotateAndSkewTextDegreesAndTranslate(opt.rot, 0, 0, opt.x, opt.y),
      L.PDFOperator.of(L.PDFOperatorNames.ShowTextAdjusted, [arr]),
      L.endText(),
      L.popGraphicsState(),
    );
  }

  // 이 컴퓨터의 글꼴 파일 읽기. 여러 글꼴이 묶인 파일(.ttc)은 하나만 꺼냄
  async function localFontBytes(f) {
    const buf = new Uint8Array(await (await f.fontData.blob()).arrayBuffer());
    const tag = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    let out = buf;
    if (tag === 'ttcf') out = extractFromCollection(buf, f.fontData.postscriptName);
    const t2 = String.fromCharCode(out[0], out[1], out[2], out[3]);
    // CFF(OTF) 글꼴은 쓴 글자만 넣기가 안 되어 파일 전체가 들어가므로 쓰지 않음
    if (t2 === 'OTTO') throw new Error('CFF 글꼴은 쓴 글자만 넣을 수 없음');
    return out;
  }
  function extractFromCollection(buf, psName) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const n = dv.getUint32(8);
    let first = null;
    for (let k = 0; k < n; k++) {
      const off = dv.getUint32(12 + k * 4);
      const numTables = dv.getUint16(off + 4);
      const recs = [];
      for (let t = 0; t < numTables; t++) {
        const r = off + 12 + t * 16;
        recs.push({ tag: dv.getUint32(r), sum: dv.getUint32(r + 4), off: dv.getUint32(r + 8), len: dv.getUint32(r + 12) });
      }
      let size = 12 + numTables * 16;
      recs.forEach((r) => { size += (r.len + 3) & ~3; });
      const out = new Uint8Array(size);
      const ov = new DataView(out.buffer);
      out.set(buf.subarray(off, off + 12), 0);
      let pos = 12 + numTables * 16;
      recs.forEach((r, t) => {
        const h = 12 + t * 16;
        ov.setUint32(h, r.tag); ov.setUint32(h + 4, r.sum); ov.setUint32(h + 8, pos); ov.setUint32(h + 12, r.len);
        out.set(buf.subarray(r.off, r.off + r.len), pos);
        pos += (r.len + 3) & ~3;
      });
      if (!first) first = out;
      try { if (fontkit.create(out).postscriptName === psName) return out; } catch (e) { /* 다음 */ }
    }
    if (first) return first;
    throw new Error('글꼴 묶음에서 글꼴을 찾지 못함');
  }

  async function downloadPdf() {
    if (!state.pdf) return;
    select(null);
    busy(true, 'PDF 만드는 중...');
    try {
      const { PDFDocument, degrees } = PDFLib;
      const doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true });
      doc.registerFontkit(fontkit);
      const pages = doc.getPages();
      const embeddedFonts = {};
      const embeddedImages = new Map();
      const sysFonts = {};
      const fallbackNames = new Set();

      for (const o of state.objects) {
        if (o.type === 'text' && !String(o.text).trim()) continue;
        const pjs = await state.pdf.getPage(o.page);
        const vp = pjs.getViewport({ scale: 1 });
        const page = pages[o.page - 1];
        const rot = ((pjs.rotate % 360) + 360) % 360;
        // 화면 좌표(배율 1) → PDF 좌표
        const toPdf = (x, y) => vp.convertToPdfPoint(x, y);

        if (o.type === 'text') {
          let f = fontByKey(o.font);
          let font = null;
          if (f.group !== 'sys') {
            try {
              if (!embeddedFonts[f.key]) {
                const bytes = f.group === 'local' ? await localFontBytes(f) : await fontBytes(f.file);
                embeddedFonts[f.key] = await doc.embedFont(bytes, { subset: true });
              }
              font = embeddedFonts[f.key];
            } catch (e) {
              console.warn(e);
              fallbackNames.add(f.label);
              f = FONTS[0];
            }
          }
          const bl = await baselineRatio(f.stack);
          const lines = String(o.text).split('\n');
          lines.forEach((line, i) => {
            if (!line) return;
            const [px, py] = toPdf(o.x, o.y + (i * LINE_HEIGHT + bl) * o.size);
            if (font) {
              page.drawText(line, { x: px, y: py, size: o.size, font, color: hexToRgb(o.color), rotate: degrees(rot) });
            } else {
              drawSysText(doc, page, sysFontRef(doc, f, sysFonts), line, { x: px, y: py, size: o.size, color: hexToRgb(o.color), rot, stack: f.stack });
            }
          });
        } else {
          let img = embeddedImages.get(o.src);
          if (!img) {
            img = /^data:image\/jpe?g/i.test(o.src) ? await doc.embedJpg(o.src) : await doc.embedPng(await toPngDataUrl(o.src));
            embeddedImages.set(o.src, img);
          }
          // 회전된 페이지에서도 보이는 대로 놓이도록 화면상 왼쪽 아래 모서리를 기준점으로 씀
          const [px, py] = toPdf(o.x, o.y + o.h);
          page.drawImage(img, { x: px, y: py, width: o.w, height: o.h, rotate: degrees(rot) });
        }
      }
      const out = await doc.save();
      const blob = new Blob([out], { type: 'application/pdf' });
      const name = state.fileName.replace(/\.pdf$/i, '') + '_편집.pdf';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      toast(fallbackNames.size
        ? '다운로드했습니다. "' + [...fallbackNames].join(', ') + '" 글꼴은 PDF에 넣을 수 없어 기본 고딕으로 저장했습니다.'
        : '다운로드했습니다: ' + name, fallbackNames.size ? 6000 : 2600);
    } catch (e) {
      console.error(e);
      toast('PDF를 만들지 못했습니다. ' + (e && e.message ? e.message : ''), 5000);
    } finally {
      busy(false);
    }
  }

  // PNG/JPEG 가 아닌 data URL(예: webp, gif) 은 PNG 로 바꿈
  async function toPngDataUrl(src) {
    if (/^data:image\/png/i.test(src)) return src;
    const img = await loadImage(src);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  }

  // ---------- 이벤트 연결 ----------
  const pickPdf = () => el.filePdf.click();
  $('btnOpen').addEventListener('click', pickPdf);
  el.dropzone.addEventListener('click', pickPdf);
  el.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickPdf(); } });
  el.filePdf.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openPdfFile(f); });
  $('btnText').addEventListener('click', addText);
  $('btnImage').addEventListener('click', () => el.fileImage.click());
  el.fileImage.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; onImageFile(f); });
  $('btnSign').addEventListener('click', openSignDialog);
  $('btnDownload').addEventListener('click', downloadPdf);
  $('btnDownload2').addEventListener('click', downloadPdf);

  $('btnPrev').addEventListener('click', () => goPage(state.page - 1));
  $('btnNext').addEventListener('click', () => goPage(state.page + 1));
  el.pageNum.addEventListener('change', () => goPage(+el.pageNum.value));
  $('btnZoomIn').addEventListener('click', () => zoom(1.2));
  $('btnZoomOut').addEventListener('click', () => zoom(1 / 1.2));
  $('btnFit').addEventListener('click', () => { state.fit = true; renderPage(); });

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (state.pdf && state.fit) renderPage(); if (sig.dlg.open && sig.tab === 'draw' && !sig.strokes) { padCtx = null; setupPad(); } }, 150);
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing || sig.dlg.open || $('donate').open || !state.pdf) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selId) { e.preventDefault(); deleteObj(state.selId); }
    else if (e.key === 'Escape') select(null);
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') goPage(state.page + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goPage(state.page - 1);
  });

  // 파일 끌어다 놓기
  ['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.remove('over'); }));
  window.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) openPdfFile(f);
    else if (/^image\//.test(f.type) && state.pdf) onImageFile(f);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.objects.length) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- 후원하기 (포토웍스 웹과 같은 방식) ----------
  // 카카오페이 송금 링크는 휴대폰에서만 열리므로 컴퓨터에서는 QR 코드를 보여줌
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPadOS
  $('kakao-pay-link').hidden = !isMobile;
  $('kakao-desktop-hint').hidden = isMobile;
  if (isMobile) $('kakao-hint').textContent = '위 버튼을 누르면 카카오페이 송금 화면이 열립니다. 다른 휴대폰으로는 QR 코드를 찍어도 됩니다.';
  $('kakao-share').hidden = !navigator.share;
  function selectDonateTab(which) {
    ['kakao', 'github'].forEach((k) => {
      $('tab-' + k).setAttribute('aria-selected', String(k === which));
      $('panel-' + k).hidden = k !== which;
    });
  }
  $('tab-kakao').addEventListener('click', () => selectDonateTab('kakao'));
  $('tab-github').addEventListener('click', () => selectDonateTab('github'));
  $('donate-open').addEventListener('click', () => { selectDonateTab('kakao'); $('donate').showModal(); });
  $('donate').addEventListener('click', (e) => { if (e.target === $('donate')) $('donate').close(); }); // 바깥 누르면 닫기
  $('kakao-copy').addEventListener('click', async () => {
    const url = $('kakao-url').value;
    try { await navigator.clipboard.writeText(url); } catch (e) { $('kakao-url').select(); document.execCommand('copy'); }
    $('kakao-copy').textContent = '복사됨';
    setTimeout(() => { $('kakao-copy').textContent = '주소 복사'; }, 1500);
  });
  $('kakao-share').addEventListener('click', () => {
    navigator.share({ title: 'PDF웍스 웹 후원 (카카오페이)', url: $('kakao-url').value }).catch(() => {});
  });

  // 테스트용 (브라우저 콘솔에서 상태 확인)
  window.__pdfEditor = { state, openPdfFile, addText, addImage, downloadPdf };
})();
