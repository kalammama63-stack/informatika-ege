// Общий код для всех страниц курса.

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранения */ } },
};
const PAGE = location.pathname.split('/').pop() || 'index.html';
const norm = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).join('\n').trim();

/* ---------- Python ---------- */
const Py = {
  worker: null, isReady: false, waiters: [], pending: null, statusEls: new Set(),
  status(text) { this.statusEls.forEach((el) => { el.textContent = text; }); },
  start() {
    if (this.worker) return;
    this.isReady = false;
    this.status('Загружаю Python… В первый раз это 10–20 секунд.');
    this.worker = new Worker('py-worker.js');
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') {
        this.isReady = true;
        this.status('Python готов.');
        this.waiters.splice(0).forEach((f) => f());
      } else if (m.type === 'fail') {
        this.status('Python не загрузился. Проверь интернет и обнови страницу.');
      } else if (m.type === 'result' && this.pending) {
        const p = this.pending; this.pending = null;
        clearTimeout(p.timer); p.resolve({ out: m.out, err: m.err });
      }
    };
  },
  whenReady() {
    this.start();
    return this.isReady ? Promise.resolve() : new Promise((r) => this.waiters.push(r));
  },
  async run(code, stdin, echo) {
    await this.whenReady();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Программа зависла: перезапускаем Python
        this.pending = null;
        this.worker.terminate(); this.worker = null;
        resolve({ out: '', err: 'Программа работает дольше 7 секунд. Похоже на бесконечный цикл: проверь условие в while. Python перезапускается, подожди немного.' });
        this.start();
      }, 7000);
      this.pending = { resolve, timer };
      this.worker.postMessage({ id: Date.now(), code, stdin, echo });
    });
  },
};

// Удобный ввод кода: Tab = 4 пробела, Enter сохраняет отступ (и добавляет после «:»)
function smartEditor(ta) {
  ta.spellcheck = false;
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('autocomplete', 'off');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px'; };
  ta.addEventListener('input', fit); setTimeout(fit, 0);
  ta.addEventListener('keydown', (e) => {
    const s = ta.selectionStart, v = ta.value;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault(); ta.setRangeText('    ', s, ta.selectionEnd, 'end');
    } else if (e.key === 'Enter') {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(lineStart, s);
      let ind = line.match(/^ */)[0];
      if (/:\s*$/.test(line)) ind += '    ';
      e.preventDefault(); ta.setRangeText('\n' + ind, s, ta.selectionEnd, 'end');
      fit();
    }
  });
}

function setupPy(box, idx) {
  const ta = box.querySelector('textarea.code');
  const start = ta.value;
  const tests = box.dataset.tests ? JSON.parse(box.dataset.tests) : null;
  const key = 'code:' + PAGE + ':' + idx;
  const saved = store.get(key, null);
  if (saved !== null) ta.value = saved;
  smartEditor(ta);
  ta.addEventListener('input', () => store.set(key, ta.value));
  ta.addEventListener('focus', () => Py.start(), { once: true });

  let stdin = null;
  if (box.hasAttribute('data-stdin') || /input\s*\(/.test(start) || tests) {
    const w = document.createElement('div'); w.className = 'stdin-wrap';
    w.innerHTML = '<label>Ввод: что программа получит через input() — каждое значение с новой строки</label><textarea class="stdin" rows="2"></textarea>';
    stdin = w.querySelector('textarea');
    stdin.value = box.dataset.stdin || (tests ? tests[0].in : '');
    ta.after(w);
  }
  const bar = document.createElement('div'); bar.className = 'bar';
  const runB = document.createElement('button'); runB.textContent = '▶ Запустить';
  bar.append(runB);
  let checkB = null;
  if (tests) { checkB = document.createElement('button'); checkB.className = 'ghost'; checkB.textContent = '✓ Проверить'; bar.append(checkB); }
  const reset = document.createElement('button'); reset.className = 'ghost'; reset.textContent = 'Сначала';
  bar.append(reset);
  const st = document.createElement('span'); st.className = 'status'; bar.append(st);
  Py.statusEls.add(st);
  const out = document.createElement('div'); out.className = 'out';
  box.append(bar, out);

  const show = (cls, html) => { out.className = 'out show ' + cls; out.innerHTML = html; };
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const busy = (b) => { runB.disabled = b; if (checkB) checkB.disabled = b; };

  runB.onclick = async () => {
    busy(true); if (!Py.isReady) show('', '<span class="label">Подожди, загружаю Python…</span>');
    const r = await Py.run(ta.value, stdin ? stdin.value : '', true);
    busy(false);
    if (r.err) show('err', (r.out ? '<span class="label">Программа успела вывести:</span>' + esc(r.out) + '\n\n' : '') + esc(r.err));
    else show('', '<span class="label">Результат:</span>' + (r.out ? esc(r.out) : '(программа ничего не вывела — нет print)'));
  };
  reset.onclick = () => { if (confirm('Вернуть программу к началу? Твои изменения сотрутся.')) { ta.value = start; store.set(key, start); ta.dispatchEvent(new Event('input')); out.className = 'out'; } };
  if (checkB) {
    checkB.onclick = async () => {
      busy(true); if (!Py.isReady) show('', '<span class="label">Подожди, загружаю Python…</span>');
      let passed = 0, fail = null;
      for (const t of tests) {
        const r = await Py.run(ta.value, t.in || '', false);
        if (!r.err && norm(r.out) === norm(t.out)) passed++;
        else if (!fail) fail = { t, r };
      }
      busy(false);
      if (!fail) {
        show('good', `Верно! Программа прошла все проверки: ${passed} из ${tests.length}.`);
        box.classList.add('solved'); store.set('ok:' + key, true);
      } else {
        const inp = fail.t.in ? `При вводе:\n${esc(fail.t.in)}\n\n` : '';
        const got = fail.r.err ? esc(fail.r.err) : `Программа вывела:\n${esc(fail.r.out) || '(ничего)'}`;
        show('err', `Пройдено проверок: ${passed} из ${tests.length}.\n\n${inp}Ожидалось:\n${esc(fail.t.out)}\n\n${got}`);
      }
    };
    if (store.get('ok:' + key, false)) box.classList.add('solved');
  }
}

/* ---------- Проверка ответа ---------- */
function setupAnswer(box, idx) {
  const right = box.dataset.answer.split('|').map((a) => a.trim().toLowerCase().replace(',', '.'));
  const key = 'ans:' + PAGE + ':' + idx;
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<input type="text" inputmode="decimal" aria-label="Ответ" placeholder="Ответ"><button>Проверить</button>';
  const v = document.createElement('div'); v.className = 'verdict';
  const hint = box.querySelector('details');
  if (hint) { box.insertBefore(row, hint); box.insertBefore(v, hint); } else box.append(row, v);
  const inp = row.querySelector('input');
  // 240 и 240.0 — один и тот же ответ
  const same = (a, r) => a === r || (a !== '' && !isNaN(a) && !isNaN(r) && Number(a) === Number(r));
  const check = () => {
    const a = inp.value.trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
    if (!a) return;
    if (right.some((r) => same(a, r))) {
      v.className = 'verdict ok'; v.textContent = 'Верно! 🎉'; box.classList.add('solved'); store.set(key, inp.value);
    } else {
      v.className = 'verdict no'; v.textContent = 'Пока неверно. Посмотри подсказку и попробуй ещё раз.';
    }
  };
  row.querySelector('button').onclick = check;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  const s = store.get(key, null);
  if (s) { inp.value = s; box.classList.add('solved'); v.className = 'verdict ok'; v.textContent = 'Решено ✓'; }
}

/* ---------- Шаги по кнопке ---------- */
function setupSteps(box) {
  const items = [...box.querySelectorAll('li')];
  items.forEach((li, i) => { if (i > 0) li.classList.add('hidden'); });
  const b = document.createElement('button'); b.className = 'ghost';
  const label = () => { const left = items.filter((li) => li.classList.contains('hidden')).length; b.textContent = left ? `Следующий шаг (осталось ${left})` : 'Все шаги открыты'; b.disabled = !left; };
  b.onclick = () => { const n = items.find((li) => li.classList.contains('hidden')); if (n) n.classList.remove('hidden'); label(); };
  label(); box.append(b);
}

/* ---------- Кнопка «Скопировать» ---------- */
function setupCopy(pre) {
  const b = document.createElement('button'); b.className = 'copy ghost'; b.textContent = 'Скопировать';
  b.onclick = async () => {
    const text = pre.querySelector('code').innerText;
    try { await navigator.clipboard.writeText(text); b.textContent = 'Скопировано ✓'; } catch (e) { b.textContent = 'Выдели и скопируй вручную'; }
    setTimeout(() => { b.textContent = 'Скопировать'; }, 2000);
  };
  pre.append(b);
}

/* ---------- Карта побед (главная) ---------- */
function setupMap(box) {
  const tasks = JSON.parse(box.dataset.tasks);
  const state = store.get('map', {});
  const score = document.querySelector('.score');
  const paint = () => { if (score) score.textContent = Object.values(state).filter((s) => s === 'done').length; };
  tasks.forEach(([n, name]) => {
    const b = document.createElement('button');
    b.innerHTML = `<b>${n}</b>${name}`;
    const apply = () => { b.className = state[n] || ''; b.setAttribute('aria-label', `Задание ${n}: ${name}. ${state[n] === 'done' ? 'Умею' : state[n] === 'learn' ? 'Учу' : 'Ещё не начато'}`); };
    b.onclick = () => { state[n] = state[n] === undefined ? 'learn' : state[n] === 'learn' ? 'done' : undefined; if (!state[n]) delete state[n]; store.set('map', state); apply(); paint(); };
    apply(); box.append(b);
  });
  paint();
}

// Счётчик «Решено на странице»
function updateProgress() {
  const el = document.querySelector('.progress');
  if (!el) return;
  const all = document.querySelectorAll('.answer, .py[data-tests]');
  const done = document.querySelectorAll('.answer.solved, .py[data-tests].solved');
  el.textContent = `${done.length} из ${all.length}`;
}
new MutationObserver(updateProgress).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

document.querySelectorAll('.py').forEach(setupPy);
document.querySelectorAll('.answer').forEach(setupAnswer);
document.querySelectorAll('.steps').forEach(setupSteps);
// Нумерация строк в коде: каждая строка — отдельный span (номер рисует CSS и не копируется)
document.querySelectorAll('pre.num code').forEach((code) => {
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  code.innerHTML = code.textContent.replace(/\n$/, '').split('\n').map((l) => `<span class="cl">${esc(l)}</span>`).join('\n');
});
document.querySelectorAll('pre.tpl').forEach(setupCopy);
document.querySelectorAll('.map').forEach(setupMap);
updateProgress();
