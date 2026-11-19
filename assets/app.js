/* =========================================================
   传感器刷题室 — 全题型版
   单选题 / 多选题 / 判断题 / 填空题 / 名词解释 / 简答题
   Local-only, no build step.
   ========================================================= */
(() => {
  "use strict";

  const DATA = window.HV_DATA;
  if (!DATA || !Array.isArray(DATA.questions)) {
    document.getElementById("view").innerHTML =
      '<div class="empty-state"><div class="empty-mark">!</div><h2>题库没有加载成功</h2><p>请确认 data/questions.js 与 index.html 在同一个网站文件夹中。</p></div>';
    return;
  }

  // All ids are strings so new types can coexist with the old choice ids.
  DATA.questions.forEach((q) => {
    q.id = String(q.id);
  });

  const ALL = DATA.questions;
  const BY_TYPE = {
    choice: DATA.choice || [],
    multi: DATA.multi || [],
    judge: DATA.judge || [],
    fill: DATA.fill || [],
    term: DATA.term || [],
    short: DATA.short || [],
    calc: DATA.calc || [],
  };
  for (const list of Object.values(BY_TYPE)) {
    for (const q of list) q.id = String(q.id);
  }
  const QBYID = new Map(ALL.map((q) => [q.id, q]));
  const HOMEWORK_IDS = (DATA.homework || []).map(String);
  function homeworkQuestions() {
    return HOMEWORK_IDS.map((id) => QBYID.get(id)).filter(Boolean);
  }
  function cramQuestions(type) {
    if (type === "homework") return homeworkQuestions();
    return BY_TYPE[type] || [];
  }
  const TYPES = DATA.types || [];
  const TYPE_MAP = new Map(TYPES.map((t) => [t.key, t]));
  const TYPE_KEYS = TYPES.map((t) => t.key);
  const GROUPS = DATA.groups || [];
  const ISSUES = DATA.issues || [];
  const KNOWLEDGE = DATA.knowledge || [];
  const LETTERS = ["A", "B", "C", "D"];
  const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  const CRAM_TYPES = ["fill", "short", "term", "calc", "homework"];
  const STORAGE_KEY = "sensor_quiz_state_v1";
  const SEVERITY_LABEL = { high: "高", medium: "中", low: "低" };

  const viewEl = document.getElementById("view");
  const storageNotice = document.getElementById("storageNotice");
  const modalRoot = document.getElementById("modalRoot");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalConfirm = document.getElementById("modalConfirm");
  const modalCancel = document.getElementById("modalCancel");
  const toastEl = document.getElementById("toast");

  let storageOk = true;
  let state = loadState();
  const ui = {
    route: "auto",
    resultFilter: "all",
    timerId: null,
    toastTimer: null,
    modalOpen: false,
    modalResolve: null,
    lastFocus: null,
  };

  /* -------------------------------------------------------
     Storage / migration
     ------------------------------------------------------- */

  function emptyState() {
    return {
      version: 2,
      settings: { shuffleOptions: true, randomOrder: true },
      wrong: {},
      seen: {},
      history: [],
      active: null,
      cram: defaultCram(),
    };
  }

  function defaultCram() {
    return {
      type: "fill",
      hideAnswers: false,
      positions: { fill: 0, short: 0, term: 0, calc: 0, homework: 0 },
      orders: {},
    };
  }

  function normalizeCram(cram) {
    const base = defaultCram();
    if (!cram || typeof cram !== "object") return base;
    const result = {
      type: CRAM_TYPES.includes(cram.type) ? cram.type : "fill",
      hideAnswers: Boolean(cram.hideAnswers),
      positions: { ...base.positions },
      orders: {},
    };
    for (const type of CRAM_TYPES) {
      const defaultIds = cramQuestions(type).map((q) => q.id);
      const saved = Array.isArray(cram.orders?.[type]) ? cram.orders[type] : [];
      const order = Array.from(new Set(saved.map(String))).filter((id) => QBYID.has(id));
      for (const id of defaultIds) {
        if (!order.includes(id)) order.push(id);
      }
      result.orders[type] = order.length ? order : defaultIds;
      result.positions[type] = clamp(
        Number(cram.positions?.[type]) || 0,
        0,
        Math.max(0, result.orders[type].length - 1)
      );
    }
    return result;
  }

  function loadState() {
    const base = emptyState();
    let raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      storageOk = false;
      return base;
    }
    if (!raw) return base;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch (_) {
        /* memory state still works */
      }
      return base;
    }
    if (!parsed || typeof parsed !== "object") return base;

    const history = Array.isArray(parsed.history)
      ? parsed.history.map((item) => ({ ...item, type: item.type || "choice" }))
      : [];

    return {
      ...base,
      ...parsed,
      version: 2,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      wrong: parsed.wrong && typeof parsed.wrong === "object" ? parsed.wrong : {},
      seen: parsed.seen && typeof parsed.seen === "object" ? parsed.seen : {},
      history,
      active: normalizeActive(parsed.active),
      cram: normalizeCram(parsed.cram),
    };
  }

  function normalizeActive(active) {
    if (!active || !Array.isArray(active.order)) return null;
    const order = active.order
      .map((id) => String(id))
      .filter((id) => QBYID.has(id));
    if (!order.length) return null;

    let type = active.type;
    if (!TYPE_KEYS.includes(type) && type !== "mixed") type = "choice";
    const mode = active.mode === "exam" ? "exam" : "practice";
    if (mode === "exam") type = "choice";

    const optionOrders = active.optionOrders && typeof active.optionOrders === "object"
      ? active.optionOrders
      : {};
    for (const id of order) {
      const q = QBYID.get(id);
      const valid =
        Array.isArray(optionOrders[id]) &&
        optionOrders[id].length === 4 &&
        new Set(optionOrders[id]).size === 4 &&
        optionOrders[id].every((letter) => LETTERS.includes(letter));
      optionOrders[id] = valid ? optionOrders[id] : ["A", "B", "C", "D"];
    }

    const answers = active.answers && typeof active.answers === "object" ? active.answers : {};
    for (const id of Object.keys(answers)) {
      if (!QBYID.has(String(id))) delete answers[id];
    }

    const normalized = {
      ...active,
      type,
      mode,
      origin: active.origin || (active.mode === "wrong" ? "wrong" : "practice"),
      label: active.label || "练习",
      order,
      index: clamp(Number(active.index) || 0, 0, order.length - 1),
      answers,
      flags: active.flags && typeof active.flags === "object" ? active.flags : {},
      optionOrders,
      revealed: active.revealed && typeof active.revealed === "object" ? active.revealed : {},
      drafts: active.drafts && typeof active.drafts === "object" ? active.drafts : {},
      startedAt: Number(active.startedAt) || Date.now(),
      config: active.config && typeof active.config === "object" ? active.config : {},
      finished: Boolean(active.finished),
      recorded: Boolean(active.recorded),
    };
    normalized.deadline =
      mode === "exam"
        ? Number(active.deadline) ||
          normalized.startedAt + (Number(DATA.meta?.choiceExamMinutes) || 60) * 60 * 1000
        : null;
    normalized.durationSec = Number(active.durationSec) || 0;
    return normalized;
  }

  function saveState() {
    if (!storageOk) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      storageOk = false;
      updateStorageNotice();
    }
  }

  function updateStorageNotice() {
    if (storageNotice) storageNotice.hidden = storageOk;
  }

  /* -------------------------------------------------------
     Small helpers
     ------------------------------------------------------- */

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function circleNumber(value) {
    return CIRCLED[value - 1] || `(${value})`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function formatStem(text) {
    return escapeHtml(text).replace(
      /（[\s　]*）/g,
      '（<span class="stem-blank" aria-label="空格"></span>）'
    );
  }

  function optionText(question, label) {
    return question.options?.find((option) => option.label === label)?.text || "";
  }

  function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function formatClock(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
    return `${pad2(minutes)}:${pad2(seconds)}`;
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    if (hours > 0) return `${hours}时${minutes}分`;
    return `${minutes}分${secs}秒`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function getQ(id) {
    return QBYID.get(String(id)) || null;
  }

  function typeMeta(type) {
    if (type === "homework") {
      return { key: "homework", label: "课后习题", short: "习题", count: HOMEWORK_IDS.length, unit: "题", startCount: 0 };
    }
    return TYPE_MAP.get(type) || { key: type, label: type, short: type, count: 0, startCount: 10 };
  }

  function typeLabel(type) {
    return typeMeta(type).label;
  }

  function isCardType(type) {
    return type === "term" || type === "short" || type === "calc";
  }

  function isObjectiveType(type) {
    return type === "choice" || type === "multi" || type === "judge" || type === "fill";
  }

  function activeQuestion() {
    if (!state.active) return null;
    return getQ(state.active.order[state.active.index]);
  }

  function getOptionOrder(questionId) {
    const order = state.active?.optionOrders?.[String(questionId)];
    if (
      Array.isArray(order) &&
      order.length === 4 &&
      new Set(order).size === 4 &&
      order.every((letter) => LETTERS.includes(letter))
    ) {
      return order;
    }
    return LETTERS.slice();
  }

  function displayLabel(questionId, originalLabel) {
    const index = getOptionOrder(questionId).indexOf(originalLabel);
    return index >= 0 ? LETTERS[index] : originalLabel;
  }

  function isAnswered(question, session = state.active) {
    if (!session || !question) return false;
    const answer = session.answers[question.id];
    if (question.type === "fill" || question.type === "multi") return Boolean(answer?.submitted);
    return answer != null;
  }

  function isCorrect(question, session = state.active) {
    if (!session || !question) return false;
    const answer = session.answers[question.id];
    if (question.type === "fill" || question.type === "multi") return Boolean(answer?.correct);
    if (question.type === "term" || question.type === "short" || question.type === "calc") return answer === "known";
    return answer === question.answer;
  }

  function getAnsweredCount(session = state.active) {
    if (!session) return 0;
    return session.order.filter((id) => isAnswered(getQ(id), session)).length;
  }

  function getResult(session = state.active) {
    if (!session) {
      return { total: 0, correct: 0, wrong: 0, unanswered: 0, pct: 0, wrongIds: [] };
    }
    let correct = 0;
    let wrong = 0;
    let unanswered = 0;
    const wrongIds = [];
    for (const id of session.order) {
      const q = getQ(id);
      if (!q) continue;
      if (!isAnswered(q, session)) {
        unanswered += 1;
      } else if (isCorrect(q, session)) {
        correct += 1;
      } else {
        wrong += 1;
        wrongIds.push(id);
      }
    }
    return {
      total: session.order.length,
      correct,
      wrong,
      unanswered,
      pct: percent(correct, session.order.length),
      wrongIds,
    };
  }

  function resultBreakdown(session) {
    const out = {};
    for (const id of session.order) {
      const q = getQ(id);
      if (!q) continue;
      if (!out[q.type]) out[q.type] = { total: 0, correct: 0, wrong: 0, unanswered: 0 };
      out[q.type].total += 1;
      if (!isAnswered(q, session)) out[q.type].unanswered += 1;
      else if (isCorrect(q, session)) out[q.type].correct += 1;
      else out[q.type].wrong += 1;
    }
    return out;
  }

  function typeStats(type) {
    const qs = BY_TYPE[type] || [];
    let seenCount = 0;
    let attempts = 0;
    let correct = 0;
    for (const q of qs) {
      const item = state.seen[q.id];
      if (!item) continue;
      const itemAttempts = Number(item.attempts) || 0;
      if (itemAttempts > 0) seenCount += 1;
      attempts += itemAttempts;
      correct += Number(item.correct) || 0;
    }
    return {
      total: qs.length,
      seen: seenCount,
      attempts,
      correct,
      rate: percent(correct, attempts),
    };
  }

  function overallStats() {
    let attempts = 0;
    let correct = 0;
    let uniqueSeen = 0;
    for (const id of Object.keys(state.seen)) {
      if (!QBYID.has(String(id))) continue;
      const item = state.seen[id];
      const n = Number(item.attempts) || 0;
      if (n > 0) uniqueSeen += 1;
      attempts += n;
      correct += Number(item.correct) || 0;
    }
    const wrongCount = Object.keys(state.wrong).filter((id) => QBYID.has(String(id))).length;
    const objective = { attempts: 0, correct: 0 };
    const cards = { attempts: 0, correct: 0 };
    for (const [type, list] of Object.entries(BY_TYPE)) {
      for (const q of list) {
        const item = state.seen[q.id];
        if (!item) continue;
        const bucket = isCardType(type) ? cards : objective;
        bucket.attempts += Number(item.attempts) || 0;
        bucket.correct += Number(item.correct) || 0;
      }
    }
    return {
      uniqueSeen,
      attempts,
      correct,
      accuracy: percent(correct, attempts),
      wrongCount,
      sessions: state.history.length,
      streak: computeStreak(),
      objectiveAccuracy: percent(objective.correct, objective.attempts),
      objectiveAttempts: objective.attempts,
      cardRate: percent(cards.correct, cards.attempts),
      cardAttempts: cards.attempts,
    };
  }

  function computeStreak() {
    const days = new Set(
      state.history
        .map((item) => {
          const date = new Date(item.date);
          return Number.isNaN(date.getTime()) ? null : date.toDateString();
        })
        .filter(Boolean)
    );
    if (!days.size) return 0;
    const cursor = new Date();
    if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (days.has(cursor.toDateString())) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function wrongEntries() {
    return Object.keys(state.wrong)
      .map((id) => {
        const question = getQ(id);
        return { id: String(id), info: state.wrong[id], question };
      })
      .filter((entry) => entry.question)
      .sort((a, b) => {
        const countDiff = (Number(b.info?.count) || 0) - (Number(a.info?.count) || 0);
        if (countDiff) return countDiff;
        return new Date(b.info?.lastAt || 0) - new Date(a.info?.lastAt || 0);
      });
  }

  function showToast(message, tone = "default") {
    if (!toastEl) return;
    window.clearTimeout(ui.toastTimer);
    toastEl.textContent = message;
    toastEl.classList.toggle("is-error", tone === "error");
    toastEl.classList.add("is-visible");
    ui.toastTimer = window.setTimeout(() => toastEl.classList.remove("is-visible"), 2400);
  }

  /* -------------------------------------------------------
     Modal
     ------------------------------------------------------- */

  function showConfirm({ title, message, confirmText = "确定", cancelText = "取消", tone = "default" }) {
    return new Promise((resolve) => {
      if (ui.modalOpen) {
        resolve(false);
        return;
      }
      ui.modalOpen = true;
      ui.modalResolve = resolve;
      ui.lastFocus = document.activeElement;
      modalTitle.textContent = title;
      modalBody.textContent = message;
      modalCancel.textContent = cancelText;
      modalConfirm.textContent = confirmText;
      modalConfirm.className = tone === "danger" ? "btn btn-danger" : "btn btn-primary";
      modalRoot.hidden = false;
      document.body.classList.add("modal-open");
      window.setTimeout(() => modalConfirm.focus(), 20);
    });
  }

  function closeModal(result) {
    if (!ui.modalOpen) return;
    const resolve = ui.modalResolve;
    ui.modalOpen = false;
    ui.modalResolve = null;
    modalRoot.hidden = true;
    document.body.classList.remove("modal-open");
    if (ui.lastFocus && typeof ui.lastFocus.focus === "function") ui.lastFocus.focus();
    if (resolve) resolve(result);
  }

  /* -------------------------------------------------------
     Routing and shell
     ------------------------------------------------------- */

  function effectiveRoute() {
    let route = ui.route;
    if (route === "auto") {
      route = state.active ? (state.active.finished ? "results" : "quiz") : "home";
    }
    if (route === "quiz" && (!state.active || state.active.finished)) {
      route = state.active?.finished ? "results" : "home";
    }
    if (route === "results" && (!state.active || !state.active.finished)) {
      route = state.active ? "quiz" : "home";
    }
    return route;
  }

  function navigate(route) {
    if (route === "quiz" && !state.active) {
      go("home");
      return;
    }
    if (
      state.active &&
      !state.active.finished &&
      state.active.mode === "exam" &&
      effectiveRoute() === "quiz" &&
      route !== "quiz"
    ) {
      showConfirm({
        title: "暂时离开模考？",
        message: "考试计时不会暂停。返回后可以继续作答；如放弃本轮，请使用“退出本轮”。",
        confirmText: "暂时离开",
      }).then((ok) => {
        if (ok) go(route);
      });
      return;
    }
    go(route);
  }

  function go(route) {
    ui.route = route;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render(options = {}) {
    const scrollY = window.scrollY;
    stopTimer();
    const route = effectiveRoute();
    updateNav(route);
    updateStorageNotice();
    updateTitle(route);

    switch (route) {
      case "quiz":
        if (!state.active) {
          ui.route = "home";
          viewEl.innerHTML = renderHome();
          return;
        }
        viewEl.innerHTML = renderQuiz();
        startTimer();
        break;
      case "results":
        if (!state.active || !state.active.finished) {
          ui.route = state.active ? "quiz" : "home";
          render();
          return;
        }
        viewEl.innerHTML = renderResults();
        break;
      case "cram":
        viewEl.innerHTML = renderCram();
        break;
      case "scope":
        viewEl.innerHTML = renderScope();
        break;
      case "wrong":
        viewEl.innerHTML = renderWrongBook();
        break;
      case "stats":
        viewEl.innerHTML = renderStats();
        break;
      case "issues":
        viewEl.innerHTML = renderIssues();
        break;
      case "home":
      default:
        viewEl.innerHTML = renderHome();
        break;
    }

    if (options.preserveScroll) window.scrollTo({ top: scrollY, behavior: "auto" });
  }

  function updateTitle(route) {
    if (route === "quiz" && state.active) {
      const q = activeQuestion();
      document.title = `${q ? typeLabel(q.type) + " · " : ""}第 ${state.active.index + 1} 题 · 传感器刷题室`;
    } else if (route === "results" && state.active) {
      document.title = `本轮 ${getResult().pct}% · 传感器刷题室`;
    } else {
      const names = { home: "传感器刷题室", scope: "老师范围", cram: "背题模式", wrong: "复习本", stats: "学习数据", issues: "题库说明" };
      document.title = `${names[route] || "传感器刷题室"} · 传感器与检测技术`;
    }
  }

  function updateNav(route) {
    document.querySelectorAll(".nav-link").forEach((link) => {
      const active = link.dataset.nav === route;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const badge = document.getElementById("navWrongBadge");
    if (badge) {
      const count = wrongEntries().length;
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
  }

  /* -------------------------------------------------------
     Home
     ------------------------------------------------------- */

  function activeBanner() {
    const active = state.active;
    if (!active) return "";
    if (active.finished) {
      const result = getResult(active);
      return `
      <div class="active-banner">
        <div class="active-banner-copy">
          <strong>上一轮 ${result.pct}%</strong>
          <span>${escapeHtml(active.label)} · ${result.correct} / ${result.total} · ${formatDuration(active.durationSec)}</span>
        </div>
        <div class="banner-actions">
          <button type="button" class="btn btn-small btn-primary" data-action="view-results">查看结果</button>
          <button type="button" class="btn btn-small btn-ghost" data-action="discard-active">收起</button>
        </div>
      </div>`;
    }
    const answered = getAnsweredCount(active);
    const actionText = active.mode === "exam" ? "继续考试" : "继续答题";
    return `
      <div class="active-banner">
        <div class="active-banner-copy">
          <strong>上一轮还没做完</strong>
          <span>${escapeHtml(active.label)} · 已答 ${answered} / ${active.order.length}${active.mode === "exam" ? " · 考试计时中" : ""}</span>
        </div>
        <div class="banner-actions">
          <button type="button" class="btn btn-small btn-primary" data-action="resume">${actionText}</button>
          <button type="button" class="btn btn-small btn-ghost" data-action="discard-active">放弃本轮</button>
        </div>
      </div>`;
  }

  function renderScope() {
    const cards = KNOWLEDGE.map((item, index) => {
      const questions = chapterQuestions(item.chapter);
      const homeworkCount = questions.filter((q) => Boolean(q.homework)).length;
      return `
        <article class="knowledge-card">
          <div class="knowledge-top">
            <span class="knowledge-index">${pad2(index + 1)}</span>
            <span class="knowledge-chapter">第${item.chapter}章</span>
            <span class="knowledge-count">${questions.length} 题</span>
          </div>
          <h2>${escapeHtml(item.title)}</h2>
          <p class="knowledge-sections">${escapeHtml(item.sections)}</p>
          <p class="knowledge-summary">${escapeHtml(item.summary)}</p>
          <ul class="knowledge-points">
            ${item.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
          </ul>
          <div class="knowledge-homework">
            <span>课后习题</span>
            <strong>${item.homework.length ? item.homework.join(" · ") : "老师未单列"}</strong>
          </div>
          <div class="knowledge-actions">
            ${questions.length ? `<button type="button" class="btn btn-primary btn-small" data-action="start-chapter" data-chapter="${item.chapter}">刷本章 10 题</button>` : ""}
            ${homeworkCount ? `<button type="button" class="btn btn-ghost btn-small" data-action="start-chapter-homework" data-chapter="${item.chapter}">课后题 ${homeworkCount} 道</button>` : ""}
          </div>
        </article>`;
    }).join("");

    return `
      <div class="scope-page">
        <div class="page-head scope-page-head">
          <div>
            <div class="eyebrow">TEACHER SCOPE / KNOWLEDGE + QUESTIONS</div>
            <h1>老师范围小入口</h1>
            <p>先把老师画的知识点过一遍，再刷本章题和课后习题。这里只放和范围相关的章节入口，完整题库仍从首页进入。</p>
          </div>
          <button type="button" class="btn btn-ghost btn-small" data-nav="home">回首页</button>
        </div>

        <div class="scope-hero">
          <div>
            <span class="eyebrow">9 CHAPTERS · 24 HOMEWORK</span>
            <strong>1.2–1.4 · 2.1–2.3 · 3–9 章前两节</strong>
            <p>前两章优先选择/填空；后面抓工作原理和测量电路；计算题和课后习题单独过。</p>
          </div>
          <div class="scope-hero-actions">
            <button type="button" class="btn btn-accent btn-small" data-action="start-scope-all">范围综合 20 题</button>
            <button type="button" class="btn btn-ghost btn-small" data-action="open-cram" data-cram-type="homework">课后习题 24</button>
          </div>
        </div>

        <div class="exam-tip">
          <div class="eyebrow">EXAM STRATEGY</div>
          <strong>不会写的也要写满</strong>
          <p>
            计算题：先把公式、已知量、代入式和单位写出来，算不下去也别空着；简答题：先写定义，再分点写原理/条件/结论，能写几点写几点；判断题/选择题不要留空。写满不一定全对，但空题一定没分。
          </p>
        </div>

        <div class="knowledge-grid">${cards}</div>

        <p class="scope-bottom-note">
          说明：本章题会从现有题库里抽该章的单选题、多选题、名词解释、简答题和计算题；判断题/填空题如果没有可靠章节标记，就不强行塞进本章入口。
        </p>
      </div>`;
  }

  function renderHome() {
    const stats = overallStats();
    const coverage = percent(stats.uniqueSeen, ALL.length);
    const last = state.history[0];
    const issueHigh = ISSUES.filter((issue) => issue.severity === "high").length;
    const issueOther = ISSUES.filter((issue) => issue.severity !== "high").length;

    const typeCards = TYPES.map((type, index) => {
      const t = typeStats(type.key);
      const card = isCardType(type.key);
      const metricLabel = card ? "记住率" : "正确率";
      const metric = t.attempts ? `${metricLabel} ${t.rate}%` : "未开始";
      const coveragePercent = percent(t.seen, t.total);
      return `
        <article class="type-card type-${type.key}">
          <div class="type-card-top">
            <span class="type-index">${pad2(index + 1)}</span>
            <span class="type-count">${t.total} ${escapeHtml(type.unit)}</span>
          </div>
          <h3>${escapeHtml(type.label)}</h3>
          <p>${escapeHtml(type.desc)}</p>
          <div class="type-card-meta">
            <span>已练 ${t.seen} / ${t.total}</span>
            <span>${metric}</span>
          </div>
          <div class="type-card-bar" aria-hidden="true"><span style="width:${coveragePercent}%"></span></div>
          <div class="type-actions">
            <button type="button" class="btn btn-small btn-primary" data-action="start-type" data-type="${type.key}" data-count="${type.startCount}">${escapeHtml(type.action)}</button>
            <button type="button" class="btn btn-small btn-ghost" data-action="start-type" data-type="${type.key}" data-count="0">${escapeHtml(type.allLabel)}</button>
            ${type.key === "choice"
              ? '<button type="button" class="type-link" data-action="start-exam">全真模考 →</button>'
              : CRAM_TYPES.includes(type.key)
                ? `<button type="button" class="type-link" data-action="open-cram" data-cram-type="${type.key}">背题模式 →</button>`
                : ""}
          </div>
        </article>`;
    }).join("");

    const groupCards = GROUPS.map((group, index) => {
      const groupQs = BY_TYPE.choice.filter((q) => q.group === group.name);
      let attempts = 0;
      let correct = 0;
      let seen = 0;
      for (const q of groupQs) {
        const item = state.seen[q.id];
        if (!item) continue;
        if (Number(item.attempts) > 0) seen += 1;
        attempts += Number(item.attempts) || 0;
        correct += Number(item.correct) || 0;
      }
      const rate = percent(correct, attempts);
      const coverageGroup = percent(seen, groupQs.length);
      return `
        <button type="button" class="group-card" data-action="start-group" data-group="${escapeAttr(group.name)}">
          <span class="group-index">${pad2(index + 1)}</span>
          <span class="group-arrow" aria-hidden="true">↗</span>
          <h3 class="group-name">${escapeHtml(group.short)}</h3>
          <p class="group-desc">${escapeHtml(group.desc)}</p>
          <div class="group-meta">
            <span>${groupQs.length} 题</span>
            <span>${attempts ? `正确率 ${rate}%` : "尚未练习"}</span>
          </div>
          <div class="group-bar" aria-hidden="true"><span class="group-fill" style="width:${coverageGroup}%"></span></div>
        </button>`;
    }).join("");

    return `
      <section class="hero hero-full">
        <div class="hero-copy">
          <div class="hero-kicker">FINAL REVIEW / ${ALL.length} ITEMS</div>
          <h1>七种题型<br><em>一张传感器复习网</em></h1>
          <p class="hero-lead">
            单选、多选、判断、填空、名词解释、简答题、计算题全部收进来。
            前两章抓选择填空，3–9 章抓工作原理和测量电路，课后习题单独背。
          </p>
          <div class="hero-actions">
            <button type="button" class="btn btn-primary btn-arrow" data-action="start-mixed">综合 20 题</button>
            <button type="button" class="btn btn-ghost" data-action="start-exam">单选模考</button>
          </div>
          <div class="hero-note">
            <span>${ALL.length} 条内容</span>
            <span>${TYPES.length} 种题型</span>
            <span>本地保存</span>
            <span>无需联网</span>
          </div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="hero-cross"></div>
          <div class="orbit"></div>
          <div class="hero-number hero-number-three">${ALL.length}<span>CARDS</span></div>
          <div class="hero-stamp">传感器<small>选择 · 多选 · 判断 · 填空 · 名词 · 简答 · 计算</small></div>
        </div>
      </section>

      <section class="metric-grid" aria-label="学习概览">
        <div class="metric-card">
          <div class="metric-label"><span>已练题</span><span>01</span></div>
          <div class="metric-value">${stats.uniqueSeen}<small> / ${ALL.length}</small></div>
          <div class="metric-note">题库覆盖 ${coverage}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-label"><span>累计掌握率</span><span>02</span></div>
          <div class="metric-value">${stats.attempts ? stats.accuracy : "—"}${stats.attempts ? "<small>%</small>" : ""}</div>
          <div class="metric-note">${stats.attempts ? `累计 ${stats.attempts} 次作答/自评` : "完成一轮后开始统计"}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label"><span>待复习</span><span>03</span></div>
          <div class="metric-value">${stats.wrongCount}<small> 条</small></div>
          <div class="metric-note">错题 + 没记住的卡片</div>
        </div>
        <div class="metric-card">
          <div class="metric-label"><span>学习轮次</span><span>04</span></div>
          <div class="metric-value">${stats.sessions}<small> 轮</small></div>
          <div class="metric-note">${last ? `最近一轮 ${last.pct}%` : "还没有完成过一轮"}</div>
        </div>
      </section>

      <section class="scope-panel" aria-labelledby="scopeTitle">
        <div class="scope-copy">
          <div class="eyebrow">TEACHER SCOPE</div>
          <h2 id="scopeTitle">老师划的范围</h2>
          <p>
            第1章 1.2–1.4；第2章 2.1–2.3；第3–9章每章前两节（工作原理 + 测量电路）。
            前两章以选择、填空为主，后面选择、判断、填空、简答、计算都可能考；老师布置的课后习题已单独收进背题。
            站内保留了一些补充题，时间紧就先过课后习题和老师范围。
            考试时不会写也要写满：先写公式/定义，再分点写。
          </p>
        </div>
        <div class="scope-actions">
          <button type="button" class="btn btn-primary btn-small" data-nav="scope">知识点 + 题 →</button>
          <button type="button" class="btn btn-ghost btn-small" data-action="open-cram" data-cram-type="homework">课后习题 ${HOMEWORK_IDS.length}</button>
          <button type="button" class="btn btn-ghost btn-small" data-action="start-type" data-type="calc" data-count="6">计算题 6 道</button>
        </div>
      </section>

      ${activeBanner()}

      <section class="type-section">
        <div class="section-head">
          <div>
            <div class="eyebrow">QUESTION TYPES</div>
            <h2 class="section-title">题型总览</h2>
          </div>
          <p class="section-sub">七种题型都能单独刷；课后习题和计算题也可以从背题模式集中过。</p>
        </div>
        <div class="mixed-strip">
          <div class="mixed-strip-copy">
            <span class="eyebrow">MIXED ROUND</span>
            <strong>综合客观题 · 20 题</strong>
            <p>从单选、多选、判断、填空中混合抽题，换着题型做，避免只记住一种问法。</p>
          </div>
          <button type="button" class="btn btn-accent btn-small" data-action="start-mixed">开始混合练习</button>
        </div>
        <div class="cram-strip">
          <div class="cram-strip-copy">
            <span class="eyebrow">MEMORIZE MODE</span>
            <strong>背题模式 · 答案直接摊开看</strong>
            <p>填空、简答、名词解释、计算题和课后习题按顺序或随机翻页；可以先遮住答案，再逐题核对。</p>
          </div>
          <div class="banner-actions">
            <button type="button" class="btn btn-primary btn-small" data-action="open-cram" data-cram-type="fill">进入背题 →</button>
            <button type="button" class="btn btn-ghost btn-small" data-action="open-cram" data-cram-type="homework">课后习题 ${HOMEWORK_IDS.length}</button>
          </div>
        </div>
        <div class="type-grid">${typeCards}</div>
      </section>

      <div class="home-layout settings-layout">
        <section class="panel settings-panel" aria-labelledby="settingsTitle">
          <div class="eyebrow">SETTINGS</div>
          <h2 id="settingsTitle">练习设置</h2>
          <p class="settings-copy">只影响之后新开的轮次，当前这一轮不会改变。</p>
          <label class="switch-row">
            <span class="switch-copy">
              <strong>选项乱序</strong>
              <small>单选题每轮重新打乱 A/B/C/D</small>
            </span>
            <span class="switch">
              <input type="checkbox" data-setting="shuffleOptions" ${state.settings.shuffleOptions ? "checked" : ""}>
              <span class="switch-track" aria-hidden="true"></span>
            </span>
          </label>
          <label class="switch-row">
            <span class="switch-copy">
              <strong>题目乱序</strong>
              <small>关闭后按原题库顺序出题</small>
            </span>
            <span class="switch">
              <input type="checkbox" data-setting="randomOrder" ${state.settings.randomOrder ? "checked" : ""}>
              <span class="switch-track" aria-hidden="true"></span>
            </span>
          </label>
        </section>

        <aside class="home-side">
          <section class="panel progress-panel" aria-labelledby="progressTitle">
            <div class="progress-top">
              <h3 id="progressTitle">本轮备考</h3>
              <span>${coverage}%</span>
            </div>
            <div class="progress-bar" aria-hidden="true"><span class="progress-fill" style="width:${coverage}%"></span></div>
            <div class="progress-label"><span>题库覆盖</span><span>${stats.uniqueSeen} / ${ALL.length}</span></div>
            <div class="mini-stats">
              <div class="mini-stat"><span>客观正确率</span><strong>${stats.objectiveAttempts ? `${stats.objectiveAccuracy}%` : "—"}</strong></div>
              <div class="mini-stat"><span>主观记住率</span><strong>${stats.cardAttempts ? `${stats.cardRate}%` : "—"}</strong></div>
              <div class="mini-stat"><span>连续天数</span><strong>${stats.streak}</strong></div>
              <div class="mini-stat"><span>上一轮</span><strong>${last ? `${last.pct}%` : "—"}</strong></div>
            </div>
          </section>

          <section class="panel tip-panel">
            <div class="eyebrow">QUICK ROUTE</div>
            <h3>不想纠结，就这样刷</h3>
            <ol class="tip-list">
              <li>先做综合 20 题，看看自己哪一类最虚。</li>
              <li>客观错题进复习本；主观卡住就标“没记住”。</li>
              <li>考前一天只开单选模考 + 复习本。</li>
            </ol>
          </section>
        </aside>
      </div>

      <section class="groups-block" aria-labelledby="groupsTitle">
        <div class="section-head">
          <div>
            <div class="eyebrow">SINGLE CHOICE BY CHAPTER</div>
            <h2 class="section-title" id="groupsTitle">单选题按章节</h2>
          </div>
          <p class="section-sub">按八个章节补单选：绪论、基本特性、电阻/电感/电容/压电/霍尔/热电。</p>
        </div>
        <div class="group-grid">${groupCards}</div>
      </section>

      <section class="issue-callout">
        <div class="callout-mark">!</div>
        <div class="callout-body">
          <strong>题库体检：${issueHigh} 处高优先级问题，${issueOther} 处提示</strong>
          <p>资料里的单选题和多选题已整理；判断题、填空题、名词解释是根据题库要点整理的速记题。3 道选择/多选题已订正。</p>
        </div>
        <a href="#" class="callout-link" data-nav="issues">查看题库说明 →</a>
      </section>
    `;
  }

  /* -------------------------------------------------------
     Cram / memorize mode
     ------------------------------------------------------- */

  function cramOrderFor(type) {
    const qs = cramQuestions(type);
    const defaultIds = qs.map((q) => q.id);
    const allowedIds = new Set(defaultIds);
    const saved = state.cram?.orders?.[type];
    const order = Array.isArray(saved)
      ? saved.map(String).filter((id) => allowedIds.has(id))
      : [];
    for (const id of defaultIds) {
      if (!order.includes(id)) order.push(id);
    }
    return order.length ? order : defaultIds;
  }

  function cramIndexFor(type) {
    const order = cramOrderFor(type);
    return clamp(Number(state.cram?.positions?.[type]) || 0, 0, Math.max(0, order.length - 1));
  }

  function cramCurrent(type = state.cram?.type) {
    const order = cramOrderFor(type);
    return getQ(order[cramIndexFor(type)] || "");
  }

  function openCram(type) {
    const key = CRAM_TYPES.includes(type) ? type : (state.cram?.type || "fill");
    state.cram.type = key;
    saveState();
    navigate("cram");
  }

  function setCramType(type) {
    if (!CRAM_TYPES.includes(type)) return;
    state.cram.type = type;
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cramGo(index) {
    const type = state.cram.type;
    const order = cramOrderFor(type);
    state.cram.positions[type] = clamp(index, 0, Math.max(0, order.length - 1));
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cramNext() {
    const type = state.cram.type;
    cramGo(cramIndexFor(type) + 1);
  }

  function cramPrev() {
    const type = state.cram.type;
    cramGo(cramIndexFor(type) - 1);
  }

  function toggleCramAnswer() {
    state.cram.hideAnswers = !state.cram.hideAnswers;
    saveState();
    render({ preserveScroll: true });
  }

  function shuffleCram() {
    const type = state.cram.type;
    const order = shuffle(cramOrderFor(type));
    state.cram.orders[type] = order;
    state.cram.positions[type] = 0;
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("已打乱背题顺序");
  }

  function resetCramOrder() {
    const type = state.cram.type;
    state.cram.orders[type] = cramQuestions(type).map((q) => q.id);
    state.cram.positions[type] = 0;
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("已恢复原题顺序");
  }

  function renderCramTabs() {
    return CRAM_TYPES.map((type) => {
      const meta = typeMeta(type);
      const order = cramOrderFor(type);
      const index = cramIndexFor(type);
      const active = state.cram.type === type;
      return `
        <button type="button" class="cram-tab ${active ? "is-active" : ""}" data-action="cram-type" data-type="${type}" aria-pressed="${active}">
          <strong>${escapeHtml(meta.label)}</strong>
          <small>${order.length} 条 · ${index + 1} / ${order.length}</small>
        </button>`;
    }).join("");
  }

  function renderCramPrompt(q) {
    if (q.type === "fill") {
      return `<div class="cram-prompt question-stem fill-stem">${renderFillStem(q)}</div>`;
    }
    if (q.type === "short" || q.type === "calc") {
      return `<div class="cram-prompt cram-question">${escapeHtml(q.prompt)}</div>`;
    }
    return `<div class="cram-prompt cram-term">${escapeHtml(q.prompt)}</div>`;
  }

  function renderCramAnswer(q) {
    const notes = renderQuestionNotes(q);
    if (q.type === "fill") {
      return `
        <div class="cram-answer-block">
          <div class="cram-answer-label">空格答案</div>
          <div class="cram-fill-pills">
            ${q.blanks.map((blank) => `<span class="cram-fill-pill">${circleNumber(blank.number)} ${escapeHtml(blank.raw)}</span>`).join("")}
          </div>
          <p class="cram-full"><strong>完整句子：</strong>${renderFillFull(q)}</p>
          ${notes}
        </div>`;
    }
    return `
      <div class="cram-answer-block">
        <div class="cram-answer-label">${q.type === "term" ? "释义" : q.type === "calc" ? "解题步骤" : "参考答案"}</div>
        <div class="cram-answer-text">${escapeHtml(q.answer)}</div>
        ${notes}
      </div>`;
  }

  function renderCram() {
    const type = CRAM_TYPES.includes(state.cram?.type) ? state.cram.type : "fill";
    state.cram.type = type;
    const meta = typeMeta(type);
    const order = cramOrderFor(type);
    const index = cramIndexFor(type);
    const q = getQ(order[index]);
    const hidden = Boolean(state.cram.hideAnswers);
    if (!q) {
      return '<div class="empty-state"><div class="empty-mark">!</div><h2>这一组没有可背的题</h2></div>';
    }

    const cells = order.map((id, cellIndex) => {
      const current = cellIndex === index;
      return `<button type="button" class="answer-cell ${current ? "is-current" : ""}" data-action="cram-jump" data-index="${cellIndex}" title="第 ${cellIndex + 1} 条" aria-label="跳到第 ${cellIndex + 1} 条" ${current ? 'aria-current="true"' : ""}>${cellIndex + 1}</button>`;
    }).join("");

    return `
      <div class="cram-page">
        <div class="page-head cram-head">
          <div>
            <div class="eyebrow">MEMORIZE MODE</div>
            <h1>背题模式</h1>
            <p>题目和答案一起过：填空看空格、简答看踩分点、名词看定义、计算题看步骤、课后习题按老师范围过。可以先遮住答案自测，再翻页核对。</p>
          </div>
          <div class="cram-head-actions">
            ${type === "calc" || type === "homework"
              ? `<span class="badge badge-reference">${type === "homework" ? "课后习题只背不刷" : "计算题只背不刷"}</span>`
              : `<button type="button" class="btn btn-primary btn-small" data-action="start-type" data-type="${type}" data-count="${meta.startCount || 10}">去刷这个题型</button>`}
            <button type="button" class="btn btn-ghost btn-small" data-nav="home">回首页</button>
          </div>
        </div>

        <div class="cram-tabs" role="group" aria-label="选择题型">
          ${renderCramTabs()}
        </div>

        <div class="cram-layout">
          <section class="panel cram-card" aria-labelledby="cramPrompt">
            <div class="question-meta">
              ${typePill(q.type)}
              ${showGroup(q) ? `<span class="group-pill">${escapeHtml(showGroup(q))}</span>` : ""}
              <span class="q-number">Q${pad2(q.number)} / ${q.type === "term" ? "TERM" : q.type === "short" ? "SHORT" : q.type === "calc" ? "CALC" : "FILL"}</span>
              ${reviewBadges(q)}
              <span class="badge badge-reference">背题</span>
            </div>

            <div id="cramPrompt">${renderCramPrompt(q)}</div>

            <div class="cram-answer ${hidden ? "is-hidden" : ""}">
              ${hidden
                ? `<div class="cram-hidden">
                     <p>答案已遮住。先在心里过一遍，再翻开核对。</p>
                     <button type="button" class="btn btn-primary btn-small" data-action="cram-toggle">显示答案</button>
                   </div>`
                : renderCramAnswer(q)}
            </div>

            <div class="cram-footer">
              <span>${escapeHtml(meta.label)} · 第 ${index + 1} / ${order.length} 条 · ${hidden ? "答案已遮住" : "答案展开"}</span>
              <div class="quiz-actions">
                <button type="button" class="btn btn-ghost btn-small" data-action="cram-prev" ${index === 0 ? "disabled" : ""}>上一条</button>
                <button type="button" class="btn btn-primary btn-small" data-action="cram-next" ${index >= order.length - 1 ? "disabled" : ""}>下一条</button>
              </div>
            </div>
          </section>

          <aside class="cram-sidebar">
            <section class="panel cram-panel" aria-labelledby="cramPanelTitle">
              <div class="answer-head">
                <h3 id="cramPanelTitle">${escapeHtml(meta.label)} · 背题</h3>
                <span>${index + 1} / ${order.length}</span>
              </div>
              <div class="progress-bar" aria-hidden="true"><span class="progress-fill" style="width:${percent(index + 1, order.length)}%"></span></div>

              <label class="switch-row cram-switch">
                <span class="switch-copy">
                  <strong>遮住答案</strong>
                  <small>开启后先自己回想，再点“显示答案”</small>
                </span>
                <span class="switch">
                  <input type="checkbox" data-cram-setting="hideAnswers" ${hidden ? "checked" : ""}>
                  <span class="switch-track" aria-hidden="true"></span>
                </span>
              </label>

              <div class="cram-order">
                <button type="button" class="btn btn-ghost btn-small" data-action="cram-shuffle">随机顺序</button>
                <button type="button" class="btn btn-quiet btn-small" data-action="cram-reset-order">恢复原序</button>
              </div>

              <div class="answer-grid cram-grid">${cells}</div>
              <p class="cram-hint">← → 翻页 · Space 显示/遮住答案</p>
            </section>

            <section class="panel cram-tip">
              <div class="eyebrow">HOW TO USE</div>
              <p>先按题型过一遍，遮住答案做主动回忆；计算题重点看公式、代入和单位。背题只是输入，最后记得回练习模式自测。</p>
            </section>
          </aside>
        </div>
      </div>`;
  }

  /* -------------------------------------------------------
     Sessions
     ------------------------------------------------------- */

  function guardActive(callback) {
    if (state.active && !state.active.finished) {
      showConfirm({
        title: "当前还有一轮没完成",
        message: "开始新的一轮会放弃当前进度。当前答案不会计入练习记录。",
        confirmText: "放弃并开始",
        cancelText: "继续当前一轮",
      }).then((ok) => {
        if (!ok) return;
        state.active = null;
        saveState();
        callback();
      });
      return;
    }
    callback();
  }

  function beginSession({
    type,
    ids,
    count = null,
    label,
    group = null,
    origin = "practice",
    mode = "practice",
    config = {},
  }) {
    let list = Array.from(new Set(ids.map(String))).filter((id) => QBYID.has(id));
    if (!list.length) {
      showToast("没有可用的题目", "error");
      return;
    }
    if (state.settings.randomOrder) list = shuffle(list);
    if (count && count < list.length) list = list.slice(0, count);

    const optionOrders = {};
    for (const id of list) {
      const q = getQ(id);
      optionOrders[id] = state.settings.shuffleOptions && q.type === "choice"
        ? shuffle(LETTERS)
        : LETTERS.slice();
    }

    const now = Date.now();
    state.active = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      mode,
      origin,
      label,
      group,
      order: list,
      index: 0,
      answers: {},
      flags: {},
      optionOrders,
      revealed: {},
      drafts: {},
      startedAt: now,
      deadline:
        mode === "exam"
          ? now + (Number(DATA.meta?.choiceExamMinutes) || 60) * 60 * 1000
          : null,
      finished: false,
      recorded: false,
      config: { ...config, count: list.length },
    };
    saveState();
    ui.route = "quiz";
    ui.resultFilter = "all";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startType(type, requestedCount) {
    const meta = typeMeta(type);
    const list = BY_TYPE[type] || [];
    if (!list.length) {
      showToast("这一题型暂无题目", "error");
      return;
    }
    const count = requestedCount === 0 ? list.length : Math.min(requestedCount || meta.startCount || 10, list.length);
    const unit = isCardType(type) ? (type === "term" ? "张" : "题") : "题";
    beginSession({
      type,
      ids: list.map((q) => q.id),
      count,
      label: `${meta.label} · ${count} ${unit}`,
      origin: "type",
      config: { requestedCount, unit },
    });
  }

  function startGroup(groupName) {
    const group = GROUPS.find((item) => item.name === groupName);
    const ids = BY_TYPE.choice.filter((q) => q.group === groupName).map((q) => q.id);
    if (!group || !ids.length) {
      showToast("这一组暂时没有题目", "error");
      return;
    }
    beginSession({
      type: "choice",
      ids,
      count: ids.length,
      label: `单选题 · ${group.short}`,
      group: groupName,
      origin: "group",
    });
  }

  function chapterOf(q) {
    if (Number.isFinite(q.chapter)) return q.chapter;
    const match = String(q.group || "").match(/第\s*(\d+)\s*章/);
    return match ? Number(match[1]) : null;
  }

  function chapterQuestions(chapter) {
    const lists = [
      BY_TYPE.choice, BY_TYPE.multi, BY_TYPE.judge, BY_TYPE.fill,
      BY_TYPE.term, BY_TYPE.short, BY_TYPE.calc,
    ];
    return lists.flat().filter((q) => chapterOf(q) === chapter);
  }

  function startChapter(chapter, count = 10) {
    const ids = chapterQuestions(chapter).map((q) => q.id);
    if (!ids.length) {
      showToast("这一章暂时没有题目", "error");
      return;
    }
    beginSession({
      type: "mixed",
      ids,
      count: Math.min(count, ids.length),
      label: `第${chapter}章 · 知识点+题`,
      origin: "scope",
      chapter,
      config: { requestedCount: count },
    });
  }

  function startChapterHomework(chapter) {
    const ids = chapterQuestions(chapter).filter((q) => Boolean(q.homework)).map((q) => q.id);
    if (!ids.length) {
      showToast("这一章老师没有单列课后习题", "error");
      return;
    }
    beginSession({
      type: "mixed",
      ids,
      count: ids.length,
      label: `第${chapter}章 · 课后习题`,
      origin: "scope-homework",
      chapter,
    });
  }

  function startScopeAll() {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((chapter) => chapterQuestions(chapter).map((q) => q.id));
    if (!ids.length) {
      showToast("老师范围暂时没有题目", "error");
      return;
    }
    beginSession({
      type: "mixed",
      ids,
      count: Math.min(20, ids.length),
      label: "老师范围 · 综合 20 题",
      origin: "scope-all",
    });
  }

  function startExam() {
    beginSession({
      type: "choice",
      ids: BY_TYPE.choice.map((q) => q.id),
      count: Math.min(40, BY_TYPE.choice.length),
      label: "单选模考 · 40 题 / 60 分钟",
      origin: "exam",
      mode: "exam",
    });
  }

  function startMixed() {
    const take = (list, count) => shuffle(list.map((q) => q.id)).slice(0, count);
    const ids = [
      ...take(BY_TYPE.choice, 7),
      ...take(BY_TYPE.multi, 5),
      ...take(BY_TYPE.judge, 4),
      ...take(BY_TYPE.fill, 4),
    ];
    beginSession({
      type: "mixed",
      ids,
      count: ids.length,
      label: "综合客观题 · 20 题",
      origin: "mixed",
    });
  }

  function startWrong() {
    const entries = wrongEntries();
    if (!entries.length) {
      showToast("复习本还是空的，先去刷几题");
      return;
    }
    beginSession({
      type: "mixed",
      ids: entries.map((entry) => entry.id),
      count: entries.length,
      label: "复习本 · 全部",
      origin: "wrong",
    });
  }

  function startSingle(questionId) {
    const q = getQ(questionId);
    if (!q) return;
    beginSession({
      type: q.type,
      ids: [q.id],
      count: 1,
      label: `${typeLabel(q.type)} · 单题`,
      origin: "single",
    });
  }

  function retrySame() {
    const prev = state.active;
    if (!prev) return;
    if (prev.mode === "exam") {
      startExam();
      return;
    }
    if (prev.origin === "scope" && prev.chapter) {
      startChapter(prev.chapter, prev.config?.requestedCount || 10);
      return;
    }
    if (prev.origin === "scope-homework" && prev.chapter) {
      startChapterHomework(prev.chapter);
      return;
    }
    if (prev.origin === "scope-all") {
      startScopeAll();
      return;
    }
    if (prev.origin === "mixed") {
      startMixed();
      return;
    }
    if (prev.origin === "group" && prev.group) {
      startGroup(prev.group);
      return;
    }
    if (prev.origin === "wrong") {
      startWrong();
      return;
    }
    if (prev.origin === "single") {
      startSingle(prev.order[0]);
      return;
    }
    if (prev.type !== "mixed") {
      startType(prev.type, prev.config?.requestedCount ?? prev.order.length);
      return;
    }
    beginSession({
      type: "mixed",
      ids: prev.order,
      count: prev.order.length,
      label: prev.label,
      origin: "wrong-set",
    });
  }

  function retryWrongSet() {
    const prev = state.active;
    if (!prev) return;
    const ids = prev.order.filter((id) => {
      const q = getQ(id);
      return q && isAnswered(q, prev) && !isCorrect(q, prev);
    });
    if (!ids.length) {
      showToast("本轮没有需要重做的题");
      return;
    }
    beginSession({
      type: "mixed",
      ids,
      count: ids.length,
      label: "本轮待复习",
      origin: "wrong-set",
    });
  }

  /* -------------------------------------------------------
     Quiz rendering
     ------------------------------------------------------- */

  function typePill(type) {
    return `<span class="type-pill type-${escapeAttr(type)}">${escapeHtml(typeLabel(type))}</span>`;
  }

  function reviewBadges(q) {
    const bits = [];
    if (q.sourceReference) bits.push('<span class="badge badge-reference">参考答案</span>');
    if (q.review) {
      bits.push(`<span class="badge badge-${escapeAttr(q.review.type)}">${escapeHtml(q.review.label)}</span>`);
    }
    return bits.join("");
  }

  function showGroup(q) {
    if (!q.group) return "";
    return ["判断题", "名词解释", "简答题"].includes(q.group) ? "" : q.group;
  }

  function renderQuestionMeta(q) {
    const groupLabel = showGroup(q);
    return `
      <div class="question-meta">
        ${typePill(q.type)}
        ${groupLabel ? `<span class="group-pill">${escapeHtml(groupLabel)}</span>` : ""}
        <span class="q-number">Q${pad2(q.number)} / ${q.type === "term" ? "TERM" : q.type === "short" ? "SHORT" : q.type === "calc" ? "CALC" : q.type === "fill" ? "FILL" : q.type === "judge" ? "T / F" : q.type === "multi" ? "MULTI" : "ORIGINAL"}</span>
        ${reviewBadges(q)}
        <button type="button" class="flag-btn ${state.active.flags[q.id] ? "is-flagged" : ""}" data-action="toggle-flag" aria-pressed="${Boolean(state.active.flags[q.id])}">
          <span class="flag-icon" aria-hidden="true"></span>${state.active.flags[q.id] ? "已标记" : "标记"}
        </button>
      </div>`;
  }

  function renderQuiz() {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q) {
      return '<div class="empty-state"><div class="empty-mark">!</div><h2>题目丢失了</h2><p>返回首页重新开始一轮即可。</p></div>';
    }

    const n = session.order.length;
    const index = session.index;
    const isExam = session.mode === "exam";
    const answeredCount = getAnsweredCount(session);
    const progress = n ? ((index + 1) / n) * 100 : 0;
    const isLast = index === n - 1;
    const timerLabel = isExam ? "剩余" : "用时";
    const timerValue = isExam
      ? formatClock(session.deadline - Date.now())
      : formatClock(Date.now() - session.startedAt);

    let stemBlock = "";
    let body = "";

    if (q.type === "choice") {
      stemBlock = `<h2 class="question-stem" id="questionStem" tabindex="-1">${formatStem(q.stem)}</h2>`;
      body = renderChoiceBody(q, session, isExam);
    } else if (q.type === "multi") {
      stemBlock = `<h2 class="question-stem" id="questionStem" tabindex="-1">${formatStem(q.stem)}</h2>`;
      body = renderMultiBody(q, session);
    } else if (q.type === "judge") {
      stemBlock = `<h2 class="question-stem judge-stem" id="questionStem" tabindex="-1">${formatStem(q.stem)}</h2>`;
      body = renderJudgeBody(q, session, isExam);
    } else if (q.type === "fill") {
      stemBlock = `<h2 class="question-stem fill-stem" id="questionStem" tabindex="-1">${renderFillStem(q)}</h2>`;
      body = renderFillBody(q, session);
    } else {
      stemBlock = `<div class="flash-prompt" id="questionStem" tabindex="-1">${escapeHtml(q.prompt)}</div>`;
      body = renderCardBody(q, session);
    }

    const answerCells = renderAnswerCells(session);
    const answered = getAnsweredCount(session);
    const unitLabel = isCardType(q.type) ? "已评" : (q.type === "fill" || q.type === "multi") ? "已交" : "已答";
    const sessionTitle = session.type === "mixed" ? session.label : `${typeLabel(q.type)} · 第 ${index + 1} / ${n} 题`;

    return `
      <div class="quiz-page">
        <div class="quiz-topline">
          <button type="button" class="back-link" data-action="exit"><span aria-hidden="true">←</span>退出</button>
          <div class="quiz-progress">
            <div class="progress-meta">
              <span>${escapeHtml(sessionTitle)}</span>
              <span>${unitLabel} <strong>${answered}</strong> / ${n}</span>
            </div>
            <div class="progress-track" aria-hidden="true"><span style="width:${progress}%"></span></div>
          </div>
          <div class="timer-chip" id="timerChip">
            <span class="timer-label">${timerLabel}</span>
            <strong class="timer-value" id="timerValue">${timerValue}</strong>
          </div>
        </div>

        <div class="quiz-layout">
          <section class="panel question-panel question-panel-${q.type}" aria-labelledby="questionStem">
            ${renderQuestionMeta(q)}
            ${stemBlock}
            ${body}
            <div class="question-footer">
              <span class="shortcut-hint">${shortcutHint(q)}</span>
              <div class="quiz-actions">
                <button type="button" class="btn btn-ghost btn-small" data-action="prev" ${index === 0 ? "disabled" : ""}>上一题</button>
                <button type="button" class="btn btn-primary btn-small" data-action="next">
                  ${isLast ? (isExam ? "交卷" : "完成本轮") : (isAnswered(q, session) || isExam ? "下一题" : "跳过")}
                </button>
              </div>
            </div>
          </section>

          <aside class="quiz-sidebar">
            <div class="panel answer-card-panel">
              <div class="answer-head">
                <h3>答题卡</h3>
                <span>${answered} / ${n}</span>
              </div>
              <div class="answer-grid">${answerCells}</div>
              <div class="answer-legend">
                <span><i class="legend-dot current"></i>当前</span>
                <span><i class="legend-dot done"></i>完成</span>
                <span><i class="legend-dot flag"></i>标记</span>
              </div>
            </div>
            <div class="panel submit-panel">
              <p class="submit-copy">
                ${unitLabel} <strong>${answered}</strong>，未完成 <strong>${n - answered}</strong>。<br>
                ${isExam ? "交卷后统一判分并生成复盘。" : "结束本轮后写入统计与复习本。"}
              </p>
              <button type="button" class="btn ${isExam ? "btn-accent" : "btn-primary"} btn-block btn-small" data-action="finish">
                ${isExam ? "交卷" : "结束并看结果"}
              </button>
              <a href="#" class="side-exit" data-action="exit">放弃本轮</a>
            </div>
          </aside>
        </div>
      </div>`;
  }

  function shortcutHint(q) {
    if (q.type === "choice") return "A–D / 1–4 选择 · ← → 切题 · F 标记";
    if (q.type === "multi") return "A–E / 1–5 勾选 · Enter 提交 · ← → 切题";
    if (q.type === "judge") return "T / F 或 1 / 2 判断 · ← → 切题 · F 标记";
    if (q.type === "fill") return "在输入框里填写，Enter 提交 · ← → 切题";
    return "空格显示答案 · 1 没记住 / 2 记住了 · ← → 切题";
  }

  function renderChoiceBody(q, session, isExam) {
    const selected = session.answers[q.id] ?? null;
    const showFeedback = !isExam && selected != null;
    const isRight = selected === q.answer;
    const order = getOptionOrder(q.id);
    const correctDisplay = displayLabel(q.id, q.answer);
    const correctText = optionText(q, q.answer);
    const options = order
      .map((original, displayIndex) => {
        const option = q.options.find((item) => item.label === original);
        if (!option) return "";
        const isSelected = selected === original;
        const isRightOption = q.answer === original;
        const classes = ["option"];
        let mark = "";
        if (isExam) {
          if (isSelected) classes.push("is-selected");
        } else if (showFeedback) {
          if (isRightOption) {
            classes.push("is-correct");
            mark = "✓";
          } else if (isSelected) {
            classes.push("is-wrong");
            mark = "×";
          } else {
            classes.push("is-dimmed");
          }
        } else if (isSelected) {
          classes.push("is-selected");
        }
        return `
          <button type="button" class="${classes.join(" ")}" data-action="answer" data-answer="${original}" aria-pressed="${isSelected}" ${showFeedback ? "disabled" : ""}>
            <span class="option-letter">${LETTERS[displayIndex]}</span>
            <span class="option-text">${escapeHtml(option.text)}</span>
            <span class="option-mark" aria-hidden="true">${mark}</span>
          </button>`;
      })
      .join("");

    const feedback = showFeedback
      ? `
      <div class="feedback ${isRight ? "is-correct" : "is-wrong"}">
        <div class="feedback-head">
          <span class="feedback-icon" aria-hidden="true">${isRight ? "✓" : "×"}</span>
          <strong>${isRight ? "答对了" : "答错了"}</strong>
        </div>
        <p class="correct-line">正确答案：<b>${correctDisplay}．${escapeHtml(correctText)}</b></p>
        <p class="explanation">${escapeHtml(q.explanation)}</p>
        ${renderQuestionNotes(q)}
      </div>`
      : "";

    return `<div class="options" role="group" aria-label="选项">${options}</div>${feedback}`;
  }

  function renderMultiBody(q, session) {
    const record = session.answers[q.id];
    const selected = Array.isArray(record?.selected) ? record.selected : [];
    const submitted = Boolean(record?.submitted);
    const isRight = Boolean(record?.correct);
    const answerSet = new Set(q.answer.split(""));
    const options = q.options
      .map((option) => {
        const isSelected = selected.includes(option.label);
        const isRightOption = answerSet.has(option.label);
        const classes = ["option"];
        let mark = "";
        if (submitted) {
          if (isRightOption) {
            classes.push("is-correct");
            mark = "✓";
          } else if (isSelected) {
            classes.push("is-wrong");
            mark = "×";
          } else {
            classes.push("is-dimmed");
          }
        } else if (isSelected) {
          classes.push("is-selected");
        }
        return `
          <button type="button" class="${classes.join(" ")}" data-action="toggle-multi" data-answer="${option.label}" aria-pressed="${isSelected}" ${submitted ? "disabled" : ""}>
            <span class="option-letter">${option.label}</span>
            <span class="option-text">${escapeHtml(option.text)}</span>
            <span class="option-mark" aria-hidden="true">${mark}</span>
          </button>`;
      })
      .join("");

    const selectedText = selected.length ? selected.join("、") : "未选";
    const correctText = q.options
      .filter((option) => answerSet.has(option.label))
      .map((option) => `${option.label}．${option.text}`)
      .join("；");
    const feedback = submitted
      ? `
      <div class="feedback ${isRight ? "is-correct" : "is-wrong"} multi-feedback">
        <div class="feedback-head">
          <span class="feedback-icon" aria-hidden="true">${isRight ? "✓" : "×"}</span>
          <strong>${isRight ? "全选正确" : "答案不对"}</strong>
        </div>
        <p class="correct-line">正确答案：<b>${escapeHtml(q.answer)}</b>　${escapeHtml(correctText)}</p>
        <div class="multi-selected-line">你的选择：${escapeHtml(selectedText)}</div>
        ${q.explanation ? `<p class="explanation">${escapeHtml(q.explanation)}</p>` : ""}
        ${renderQuestionNotes(q)}
      </div>`
      : "";

    return `
      <div class="multi-tip">多选题：选出所有正确选项后提交，少选、多选、错选都按错误计。</div>
      <div class="options multi-options" role="group" aria-label="多选项">${options}</div>
      ${submitted
        ? feedback
        : `<div class="multi-submit-row">
             <span>已选：<strong>${escapeHtml(selectedText)}</strong></span>
             <button type="button" class="btn btn-primary btn-small" data-action="submit-multi" ${selected.length ? "" : "disabled"}>提交答案</button>
           </div>`}`;
  }

  function renderJudgeBody(q, session, isExam) {
    const selected = session.answers[q.id] ?? null;
    const showFeedback = !isExam && selected != null;
    const isRight = selected === q.answer;
    const correctSymbol = q.answer === "T" ? "√ 正确" : "× 错误";
    const options = [
      { key: "T", symbol: "√", text: "正确" },
      { key: "F", symbol: "×", text: "错误" },
    ]
      .map((option) => {
        const isSelected = selected === option.key;
        const isRightOption = q.answer === option.key;
        const classes = ["judge-option"];
        if (isExam) {
          if (isSelected) classes.push("is-selected");
        } else if (showFeedback) {
          if (isRightOption) classes.push("is-correct");
          else if (isSelected) classes.push("is-wrong");
          else classes.push("is-dimmed");
        } else if (isSelected) {
          classes.push("is-selected");
        }
        return `
          <button type="button" class="${classes.join(" ")}" data-action="answer" data-answer="${option.key}" aria-pressed="${isSelected}" ${showFeedback ? "disabled" : ""}>
            <span class="judge-symbol">${option.symbol}</span>
            <span>${option.text}</span>
          </button>`;
      })
      .join("");

    const feedback = showFeedback
      ? `
      <div class="feedback ${isRight ? "is-correct" : "is-wrong"}">
        <div class="feedback-head">
          <span class="feedback-icon" aria-hidden="true">${isRight ? "✓" : "×"}</span>
          <strong>${isRight ? "判断正确" : "判断错误"}</strong>
        </div>
        <p class="correct-line">正确答案：<b>${correctSymbol}</b></p>
        <p class="explanation">${escapeHtml(q.explanation)}</p>
        ${renderQuestionNotes(q)}
      </div>`
      : "";

    return `<div class="judge-options">${options}</div>${feedback}`;
  }

  function renderQuestionNotes(q) {
    const bits = [];
    if (q.note) bits.push(`<div class="review-note"><strong>提示：</strong>${escapeHtml(q.note)}</div>`);
    if (q.review) {
      bits.push(`<div class="review-note"><strong>${escapeHtml(q.review.label)}：</strong>${escapeHtml(q.review.note)}${q.review.type === "corrected" ? ` 原 PDF 答案：${escapeHtml(q.sourceAnswer)}。` : ""}</div>`);
    }
    return bits.join("");
  }

  function renderFillStem(q) {
    return (q.segments || [])
      .map((seg) => {
        if (seg.type === "blank") {
          return `<span class="fill-blank" aria-label="第 ${seg.number} 空">${circleNumber(seg.number)}</span>`;
        }
        return escapeHtml(seg.text);
      })
      .join("");
  }

  function renderFillFull(q) {
    return (q.segments || [])
      .map((seg) => {
        if (seg.type === "blank") {
          const blank = q.blanks[seg.number - 1];
          return `<b class="fill-answer-highlight">${escapeHtml(blank?.raw || "")}</b>`;
        }
        return escapeHtml(seg.text);
      })
      .join("");
  }

  function renderFillBody(q, session) {
    const record = session.answers[q.id];
    const submitted = Boolean(record?.submitted);
    if (!submitted) {
      const fields = q.blanks
        .map(
          (blank) => `
          <label class="fill-field">
            <span class="fill-field-number">${circleNumber(blank.number)}</span>
            <input class="fill-input" type="text" data-blank-index="${blank.number - 1}" autocomplete="off" spellcheck="false" placeholder="第 ${blank.number} 空">
          </label>`
        )
        .join("");
      return `
        <form class="fill-form" data-fill-form>
          <div class="fill-fields ${q.blanks.length === 1 ? "is-single" : ""}">${fields}</div>
          <div class="fill-submit-row">
            <button type="submit" class="btn btn-primary btn-small">提交答案</button>
            <span class="fill-hint">按原题标注挖空；标点、空格和全半角会自动归一化。</span>
          </div>
        </form>`;
    }

    const blankResults = record.blankResults || [];
    const rows = q.blanks
      .map((blank, index) => {
        const ok = Boolean(blankResults[index]);
        const value = record.values?.[index] || "";
        return `
          <div class="fill-answer-row ${ok ? "is-correct" : "is-wrong"}">
            <span class="fill-answer-index">${circleNumber(blank.number)}</span>
            <div>
              <span class="fill-yours">你写：${escapeHtml(value || "（空）")}</span>
              <span class="fill-right">答案：${escapeHtml(blank.raw)}</span>
            </div>
          </div>`;
      })
      .join("");

    return `
      <div class="feedback ${record.correct ? "is-correct" : "is-wrong"} fill-feedback">
        <div class="feedback-head">
          <span class="feedback-icon" aria-hidden="true">${record.correct ? "✓" : "×"}</span>
          <strong>${record.correct ? "全部正确" : "对照一下答案"}</strong>
        </div>
        <div class="fill-answer-list">${rows}</div>
        <p class="fill-full"><strong>完整句子：</strong>${renderFillFull(q)}</p>
        ${q.note ? `<p class="explanation">${escapeHtml(q.note)}</p>` : ""}
        ${!record.correct && !record.overridden ? '<button type="button" class="btn btn-small btn-ghost fill-override" data-action="fill-override">意思对了，算我答对</button>' : ""}
        ${record.overridden ? '<p class="fill-override-note">已按“意思对了”记为正确。</p>' : ""}
      </div>`;
  }

  function renderCardBody(q, session) {
    const revealed = Boolean(session.revealed[q.id] || session.answers[q.id] != null);
    const rating = session.answers[q.id] || null;
    const isTerm = q.type === "term";
    const isCalc = q.type === "calc";
    if (!revealed) {
      return `
        <div class="flash-card">
          <div class="flash-hide">
            <p>${isTerm ? "先在心里把定义说一遍，再翻答案。" : isCalc ? "先写公式、代入和单位，再对解题步骤。" : "先列一下答题要点，再翻答案。"}</p>
            <button type="button" class="btn btn-primary btn-small" data-action="reveal-card">显示答案</button>
          </div>
        </div>`;
    }

    return `
      <div class="flash-card">
        <div class="flash-answer">
          <div class="flash-answer-head">
            <span class="eyebrow">${isTerm ? "DEFINITION" : isCalc ? "SOLUTION" : "KEY POINTS"}</span>
            <span class="flash-type-label">${isTerm ? "名词解释" : isCalc ? "解题步骤" : "参考答案"}</span>
          </div>
          <div class="flash-answer-text">${escapeHtml(q.answer)}</div>
          ${q.keyPoints?.length ? `
            <div class="key-points">
              <strong>踩分点</strong>
              <ul>${q.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
            </div>` : ""}
          ${renderQuestionNotes(q)}
        </div>
        <div class="rating-actions" role="group" aria-label="自评">
          <button type="button" class="rating-btn rating-unknown ${rating === "unknown" ? "is-selected" : ""}" data-action="rate-card" data-rating="unknown">
            <span>1</span>没记住
          </button>
          <button type="button" class="rating-btn rating-known ${rating === "known" ? "is-selected" : ""}" data-action="rate-card" data-rating="known">
            <span>2</span>记住了
          </button>
        </div>
        ${rating ? `<p class="rating-status ${rating === "known" ? "is-known" : "is-unknown"}">已记录：${rating === "known" ? "记住了" : "没记住"}，可以点另一项改判。</p>` : ""}
      </div>`;
  }

  function renderAnswerCells(session) {
    const isExam = session.mode === "exam";
    return session.order
      .map((id, index) => {
        const q = getQ(id);
        if (!q) return "";
        const answered = isAnswered(q, session);
        const correct = answered && isCorrect(q, session);
        const classes = ["answer-cell"];
        if (index === session.index) classes.push("is-current");
        if (answered) classes.push("is-answered");
        if (!isExam && answered) classes.push(correct ? "is-correct" : "is-wrong");
        if (session.flags[id]) classes.push("is-flagged");
        const stateText = answered ? (isCardType(q.type) ? "已评" : "已答") : "未完成";
        return `<button type="button" class="${classes.join(" ")}" data-action="jump" data-index="${index}" title="第 ${index + 1} 题 · ${stateText}" aria-label="跳到第 ${index + 1} 题，${stateText}" ${index === session.index ? 'aria-current="true"' : ""}>${index + 1}</button>`;
      })
      .join("");
  }

  /* -------------------------------------------------------
     Quiz interactions
     ------------------------------------------------------- */

  function selectAnswer(answer) {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q || session.finished) return;
    if (q.type !== "choice" && q.type !== "judge") return;
    if (session.mode !== "exam" && session.answers[q.id] != null) return;
    session.answers[q.id] = answer;
    saveState();
    render({ preserveScroll: true });
    if (session.mode !== "exam") {
      window.requestAnimationFrame(() => {
        const feedback = document.querySelector(".feedback");
        if (feedback && feedback.getBoundingClientRect().bottom > window.innerHeight) {
          feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }
  }

  function normalizeFillText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (ch) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(ch)))
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (ch) => String("⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(ch)))
      .replace(/[×xX*]/g, "*")
      .replace(/[−–—]/g, "-")
      .replace(/≤/g, "<=")
      .replace(/≥/g, ">=")
      .replace(/[，。；：、,.;:!?！？"'“”‘’\s]/g, "")
      .replace(/·/g, "");
  }

  function fillBlankCorrect(value, blank) {
    const normalized = normalizeFillText(value);
    if (!normalized) return false;
    const accepted = blank.accepted || [];
    if (accepted.includes(normalized)) return true;
    // Long phrases: accept a meaningful keyword covered by the reference.
    return accepted.some((item) => {
      if (item.length < 4) return false;
      return item.includes(normalized) || normalized.includes(item);
    });
  }

  function toggleMulti(answer) {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q || q.type !== "multi") return;
    if (session.answers[q.id]?.submitted) return;
    const record = session.answers[q.id] || { selected: [], submitted: false, correct: false };
    const selected = new Set(record.selected || []);
    if (selected.has(answer)) selected.delete(answer);
    else selected.add(answer);
    session.answers[q.id] = {
      selected: Array.from(selected).sort(),
      submitted: false,
      correct: false,
    };
    saveState();
    render({ preserveScroll: true });
  }

  function submitMulti() {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q || q.type !== "multi") return;
    const record = session.answers[q.id];
    if (record?.submitted) return;
    const selected = Array.isArray(record?.selected) ? record.selected.slice().sort() : [];
    if (!selected.length) return;
    const correct = selected.join("") === q.answer.split("").sort().join("");
    session.answers[q.id] = { selected, submitted: true, correct };
    saveState();
    render({ preserveScroll: true });
    window.requestAnimationFrame(() => {
      const feedback = document.querySelector(".feedback");
      if (feedback && feedback.getBoundingClientRect().bottom > window.innerHeight) {
        feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  function submitFill() {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q || q.type !== "fill" || session.answers[q.id]?.submitted) return;
    const inputs = Array.from(document.querySelectorAll(".fill-input"));
    const values = inputs.map((input) => input.value.trim());
    const blankResults = q.blanks.map((blank, index) => fillBlankCorrect(values[index], blank));
    const correct = blankResults.length > 0 && blankResults.every(Boolean);
    session.answers[q.id] = {
      submitted: true,
      values,
      blankResults,
      correct,
      overridden: false,
    };
    saveState();
    render({ preserveScroll: true });
    window.requestAnimationFrame(() => {
      const feedback = document.querySelector(".feedback");
      if (feedback && feedback.getBoundingClientRect().bottom > window.innerHeight) {
        feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  function overrideFill() {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q || q.type !== "fill") return;
    const record = session.answers[q.id];
    if (!record?.submitted || record.correct) return;
    record.correct = true;
    record.overridden = true;
    saveState();
    render({ preserveScroll: true });
  }

  function revealCard() {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q) return;
    session.revealed[q.id] = true;
    saveState();
    render({ preserveScroll: true });
  }

  function rateCard(rating) {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q || !isCardType(q.type)) return;
    if (rating !== "known" && rating !== "unknown") return;
    session.revealed[q.id] = true;
    session.answers[q.id] = rating;
    saveState();
    render({ preserveScroll: true });
  }

  function goToQuestion(index) {
    if (!state.active) return;
    const next = clamp(index, 0, state.active.order.length - 1);
    if (next === state.active.index) return;
    state.active.index = next;
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function nextQuestion() {
    if (!state.active) return;
    if (state.active.index >= state.active.order.length - 1) {
      requestFinish();
      return;
    }
    goToQuestion(state.active.index + 1);
  }

  function previousQuestion() {
    if (!state.active) return;
    goToQuestion(state.active.index - 1);
  }

  function toggleFlag() {
    const session = state.active;
    const q = activeQuestion();
    if (!session || !q) return;
    session.flags[q.id] = !session.flags[q.id];
    saveState();
    render({ preserveScroll: true });
  }

  function requestExit() {
    if (!state.active) {
      navigate("home");
      return;
    }
    const finished = state.active.finished;
    showConfirm({
      title: finished ? "回到首页？" : "放弃这一轮？",
      message: finished
        ? "本轮成绩已经写入练习记录，回到首页不会丢失。"
        : "本轮已选/已评的答案不会计入练习记录。未完成的客观题也不会进入复习本。",
      confirmText: finished ? "回到首页" : "放弃本轮",
      tone: "danger",
    }).then((ok) => {
      if (!ok) return;
      state.active = null;
      saveState();
      ui.route = "home";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function requestFinish() {
    if (!state.active) return;
    if (state.active.finished) {
      go("results");
      return;
    }
    const result = getResult();
    const isExam = state.active.mode === "exam";
    const message = isExam
      ? `共 ${result.total} 题，已答 ${result.total - result.unanswered} 题，未答 ${result.unanswered} 题。交卷后不能再修改答案。`
      : `已完成 ${result.total - result.unanswered} / ${result.total} 题。未完成的题目按未做计入本轮结果。`;
    showConfirm({
      title: isExam ? "确认交卷？" : "结束这一轮？",
      message,
      confirmText: isExam ? "确认交卷" : "结束并看结果",
    }).then((ok) => {
      if (ok) finishSession("manual");
    });
  }

  function finishSession(reason = "manual") {
    const session = state.active;
    if (!session || session.finished) return;
    stopTimer();
    const now = Date.now();
    session.finishedAt = now;
    session.durationSec = Math.max(1, Math.round((now - session.startedAt) / 1000));
    session.finished = true;
    recordSession(session);
    session.finished = true;
    session.recorded = true;
    saveState();

    ui.route = "results";
    const result = getResult(session);
    ui.resultFilter = result.wrong || result.unanswered ? "review" : "all";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (reason === "timeout") showToast("时间到，已自动交卷", "error");
  }

  function recordSession(session) {
    if (!session || session.recorded) return;
    const now = new Date();
    const nowIso = now.toISOString();
    const durationSec = Math.max(1, Math.round((now.getTime() - session.startedAt) / 1000));

    for (const id of session.order) {
      const q = getQ(id);
      if (!q || !isAnswered(q, session)) continue;
      const ok = isCorrect(q, session);
      const seen = state.seen[id] || { attempts: 0, correct: 0, wrong: 0 };
      seen.attempts = (Number(seen.attempts) || 0) + 1;
      if (ok) {
        seen.correct = (Number(seen.correct) || 0) + 1;
        const previous = state.wrong[id];
        if (previous) {
          previous.streak = (Number(previous.streak) || 0) + 1;
          if (previous.streak >= 2) delete state.wrong[id];
        }
      } else {
        seen.wrong = (Number(seen.wrong) || 0) + 1;
        const previous = state.wrong[id] || { count: 0, streak: 0 };
        previous.count = (Number(previous.count) || 0) + 1;
        previous.streak = 0;
        previous.type = q.type;
        previous.lastAt = nowIso;
        if (q.type === "choice" || q.type === "judge") {
          previous.lastAnswer = session.answers[id];
          previous.lastValues = null;
        } else if (q.type === "fill") {
          previous.lastValues = session.answers[id].values || [];
          previous.lastAnswer = null;
        } else if (q.type === "multi") {
          previous.lastValues = session.answers[id].selected || [];
          previous.lastAnswer = null;
        } else {
          previous.lastRating = session.answers[id];
          previous.lastAnswer = null;
        }
        state.wrong[id] = previous;
      }
      seen.lastAt = nowIso;
      state.seen[id] = seen;
    }

    const result = getResult(session);
    state.history.unshift({
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      date: nowIso,
      type: session.type,
      mode: session.mode,
      label: session.label,
      group: session.group || null,
      total: result.total,
      correct: result.correct,
      wrong: result.wrong,
      unanswered: result.unanswered,
      pct: result.pct,
      durationSec,
    });
    state.history = state.history.slice(0, 40);
    session.recorded = true;
  }

  /* -------------------------------------------------------
     Timer
     ------------------------------------------------------- */

  function stopTimer() {
    if (ui.timerId) {
      window.clearInterval(ui.timerId);
      ui.timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (!state.active || state.active.finished) return;
    tickTimer();
    if (!state.active || state.active.finished) return;
    ui.timerId = window.setInterval(tickTimer, 1000);
  }

  function tickTimer() {
    if (!state.active || state.active.finished) {
      stopTimer();
      return;
    }
    const session = state.active;
    const valueEl = document.getElementById("timerValue");
    if (!valueEl) {
      stopTimer();
      return;
    }
    if (session.mode === "exam") {
      const left = session.deadline - Date.now();
      valueEl.textContent = formatClock(left);
      const chip = document.getElementById("timerChip");
      if (chip) chip.classList.toggle("is-low", left <= 5 * 60 * 1000);
      if (left <= 0) {
        stopTimer();
        finishSession("timeout");
      }
    } else {
      valueEl.textContent = formatClock(Date.now() - session.startedAt);
    }
  }

  /* -------------------------------------------------------
     Results
     ------------------------------------------------------- */

  function ratingLabel(value) {
    if (value === "known") return "记住了";
    if (value === "unknown") return "没记住";
    return "未完成";
  }

  function renderReviewItem(q, session) {
    const answered = isAnswered(q, session);
    const correct = answered && isCorrect(q, session);
    const status = !answered ? "未完成" : q.type === "term" || q.type === "short" || q.type === "calc" ? ratingLabel(session.answers[q.id]) : correct ? "答对" : "答错";
    const statusClass = !answered ? "is-unanswered" : correct ? "" : "is-wrong";
    let body = "";

    if (q.type === "choice") {
      const selected = session.answers[q.id] ?? null;
      const order = getOptionOrder(q.id);
      body = `<div class="review-options">${order.map((original, index) => {
        const classes = ["review-option"];
        if (original === q.answer) classes.push("is-correct");
        if (original === selected && original !== q.answer) classes.push("is-chosen-wrong");
        return `<div class="${classes.join(" ")}">${LETTERS[index]}．${escapeHtml(optionText(q, original))}</div>`;
      }).join("")}</div>`;
    } else if (q.type === "multi") {
      const selected = session.answers[q.id]?.selected || [];
      const answerSet = new Set(q.answer.split(""));
      body = `<div class="review-options multi-review-options">${q.options.map((option) => {
        const classes = ["review-option"];
        if (answerSet.has(option.label)) classes.push("is-correct");
        if (selected.includes(option.label) && !answerSet.has(option.label)) classes.push("is-chosen-wrong");
        return `<div class="${classes.join(" ")}">${option.label}．${escapeHtml(option.text)}</div>`;
      }).join("")}</div>`;
    } else if (q.type === "judge") {
      const selected = session.answers[q.id];
      body = `<div class="review-judge">
        <span class="review-option ${q.answer === "T" ? "is-correct" : ""}">√ 正确</span>
        <span class="review-option ${q.answer === "F" ? "is-correct" : ""}">× 错误</span>
        <span class="review-picked">你选：${selected ? (selected === "T" ? "√ 正确" : "× 错误") : "未答"}</span>
      </div>`;
    } else if (q.type === "fill") {
      const record = session.answers[q.id];
      body = `<div class="review-fill">
        <div class="fill-answer-list">${q.blanks.map((blank, index) => {
          const value = record?.values?.[index] || "";
          const ok = Boolean(record?.blankResults?.[index]);
          return `<div class="fill-answer-row ${ok ? "is-correct" : "is-wrong"}"><span class="fill-answer-index">${circleNumber(blank.number)}</span><div><span class="fill-yours">你写：${escapeHtml(value || "（空）")}</span><span class="fill-right">答案：${escapeHtml(blank.raw)}</span></div></div>`;
        }).join("")}</div>
      </div>`;
    } else {
      body = `<div class="review-flash-answer">${escapeHtml(q.answer)}</div>`;
    }

    return `
      <article class="review-item ${statusClass}">
        <div class="review-item-head">
          ${typePill(q.type)}
          <span class="review-no">Q${pad2(q.number)}</span>
          ${showGroup(q) ? `<span class="group-pill">${escapeHtml(showGroup(q))}</span>` : ""}
          ${reviewBadges(q)}
          <span class="review-status">${status}</span>
        </div>
        <h3 class="review-stem">${q.type === "term" || q.type === "short" || q.type === "calc" ? escapeHtml(q.prompt) : q.type === "fill" ? renderFillStem(q) : formatStem(q.stem)}</h3>
        ${body}
        ${q.explanation ? `<p class="review-exp"><strong>解析：</strong>${escapeHtml(q.explanation)}</p>` : ""}
        ${q.note ? `<p class="review-exp"><strong>提示：</strong>${escapeHtml(q.note)}</p>` : ""}
        ${q.review ? `<p class="review-exp review-note"><strong>${escapeHtml(q.review.label)}：</strong>${escapeHtml(q.review.note)}</p>` : ""}
      </article>`;
  }

  function renderResults() {
    const session = state.active;
    const result = getResult(session);
    const hasCards = session.order.some((id) => isCardType(getQ(id)?.type));
    const onlyCards = session.order.every((id) => isCardType(getQ(id)?.type));
    const duration = session.durationSec || Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
    const isExam = session.mode === "exam";
    const correctLabel = onlyCards ? "记住" : hasCards ? "掌握" : "答对";
    const wrongLabel = onlyCards ? "没记住" : hasCards ? "待复习" : "答错";
    const unansweredLabel = onlyCards ? "未评" : "未答";
    const title =
      result.pct === 100
        ? "这一轮，全部过关。"
        : result.pct >= 85
          ? "这一轮，很稳。"
          : result.pct >= 70
            ? "基础在线，再补几处。"
            : result.pct >= 50
              ? "能拿分，但还不够稳。"
              : "先把复习本吃透。";
    const subtitle = `本轮 ${result.total} 项，${correctLabel} ${result.correct} 项。${result.wrong ? "没掌握的内容已进复习本，连续两次答对/记住才会移出。" : "这一轮很干净，可以加量或换题型。"}`;
    const filter = ui.resultFilter === "all" ? "all" : "review";
    const reviewIds = filter === "review"
      ? session.order.filter((id) => {
          const q = getQ(id);
          return q && (!isAnswered(q, session) || !isCorrect(q, session));
        })
      : session.order;

    const reviewItems = reviewIds.map((id) => {
      const q = getQ(id);
      return q ? renderReviewItem(q, session) : "";
    }).join("");

    const breakdown = resultBreakdown(session);
    const breakdownHtml = Object.entries(breakdown)
      .map(([type, data]) => `<span class="result-type-chip">${typeLabel(type)} <b>${data.correct}/${data.total}</b></span>`)
      .join("");

    return `
      <div class="results-page">
        <section class="panel result-hero" aria-label="本轮成绩">
          <div class="score-wrap">
            <div class="score-ring" style="--score:${result.pct}" role="img" aria-label="掌握率 ${result.pct}%">
              <div class="score-inner">
                <div class="score-num">${result.pct}<small>%</small></div>
                <div class="score-caption">${onlyCards ? "RECALL" : "SCORE"}</div>
              </div>
            </div>
          </div>
          <div class="result-copy">
            <div class="result-kicker">${isExam ? "MOCK EXAM COMPLETE" : "ROUND COMPLETE"}</div>
            <h1 class="result-title">${title}</h1>
            <p class="result-sub">${subtitle}</p>
            <div class="result-stats">
              <div class="result-stat"><span>${correctLabel}</span><strong class="good">${result.correct}</strong></div>
              <div class="result-stat"><span>${wrongLabel}</span><strong class="bad">${result.wrong}</strong></div>
              <div class="result-stat"><span>${unansweredLabel}</span><strong>${result.unanswered}</strong></div>
              <div class="result-stat"><span>用时</span><strong>${formatDuration(duration)}</strong></div>
            </div>
            <div class="result-breakdown">${breakdownHtml}</div>
            <div class="result-actions">
              ${result.wrongIds.length ? '<button type="button" class="btn btn-accent btn-small" data-action="retry-wrong">重做本轮待复习</button>' : ""}
              <button type="button" class="btn btn-primary btn-small" data-action="retry-same">再来一轮</button>
              <button type="button" class="btn btn-ghost btn-small" data-action="home">回首页</button>
            </div>
          </div>
        </section>

        <section class="review-section" aria-labelledby="reviewTitle">
          <div class="review-head">
            <div>
              <div class="eyebrow">REVIEW</div>
              <h2 id="reviewTitle">逐题复盘</h2>
            </div>
            <div class="filter-group" role="group" aria-label="复盘筛选">
              <button type="button" class="filter-btn ${filter === "all" ? "is-active" : ""}" data-action="result-filter" data-filter="all">全部 ${result.total}</button>
              <button type="button" class="filter-btn ${filter === "review" ? "is-active" : ""}" data-action="result-filter" data-filter="review">待复习 ${result.wrong + result.unanswered}</button>
            </div>
          </div>
          <div class="review-list">${reviewItems || '<div class="empty-state"><div class="empty-mark">✓</div><h2>没有需要复盘的题</h2><p>这一轮所有题都过关了。</p></div>'}</div>
        </section>
      </div>`;
  }

  /* -------------------------------------------------------
     Review book
     ------------------------------------------------------- */

  function renderReviewBookItem({ id, info, question }) {
    const count = Number(info.count) || 1;
    const streak = Number(info.streak) || 0;
    const lastAnswer = info.lastAnswer;
    let answerPreview = "";
    if (question.type === "choice") {
      answerPreview = `${question.answer}．${optionText(question, question.answer)}`;
    } else if (question.type === "multi") {
      answerPreview = question.answer.split("").map((label) => `${label}．${optionText(question, label)}`).join("；");
    } else if (question.type === "judge") {
      answerPreview = question.answerText === "√" ? "√ 正确" : "× 错误";
    } else if (question.type === "fill") {
      answerPreview = question.answerText;
    }

    let body = "";
    if (question.type === "multi") {
      const lastValues = Array.isArray(info.lastValues) ? info.lastValues : [];
      body = `<p class="wrong-meta">上次选：<strong>${escapeHtml(lastValues.join("、") || "—")}</strong> · 正确答案：<strong>${escapeHtml(answerPreview)}</strong> · 连续答对 ${streak} / 2</p>
        <details class="wrong-details"><summary>查看选项与解析</summary>
        <div class="wrong-answer-list">${question.options.map((option) => {
          const classes = ["wrong-answer-line"];
          if (question.answer.includes(option.label)) classes.push("is-correct");
          if (lastValues.includes(option.label) && !question.answer.includes(option.label)) classes.push("is-chosen-wrong");
          return `<div class="${classes.join(" ")}">${option.label}．${escapeHtml(option.text)}</div>`;
        }).join("")}</div>
        ${question.explanation ? `<p class="wrong-explanation">${escapeHtml(question.explanation)}</p>` : ""}
        ${question.note ? `<p class="wrong-explanation">${escapeHtml(question.note)}</p>` : ""}
        </details>`;
    } else if (question.type === "fill") {
      body = `<p class="wrong-meta">正确答案：<strong>${escapeHtml(answerPreview)}</strong> · 连续答对 ${streak} / 2</p>
        <details class="wrong-details"><summary>查看完整答案</summary>
        <p class="wrong-explanation">${renderFillFull(question)}</p>
        ${question.note ? `<p class="wrong-explanation">${escapeHtml(question.note)}</p>` : ""}
        </details>`;
    } else if (question.type === "term" || question.type === "short" || question.type === "calc") {
      body = `<p class="wrong-meta">上次自评：<strong>没记住</strong> · 连续记住 ${streak} / 2</p>
        <details class="wrong-details"><summary>${question.type === "calc" ? "查看解题步骤" : "查看参考答案"}</summary>
        <p class="wrong-explanation wrong-long-answer">${escapeHtml(question.answer)}</p>
        </details>`;
    } else {
      const last = question.type === "choice" && lastAnswer
        ? `${lastAnswer}．${optionText(question, lastAnswer)}`
        : question.type === "judge" && lastAnswer
          ? lastAnswer === "T" ? "√ 正确" : "× 错误"
          : "—";
      body = `<p class="wrong-meta">上次选：<strong>${escapeHtml(last)}</strong> · 正确答案：<strong>${escapeHtml(answerPreview)}</strong> · 连续答对 ${streak} / 2</p>
        <details class="wrong-details"><summary>查看解析</summary>
        <p class="wrong-explanation">${escapeHtml(question.explanation || "")}</p>
        ${question.note ? `<p class="wrong-explanation">${escapeHtml(question.note)}</p>` : ""}
        </details>`;
    }

    return `
      <article class="wrong-card">
        <div class="wrong-head">
          ${typePill(question.type)}
          <span class="review-no">Q${pad2(question.number)}</span>
          ${showGroup(question) ? `<span class="group-pill">${escapeHtml(showGroup(question))}</span>` : ""}
          <span class="wrong-count">${question.type === "term" || question.type === "short" || question.type === "calc" ? "没记住" : "错"} ${count} 次</span>
          ${reviewBadges(question)}
        </div>
        <h2 class="wrong-stem">${question.type === "term" || question.type === "short" || question.type === "calc" ? escapeHtml(question.prompt) : question.type === "fill" ? renderFillStem(question) : formatStem(question.stem)}</h2>
        ${body}
        <div class="wrong-buttons">
          <button type="button" class="btn btn-primary btn-small" data-action="retry-one" data-id="${id}">重练这题</button>
          <button type="button" class="btn btn-ghost btn-small" data-action="remove-wrong" data-id="${id}">标记已掌握</button>
        </div>
      </article>`;
  }

  function renderWrongBook() {
    const entries = wrongEntries();
    if (!entries.length) {
      return `
        <div class="page-head">
          <div>
            <div class="eyebrow">REVIEW BOOK</div>
            <h1>复习本</h1>
            <p>单选/多选/判断题/填空题答错，或名词解释/简答题自评“没记住”，都会进这里。连续两次答对/记住才会移出。</p>
          </div>
        </div>
        <div class="empty-state">
          <div class="empty-mark">✓</div>
          <h2>复习本是空的</h2>
          <p>先开一轮综合客观题，或者抽几张名词解释 / 简答题。需要再看的内容会自动收进来。</p>
          <button type="button" class="btn btn-primary" data-action="start-mixed">去刷综合 20 题</button>
        </div>`;
    }

    return `
      <div class="page-head">
        <div>
          <div class="eyebrow">REVIEW BOOK</div>
          <h1>复习本 <span class="badge badge-corrected">${entries.length} 条</span></h1>
          <p>客观题错题 + 主观题没记住。连续两次答对/记住自动移出，也可以手动标记掌握。</p>
        </div>
        <div class="wrong-actions">
          <button type="button" class="btn btn-primary btn-small" data-action="start-wrong">全部复习</button>
          <button type="button" class="btn btn-ghost btn-small" data-nav="home">回首页</button>
        </div>
      </div>
      <div class="wrong-grid">${entries.map(renderReviewBookItem).join("")}</div>`;
  }

  /* -------------------------------------------------------
     Stats
     ------------------------------------------------------- */

  function renderStats() {
    const stats = overallStats();
    const coverage = percent(stats.uniqueSeen, ALL.length);
    const typeRows = TYPES.map((type) => {
      const t = typeStats(type.key);
      const card = isCardType(type.key);
      return `
        <div class="stat-bar-row">
          <div class="stat-bar-label">
            <span>${escapeHtml(type.label)}</span>
            <span>${t.attempts ? `${card ? "记住" : "正确"} ${t.correct}/${t.attempts} · ${t.rate}%` : `${t.total} ${escapeHtml(type.unit)} · 未练`}</span>
          </div>
          <div class="stat-bar" aria-hidden="true"><span style="width:${t.rate}%"></span></div>
        </div>`;
    }).join("");

    const historyRows = state.history.length
      ? state.history.slice(0, 14).map((item) => `
          <li class="history-row">
            <span class="history-date">${formatDate(item.date)}</span>
            <span class="history-mode">${escapeHtml(item.label || typeLabel(item.type || "choice"))}</span>
            <span class="history-score ${item.pct < 60 ? "is-low" : ""}">${item.pct}%</span>
            <span class="history-time">${formatDuration(item.durationSec)}</span>
          </li>`).join("")
      : '<li class="history-empty">还没有完成过一轮练习。完成一轮后，成绩会出现在这里。</li>';

    return `
      <div class="stats-page">
        <div class="page-head">
          <div>
            <div class="eyebrow">LEARNING DATA</div>
            <h1>学习数据</h1>
            <p>所有数据只存在当前浏览器。换浏览器、清理站点数据或使用无痕模式，记录不会跟过去。</p>
          </div>
          <button type="button" class="btn btn-ghost btn-small" data-nav="home">回首页</button>
        </div>

        <div class="stat-cards">
          <div class="stat-card"><span>已练题</span><strong>${stats.uniqueSeen}<small> / ${ALL.length}</small></strong><small>覆盖 ${coverage}%</small></div>
          <div class="stat-card"><span>客观正确率</span><strong>${stats.objectiveAttempts ? `${stats.objectiveAccuracy}%` : "—"}</strong><small>${stats.objectiveAttempts} 次客观作答</small></div>
          <div class="stat-card"><span>主观记住率</span><strong>${stats.cardAttempts ? `${stats.cardRate}%` : "—"}</strong><small>${stats.cardAttempts} 次卡片自评</small></div>
          <div class="stat-card"><span>待复习 / 连续</span><strong>${stats.wrongCount}<small> 条</small></strong><small>连续 ${stats.streak} 天 · ${stats.sessions} 轮</small></div>
        </div>

        <div class="stats-grid">
          <section class="panel stats-panel" aria-labelledby="groupStatsTitle">
            <div class="eyebrow">BY TYPE</div>
            <h2 id="groupStatsTitle">分题型表现</h2>
            ${typeRows}
            <p class="setup-hint">主观题的“正确率”是自评记住率，不是机器判分。题量小的题型，百分比波动会更明显。</p>
          </section>

          <section class="panel stats-panel" aria-labelledby="historyTitle">
            <div class="eyebrow">RECENT ROUNDS</div>
            <h2 id="historyTitle">最近练习</h2>
            <ul class="history-list">${historyRows}</ul>
            <div class="danger-zone">
              <p><strong>清空本机记录</strong><br>包括复习本、正确率和练习历史，题库本身不会删除。</p>
              <button type="button" class="btn btn-danger btn-small" data-action="reset-data">清空数据</button>
            </div>
          </section>
        </div>
      </div>`;
  }

  /* -------------------------------------------------------
     Issues
     ------------------------------------------------------- */

  function renderIssues() {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const issue of ISSUES) counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    const cards = ISSUES.map((issue, index) => {
      const qid = issue.qid ? String(issue.qid) : "";
      return `
        <article class="issue-card severity-${escapeAttr(issue.severity)}" id="${escapeAttr(issue.id)}">
          <div class="issue-side">
            <span class="issue-num">${pad2(index + 1)}</span>
            <span class="issue-severity">${SEVERITY_LABEL[issue.severity] || "提示"}</span>
          </div>
          <div class="issue-body">
            <h2 class="issue-title">${escapeHtml(issue.title)}</h2>
            <p class="issue-where">${escapeHtml(issue.where)}</p>
            <p class="issue-problem">${escapeHtml(issue.problem)}</p>
            <p class="issue-action"><strong>处理：</strong>${escapeHtml(issue.action)}</p>
            <div class="issue-footer">
              ${qid && QBYID.has(qid) ? `<button type="button" class="btn btn-ghost" data-action="start-single" data-id="${escapeAttr(qid)}">做这题</button>` : ""}
              
            </div>
          </div>
        </article>`;
    }).join("");

    return `
      <div class="issues-page">
        <div class="page-head">
          <div>
            <div class="eyebrow">SOURCE & NOTES</div>
            <h1>题库说明</h1>
            <p>单选、多选、简答和计算题来自传感器题库/第4版习题答案；判断、填空、名词解释是根据题库要点整理的速记题。下面列出订正、存疑和资料来源说明。</p>
          </div>
          <button type="button" class="btn btn-ghost btn-small" data-nav="home">回首页</button>
        </div>

        <div class="issues-intro">
          <div class="severity-summary">
            <span class="severity-chip high"><b>${counts.high}</b> 高优先级</span>
            <span class="severity-chip medium"><b>${counts.medium}</b> 中优先级</span>
            <span class="severity-chip low"><b>${counts.low}</b> 低优先级</span>
          </div>
          <p>站内处理原则：能确定的错答案直接订正；只能确定“有争议”的保留原答案并标注；主观题自评。所有题目最终以老师课堂口径为准。</p>
        </div>

        <div class="issue-list">${cards}</div>

        <div class="issues-note">
          <strong>资料说明：</strong>主题库来自《传感器.pdf》《传感器.docx》以及章节扫描资料；老师布置的课后习题按 source/exercise-answers.pdf（第4版习题参考答案）录入。扫描版章节练习的填空/答案表 OCR 不稳定，站内没有强行照抄；判断、填空、名词解释因此按主资料的问答和选择题考点整理，并在题目中标注。<br><br>
          <strong>背题模式：</strong>顶部“背题”覆盖填空、简答、名词解释、计算题和课后习题；答案默认展开，可遮住自测，支持顺序/随机和进度跳转。
        </div>
      </div>`;
  }

  /* -------------------------------------------------------
     Event handlers
     ------------------------------------------------------- */

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.nav);
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    switch (action) {
      case "start-type":
        guardActive(() => startType(actionEl.dataset.type, Number(actionEl.dataset.count)));
        break;
      case "open-cram":
        openCram(actionEl.dataset.cramType);
        break;
      case "cram-type":
        setCramType(actionEl.dataset.type);
        break;
      case "cram-prev":
        cramPrev();
        break;
      case "cram-next":
        cramNext();
        break;
      case "cram-jump":
        cramGo(Number(actionEl.dataset.index));
        break;
      case "cram-toggle":
        toggleCramAnswer();
        break;
      case "cram-shuffle":
        shuffleCram();
        break;
      case "cram-reset-order":
        resetCramOrder();
        break;
      case "start-exam":
        guardActive(startExam);
        break;
      case "start-mixed":
        guardActive(startMixed);
        break;
      case "start-group":
        guardActive(() => startGroup(actionEl.dataset.group));
        break;
      case "start-chapter":
        guardActive(() => startChapter(Number(actionEl.dataset.chapter), 10));
        break;
      case "start-chapter-homework":
        guardActive(() => startChapterHomework(Number(actionEl.dataset.chapter)));
        break;
      case "start-scope-all":
        guardActive(startScopeAll);
        break;
      case "resume":
        if (state.active) {
          ui.route = state.active.finished ? "results" : "quiz";
          render();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        break;
      case "view-results":
        if (state.active?.finished) {
          ui.route = "results";
          render();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        break;
      case "discard-active":
        if (!state.active) break;
        if (state.active.finished) {
          state.active = null;
          saveState();
          render();
        } else {
          showConfirm({
            title: "放弃这一轮？",
            message: "当前进度会直接丢掉，不会写入练习记录。",
            confirmText: "放弃",
            tone: "danger",
          }).then((ok) => {
            if (!ok) return;
            state.active = null;
            saveState();
            render();
          });
        }
        break;
      case "answer":
        selectAnswer(actionEl.dataset.answer);
        break;
      case "toggle-multi":
        toggleMulti(actionEl.dataset.answer);
        break;
      case "submit-multi":
        submitMulti();
        break;
      case "fill-override":
        overrideFill();
        break;
      case "reveal-card":
        revealCard();
        break;
      case "rate-card":
        rateCard(actionEl.dataset.rating);
        break;
      case "prev":
        previousQuestion();
        break;
      case "next":
        nextQuestion();
        break;
      case "finish":
        requestFinish();
        break;
      case "exit":
        requestExit();
        break;
      case "jump":
        goToQuestion(Number(actionEl.dataset.index));
        break;
      case "toggle-flag":
        toggleFlag();
        break;
      case "result-filter":
        ui.resultFilter = actionEl.dataset.filter === "all" ? "all" : "review";
        render({ preserveScroll: true });
        break;
      case "retry-wrong":
        retryWrongSet();
        break;
      case "retry-same":
        retrySame();
        break;
      case "home":
        navigate("home");
        break;
      case "start-wrong":
        guardActive(startWrong);
        break;
      case "retry-one":
        guardActive(() => startSingle(actionEl.dataset.id));
        break;
      case "remove-wrong": {
        const id = String(actionEl.dataset.id);
        if (state.wrong[id]) {
          delete state.wrong[id];
          saveState();
          render({ preserveScroll: true });
          showToast("已标记为掌握");
        }
        break;
      }
      case "reset-data":
        showConfirm({
          title: "清空所有本机记录？",
          message: "复习本、正确率、练习历史和当前进度都会被删除。此操作不可撤销。",
          confirmText: "全部清空",
          tone: "danger",
        }).then((ok) => {
          if (!ok) return;
          state = emptyState();
          try {
            window.localStorage.removeItem(STORAGE_KEY);
          } catch (error) {
            /* ignore */
          }
          storageOk = true;
          ui.route = "home";
          ui.resultFilter = "all";
          saveState();
          render();
          showToast("本机记录已清空");
        });
        break;
      case "start-single":
        guardActive(() => startSingle(actionEl.dataset.id));
        break;
      default:
        break;
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-fill-form]");
    if (!form) return;
    event.preventDefault();
    submitFill();
  });

  document.addEventListener("change", (event) => {
    const cramInput = event.target.closest("[data-cram-setting]");
    if (cramInput) {
      if (cramInput.dataset.cramSetting === "hideAnswers") {
        state.cram.hideAnswers = cramInput.checked;
        saveState();
        render({ preserveScroll: true });
      }
      return;
    }

    const input = event.target.closest("[data-setting]");
    if (!input) return;
    const key = input.dataset.setting;
    if (key !== "shuffleOptions" && key !== "randomOrder") return;
    state.settings[key] = input.checked;
    saveState();
  });

  document.addEventListener("keydown", (event) => {
    if (ui.modalOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal(false);
      }
      return;
    }
    if (event.target.closest("input, textarea, select")) return;
    const route = effectiveRoute();

    if (route === "cram") {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        cramPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        cramNext();
      } else if (event.key === " " || event.key === "Spacebar" || event.code === "Space") {
        event.preventDefault();
        toggleCramAnswer();
      }
      return;
    }

    if (route !== "quiz" || !state.active || state.active.finished) return;

    const q = activeQuestion();
    if (!q) return;
    const key = event.key;
    const upper = key.length === 1 ? key.toUpperCase() : key;
    const objective = q.type === "choice" || q.type === "judge";
    const locked = objective && state.active.mode !== "exam" && state.active.answers[q.id] != null;

    if (q.type === "multi") {
      const labels = q.options.map((option) => option.label);
      let target = "";
      if (["1", "2", "3", "4", "5"].includes(key)) target = labels[Number(key) - 1] || "";
      else if (["A", "B", "C", "D", "E"].includes(upper)) target = upper;
      if (target) {
        event.preventDefault();
        toggleMulti(target);
        return;
      }
    }

    if (objective) {
      if (locked) return;
      if (q.type === "choice" && ["1", "2", "3", "4"].includes(key)) {
        const order = getOptionOrder(q.id);
        const answer = order[Number(key) - 1];
        if (answer) {
          event.preventDefault();
          selectAnswer(answer);
        }
        return;
      }
      if (q.type === "judge" && ["1", "2"].includes(key)) {
        event.preventDefault();
        selectAnswer(key === "1" ? "T" : "F");
        return;
      }
      if (q.type === "choice" && LETTERS.includes(upper)) {
        event.preventDefault();
        selectAnswer(upper);
        return;
      }
      if (q.type === "judge" && (upper === "T" || upper === "F")) {
        event.preventDefault();
        selectAnswer(upper);
        return;
      }
    }

    if (q.type === "term" || q.type === "short" || q.type === "calc") {
      const revealed = Boolean(state.active.revealed[q.id] || state.active.answers[q.id] != null);
      if (key === " " || key === "Spacebar") {
        event.preventDefault();
        if (!revealed) revealCard();
        return;
      }
      if (revealed && ["1", "2"].includes(key)) {
        event.preventDefault();
        rateCard(key === "1" ? "unknown" : "known");
        return;
      }
    }

    if (key === "ArrowLeft") {
      event.preventDefault();
      previousQuestion();
    } else if (key === "ArrowRight") {
      event.preventDefault();
      nextQuestion();
    } else if (key === "Enter" && !event.target.closest("button, a")) {
      event.preventDefault();
      if (q.type === "multi" && !state.active.answers[q.id]?.submitted) submitMulti();
      else nextQuestion();
    } else if (upper === "F") {
      event.preventDefault();
      toggleFlag();
    }
  });

  modalCancel.addEventListener("click", () => closeModal(false));
  modalConfirm.addEventListener("click", () => closeModal(true));
  modalRoot.addEventListener("click", (event) => {
    if (event.target.dataset.modalClose === "true") closeModal(false);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && effectiveRoute() === "quiz") tickTimer();
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  if (!storageOk) updateStorageNotice();
  render();
})();
