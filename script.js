(function () {
  "use strict";

  const STORAGE_KEY = "pennywise-data-v1";
  const DEFAULT_CATEGORIES = [
    { name: "Food", icon: "🍜" }, { name: "Transportation", icon: "🚌" },
    { name: "Groceries", icon: "🛒" }, { name: "Bills", icon: "💡" },
    { name: "Shopping", icon: "🛍️" }, { name: "Personal care", icon: "🧴" },
    { name: "Entertainment", icon: "🎬" }, { name: "Education", icon: "📚" },
    { name: "Health", icon: "💊" }, { name: "Other", icon: "✨" }
  ];
  const INCOME_CATEGORIES = ["Salary", "Allowance", "Business income", "Other"];
  const ACCOUNT_TYPES = ["Cash", "Bank account", "E-wallet", "Other"];
  const CURRENCIES = [
    { code: "PHP", label: "Philippine peso (₱)", symbol: "₱", locale: "en-PH" },
    { code: "USD", label: "US dollar ($)", symbol: "$", locale: "en-US" },
    { code: "EUR", label: "Euro (€)", symbol: "€", locale: "de-DE" },
    { code: "GBP", label: "British pound (£)", symbol: "£", locale: "en-GB" },
    { code: "JPY", label: "Japanese yen (¥)", symbol: "¥", locale: "ja-JP" },
    { code: "SGD", label: "Singapore dollar (S$)", symbol: "S$", locale: "en-SG" },
    { code: "AUD", label: "Australian dollar (A$)", symbol: "A$", locale: "en-AU" },
    { code: "CAD", label: "Canadian dollar (C$)", symbol: "C$", locale: "en-CA" }
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = () => window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const escapeHTML = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  function initialState() {
    return {
      transactions: [], budgets: [], goals: [],
      accounts: [{ id: uid(), name: "Cash wallet", type: "Cash", balance: 0 }],
      categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
      preferences: { currency: "PHP", theme: "light", name: "", notifications: true }
    };
  }

  function normalizeState(raw) {
    const base = initialState();
    if (!raw || typeof raw !== "object") return base;
    const allowedArrays = ["transactions", "budgets", "goals", "accounts", "categories"];
    allowedArrays.forEach((key) => { if (Array.isArray(raw[key])) base[key] = raw[key]; });
    if (!base.accounts.length) base.accounts = initialState().accounts;
    if (!base.categories.length) base.categories = DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    if (raw.preferences && typeof raw.preferences === "object") base.preferences = { ...base.preferences, ...raw.preferences };
    if (!CURRENCIES.some((currency) => currency.code === base.preferences.currency)) base.preferences.currency = "PHP";
    base.transactions = base.transactions.filter((item) => item && item.id && ["income", "expense", "transfer"].includes(item.type) && Number.isFinite(Number(item.amount)) && Number(item.amount) > 0);
    base.accounts = base.accounts.filter((item) => item && item.id).map((item) => ({ ...item, balance: Number(item.balance) || 0 }));
    return base;
  }

  let state;
  try { state = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch (error) { state = initialState(); console.error("PennyWise could not read saved data.", error); }
  let activePage = "dashboard";
  let transactionFilters = { search: "", type: "all", category: "all", from: "", to: "", sort: "newest" };
  let reportPeriod = "monthly";

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { console.error("PennyWise could not save data.", error); toast("Could not save data. Check available browser storage."); }
  }
  function currencyInfo() { return CURRENCIES.find((item) => item.code === state.preferences.currency) || CURRENCIES[0]; }
  function money(value) {
    const amount = Number(value) || 0;
    try { return new Intl.NumberFormat(currencyInfo().locale, { style: "currency", currency: currencyInfo().code, maximumFractionDigits: currencyInfo().code === "JPY" ? 0 : 2 }).format(amount); }
    catch (_) { return `${currencyInfo().symbol}${amount.toFixed(2)}`; }
  }
  function toast(message) {
    const node = document.createElement("div");
    node.className = "toast"; node.textContent = message; $("#toast-region").appendChild(node);
    window.setTimeout(() => node.remove(), 3200);
  }
  function dateLabel(value, options) {
    if (!value) return "No date";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, options || { month: "short", day: "numeric", year: "numeric" }).format(date);
  }
  function categoryInfo(name) { return state.categories.find((item) => item.name === name) || { name: name || "Other", icon: "✨" }; }
  function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
  function periodBounds(period, anchor = new Date()) {
    const start = new Date(anchor); start.setHours(0, 0, 0, 0);
    const end = new Date(anchor); end.setHours(23, 59, 59, 999);
    if (period === "daily") return { start, end };
    if (period === "weekly") {
      const weekday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - weekday); end.setTime(start.getTime()); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (period === "yearly") {
      start.setMonth(0, 1); end.setMonth(11, 31); end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    start.setDate(1); end.setMonth(end.getMonth() + 1, 0); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  function within(item, bounds) {
    if (!item.date) return false;
    const date = new Date(`${item.date}T12:00:00`);
    return date >= bounds.start && date <= bounds.end;
  }
  function transactionsIn(period, anchor = new Date()) {
    const bounds = periodBounds(period, anchor);
    return state.transactions.filter((item) => within(item, bounds));
  }
  function totals(items) {
    return items.reduce((result, item) => {
      if (item.type === "income" || item.type === "expense") result[item.type] += Number(item.amount) || 0;
      return result;
    }, { income: 0, expense: 0 });
  }
  function netIncome(items) { const result = totals(items); return result.income - result.expense; }
  function monthTransactions(offset = 0) {
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() + offset);
    return state.transactions.filter((item) => item.date && item.date.slice(0, 7) === monthKey(date));
  }
  function currentBudgetSpent(budget, category) {
    let bounds;
    const now = new Date();
    if (budget.period === "daily") bounds = periodBounds("daily", now);
    else if (budget.period === "weekly") bounds = periodBounds("weekly", now);
    else if (budget.period === "monthly") bounds = periodBounds("monthly", now);
    else bounds = { start: new Date(`${budget.startDate || todayISO()}T00:00:00`), end: new Date(`${budget.endDate || todayISO()}T23:59:59`) };
    return state.transactions.filter((item) => item.type === "expense" && (!category || item.category === category) && within(item, bounds)).reduce((sum, item) => sum + Number(item.amount), 0);
  }
  function budgetProgress(budget, category) {
    const limit = category ? Number(budget.limits && budget.limits[category]) || 0 : Number(budget.amount) || 0;
    const spent = currentBudgetSpent(budget, category);
    return { limit, spent, percent: limit > 0 ? spent / limit * 100 : 0 };
  }
  function expenseCategories() { return state.categories.map((item) => item.name); }
  function accountOptions(selected) {
    return state.accounts.map((account) => `<option value="${escapeHTML(account.id)}" ${account.id === selected ? "selected" : ""}>${escapeHTML(account.name)} · ${money(account.balance)}</option>`).join("");
  }
  function setPage(page) {
    activePage = page;
    $$(".nav-link[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function heading(title, subtitle, actions = "") {
    return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
  }
  function actionButton(label, action, id, extra = "") {
    return `<button class="action-button" data-action="${action}" data-id="${escapeHTML(id)}" ${extra}>${label}</button>`;
  }
  function emptyState(icon, text, action = "") {
    return `<div class="empty-state"><div class="empty-icon">${icon}</div>${text}${action}</div>`;
  }
  function transactionRow(item) {
    const category = item.type === "income" ? { icon: "💰", name: item.category || "Income" } : item.type === "transfer" ? { icon: "⇄", name: "Transfer" } : categoryInfo(item.category);
    return `<div class="transaction-row">
      <div class="category-icon">${category.icon}</div>
      <div class="transaction-main"><div class="transaction-name">${escapeHTML(item.description || item.category)}</div><div class="transaction-meta">${escapeHTML(category.name)} · ${dateLabel(item.date, { month: "short", day: "numeric" })}</div></div>
      <div class="transaction-amount ${item.type}">${item.type === "income" ? "+" : item.type === "transfer" ? "⇄ " : "−"}${money(item.amount)}</div>
    </div>`;
  }
  function summaryCard(label, value, icon, foot, className = "") {
    return `<article class="summary-card"><div class="summary-top"><span>${label}</span><span class="summary-icon">${icon}</span></div><div class="summary-value">${value}</div><div class="summary-foot ${className}">${foot}</div></article>`;
  }

  function renderDashboard() {
    const allMonth = monthTransactions();
    const { income, expense } = totals(allMonth);
    const savings = netIncome(allMonth);
    const budget = state.budgets.find((item) => item.period === "monthly") || state.budgets[0];
    const budgetAmount = budget ? Number(budget.amount) || 0 : 0;
    const categoryLimits = budget && budget.limits ? budget.limits : {};
    const categoryLimitsTotal = Object.values(categoryLimits).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const effectiveBudget = budgetAmount || categoryLimitsTotal;
    const budgetSpent = budget ? budgetAmount ? currentBudgetSpent(budget) : Object.keys(categoryLimits).reduce((sum, category) => sum + currentBudgetSpent(budget, category), 0) : 0;
    const remaining = Math.max(0, effectiveBudget - budgetSpent);
    const percentSpent = income > 0 ? Math.min(100, expense / income * 100) : 0;
    const recent = [...state.transactions].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
    const actions = `<button class="button button-secondary" data-action="add-transaction" data-type="income">＋ Income</button><button class="button button-primary" data-action="add-transaction" data-type="expense">＋ Add transaction</button>`;
    return `${heading(`Good ${greeting()}, ${escapeHTML(state.preferences.name || "there")} 👋`, "Here’s how your money is doing this month.", actions)}
      <div class="summary-grid">
        ${summaryCard("Total income", money(income), "↗", "This month", "positive")}
        ${summaryCard("Total expenses", money(expense), "↘", `${percentSpent.toFixed(0)}% of income spent`, "negative")}
        ${summaryCard("Available balance", money(savings), "◈", "Income minus expenses", savings >= 0 ? "positive" : "negative")}
        ${summaryCard("Remaining budget", budget ? money(remaining) : "Set a budget", "◷", budget ? `${effectiveBudget > 0 ? Math.min(100, budgetSpent / effectiveBudget * 100).toFixed(0) : 0}% of ${budget.period} budget used` : "Create your first budget")}
      </div>
      <div class="content-grid">
        <section class="panel"><div class="panel-heading"><div><h2>Spending & income</h2><div class="panel-subtitle">Your last 6 months at a glance</div></div><span class="category-pill">6 months</span></div><div class="chart-wrap" id="trend-chart"></div></section>
        <section class="panel"><div class="panel-heading"><div><h2>Budget progress</h2><div class="panel-subtitle">${budget ? `${escapeHTML(budget.name)} · ${budget.period}` : "Track spending at your pace"}</div></div><button class="text-button" data-page="budgets">View all →</button></div>
          <div class="budget-overview">${budget ? renderBudgetOverview(budget) : emptyState("◉", "No budget yet. Set a spending limit to stay on track.", `<br><button class="button button-primary button-small" data-action="add-budget">Create budget</button>`)}</div>
          ${budget ? `<div class="panel-subtitle" style="margin-top:17px">${remaining > 0 ? `${money(remaining)} left in this budget` : "Your budget is fully used."}</div>` : ""}
        </section>
      </div>
      <div class="content-grid">
        <section class="panel"><div class="panel-heading"><div><h2>Recent transactions</h2><div class="panel-subtitle">Your latest money moves</div></div><button class="text-button" data-page="transactions">See all →</button></div>
          <div class="transaction-list">${recent.length ? recent.map(transactionRow).join("") : emptyState("↕", "Your transactions will show up here.", `<button class="button button-primary button-small" data-action="add-transaction">Add transaction</button>`)}</div>
        </section>
        <section class="panel"><div class="panel-heading"><div><h2>Spending breakdown</h2><div class="panel-subtitle">This month by category</div></div><button class="text-button" data-page="reports">Details →</button></div><div id="category-chart" class="chart-wrap"></div></section>
      </div>
      <section class="panel"><div class="panel-heading"><div><h2>Savings goals</h2><div class="panel-subtitle">Keep your future in sight</div></div><button class="text-button" data-page="goals">View goals →</button></div>${renderGoalOverview()}</section>`;
  }
  function greeting() {
    const hour = new Date().getHours();
    return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  }
  function renderBudgetOverview(budget) {
    const limits = budget.limits && Object.keys(budget.limits).length ? Object.keys(budget.limits) : [null];
    return limits.map((category) => {
      const progress = budgetProgress(budget, category);
      const label = category || "Overall spending";
      const pct = Math.min(100, progress.percent);
      const tone = progress.percent >= 80 ? "warn" : "good";
      return `<div><div class="budget-line"><span>${escapeHTML(label)}</span><strong>${money(progress.spent)} <span class="muted">/ ${money(progress.limit)}</span></strong></div><div class="progress-track"><div class="progress-fill ${tone}" style="width:${pct}%"></div></div>${state.preferences.notifications && progress.limit && progress.percent >= 50 ? `<div class="budget-alert" style="margin-top:7px">⚠ ${budgetWarning(progress.percent)}</div>` : ""}</div>`;
    }).join("");
  }
  function budgetWarning(percent) {
    if (percent >= 100) return "You’ve reached 100% of this budget limit.";
    if (percent >= 80) return "You’ve used at least 80% of this budget limit.";
    return "You’ve used at least 50% of this budget limit.";
  }
  function renderGoalOverview() {
    if (!state.goals.length) return emptyState("◎", "No savings goals yet. Give your next big thing a name.", `<button class="button button-primary button-small" data-action="add-goal">Create a goal</button>`);
    return `<div class="cards-grid">${state.goals.slice(0, 3).map((goal) => {
      const percent = goal.target > 0 ? Math.min(100, Number(goal.current) / Number(goal.target) * 100) : 0;
      return `<div class="budget-line" style="align-items:flex-start"><span>${escapeHTML(goal.icon || "🎯")} ${escapeHTML(goal.name)}</span><strong>${percent.toFixed(0)}%</strong><div style="width:100%"><div class="progress-track"><div class="progress-fill good" style="width:${percent}%"></div></div><div class="goal-footer"><span>${money(goal.current)} saved</span><span>${money(goal.target)} goal</span></div></div></div>`;
    }).join("")}</div>`;
  }

  function renderTransactions() {
    const categories = [...new Set(state.transactions.map((item) => item.category).filter(Boolean))].sort();
    let rows = state.transactions.filter((item) => {
      const query = transactionFilters.search.toLowerCase();
      const matchesSearch = !query || `${item.description} ${item.category} ${item.paymentMethod}`.toLowerCase().includes(query);
      const matchesType = transactionFilters.type === "all" || item.type === transactionFilters.type;
      const matchesCategory = transactionFilters.category === "all" || item.category === transactionFilters.category;
      return matchesSearch && matchesType && matchesCategory && (!transactionFilters.from || item.date >= transactionFilters.from) && (!transactionFilters.to || item.date <= transactionFilters.to);
    });
    rows.sort((a, b) => transactionFilters.sort === "oldest" ? (a.date || "").localeCompare(b.date || "") : transactionFilters.sort === "highest" ? Number(b.amount) - Number(a.amount) : (b.date || "").localeCompare(a.date || ""));
    const content = rows.length ? rows.map((item) => {
      const cat = item.type === "income" ? { icon: "💰", name: item.category } : categoryInfo(item.category);
      return `<tr><td><span class="table-title"><span class="category-icon">${cat.icon}</span>${escapeHTML(item.description || item.category)}</span></td><td><span class="category-pill">${escapeHTML(item.category)}</span></td><td>${dateLabel(item.date)}</td><td>${escapeHTML(item.paymentMethod || "—")}</td><td class="transaction-amount ${item.type}">${item.type === "income" ? "+" : item.type === "transfer" ? "⇄ " : "−"}${money(item.amount)}</td><td><div class="action-cell">${item.type === "transfer" ? "" : actionButton("Edit", "edit-transaction", item.id)}${actionButton("Delete", "delete-transaction", item.id)}</div></td></tr>`;
    }).join("") : `<tr><td colspan="6">${emptyState("↕", "No transactions match these filters.")}</td></tr>`;
    return `${heading("Transactions", "A clear history of every peso in and out.", `<button class="button button-primary" data-action="add-transaction">＋ Add transaction</button>`)}
      <section class="panel list-panel"><div class="toolbar">
        <input class="field-control search-control" id="filter-search" type="search" placeholder="Search description or category" value="${escapeHTML(transactionFilters.search)}" aria-label="Search transactions">
        <select class="field-control" id="filter-type" aria-label="Transaction type"><option value="all">All types</option><option value="income" ${transactionFilters.type === "income" ? "selected" : ""}>Income</option><option value="expense" ${transactionFilters.type === "expense" ? "selected" : ""}>Expenses</option><option value="transfer" ${transactionFilters.type === "transfer" ? "selected" : ""}>Transfers</option></select>
        <select class="field-control" id="filter-category" aria-label="Category"><option value="all">All categories</option>${categories.map((item) => `<option ${transactionFilters.category === item ? "selected" : ""}>${escapeHTML(item)}</option>`).join("")}</select>
        <input class="field-control" id="filter-from" type="date" aria-label="From date" value="${transactionFilters.from}">
        <input class="field-control" id="filter-to" type="date" aria-label="To date" value="${transactionFilters.to}">
        <select class="field-control" id="filter-sort" aria-label="Sort transactions"><option value="newest" ${transactionFilters.sort === "newest" ? "selected" : ""}>Newest first</option><option value="oldest" ${transactionFilters.sort === "oldest" ? "selected" : ""}>Oldest first</option><option value="highest" ${transactionFilters.sort === "highest" ? "selected" : ""}>Highest amount</option></select>
      </div><div class="table-wrap"><table class="data-table"><thead><tr><th>DESCRIPTION</th><th>CATEGORY</th><th>DATE</th><th>PAYMENT</th><th>AMOUNT</th><th></th></tr></thead><tbody>${content}</tbody></table></div></section>`;
  }

  function renderBudgets() {
    const cards = state.budgets.length ? `<div class="cards-grid">${state.budgets.map((budget) => {
      const limits = budget.limits && Object.keys(budget.limits).length ? Object.entries(budget.limits) : [[null, budget.amount]];
      return `<article class="panel budget-card"><div class="panel-heading"><div><h2>${escapeHTML(budget.name)}</h2><span class="frequency-pill">${escapeHTML(budget.period)} budget</span></div><div class="action-cell">${actionButton("Edit", "edit-budget", budget.id)}${actionButton("Delete", "delete-budget", budget.id)}</div></div>
      ${limits.map(([category, amount]) => {
        const progress = budgetProgress(budget, category);
        const pct = Math.min(100, progress.percent);
        return `<div style="margin-top:16px"><div class="budget-line"><span>${escapeHTML(category || "Overall spending")}</span><strong>${money(progress.spent)} / ${money(Number(amount) || 0)}</strong></div><div class="progress-track"><div class="progress-fill ${progress.percent >= 80 ? "warn" : "good"}" style="width:${pct}%"></div></div><div class="goal-footer"><span>${progress.percent.toFixed(0)}% used</span><span>${money(Math.max(0, (Number(amount) || 0) - progress.spent))} left</span></div>${state.preferences.notifications && progress.percent >= 50 ? `<div class="budget-alert" style="margin-top:9px">⚠ ${budgetWarning(progress.percent)}</div>` : ""}</div>`;
      }).join("")}</article>`;
    }).join("")}</div>` : emptyState("◉", "You haven't created a budget yet. Start with a monthly spending limit.");
    return `${heading("Your budgets", "Set flexible spending limits and get a heads-up when you’re getting close.", `<button class="button button-primary" data-action="add-budget">＋ Create budget</button>`)}${cards}
      <section class="panel list-panel"><div class="panel-heading"><div><h2>Budget alerts</h2><div class="panel-subtitle">Heads-up milestones are shown at 50%, 80%, and 100% of a limit.</div></div></div><div class="notice">Alerts are shown in PennyWise whenever you view your budgets. Your records are stored locally on this device.</div></section>`;
  }

  function goalRate(goal) {
    const remaining = Math.max(0, Number(goal.target) - Number(goal.current));
    if (!goal.targetDate || remaining === 0) return null;
    const days = Math.ceil((new Date(`${goal.targetDate}T23:59:59`) - new Date()) / 86400000);
    if (days <= 0) return { days, daily: remaining, weekly: remaining, monthly: remaining };
    return { days, daily: remaining / days, weekly: remaining / days * 7, monthly: remaining / days * 30.4375 };
  }
  function renderGoals() {
    const cards = state.goals.length ? `<div class="cards-grid">${state.goals.map((goal) => {
      const target = Number(goal.target) || 0; const current = Number(goal.current) || 0;
      const percent = target > 0 ? Math.min(100, current / target * 100) : 0;
      const rate = goalRate(goal);
      return `<article class="panel goal-card"><div class="panel-heading"><div><span class="category-icon">${escapeHTML(goal.icon || "🎯")}</span><h2 style="margin-top:10px">${escapeHTML(goal.name)}</h2></div><div class="action-cell">${actionButton("Edit", "edit-goal", goal.id)}${actionButton("Delete", "delete-goal", goal.id)}</div></div>
        <div class="goal-amount">${money(current)}</div><div class="goal-target">of ${money(target)} goal</div><div class="progress-track" style="margin-top:12px"><div class="progress-fill good" style="width:${percent}%"></div></div><div class="goal-footer"><span>${percent.toFixed(0)}% complete</span><span>${goal.targetDate ? `By ${dateLabel(goal.targetDate, { month: "short", year: "numeric" })}` : "No deadline"}</span></div>
        <div class="goal-save-rate">${current >= target && target > 0 ? "🎉 Goal complete — wonderful work!" : rate ? rate.days <= 0 ? `Past target date. Save ${money(rate.daily)} now to close the gap.` : `To reach your goal: <strong>${money(rate.daily)}/day</strong> · ${money(rate.weekly)}/week · ${money(rate.monthly)}/month` : "Add a target date to see your suggested savings pace."}</div>
        <div class="goal-actions"><button class="button button-primary button-small" data-action="contribute-goal" data-id="${escapeHTML(goal.id)}">＋ Add savings</button></div></article>`;
    }).join("")}</div>` : emptyState("◎", "Give your savings a purpose. Create your first goal to get started.");
    return `${heading("Savings goals", "Make progress on the things that matter to you.", `<button class="button button-primary" data-action="add-goal">＋ New goal</button>`)}${cards}`;
  }

  function renderAccounts() {
    const cards = state.accounts.length ? `<div class="cards-grid">${state.accounts.map((account) => `<article class="panel account-card"><div class="account-card-header"><span class="category-icon">${account.type === "Cash" ? "💵" : account.type === "E-wallet" ? "📱" : "🏦"}</span><div class="action-cell">${actionButton("Edit", "edit-account", account.id)}${actionButton("Delete", "delete-account", account.id)}</div></div><div class="account-balance">${money(account.balance)}</div><div class="table-title">${escapeHTML(account.name)}</div><div class="account-kind">${escapeHTML(account.type)}</div><div class="account-actions"><button class="button button-secondary button-small" data-action="transfer" data-id="${escapeHTML(account.id)}">⇄ Transfer</button></div></article>`).join("")}</div>` : emptyState("▤", "Add an account to keep track of your cash, bank, and e-wallet balances.");
    return `${heading("Accounts", "See where your money lives and move it between accounts.", `<button class="button button-secondary" data-action="transfer">⇄ Transfer</button><button class="button button-primary" data-action="add-account">＋ Add account</button>`)}
      <section class="panel" style="margin-bottom:17px"><div class="stat-grid"><div class="stat-tile"><span class="muted">Total across accounts</span><strong>${money(state.accounts.reduce((sum, item) => sum + Number(item.balance), 0))}</strong></div><div class="stat-tile"><span class="muted">Number of accounts</span><strong>${state.accounts.length}</strong></div><div class="stat-tile"><span class="muted">Transfers tracked</span><strong>${state.transactions.filter((item) => item.type === "transfer").length}</strong></div></div><div class="notice">Transfers change account balances but are never counted as income or expenses in your reports.</div></section>${cards}`;
  }

  function renderReports() {
    const periods = ["daily", "weekly", "monthly", "yearly"];
    const items = transactionsIn(reportPeriod); const { income, expense } = totals(items);
    const net = income - expense; const savingsRate = income > 0 ? Math.max(0, net) / income * 100 : 0;
    const monthItems = monthTransactions();
    const catTotals = {};
    monthItems.filter((item) => item.type === "expense").forEach((item) => { catTotals[item.category] = (catTotals[item.category] || 0) + Number(item.amount); });
    const categoryRows = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    const previous = monthTransactions(-1);
    const prevByCategory = {};
    previous.filter((item) => item.type === "expense").forEach((item) => { prevByCategory[item.category] = (prevByCategory[item.category] || 0) + Number(item.amount); });
    const trend = categoryRows.slice(0, 5).map(([category, amount]) => {
      const oldAmount = prevByCategory[category] || 0; const change = oldAmount > 0 ? (amount - oldAmount) / oldAmount * 100 : amount > 0 ? 100 : 0;
      return `<div class="budget-line"><span>${categoryInfo(category).icon} ${escapeHTML(category)}</span><span><strong>${money(amount)}</strong> <span class="${change > 0 ? "negative" : "positive"}">${oldAmount ? `${change > 0 ? "+" : ""}${change.toFixed(0)}%` : "New"}</span></span></div>`;
    }).join("");
    const topCategory = categoryRows[0];
    const periodLabel = reportPeriod.charAt(0).toUpperCase() + reportPeriod.slice(1);
    const periodDescription = { daily: "Today", weekly: "This week", monthly: "This month", yearly: "This year" }[reportPeriod];
    return `${heading("Your reports", "Understand the story behind your spending.", `<select class="field-control" id="report-period" aria-label="Report period">${periods.map((item) => `<option value="${item}" ${item === reportPeriod ? "selected" : ""}>${item.charAt(0).toUpperCase() + item.slice(1)}</option>`).join("")}</select>`)}
      <section class="panel" style="margin-bottom:17px"><div class="panel-heading"><div><h2>${periodLabel} summary</h2><div class="panel-subtitle">${periodDescription} · based on recorded transactions</div></div></div>
        <div class="stat-grid">${[
          ["Income", money(income), "positive"], ["Expenses", money(expense), "negative"], ["Net savings", money(net), net >= 0 ? "positive" : "negative"]
        ].map(([label, value, cls]) => `<div class="stat-tile"><span class="muted">${label}</span><strong class="${cls}">${value}</strong></div>`).join("")}</div>
        <div class="budget-line"><span>Income spent</span><strong>${income > 0 ? (expense / income * 100).toFixed(1) : "0.0"}%</strong></div><div class="progress-track"><div class="progress-fill ${income > 0 && expense / income >= .8 ? "warn" : "good"}" style="width:${Math.min(100, income > 0 ? expense / income * 100 : 0)}%"></div></div>
        <div class="budget-line" style="margin-top:15px"><span>Savings rate</span><strong>${savingsRate.toFixed(1)}%</strong></div><div class="progress-track"><div class="progress-fill good" style="width:${Math.min(100, savingsRate)}%"></div></div></section>
      <div class="content-grid"><section class="panel"><div class="panel-heading"><div><h2>Category spending</h2><div class="panel-subtitle">Current month · percentage of expenses</div></div></div><div id="category-chart" class="chart-wrap"></div><div class="budget-overview">${categoryRows.length ? categoryRows.map(([category, amount]) => { const pct = expenseCategoriesTotal(catTotals) ? amount / expenseCategoriesTotal(catTotals) * 100 : 0; return `<div><div class="budget-line"><span>${categoryInfo(category).icon} ${escapeHTML(category)}</span><strong>${money(amount)} · ${pct.toFixed(1)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>`; }).join("") : emptyState("◔", "Add expenses to see your category breakdown.")}</div></section>
      <section class="panel"><div class="panel-heading"><div><h2>Spending insights</h2><div class="panel-subtitle">Compared with last month</div></div></div>
        <div class="insight-card"><strong>✦ Biggest category</strong>${topCategory ? `${escapeHTML(topCategory[0])} is your biggest spending category this month at ${money(topCategory[1])} (${expense > 0 ? (topCategory[1] / expense * 100).toFixed(0) : 0}% of recorded expenses).` : "Record a few expenses to uncover your top spending category."}</div>
        <div class="budget-overview">${trend || `<div class="empty-state">No spending trends yet. Add expenses to start comparing habits.</div>`}</div>
        <div class="panel-subtitle" style="margin-top:14px">Only your recorded transactions are used for these insights. A category marked “New” had no spending last month.</div></section></div>`;
  }
  function expenseCategoriesTotal(totalsByCategory) { return Object.values(totalsByCategory).reduce((sum, value) => sum + value, 0); }

  function renderSettings() {
    const prefs = state.preferences;
    return `${heading("Settings", "Make PennyWise feel like yours and keep your data in your hands.", "")}
      <div class="settings-layout">
        <section class="panel settings-panel"><h2>Profile & preferences</h2>
          <div class="form-field"><label for="pref-name">Your name</label><input id="pref-name" maxlength="60" value="${escapeHTML(prefs.name || "")}" placeholder="What should we call you?"></div>
          <div class="form-field"><label for="pref-currency">Currency</label><select id="pref-currency">${CURRENCIES.map((currency) => `<option value="${currency.code}" ${prefs.currency === currency.code ? "selected" : ""}>${currency.label}</option>`).join("")}</select></div>
          <div class="setting-row"><div><strong>Dark mode</strong><small>Choose a softer look for low-light settings.</small></div><label class="switch"><input type="checkbox" id="pref-theme" ${prefs.theme === "dark" ? "checked" : ""}><span></span></label></div>
          <div class="setting-row"><div><strong>Budget notifications</strong><small>Show in-app warnings at 50%, 80%, and 100% of budget limits.</small></div><label class="switch"><input type="checkbox" id="pref-notifications" ${prefs.notifications ? "checked" : ""}><span></span></label></div>
          <button class="button button-primary" id="save-preferences">Save preferences</button>
        </section>
        <section class="panel settings-panel"><h2>Expense categories</h2><div class="panel-subtitle">Customize the categories available when adding an expense.</div>
          <div class="transaction-list">${state.categories.map((category) => `<div class="transaction-row"><span class="category-icon">${escapeHTML(category.icon)}</span><div class="transaction-main"><div class="transaction-name">${escapeHTML(category.name)}</div></div>${actionButton("Remove", "delete-category", category.name)}</div>`).join("")}</div>
          <form id="add-category-form" class="inline-form"><div class="form-field"><label for="new-category">New category</label><input id="new-category" maxlength="35" required placeholder="e.g. Pets"></div><button class="button button-secondary" type="submit">＋ Add</button></form>
        </section>
        <section class="panel settings-panel"><h2>Data & backup</h2><div class="notice"><strong>Your records stay on this device.</strong> PennyWise saves data in this browser’s localStorage. It does not automatically synchronize financial records across devices or browsers. Export a backup and restore it on another device if needed.</div>
          <div class="heading-actions"><button class="button button-secondary" data-action="export-csv">Export transactions CSV</button><button class="button button-secondary" data-action="backup-json">Back up JSON</button><button class="button button-secondary" data-action="restore-json">Restore JSON backup</button></div>
        </section>
        <section class="panel settings-panel"><h2>Sample data</h2><div class="panel-subtitle">Try the dashboard with realistic examples, or clear the sample again.</div>
          <div class="heading-actions"><button class="button button-secondary" data-action="load-sample">Load sample data</button><button class="button button-danger" data-action="remove-sample">Remove sample data</button></div>
          <div class="notice">Sample records are labeled so you can remove them without affecting your own entries.</div>
        </section>
      </div>`;
  }
  function render() {
    const page = $("#page-content");
    const renderers = { dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets, goals: renderGoals, accounts: renderAccounts, reports: renderReports, settings: renderSettings };
    page.innerHTML = (renderers[activePage] || renderDashboard)();
    $("#header-name").textContent = state.preferences.name || "My wallet";
    $("#avatar-initials").textContent = state.preferences.name ? state.preferences.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "PW";
    document.body.classList.toggle("dark-theme", state.preferences.theme === "dark");
    if (activePage === "dashboard") { drawTrendChart(); drawCategoryChart(); }
    if (activePage === "reports") drawCategoryChart();
  }

  function svgText(x, y, text, anchor = "middle") {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="currentColor" font-family="DM Sans,sans-serif" font-size="10">${escapeHTML(text)}</text>`;
  }
  function drawTrendChart() {
    const holder = $("#trend-chart"); if (!holder) return;
    const months = [];
    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - offset);
      const key = monthKey(date); const monthItems = state.transactions.filter((item) => item.date && item.date.slice(0, 7) === key);
      months.push({ label: date.toLocaleDateString(undefined, { month: "short" }), ...totals(monthItems) });
    }
    const max = Math.max(1, ...months.flatMap((item) => [item.income, item.expense]));
    const width = 500; const height = 210; const left = 28; const bottom = 181; const top = 14; const chartHeight = bottom - top;
    const bars = months.map((item, index) => {
      const groupX = left + index * 77; const barHeightIncome = item.income / max * chartHeight; const barHeightExpense = item.expense / max * chartHeight;
      return `<rect x="${groupX + 14}" y="${bottom - barHeightIncome}" width="17" height="${barHeightIncome}" rx="5" fill="#9c8be9"><title>${item.label}: income ${money(item.income)}</title></rect>
        <rect x="${groupX + 35}" y="${bottom - barHeightExpense}" width="17" height="${barHeightExpense}" rx="5" fill="#f2b792"><title>${item.label}: expenses ${money(item.expense)}</title></rect>${svgText(groupX + 32, 202, item.label)}`;
    }).join("");
    let grid = "";
    for (let i = 0; i < 4; i++) { const y = top + i * chartHeight / 3; grid += `<line x1="${left}" y1="${y}" x2="${width - 8}" y2="${y}" stroke="var(--line)" stroke-dasharray="3 5"/>`; }
    holder.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart of income and expenses over the last six months">${grid}${bars}</svg><div class="chart-legend"><span><i class="legend-dot" style="background:#9c8be9"></i>Income</span><span><i class="legend-dot" style="background:#f2b792"></i>Expenses</span></div>`;
  }
  function drawCategoryChart() {
    const holder = $("#category-chart"); if (!holder) return;
    const monthItems = monthTransactions().filter((item) => item.type === "expense");
    const values = {};
    monthItems.forEach((item) => { values[item.category] = (values[item.category] || 0) + Number(item.amount); });
    const data = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const total = data.reduce((sum, item) => sum + item[1], 0);
    if (!total) { holder.innerHTML = emptyState("◔", "Add expenses to see your spending breakdown."); return; }
    const colors = ["#8877df", "#f4b58d", "#7bc6a2", "#83a8e9", "#e791ae", "#e7cb75"];
    let angle = -90; const segments = data.map(([, amount], index) => {
      const start = angle; const sweep = amount / total * 359.9; angle += sweep; const end = angle;
      const polar = (deg) => { const rad = deg * Math.PI / 180; return [110 + 76 * Math.cos(rad), 103 + 76 * Math.sin(rad)]; };
      const [x1, y1] = polar(start); const [x2, y2] = polar(end); const large = sweep > 180 ? 1 : 0;
      return `<path d="M 110 103 L ${x1} ${y1} A 76 76 0 ${large} 1 ${x2} ${y2} Z" fill="${colors[index % colors.length]}"><title>${escapeHTML(data[index][0])}: ${money(amount)} (${(amount / total * 100).toFixed(1)}%)</title></path>`;
    }).join("");
    holder.innerHTML = `<svg viewBox="0 0 220 205" role="img" aria-label="Donut chart showing monthly spending by category"><g>${segments}<circle cx="110" cy="103" r="49" fill="var(--surface)"/><text x="110" y="99" text-anchor="middle" fill="var(--muted)" font-family="DM Sans,sans-serif" font-size="10">Total spent</text><text x="110" y="117" text-anchor="middle" fill="var(--text)" font-family="Manrope,sans-serif" font-size="13" font-weight="700">${escapeHTML(money(total))}</text></g></svg>
      <div class="chart-legend">${data.map(([name], index) => `<span><i class="legend-dot" style="background:${colors[index % colors.length]}"></i>${escapeHTML(name)}</span>`).join("")}</div>`;
  }

  function openDialog(title, body, onSubmit, submitLabel = "Save") {
    const dialog = $("#app-dialog");
    $("#dialog-content").innerHTML = `<form class="modal-form" id="active-form"><div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="dialog-close" data-close-dialog aria-label="Close">×</button></div><div class="dialog-fields">${body}</div><div class="dialog-actions"><button type="button" class="button button-secondary" data-close-dialog>Cancel</button><button class="button button-primary" type="submit">${submitLabel}</button></div></form>`;
    if (dialog.open) dialog.close();
    dialog.showModal();
    $("#active-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries());
      try { onSubmit(values); }
      catch (error) { console.error("Could not complete the requested action.", error); toast(error.message || "Something went wrong. Please try again."); }
    });
  }
  function closeDialog() { $("#app-dialog").close(); }
  function inputField(label, name, value = "", type = "text", extra = "") {
    return `<div class="form-field"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" ${extra}></div>`;
  }
  function selectField(label, name, options, selected, empty = false) {
    return `<div class="form-field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" required>${empty ? `<option value="">Choose ${label.toLowerCase()}</option>` : ""}${options.map((option) => { const value = typeof option === "string" ? option : option.value; const text = typeof option === "string" ? option : option.label; return `<option value="${escapeHTML(value)}" ${value === selected ? "selected" : ""}>${escapeHTML(text)}</option>`; }).join("")}</select></div>`;
  }
  function transactionForm(item = {}) {
    const type = item.type || "expense";
    const categories = type === "income" ? INCOME_CATEGORIES : expenseCategories();
    const paymentMethods = ["Cash", "Debit card", "Credit card", "Bank transfer", "E-wallet", "Other"];
    openDialog(item.id ? `Edit ${type}` : `Add ${type}`, `
      ${selectField("Type", "type", [{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }], type)}
      ${inputField("Description", "description", item.description || "", "text", 'maxlength="100" required placeholder="e.g. Weekly groceries"')}
      <div class="form-two-col">${inputField("Amount", "amount", item.amount || "", "number", 'min="0.01" step="0.01" required placeholder="0.00"')}${selectField("Category / source", "category", categories, item.category || categories[0])}</div>
      <div class="form-two-col">${inputField("Date", "date", item.date || todayISO(), "date", "required")}${selectField("Payment method", "paymentMethod", paymentMethods, item.paymentMethod || "Cash")}</div>
      ${selectField("Account", "accountId", state.accounts.map((account) => ({ value: account.id, label: `${account.name} (${account.type})` })), item.accountId || (state.accounts[0] && state.accounts[0].id))}
    `, (values) => {
      const amount = Number(values.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
      const account = state.accounts.find((entry) => entry.id === values.accountId);
      if (!account) throw new Error("Choose a valid account.");
      const existing = item.id ? state.transactions.find((entry) => entry.id === item.id) : null;
      if (existing) {
        const oldAccount = state.accounts.find((entry) => entry.id === existing.accountId);
        if (oldAccount) oldAccount.balance += existing.type === "income" ? -Number(existing.amount) : Number(existing.amount);
      }
      account.balance += values.type === "income" ? amount : -amount;
      const record = { ...existing, ...item, ...values, type: values.type, amount, id: item.id || uid(), sample: (existing && existing.sample) || item.sample || false };
      const index = state.transactions.findIndex((entry) => entry.id === record.id);
      if (index >= 0) state.transactions[index] = record; else state.transactions.push(record);
      finish(item.id ? "Transaction updated." : "Transaction added.");
    }, item.id ? "Save changes" : "Add transaction");
    $("#field-type").addEventListener("change", (event) => {
      const old = Object.fromEntries(new FormData($("#active-form")).entries());
      old.type = event.target.value;
      closeDialog(); transactionForm({ ...item, ...old, type: old.type, category: "" });
    });
  }
  function deleteTransaction(id) {
    const item = state.transactions.find((entry) => entry.id === id); if (!item) return;
    if (!window.confirm(`Delete “${item.description || item.category}”? This cannot be undone.`)) return;
    const account = state.accounts.find((entry) => entry.id === item.accountId);
    if (account) account.balance += item.type === "income" ? -Number(item.amount) : Number(item.amount);
    if (item.type === "transfer") {
      const destination = state.accounts.find((entry) => entry.id === item.toAccountId);
      if (destination) destination.balance -= Number(item.amount);
    }
    state.transactions = state.transactions.filter((entry) => entry.id !== id); finish("Transaction deleted.");
  }
  function budgetForm(budget = {}) {
    const period = budget.period || "monthly";
    openDialog(budget.id ? "Edit budget" : "Create a budget", `
      ${inputField("Budget name", "name", budget.name || "", "text", 'maxlength="60" required placeholder="e.g. Monthly essentials"')}
      ${selectField("Budget period", "period", ["daily", "weekly", "monthly", "custom"], period)}
      <div id="overall-budget-fields">${inputField("Overall spending limit", "amount", budget.amount || "", "number", 'min="0.01" step="0.01" placeholder="Leave blank if using category limits"')}</div>
      ${inputField("Category limits (optional)", "limitsText", budget.limits ? Object.entries(budget.limits).map(([key, value]) => `${key}: ${value}`).join("\\n") : "", "text", 'placeholder="Food: 5000, Bills: 3000"')}
      <div class="panel-subtitle">Enter category limits separated by commas, e.g. Food: 5000, Bills: 3000. Custom budgets use the dates below.</div>
      <div class="form-two-col" id="custom-dates">${inputField("Start date", "startDate", budget.startDate || todayISO(), "date")}${inputField("End date", "endDate", budget.endDate || todayISO(), "date")}</div>
    `, (values) => {
      const amount = Number(values.amount) || 0;
      const limits = {};
      (values.limitsText || "").split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
        const match = part.match(/^(.+?)\s*:\s*(\d+(?:\.\d+)?)$/);
        if (!match) throw new Error("Category limits must use the format Category: amount, for example Food: 5000.");
        const name = match[1].trim(); const limit = Number(match[2]);
        if (!expenseCategories().includes(name)) throw new Error(`“${name}” is not an expense category. Add it in Settings first.`);
        if (limit <= 0) throw new Error("Each category limit must be greater than zero.");
        limits[name] = limit;
      });
      if (!amount && !Object.keys(limits).length) throw new Error("Enter an overall limit or at least one category limit.");
      if (values.period === "custom" && (!values.startDate || !values.endDate)) throw new Error("Choose both a start date and an end date for a custom budget.");
      if (values.period === "custom" && values.endDate < values.startDate) throw new Error("End date must be on or after the start date.");
      const record = { ...budget, id: budget.id || uid(), name: values.name.trim(), period: values.period, amount, limits, startDate: values.startDate, endDate: values.endDate };
      const index = state.budgets.findIndex((entry) => entry.id === record.id);
      if (index >= 0) state.budgets[index] = record; else state.budgets.push(record);
      finish(budget.id ? "Budget updated." : "Budget created.");
    });
  }
  function goalForm(goal = {}) {
    openDialog(goal.id ? "Edit savings goal" : "Create a savings goal", `
      ${inputField("Goal name", "name", goal.name || "", "text", 'maxlength="60" required placeholder="e.g. Emergency fund"')}
      <div class="form-two-col">${inputField("Target amount", "target", goal.target || "", "number", 'min="0.01" step="0.01" required')}${inputField("Already saved", "current", goal.current || 0, "number", 'min="0" step="0.01" required')}</div>
      <div class="form-two-col">${inputField("Target date (optional)", "targetDate", goal.targetDate || "", "date")}${inputField("Emoji (optional)", "icon", goal.icon || "🎯", "text", 'maxlength="4"')}</div>
    `, (values) => {
      const target = Number(values.target); const current = Number(values.current);
      if (target <= 0 || current < 0) throw new Error("Enter a target above zero and savings of zero or more.");
      const record = { ...goal, id: goal.id || uid(), name: values.name.trim(), target, current, targetDate: values.targetDate, icon: values.icon || "🎯" };
      const index = state.goals.findIndex((entry) => entry.id === record.id);
      if (index >= 0) state.goals[index] = record; else state.goals.push(record);
      finish(goal.id ? "Savings goal updated." : "Savings goal created.");
    });
  }
  function contributeGoal(id) {
    const goal = state.goals.find((entry) => entry.id === id); if (!goal) return;
    openDialog(`Add savings · ${escapeHTML(goal.name)}`, `${inputField("Amount to add", "amount", "", "number", 'min="0.01" step="0.01" required placeholder="0.00"')}`, (values) => {
      const amount = Number(values.amount); if (amount <= 0) throw new Error("Enter an amount greater than zero.");
      goal.current = Number(goal.current) + amount; finish("Savings added to your goal.");
    }, "Add savings");
  }
  function accountForm(account = {}) {
    openDialog(account.id ? "Edit account" : "Add account", `
      ${inputField("Account name", "name", account.name || "", "text", 'maxlength="50" required placeholder="e.g. BPI savings"')}
      ${selectField("Account type", "type", ACCOUNT_TYPES, account.type || "Cash")}
      ${inputField(account.id ? "Current balance" : "Starting balance", "balance", account.balance || 0, "number", 'min="0" step="0.01" required')}
    `, (values) => {
      const balance = Number(values.balance); if (!Number.isFinite(balance) || balance < 0) throw new Error("Enter a valid balance of zero or more.");
      const record = { ...account, id: account.id || uid(), name: values.name.trim(), type: values.type, balance };
      const index = state.accounts.findIndex((entry) => entry.id === record.id);
      if (index >= 0) state.accounts[index] = record; else state.accounts.push(record);
      finish(account.id ? "Account updated." : "Account added.");
    });
  }
  function transferForm(defaultId) {
    if (state.accounts.length < 2) { toast("Add another account before making a transfer."); return; }
    openDialog("Transfer between accounts", `
      ${selectField("From account", "fromId", state.accounts.map((account) => ({ value: account.id, label: `${account.name} · ${money(account.balance)}` })), defaultId || state.accounts[0].id)}
      ${selectField("To account", "toId", state.accounts.map((account) => ({ value: account.id, label: `${account.name} · ${money(account.balance)}` })), state.accounts.find((account) => account.id !== defaultId)?.id || state.accounts[1].id)}
      <div class="form-two-col">${inputField("Amount", "amount", "", "number", 'min="0.01" step="0.01" required')}${inputField("Date", "date", todayISO(), "date", "required")}</div>
      <div class="notice">Transfers only move balances between accounts. They are excluded from income and expense totals.</div>
    `, (values) => {
      if (values.fromId === values.toId) throw new Error("Choose two different accounts.");
      const from = state.accounts.find((account) => account.id === values.fromId); const to = state.accounts.find((account) => account.id === values.toId);
      const amount = Number(values.amount);
      if (!from || !to || amount <= 0) throw new Error("Enter a valid transfer amount and accounts.");
      if (amount > from.balance && !window.confirm("This transfer is larger than the source account balance. Continue anyway?")) return;
      from.balance -= amount; to.balance += amount;
      state.transactions.push({ id: uid(), type: "transfer", category: "Transfer", description: `Transfer: ${from.name} → ${to.name}`, amount, date: values.date, paymentMethod: "Account transfer", accountId: from.id, toAccountId: to.id, sample: Boolean(from.sample && to.sample) });
      finish("Transfer completed. It won't affect income or expense totals.");
    }, "Transfer");
  }
  function finish(message) { save(); closeDialog(); render(); toast(message); }

  function deleteRecord(listName, id, label) {
    const list = state[listName]; const item = list.find((entry) => entry.id === id); if (!item) return;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    if (listName === "accounts" && state.transactions.some((transaction) => transaction.accountId === id || transaction.toAccountId === id)) {
      toast("This account is used by transaction history. Move or remove those transactions first."); return;
    }
    state[listName] = list.filter((entry) => entry.id !== id); finish(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted.`);
  }
  function deleteCategory(name) {
    if (!window.confirm(`Remove the “${name}” category? Existing transactions will keep their category label.`)) return;
    state.categories = state.categories.filter((item) => item.name !== name);
    state.budgets.forEach((budget) => { if (budget.limits) delete budget.limits[name]; });
    finish("Category removed.");
  }

  function escapeCSV(value) { return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`; }
  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCSV() {
    const headers = ["date", "type", "description", "category", "amount", "currency", "payment_method", "account", "destination_account"];
    const lines = state.transactions.map((item) => {
      const account = state.accounts.find((entry) => entry.id === item.accountId);
      const destination = state.accounts.find((entry) => entry.id === item.toAccountId);
      return [item.date, item.type, item.description, item.category, item.amount, state.preferences.currency, item.paymentMethod, account ? account.name : "", destination ? destination.name : ""].map(escapeCSV).join(",");
    });
    downloadFile("pennywise-transactions.csv", [headers.join(","), ...lines].join("\r\n"), "text/csv;charset=utf-8");
    toast("Transaction CSV exported.");
  }
  function exportJSON() {
    downloadFile(`pennywise-backup-${todayISO()}.json`, JSON.stringify({ app: "PennyWise", version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2), "application/json");
    toast("JSON backup downloaded.");
  }
  function restoreJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const raw = parsed && parsed.data ? parsed.data : parsed;
        if (!raw || !Array.isArray(raw.transactions) || !Array.isArray(raw.accounts)) throw new Error("This file does not look like a PennyWise backup.");
        const restored = normalizeState(raw);
        if (!window.confirm(`Restore backup with ${restored.transactions.length} transactions, ${restored.budgets.length} budgets, and ${restored.goals.length} goals? This replaces the data currently stored in this browser.`)) return;
        state = restored; save(); render(); toast("Backup restored successfully.");
      } catch (error) { console.error("PennyWise could not restore backup.", error); toast(error.message || "The selected backup file is invalid."); }
      finally { $("#restore-file").value = ""; }
    };
    reader.onerror = () => { toast("Could not read the selected backup file."); $("#restore-file").value = ""; };
    reader.readAsText(file);
  }
  function sampleData() {
    const accountOne = { id: uid(), name: "Everyday cash", type: "Cash", balance: 0, sample: true };
    const accountTwo = { id: uid(), name: "Savings account", type: "Bank account", balance: 0, sample: true };
    const accounts = [accountOne, accountTwo];
    const date = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().slice(0, 10); };
    const records = [
      { type: "income", description: "Monthly salary", category: "Salary", amount: 28000, date: date(3), paymentMethod: "Bank transfer", accountId: accountTwo.id },
      { type: "expense", description: "Weekly groceries", category: "Groceries", amount: 1850, date: date(2), paymentMethod: "Debit card", accountId: accountOne.id },
      { type: "expense", description: "Commute", category: "Transportation", amount: 240, date: date(1), paymentMethod: "Cash", accountId: accountOne.id },
      { type: "expense", description: "Electricity bill", category: "Bills", amount: 1600, date: date(5), paymentMethod: "E-wallet", accountId: accountOne.id },
      { type: "income", description: "Weekend side project", category: "Business income", amount: 3500, date: date(7), paymentMethod: "Bank transfer", accountId: accountTwo.id },
      { type: "expense", description: "Lunch with friends", category: "Food", amount: 680, date: date(4), paymentMethod: "Cash", accountId: accountOne.id },
      { type: "expense", description: "New notebook", category: "Shopping", amount: 420, date: date(9), paymentMethod: "E-wallet", accountId: accountOne.id },
      { type: "expense", description: "Streaming subscription", category: "Entertainment", amount: 299, date: date(11), paymentMethod: "Credit card", accountId: accountOne.id }
    ].map((item) => ({ ...item, id: uid(), sample: true }));
    records.forEach((item) => {
      const account = accounts.find((entry) => entry.id === item.accountId);
      account.balance += item.type === "income" ? item.amount : -item.amount;
    });
    return {
      accounts,
      transactions: records,
      budgets: [{ id: uid(), name: "Monthly essentials", period: "monthly", amount: 10000, limits: { Food: 2500, Groceries: 3500, Transportation: 1500, Bills: 2500 }, startDate: todayISO(), endDate: todayISO(), sample: true }],
      goals: [{ id: uid(), name: "Emergency fund", target: 50000, current: 12000, targetDate: new Date(new Date().setMonth(new Date().getMonth() + 8)).toISOString().slice(0, 10), icon: "🛟", sample: true }]
    };
  }
  function loadSample() {
    if (state.transactions.some((item) => item.sample) || state.budgets.some((item) => item.sample) || state.goals.some((item) => item.sample) || state.accounts.some((item) => item.sample)) {
      toast("Sample data is already loaded. Remove it before loading another set."); return;
    }
    if (state.transactions.some((item) => !item.sample) && !window.confirm("Sample transactions will be added alongside your existing records. Continue?")) return;
    const sample = sampleData(); state.transactions.push(...sample.transactions); state.budgets.push(...sample.budgets); state.goals.push(...sample.goals);
    state.accounts = state.accounts.filter((account) => !(account.name === "Cash wallet" && account.balance === 0 && !state.transactions.some((item) => item.accountId === account.id)));
    state.accounts.push(...sample.accounts); finish("Sample data loaded. Explore the dashboard and remove it any time.");
  }
  function removeSample() {
    if (!state.transactions.some((item) => item.sample) && !state.budgets.some((item) => item.sample) && !state.goals.some((item) => item.sample) && !state.accounts.some((item) => item.sample)) { toast("There is no sample data to remove."); return; }
    if (!window.confirm("Remove all sample transactions, budgets, goals, and accounts? Your own records will stay.")) return;
    state.transactions.filter((item) => item.sample).forEach((item) => {
      const source = state.accounts.find((account) => account.id === item.accountId);
      const destination = state.accounts.find((account) => account.id === item.toAccountId);
      if (item.type === "transfer") {
        if (source) source.balance += Number(item.amount);
        if (destination) destination.balance -= Number(item.amount);
      } else if (source) {
        source.balance += item.type === "income" ? -Number(item.amount) : Number(item.amount);
      }
    });
    state.transactions = state.transactions.filter((item) => !item.sample);
    state.budgets = state.budgets.filter((item) => !item.sample);
    state.goals = state.goals.filter((item) => !item.sample);
    state.accounts = state.accounts.filter((item) => {
      const inUse = state.transactions.some((transaction) => transaction.accountId === item.id || transaction.toAccountId === item.id);
      if (item.sample && inUse) delete item.sample;
      return !item.sample || inUse;
    });
    if (!state.accounts.length) state.accounts = initialState().accounts;
    finish("Sample data removed.");
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("#save-preferences")) {
      state.preferences.name = $("#pref-name").value.trim();
      state.preferences.currency = $("#pref-currency").value;
      state.preferences.theme = $("#pref-theme").checked ? "dark" : "light";
      state.preferences.notifications = $("#pref-notifications").checked;
      save(); render(); toast("Preferences saved.");
      return;
    }
    const close = event.target.closest("[data-close-dialog]"); if (close) { closeDialog(); return; }
    const pageButton = event.target.closest("[data-page]"); if (pageButton) { event.preventDefault(); if ($("#app-dialog").open) closeDialog(); setPage(pageButton.dataset.page); return; }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const id = action.dataset.id; const item = state.transactions.find((entry) => entry.id === id);
    switch (action.dataset.action) {
      case "add-transaction": transactionForm({ type: action.dataset.type || "expense" }); break;
      case "edit-transaction": if (item) transactionForm(item); break;
      case "delete-transaction": deleteTransaction(id); break;
      case "add-budget": budgetForm(); break;
      case "edit-budget": { const budget = state.budgets.find((entry) => entry.id === id); if (budget) budgetForm(budget); break; }
      case "delete-budget": deleteRecord("budgets", id, "budget"); break;
      case "add-goal": goalForm(); break;
      case "edit-goal": { const goal = state.goals.find((entry) => entry.id === id); if (goal) goalForm(goal); break; }
      case "delete-goal": deleteRecord("goals", id, "savings goal"); break;
      case "contribute-goal": contributeGoal(id); break;
      case "add-account": accountForm(); break;
      case "edit-account": { const account = state.accounts.find((entry) => entry.id === id); if (account) accountForm(account); break; }
      case "delete-account": deleteRecord("accounts", id, "account"); break;
      case "transfer": transferForm(id); break;
      case "mobile-more":
        openDialog("More pages", `<div class="dialog-fields"><button class="button button-secondary" type="button" data-page="accounts">▤ Accounts</button><button class="button button-secondary" type="button" data-page="reports">▥ Reports</button><button class="button button-secondary" type="button" data-page="settings">⚙ Settings</button></div>`, () => {}, "Done");
        break;
      case "delete-category": deleteCategory(id); break;
      case "export-csv": exportCSV(); break;
      case "backup-json": exportJSON(); break;
      case "restore-json": $("#restore-file").click(); break;
      case "load-sample": loadSample(); break;
      case "remove-sample": removeSample(); break;
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "filter-search") {
      transactionFilters.search = event.target.value;
      if (activePage === "transactions") {
        const input = event.target;
        const cursor = input.selectionStart;
        render();
        const refreshedInput = $("#filter-search");
        refreshedInput.focus();
        refreshedInput.setSelectionRange(cursor, cursor);
      }
    }
  });
  document.addEventListener("change", (event) => {
    const filterMap = { "filter-type": "type", "filter-category": "category", "filter-from": "from", "filter-to": "to", "filter-sort": "sort" };
    if (filterMap[event.target.id]) { transactionFilters[filterMap[event.target.id]] = event.target.value; render(); }
    if (event.target.id === "report-period") { reportPeriod = event.target.value; render(); }
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "add-category-form") return;
    event.preventDefault();
    const field = $("#new-category"); const name = field.value.trim();
    if (!name) return;
    if (state.categories.some((item) => item.name.toLowerCase() === name.toLowerCase())) { toast("That category already exists."); return; }
    state.categories.push({ name, icon: "✨" }); save(); render(); toast("Category added.");
  });
  $("#theme-toggle").addEventListener("click", () => {
    state.preferences.theme = state.preferences.theme === "dark" ? "light" : "dark"; save(); render();
    toast(`${state.preferences.theme === "dark" ? "Dark" : "Light"} mode enabled.`);
  });
  $("#mobile-add").addEventListener("click", () => transactionForm());
  $("#restore-file").addEventListener("change", (event) => restoreJSON(event.target.files[0]));
  $("#today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  render();
})();
