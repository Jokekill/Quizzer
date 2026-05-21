(() => {
  'use strict';

  const RESOURCES_DIR = 'resources/';
  const RESOURCES_INDEX = RESOURCES_DIR + 'index.json';
  const ROLE_LABELS = {
    question: 'Otázka',
    answer: 'Odpověď',
    correct: 'Správná odpověď',
    explanation: 'Vysvětlení',
    ignore: 'Ignorovat',
  };

  const state = {
    rawText: '',
    delimiter: ';',
    headers: [],
    rows: [],
    mapping: null,
    questions: [],
    mode: null,
    quiz: null,
  };

  const app = document.getElementById('app');
  const navHome = document.getElementById('nav-home');

  navHome.addEventListener('click', () => showHome());

  // ----- CSV parsing -----
  function parseCSV(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++;
      } else {
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === delimiter) { row.push(field); field = ''; i++; continue; }
        if (c === '\r') { i++; continue; }
        if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
        field += c; i++;
      }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows
      .filter(r => r.some(cell => cell && cell.trim() !== ''))
      .map(r => r.map(cell => cell.trim()));
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const candidates = [';', ',', '\t'];
    let best = ';', bestCount = -1;
    for (const d of candidates) {
      const count = firstLine.split(d).length - 1;
      if (count > bestCount) { best = d; bestCount = count; }
    }
    return best;
  }

  // ----- Util -----
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function clearView() { app.innerHTML = ''; }
  function mountTemplate(id) {
    clearView();
    const tpl = document.getElementById(id);
    const node = tpl.content.cloneNode(true);
    const wrapper = document.createElement('div');
    wrapper.className = 'fade-in';
    wrapper.appendChild(node);
    app.appendChild(wrapper);
  }

  // ----- View: Home (library + upload) -----
  function showHome() {
    state.quiz = null;
    state.mode = null;
    mountTemplate('view-home');

    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    const dropzone = document.getElementById('dropzone');
    const delimSelect = document.getElementById('delimiter-select');
    const list = document.getElementById('library-list');
    const empty = document.getElementById('library-empty');

    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFile(file, delimSelect.value);
    });

    ['dragenter', 'dragover'].forEach(ev => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file, delimSelect.value);
    });

    fetchResourceIndex()
      .then(files => {
        if (!files || files.length === 0) {
          empty.hidden = false;
          return;
        }
        files.forEach(file => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'library-item';
          item.innerHTML = `
            <span class="library-item-name"></span>
            <span class="library-item-file"></span>
          `;
          item.querySelector('.library-item-name').textContent = prettifyName(file);
          item.querySelector('.library-item-file').textContent = file;
          item.addEventListener('click', () => {
            if (item.classList.contains('is-loading')) return;
            item.classList.add('is-loading');
            loadFromResource(file)
              .catch(err => {
                item.classList.remove('is-loading');
                alert('Nepodařilo se načíst „' + file + '": ' + err.message);
              });
          });
          list.appendChild(item);
        });
      })
      .catch(() => {
        empty.hidden = false;
        empty.textContent = 'Knihovnu se nepodařilo načíst. Pokud testuješ lokálně, otevři aplikaci přes http server.';
      });
  }

  function prettifyName(filename) {
    return String(filename)
      .replace(/\.csv$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fetchResourceIndex() {
    return fetch(RESOURCES_INDEX, { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        if (!Array.isArray(data)) return [];
        return data
          .map(x => typeof x === 'string' ? x : (x && x.file))
          .filter(x => typeof x === 'string' && x.toLowerCase().endsWith('.csv'));
      });
  }

  function loadFromResource(filename) {
    return fetch(RESOURCES_DIR + encodeURIComponent(filename), { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(text => loadCsvText(text, 'auto'));
  }

  function handleFile(file, delimChoice) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      loadCsvText(text, delimChoice);
    };
    reader.readAsText(file);
  }

  function loadCsvText(text, delimChoice) {
    const delimiter = (delimChoice === 'auto' || !delimChoice)
      ? detectDelimiter(text)
      : (delimChoice === '\\t' ? '\t' : delimChoice);
    const rows = parseCSV(text, delimiter);
    if (rows.length < 2) {
      alert('CSV se nepodařilo načíst nebo neobsahuje žádné řádky s daty.');
      return;
    }
    state.rawText = text;
    state.delimiter = delimiter;
    state.headers = rows[0];
    state.rows = rows.slice(1);
    state.mapping = autoMap(state.headers);
    showMapping();
  }

  function autoMap(headers) {
    const m = { question: null, answers: [], correct: null, explanation: null };
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    headers.forEach((h, idx) => {
      const nh = norm(h);
      if (m.question === null && (nh.includes('otaz') || nh === 'question' || nh === 'q')) {
        m.question = idx;
      } else if (m.correct === null && (nh.includes('spravn') || nh.includes('correct') || nh.includes('answer key'))) {
        m.correct = idx;
      } else if (m.explanation === null && (nh.includes('vysvet') || nh.includes('expl') || nh.includes('reason') || nh.includes('comment'))) {
        m.explanation = idx;
      } else {
        if (h && h.length <= 4) m.answers.push(idx);
      }
    });
    if (m.answers.length < 2) {
      m.answers = [];
      headers.forEach((h, idx) => {
        if (idx !== m.question && idx !== m.correct && idx !== m.explanation) m.answers.push(idx);
      });
    }
    return m;
  }

  // ----- View: Mapping -----
  function showMapping() {
    mountTemplate('view-mapping');

    const grid = document.getElementById('mapping-grid');
    const preview = document.getElementById('preview');
    const errBox = document.getElementById('mapping-error');
    const backBtn = document.getElementById('back-to-upload');
    const confirmBtn = document.getElementById('confirm-mapping');

    const roles = ['ignore', 'question', 'answer', 'correct', 'explanation'];
    const currentRoles = state.headers.map((_, idx) => {
      if (state.mapping.question === idx) return 'question';
      if (state.mapping.correct === idx) return 'correct';
      if (state.mapping.explanation === idx) return 'explanation';
      if (state.mapping.answers.includes(idx)) return 'answer';
      return 'ignore';
    });

    state.headers.forEach((h, idx) => {
      const name = document.createElement('div');
      name.className = 'mapping-col-name';
      const sampleVal = (state.rows[0] && state.rows[0][idx]) || '';
      name.innerHTML = `<strong>${escapeHtml(h || '(bez názvu)')}</strong><span class="sample">${escapeHtml(truncate(sampleVal, 32))}</span>`;
      grid.appendChild(name);

      const select = document.createElement('select');
      select.dataset.colIdx = String(idx);
      roles.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = ROLE_LABELS[r];
        if (r === currentRoles[idx]) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => {
        currentRoles[idx] = select.value;
      });
      grid.appendChild(select);
    });

    // Preview
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    state.headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h || '(bez názvu)';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    state.rows.slice(0, 5).forEach(r => {
      const tr = document.createElement('tr');
      state.headers.forEach((_, i) => {
        const td = document.createElement('td');
        td.textContent = r[i] || '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    preview.appendChild(table);

    backBtn.addEventListener('click', showHome);

    confirmBtn.addEventListener('click', () => {
      const mapping = { question: null, answers: [], correct: null, explanation: null };
      currentRoles.forEach((role, idx) => {
        if (role === 'question') mapping.question = idx;
        else if (role === 'correct') mapping.correct = idx;
        else if (role === 'explanation') mapping.explanation = idx;
        else if (role === 'answer') mapping.answers.push(idx);
      });

      const errors = validateMapping(mapping);
      if (errors.length) {
        errBox.hidden = false;
        errBox.textContent = errors.join(' ');
        return;
      }
      errBox.hidden = true;
      state.mapping = mapping;
      buildQuestions();
      if (state.questions.length === 0) {
        errBox.hidden = false;
        errBox.textContent = 'Po zpracování CSV nebyla nalezena žádná použitelná otázka.';
        return;
      }
      showModeSelect();
    });
  }

  function validateMapping(m) {
    const errs = [];
    if (m.question === null) errs.push('Vyber sloupec s otázkou.');
    if (m.answers.length < 2) errs.push('Vyber alespoň dva sloupce s odpověďmi.');
    if (m.correct === null) errs.push('Vyber sloupec se správnou odpovědí.');
    return errs;
  }

  function buildQuestions() {
    const { question: qi, answers: ais, correct: ci, explanation: ei } = state.mapping;
    const questions = [];
    state.rows.forEach((row, rowIdx) => {
      const qText = (row[qi] || '').trim();
      if (!qText) return;
      const answers = ais
        .map(i => ({ idx: i, text: (row[i] || '').trim() }))
        .filter(a => a.text !== '');
      if (answers.length < 2) return;
      const correctRaw = (row[ci] || '').trim();
      const correctIdx = resolveCorrect(correctRaw, ais, answers, state.headers);
      if (correctIdx === -1) return;
      const explanation = ei != null ? (row[ei] || '').trim() : '';
      questions.push({
        id: 'q' + rowIdx,
        text: qText,
        answers: answers.map(a => a.text),
        correctIndex: correctIdx,
        explanation,
      });
    });
    state.questions = questions;
  }

  function resolveCorrect(raw, answerColIdxs, answers, headers) {
    if (!raw) return -1;
    const trimmed = raw.trim();
    // 1) single letter matching one of the answer column headers
    if (/^[A-Za-z]$/.test(trimmed)) {
      const target = trimmed.toUpperCase();
      for (let i = 0; i < answerColIdxs.length; i++) {
        const colIdx = answerColIdxs[i];
        const header = (headers[colIdx] || '').trim().toUpperCase();
        if (header === target) {
          const pos = answers.findIndex(a => a.idx === colIdx);
          if (pos !== -1) return pos;
        }
      }
      // 2) by position A=0, B=1, ...
      const code = target.charCodeAt(0) - 65;
      if (code >= 0 && code < answers.length) return code;
    }
    // 3) match by text against answers
    const normalized = trimmed.toLowerCase();
    const pos = answers.findIndex(a => a.text.toLowerCase() === normalized);
    if (pos !== -1) return pos;
    // 4) numeric position (1-based)
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10) - 1;
      if (n >= 0 && n < answers.length) return n;
    }
    return -1;
  }

  // ----- View: Mode select -----
  function showModeSelect() {
    mountTemplate('view-mode');
    document.getElementById('loaded-count').textContent = String(state.questions.length);
    document.getElementById('mode-learn').addEventListener('click', () => startQuiz('learn'));
    document.getElementById('mode-exam').addEventListener('click', () => startQuiz('exam'));
    document.getElementById('back-to-mapping').addEventListener('click', showMapping);
  }

  // ----- Quiz logic -----
  function preparePerQuestion(q) {
    const order = shuffle(q.answers.map((_, i) => i));
    return {
      ...q,
      displayAnswers: order.map(i => q.answers[i]),
      displayCorrectIndex: order.indexOf(q.correctIndex),
      _order: order,
    };
  }

  function startQuiz(mode, subset) {
    state.mode = mode;
    const source = (subset && subset.length) ? subset : state.questions;
    const prepared = shuffle(source).map(preparePerQuestion);

    if (mode === 'learn') {
      state.quiz = {
        mode,
        queue: prepared.slice(),
        total: prepared.length,
        learnedIds: new Set(),
        seen: 0,
        current: null,
        currentAnswered: false,
        currentSelectedIndex: -1,
        currentWasCorrect: false,
        history: [],
      };
    } else {
      state.quiz = {
        mode,
        list: prepared,
        index: 0,
        answers: new Array(prepared.length).fill(-1),
      };
    }
    nextQuestion();
  }

  function nextQuestion() {
    if (state.mode === 'learn') {
      const q = state.quiz.queue.shift();
      if (!q) { showResults(); return; }
      state.quiz.current = q;
      state.quiz.currentAnswered = false;
      state.quiz.currentSelectedIndex = -1;
      state.quiz.currentWasCorrect = false;
    } else {
      if (state.quiz.index >= state.quiz.list.length) { showResults(); return; }
    }
    renderQuiz();
  }

  function renderQuiz() {
    mountTemplate('view-quiz');
    const qText = document.getElementById('question-text');
    const answersDiv = document.getElementById('answers');
    const explBox = document.getElementById('explanation');
    const primary = document.getElementById('primary-action');
    const progressFill = document.getElementById('progress-fill');
    const progressMeta = document.getElementById('progress-meta');
    const quitBtn = document.getElementById('quit-quiz');

    quitBtn.addEventListener('click', () => {
      if (confirm('Opravdu chceš ukončit kvíz?')) showHome();
    });

    let current, isLearn = state.mode === 'learn';
    if (isLearn) {
      current = state.quiz.current;
      const learned = state.quiz.learnedIds.size;
      const total = state.quiz.total;
      progressFill.style.width = ((learned / total) * 100) + '%';
      const remaining = state.quiz.queue.length + 1;
      progressMeta.textContent = `Naučeno ${learned} / ${total} · Ve frontě: ${remaining}`;
    } else {
      current = state.quiz.list[state.quiz.index];
      const total = state.quiz.list.length;
      progressFill.style.width = (((state.quiz.index) / total) * 100) + '%';
      progressMeta.textContent = `Otázka ${state.quiz.index + 1} / ${total}`;
    }

    qText.textContent = current.text;

    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    let selectedIndex = isLearn ? state.quiz.currentSelectedIndex : (state.quiz.answers[state.quiz.index] ?? -1);

    current.displayAnswers.forEach((ansText, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'answer';
      btn.innerHTML = `<span class="answer-letter">${letters[i] || (i + 1)}</span><span class="answer-text"></span>`;
      btn.querySelector('.answer-text').textContent = ansText;
      btn.addEventListener('click', () => onAnswerClick(i));
      answersDiv.appendChild(btn);
    });

    function repaintAnswers() {
      const btns = answersDiv.querySelectorAll('.answer');
      btns.forEach((btn, i) => {
        btn.classList.remove('is-selected', 'is-correct', 'is-wrong');
      });
      if (isLearn && state.quiz.currentAnswered) {
        btns.forEach((btn, i) => {
          if (i === current.displayCorrectIndex) btn.classList.add('is-correct');
          else if (i === state.quiz.currentSelectedIndex) btn.classList.add('is-wrong');
          btn.disabled = true;
        });
      } else {
        if (selectedIndex >= 0) btns[selectedIndex].classList.add('is-selected');
      }
    }

    function onAnswerClick(i) {
      if (isLearn && state.quiz.currentAnswered) return;
      selectedIndex = i;
      if (!isLearn) {
        state.quiz.answers[state.quiz.index] = i;
      } else {
        state.quiz.currentSelectedIndex = i;
      }
      repaintAnswers();
      updatePrimary();
    }

    function updatePrimary() {
      if (isLearn) {
        if (!state.quiz.currentAnswered) {
          primary.textContent = 'Zkontrolovat';
          primary.disabled = state.quiz.currentSelectedIndex < 0;
        } else {
          primary.textContent = state.quiz.queue.length === 0 ? 'Dokončit' : 'Další';
          primary.disabled = false;
        }
      } else {
        const isLast = state.quiz.index === state.quiz.list.length - 1;
        primary.textContent = isLast ? 'Dokončit' : 'Další';
        primary.disabled = state.quiz.answers[state.quiz.index] < 0;
      }
    }

    primary.addEventListener('click', () => {
      if (isLearn) {
        if (!state.quiz.currentAnswered) {
          state.quiz.currentAnswered = true;
          const wasCorrect = state.quiz.currentSelectedIndex === current.displayCorrectIndex;
          state.quiz.currentWasCorrect = wasCorrect;
          if (wasCorrect) {
            state.quiz.learnedIds.add(current.id);
          } else {
            const insertAt = Math.min(state.quiz.queue.length, randInt(5, 10));
            const requeued = preparePerQuestion(current);
            state.quiz.queue.splice(insertAt, 0, requeued);
          }
          state.quiz.history.push({
            id: current.id,
            text: current.text,
            displayAnswers: current.displayAnswers,
            correctIndex: current.displayCorrectIndex,
            selectedIndex: state.quiz.currentSelectedIndex,
            wasCorrect,
            explanation: current.explanation,
          });
          if (current.explanation) {
            explBox.hidden = false;
            explBox.innerHTML = `<div class="label">${wasCorrect ? 'Správně' : 'Vysvětlení'}</div>` + escapeHtml(current.explanation);
          } else {
            explBox.hidden = false;
            explBox.innerHTML = `<div class="label">${wasCorrect ? 'Správně' : 'Špatně'}</div>` + (wasCorrect ? 'Skvělé!' : 'Tahle otázka se vrátí později.');
          }
          repaintAnswers();
          updatePrimary();
        } else {
          nextQuestion();
        }
      } else {
        if (state.quiz.index === state.quiz.list.length - 1) {
          showResults();
        } else {
          state.quiz.index++;
          nextQuestion();
        }
      }
    });

    repaintAnswers();
    updatePrimary();
  }

  // ----- View: Results -----
  function showResults() {
    mountTemplate('view-results');
    const scoreEl = document.getElementById('score');
    const list = document.getElementById('result-list');
    const retryBtn = document.getElementById('results-retry');
    const retryWrongBtn = document.getElementById('results-retry-wrong');
    const homeBtn = document.getElementById('results-home');

    let entries;
    if (state.mode === 'learn') {
      const seen = new Set();
      const firstAttempts = [];
      state.quiz.history.forEach(h => {
        if (seen.has(h.id)) return;
        seen.add(h.id);
        firstAttempts.push(h);
      });
      entries = firstAttempts;
    } else {
      entries = state.quiz.list.map((q, i) => ({
        id: q.id,
        text: q.text,
        displayAnswers: q.displayAnswers,
        correctIndex: q.displayCorrectIndex,
        selectedIndex: state.quiz.answers[i],
        wasCorrect: state.quiz.answers[i] === q.displayCorrectIndex,
        explanation: q.explanation,
      }));
    }

    const total = entries.length;
    const correct = entries.filter(e => e.wasCorrect).length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const modeLabel = state.mode === 'learn' ? 'Učení – první pokusy' : 'Zkouška';
    scoreEl.innerHTML = `${correct} / ${total} <span class="score-percent">${pct}% · ${modeLabel}</span>`;

    if (state.mode === 'exam' && entries.some(e => !e.wasCorrect)) {
      retryWrongBtn.hidden = false;
      retryWrongBtn.addEventListener('click', () => {
        const wrongIds = new Set(entries.filter(e => !e.wasCorrect).map(e => e.id));
        const subset = state.questions.filter(q => wrongIds.has(q.id));
        startQuiz('exam', subset);
      });
    }

    const filterButtons = document.querySelectorAll('.chip');
    let activeFilter = 'all';
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        activeFilter = btn.dataset.filter;
        renderEntries();
      });
    });

    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    function renderEntries() {
      list.innerHTML = '';
      const filtered = entries.filter(e => {
        if (activeFilter === 'wrong') return !e.wasCorrect;
        if (activeFilter === 'right') return e.wasCorrect;
        return true;
      });
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = 'Žádné otázky v této kategorii.';
        list.appendChild(empty);
        return;
      }
      filtered.forEach((e, i) => {
        const item = document.createElement('div');
        item.className = 'result-item ' + (e.wasCorrect ? 'is-right' : 'is-wrong');
        const idx = entries.indexOf(e) + 1;
        const correctText = e.displayAnswers[e.correctIndex] ?? '';
        const userText = e.selectedIndex >= 0 ? (e.displayAnswers[e.selectedIndex] ?? '') : '(nezodpovězeno)';
        item.innerHTML = `
          <div class="result-q">${idx}. ${escapeHtml(e.text)}</div>
          <div class="result-a"><span class="tag right">správně</span>${escapeHtml(correctText)}</div>
          ${!e.wasCorrect ? `<div class="result-a"><span class="tag ${e.selectedIndex < 0 ? 'wrong' : 'user'}">tvá odpověď</span>${escapeHtml(userText)}</div>` : ''}
          ${e.explanation ? `<div class="result-expl">${escapeHtml(e.explanation)}</div>` : ''}
        `;
        list.appendChild(item);
      });
    }
    renderEntries();

    retryBtn.addEventListener('click', () => startQuiz(state.mode));
    homeBtn.addEventListener('click', showHome);
  }

  // ----- Helpers -----
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ----- Boot -----
  function boot() {
    showHome();
  }

  boot();
})();
