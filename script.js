const $ = (id) => document.getElementById(id);

const authSection = $("auth");
const authForm = $("auth-form");
const authTitle = $("auth-title");
const authIntro = $("auth-intro");
const authSubmit = $("auth-submit");
const authToggleText = $("auth-toggle-text");
const authToggle = $("auth-toggle");
const authError = $("auth-error");
const confirmField = $("confirm-field");
const passwordInput = $("password");
const tracker = $("tracker");
const signedInAs = $("signed-in-as");
const logoutButton = $("logout");
const itemForm = $("item-form");
const sections = $("item-sections");
const emptyState = $("empty-state");
const addSection = $("add-section");
const filtersEl = $("filters");
const filterClassSelect = $("filter-class");
const filterWeekBox = $("filter-week");
const clearFilters = $("clear-filters");
const calendarEl = $("calendar");
const calTitle = $("cal-title");
const dayDetail = $("day-detail");
const repeatToggle = $("repeat-toggle");
const repeatOptions = $("repeat-options");
const repeatDays = $("repeat-days");
const dueLabel = $("due-label");
const listError = $("list-error");

let mode = "login"; // "login" or "signup"
let items = [];
let classes = [];
let schedules = {}; // class name -> { days: [0-6], start, end }
const MAX_CLASSES = 100;
const WEEK_STARTS_ON = 0; // first column of the calendar: 0 = Sunday, 1 = Monday
const UPCOMING_DAYS = 7; // "this week" means due within this many days from today
let filterClass = "";
let filterWeek = false;
let hadTasks = null; // lets the Add form collapse when the first task arrives
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = Array.from({ length: 7 }, (_, i) => (WEEK_STARTS_ON + i) % 7);
const MAX_CHIPS = 3;
let calendarMonth = startOfMonth(new Date());
let selectedDay = localISO(new Date());

function sortItems(taskList) {
  return [...taskList].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    return a.title.localeCompare(b.title);
  });
}

async function api(path, method = "GET", body) {
  const options = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, options);
    let data = {};
    try {
      data = await response.json();
    } catch {
      // empty or non-JSON body
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: "Could not reach the tracker server. Run python3 server.py, then refresh." },
    };
  }
}

function setMessage(el, message) {
  el.hidden = !message;
  el.textContent = message || "";
}

function setMode(newMode) {
  mode = newMode;
  const signup = mode === "signup";
  authTitle.textContent = signup ? "Create an account" : "Log in";
  authIntro.textContent = signup
    ? "Pick a username and password to get started."
    : "Log in to see your tasks.";
  authSubmit.textContent = signup ? "Sign up" : "Log in";
  authToggleText.textContent = signup ? "Already have an account?" : "New here?";
  authToggle.textContent = signup ? "Log in" : "Create an account";
  confirmField.hidden = !signup;
  $("confirm-password").required = signup;
  passwordInput.autocomplete = signup ? "new-password" : "current-password";
  setMessage(authError, "");
}

function showAuth(message) {
  items = [];
  tracker.hidden = true;
  recentSection.hidden = true;
  recentSection.open = false;
  classesSection.hidden = true;
  classesSection.open = false;
  classes = [];
  schedules = {};
  seriesSection.hidden = true;
  seriesSection.open = false;
  renderClasses();
  filterClass = "";
  filterWeek = false;
  filterWeekBox.checked = false;
  renderItems();
  authSection.hidden = false;
  authForm.reset();
  setMode("login");
  setMessage(authError, message);
}

function showTracker(user) {
  items = sortItems(user.items || []);
  signedInAs.textContent = `Signed in as ${user.username}. Tasks are sorted by due date.`;
  authSection.hidden = true;
  tracker.hidden = false;
  recentSection.hidden = false;
  classesSection.hidden = false;
  classes = user.classes || [];
  schedules = user.schedules || {};
  seriesSection.hidden = false;
  calendarMonth = startOfMonth(new Date());
  selectedDay = localISO(new Date());
  renderClasses();
  setMessage(formError, "");
  setMessage(classError, "");
  authForm.reset();
  setMessage(authError, "");
  setMessage(listError, "");
  hadTasks = null;
  renderItems();
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const FADE_MS = 550;
const RECENT_LIMIT = 10;

function typeLabelOf(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// Fade the row out, then mark the task complete so it moves to Recently completed.
function completeTask(task, itemEl, checkbox) {
  checkbox.disabled = true;
  const commit = () => {
    if (!items.includes(task)) {
      return; // the user logged out in the meantime
    }
    task.complete = true;
    task.completedAt = Date.now();
    saveItems();
  };
  if (reduceMotion.matches) {
    commit();
    return;
  }
  itemEl.style.maxHeight = `${itemEl.offsetHeight}px`;
  void itemEl.offsetHeight; // force a reflow so the transition runs
  itemEl.classList.add("is-fading");
  setTimeout(commit, FADE_MS);
}

function renderRecent() {
  const recent = items
    .filter((task) => task.complete)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    .slice(0, RECENT_LIMIT);

  recentList.replaceChildren();
  recent.forEach((task) => {
    const row = document.createElement("li");
    row.className = "recent-item";

    const info = document.createElement("div");
    const titleEl = document.createElement("strong");
    titleEl.textContent = task.title;
    const details = document.createElement("span");
    const when = task.completedAt
      ? ` · done ${new Date(task.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "";
    details.textContent = `${task.className}${when}`;
    info.append(titleEl, details);

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "secondary small";
    restore.textContent = "Restore";
    restore.addEventListener("click", () => {
      task.complete = false;
      task.completedAt = null;
      saveItems();
    });

    row.append(info, restore);
    recentList.append(row);
  });
  recentEmpty.hidden = recent.length > 0;
}

// Dates are "YYYY-MM-DD" strings, so local-time strings compare correctly.
function localISO(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekBounds() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + UPCOMING_DAYS);
  return { today: localISO(now), weekEnd: localISO(end) };
}

function buildItemRow(task) {
  const item = document.createElement("li");
  item.className = "item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = task.id;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      completeTask(task, item, checkbox);
    }
  });

  const label = document.createElement("label");
  label.htmlFor = task.id;

  const titleEl = document.createElement("strong");
  titleEl.textContent = task.title;

  const details = document.createElement("span");
  details.textContent = `${task.className} · ${typeLabelOf(task.type)} · due ${dueText(task.dueDate)}`;

  label.append(titleEl, details);
  item.append(checkbox, label);
  return item;
}

// The class filter only lists classes that still have upcoming tasks.
function renderFilters(upcoming) {
  const names = new Map();
  upcoming.forEach((task) => {
    const key = task.className.toLowerCase();
    if (!names.has(key)) {
      names.set(key, task.className);
    }
  });
  filterClass = names.get(filterClass.toLowerCase()) || "";

  filterClassSelect.replaceChildren(
    new Option("All classes", ""),
    ...[...names.values()].sort(byName).map((name) => new Option(name, name))
  );
  filterClassSelect.value = filterClass;
  filtersEl.hidden = upcoming.length === 0;
  clearFilters.hidden = !filterClass && !filterWeek;
}

const GROUPS = [
  { key: "overdue", title: "Overdue" },
  { key: "week", title: "Due this week" },
  { key: "later", title: "Due later" },
];

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function parseISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shortDate(iso) {
  return parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "Oct 22", or "Jan 5, 2027" when the year is not the current one.
function dueText(iso) {
  if (!iso) {
    return "no date";
  }
  const date = parseISO(iso);
  const options = { month: "short", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = "numeric";
  }
  return date.toLocaleDateString(undefined, options);
}

function timeLabel(hhmm) {
  if (!hhmm) {
    return "";
  }
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Short form for calendar chips: 9:00 -> "9a", 13:30 -> "1:30p".
function compactTime(hhmm) {
  if (!hhmm) {
    return "";
  }
  const [hours, minutes] = hhmm.split(":").map(Number);
  const hour12 = hours % 12 || 12;
  const mins = minutes ? `:${String(minutes).padStart(2, "0")}` : "";
  return `${hour12}${mins}${hours < 12 ? "a" : "p"}`;
}

function renderItems() {
  const upcoming = items.filter((task) => !task.complete);
  const { today, weekEnd } = weekBounds();

  // Repeating tasks join this list once they are due within the next week; before that they live on the calendar.
  const listable = upcoming.filter((task) => !(task.seriesId && task.dueDate > weekEnd));
  const hiddenRepeats = upcoming.length - listable.length;

  // The Add form is open when there is nothing to show, and tucks away once there is.
  const hasTasks = listable.length > 0;
  if (hasTasks !== hadTasks) {
    addSection.open = !hasTasks;
    hadTasks = hasTasks;
  }

  renderFilters(listable);

  let visible = listable;
  if (filterClass) {
    visible = visible.filter((task) => task.className.toLowerCase() === filterClass.toLowerCase());
  }

  const buckets = { overdue: [], week: [], later: [] };
  sortItems(visible).forEach((task) => {
    if (!task.dueDate) {
      buckets.later.push(task);
    } else if (task.dueDate < today) {
      buckets.overdue.push(task);
    } else if (task.dueDate <= weekEnd) {
      buckets.week.push(task);
    } else {
      buckets.later.push(task);
    }
  });
  if (filterWeek) {
    buckets.later = []; // overdue stays visible so nothing slips through
  }

  sections.replaceChildren();
  let shown = 0;
  GROUPS.forEach(({ key, title }) => {
    const tasks = buckets[key];
    if (!tasks.length) {
      return;
    }
    shown += tasks.length;
    const group = document.createElement("section");
    group.className = `task-group group-${key}`;
    const heading = document.createElement("h3");
    heading.className = "group-title";
    heading.textContent = `${title} (${tasks.length})`;
    const ul = document.createElement("ul");
    ul.className = "item-list";
    tasks.forEach((task) => ul.append(buildItemRow(task)));
    group.append(heading, ul);
    sections.append(group);
  });

  emptyState.hidden = shown > 0;
  if (hasTasks) {
    emptyState.textContent = "No tasks match these filters.";
  } else if (hiddenRepeats) {
    emptyState.textContent = "Nothing due yet. Repeating tasks appear here once they are due within the next 7 days.";
  } else {
    emptyState.textContent = "No upcoming tasks.";
  }
  renderRecent();
  renderSeries();
  renderCalendar();
}

async function saveItems() {
  items = sortItems(items);
  renderItems();
  const result = await api("/api/items", "PUT", { items });
  if (result.status === 401) {
    showAuth("Your session expired. Please log in again.");
  } else if (!result.ok) {
    setMessage(listError, result.data.error || "Could not save your tasks.");
  } else {
    setMessage(listError, "");
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = $("username").value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    setMessage(authError, "Enter your username and password.");
    return;
  }

  if (mode === "signup") {
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
      setMessage(authError, "Username must be 3-30 characters: letters, numbers, . _ -");
      return;
    }
    if (password.length < 8) {
      setMessage(authError, "Password must be at least 8 characters.");
      return;
    }
    if (password !== $("confirm-password").value) {
      setMessage(authError, "Passwords do not match. Type your password again in the confirm box.");
      $("confirm-password").focus();
      return;
    }
  }

  authSubmit.disabled = true;
  const result = await api(`/api/${mode}`, "POST", { username, password });
  authSubmit.disabled = false;

  if (result.ok) {
    showTracker(result.data);
  } else if (mode === "login" && result.status === 404) {
    // No such account: move to sign-up, keeping the username they typed.
    setMode("signup");
    setMessage(authError, `No account named "${username}" yet. Choose a password to create one.`);
    $("confirm-password").focus();
  } else {
    setMessage(authError, result.data.error || "Something went wrong.");
  }
});

authToggle.addEventListener("click", () => {
  setMode(mode === "login" ? "signup" : "login");
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", "POST");
  showAuth("");
});

itemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(itemForm);
  const title = String(data.get("title") || "").trim();
  const className = String(data.get("className") || "").trim();
  const type = String(data.get("type") || "");
  const dueDate = String(data.get("dueDate") || "");

  if (!title || !className || !type || !dueDate) {
    setMessage(
      formError,
      className ? "Please fill in every field." : "Choose a class first. You can add classes in Settings."
    );
    return;
  }
  setMessage(formError, "");

  if (repeatToggle.checked) {
    const days = selectedDays(repeatDays);
    const until = String(data.get("repeatUntil") || "");
    let problem = "";
    if (!days.length) {
      problem = "Pick at least one day to repeat on.";
    } else if (!until) {
      problem = "Choose an end date so the repeat doesn't go on forever.";
    } else if (until < dueDate) {
      problem = "The end date must be on or after the start date.";
    } else if (daysBetween(dueDate, until) > 366) {
      problem = "A repeat can run for at most a year.";
    }
    const dates = problem ? [] : repeatDates(dueDate, until, days);
    if (!problem && !dates.length) {
      problem = "None of the chosen days fall between the start and end dates.";
    }
    if (problem) {
      setMessage(formError, problem);
      return;
    }
    const stamp = Date.now();
    dates.forEach((date, index) => {
      items.push({
        id: `item-${stamp}-${index}`,
        seriesId: `series-${stamp}`,
        title,
        className,
        type,
        dueDate: date,
        complete: false,
      });
    });
  } else {
    items.push({
      id: `item-${Date.now()}`,
      title,
      className,
      type,
      dueDate,
      complete: false,
    });
  }
  itemForm.reset();
  syncRepeat();
  saveItems();
});

// ---------- Settings menu and theme ----------
const THEME_KEY = "assignment-tracker-theme";
const settingsRoot = $("settings");
const recentSection = $("recent-section");
const recentList = $("recent-list");
const recentEmpty = $("recent-empty");
const settingsButton = $("settings-button");
const settingsMenu = $("settings-menu");
const themeRadios = document.querySelectorAll('input[name="theme"]');
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function getThemePreference() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return ["system", "light", "dark"].includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function applyTheme(preference) {
  const dark = preference === "dark" || (preference === "system" && systemDark.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function setSettingsOpen(open) {
  settingsMenu.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
}

themeRadios.forEach((radio) => {
  radio.checked = radio.value === getThemePreference();
  radio.addEventListener("change", () => {
    try {
      localStorage.setItem(THEME_KEY, radio.value);
    } catch {
      // storage unavailable; the choice still applies until the page closes
    }
    applyTheme(radio.value);
  });
});

// If the computer switches between light and dark, follow it when set to "system".
systemDark.addEventListener("change", () => {
  if (getThemePreference() === "system") {
    applyTheme("system");
  }
});

settingsButton.addEventListener("click", () => setSettingsOpen(settingsMenu.hidden));

document.addEventListener("click", (event) => {
  // composedPath still lists the clicked button after a re-render has removed it
  if (!event.composedPath().includes(settingsRoot)) {
    setSettingsOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsMenu.hidden) {
    setSettingsOpen(false);
    settingsButton.focus();
  }
});

// ---------- Classes ----------
const classSelect = $("class-name");
const classHint = $("class-hint");
const classesSection = $("classes-section");
const classForm = $("class-form");
const newClassInput = $("new-class");
const classError = $("class-error");
const classList = $("class-list");
const classEmpty = $("class-empty");
const formError = $("form-error");

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });

function scheduleText(name) {
  const schedule = schedules[name];
  if (!schedule) {
    return "";
  }
  const days = DAY_ORDER.filter((d) => schedule.days.includes(d)).map((d) => DAY_NAMES[d]).join(", ");
  const times = schedule.start
    ? ` · ${timeLabel(schedule.start)}${schedule.end ? `–${timeLabel(schedule.end)}` : ""}`
    : "";
  const until = schedule.until ? ` · until ${shortDate(schedule.until)}` : "";
  return days + times + until;
}

function renderClasses() {
  // Rebuild the dropdown, keeping the current choice if it still exists.
  const previous = classSelect.value;
  classSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.setAttribute("selected", ""); // so form.reset() returns here
  placeholder.textContent = classes.length ? "Select a class" : "No classes yet";
  classSelect.append(placeholder);
  classes.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    classSelect.append(option);
  });
  if (classes.includes(previous)) {
    classSelect.value = previous;
  }
  classHint.hidden = classes.length > 0;

  // Rebuild the list in Settings.
  classList.replaceChildren();
  classes.forEach((name) => {
    const row = document.createElement("li");
    row.className = "class-item";
    const info = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = name;
    info.append(label);
    const when = scheduleText(name);
    if (when) {
      const meets = document.createElement("span");
      meets.textContent = when;
      info.append(meets);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary small";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.addEventListener("click", () => {
      classes = classes.filter((c) => c !== name);
      delete schedules[name];
      setMessage(classError, "");
      saveClasses();
    });
    row.append(info, remove);
    classList.append(row);
  });
  classEmpty.hidden = classes.length > 0;
  renderCalendar();
}

async function saveClasses() {
  renderClasses();
  const result = await api("/api/classes", "PUT", { classes, schedules });
  if (result.status === 401) {
    showAuth("Your session expired. Please log in again.");
  } else if (!result.ok) {
    setMessage(classError, result.data.error || "Could not save your classes.");
  }
}

classForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = newClassInput.value.trim().replace(/\s+/g, " ");
  const days = selectedDays(classDays);
  const start = classStart.value;
  const end = classEnd.value;
  const until = classUntil.value;

  if (!name) {
    setMessage(classError, "Enter a class name.");
    return;
  }
  if (start && !days.length) {
    setMessage(classError, "Pick the days this class meets.");
    return;
  }
  if (end && !start) {
    setMessage(classError, "Add a start time too.");
    return;
  }
  if (start && end && end <= start) {
    setMessage(classError, "The end time must be after the start time.");
    return;
  }

  if (until && !days.length) {
    setMessage(classError, "Pick the days this class meets.");
    return;
  }
  if (until && until < localISO(new Date())) {
    setMessage(classError, "Choose an end date that is not in the past.");
    return;
  }

  const existing = classes.find((c) => c.toLowerCase() === name.toLowerCase());
  if (existing && !days.length) {
    setMessage(classError, `"${existing}" is already in your list. To change its schedule, pick days and add it again.`);
    return;
  }
  if (!existing && classes.length >= MAX_CLASSES) {
    setMessage(classError, `You can have up to ${MAX_CLASSES} classes.`);
    return;
  }

  const finalName = existing || name;
  if (!existing) {
    classes.push(name);
    classes.sort(byName);
  }
  if (days.length) {
    schedules[finalName] = { days, start, end: start ? end : "", until };
  }

  newClassInput.value = "";
  classStart.value = "";
  classEnd.value = "";
  classUntil.value = "";
  classDays.querySelectorAll("input").forEach((box) => {
    box.checked = false;
  });
  setMessage(classError, "");
  saveClasses();
  newClassInput.focus();
});

// The hint under the dropdown jumps straight to the Classes section in Settings.
$("open-classes").addEventListener("click", (event) => {
  event.stopPropagation(); // otherwise the outside-click handler would close the menu
  setSettingsOpen(true);
  classesSection.open = true;
  newClassInput.focus();
});

// ---------- Filters ----------
filterClassSelect.addEventListener("change", () => {
  filterClass = filterClassSelect.value;
  renderItems();
});

filterWeekBox.addEventListener("change", () => {
  filterWeek = filterWeekBox.checked;
  renderItems();
});

clearFilters.addEventListener("click", () => {
  filterClass = "";
  filterWeek = false;
  filterWeekBox.checked = false;
  renderItems();
});

// If the tab sat open past midnight, regroup tasks when you come back to it.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !tracker.hidden) {
    renderItems();
  }
});

// ---------- Day pickers and repeating tasks ----------
const classDays = $("class-days");
const classStart = $("class-start");
const classEnd = $("class-end");
const classUntil = $("class-until");
const seriesSection = $("series-section");
const seriesList = $("series-list");
const seriesEmpty = $("series-empty");

function buildDayPicker(container) {
  DAY_ORDER.forEach((day) => {
    const label = document.createElement("label");
    label.className = "day-chip";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = String(day);
    const text = document.createElement("span");
    text.textContent = DAY_NAMES[day];
    label.append(box, text);
    container.append(label);
  });
}

function selectedDays(container) {
  return [...container.querySelectorAll("input:checked")].map((box) => Number(box.value));
}

buildDayPicker(classDays);
buildDayPicker(repeatDays);

function daysBetween(fromISO, toISO) {
  return Math.round((parseISO(toISO) - parseISO(fromISO)) / 86400000);
}

function repeatDates(startISO, untilISO, days) {
  const dates = [];
  for (const day = parseISO(startISO); localISO(day) <= untilISO; day.setDate(day.getDate() + 1)) {
    if (days.includes(day.getDay())) {
      dates.push(localISO(day));
    }
  }
  return dates;
}

function syncRepeat() {
  repeatOptions.hidden = !repeatToggle.checked;
  dueLabel.textContent = repeatToggle.checked ? "Starts on" : "Due date";
}

repeatToggle.addEventListener("change", syncRepeat);

function renderSeries() {
  const groups = new Map();
  items
    .filter((task) => task.seriesId && !task.complete)
    .forEach((task) => {
      if (!groups.has(task.seriesId)) {
        groups.set(task.seriesId, []);
      }
      groups.get(task.seriesId).push(task);
    });

  seriesList.replaceChildren();
  groups.forEach((tasks, id) => {
    const sorted = sortItems(tasks);
    const weekdays = [...new Set(sorted.map((task) => parseISO(task.dueDate).getDay()))]
      .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
      .map((day) => DAY_NAMES[day])
      .join(", ");

    const row = document.createElement("li");
    row.className = "recent-item";
    const info = document.createElement("div");
    const titleEl = document.createElement("strong");
    titleEl.textContent = sorted[0].title;
    const details = document.createElement("span");
    details.textContent =
      `${sorted[0].className} · ${weekdays} · until ${shortDate(sorted[sorted.length - 1].dueDate)} · ${sorted.length} left`;
    info.append(titleEl, details);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary small";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove repeating task ${sorted[0].title}`);
    remove.addEventListener("click", () => {
      if (window.confirm(`Remove the ${sorted.length} remaining "${sorted[0].title}" tasks? Completed ones are kept.`)) {
        items = items.filter((task) => !(task.seriesId === id && !task.complete));
        saveItems();
      }
    });

    row.append(info, remove);
    seriesList.append(row);
  });
  seriesEmpty.hidden = groups.size > 0;
}

// ---------- Calendar ----------
function dayEntries(date, iso, tasksByDate) {
  const dueTasks = (tasksByDate.get(iso) || []).map((task) => ({ kind: "task", task }));
  const meetings = Object.entries(schedules)
    .filter(([, schedule]) => schedule.days.includes(date.getDay()) && (!schedule.until || iso <= schedule.until))
    .map(([name, schedule]) => ({ kind: "class", name, start: schedule.start, end: schedule.end }))
    .sort((a, b) => (a.start || "99").localeCompare(b.start || "99") || a.name.localeCompare(b.name));
  return [...dueTasks, ...meetings]; // tasks first, so they win the limited space in a cell
}

function entryChip(entry) {
  const chip = document.createElement("span");
  if (entry.kind === "task") {
    chip.className = `chip chip-${entry.task.type}`;
    chip.textContent = entry.task.title;
    chip.title = `${entry.task.title} (${entry.task.className})`;
  } else {
    chip.className = "chip chip-class";
    chip.textContent = `${compactTime(entry.start)} ${entry.name}`.trim();
    chip.title = `${entry.name} class${entry.start ? ` at ${timeLabel(entry.start)}` : ""}`;
  }
  return chip;
}

function renderDayDetail(tasksByDate) {
  if (!selectedDay) {
    dayDetail.hidden = true;
    return;
  }
  const date = parseISO(selectedDay);
  const heading = document.createElement("h3");
  heading.textContent = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const entries = dayEntries(date, selectedDay, tasksByDate);
  const body = document.createElement(entries.length ? "ul" : "p");
  if (entries.length) {
    body.className = "detail-list";
  } else {
    body.className = "hint";
    body.textContent = "Nothing scheduled.";
  }
  entries.forEach((entry) => {
    const row = document.createElement("li");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    if (entry.kind === "task") {
      row.className = `detail-item chip-${entry.task.type}`;
      title.textContent = entry.task.title;
      meta.textContent = `Due · ${entry.task.className} · ${typeLabelOf(entry.task.type)}`;
    } else {
      row.className = "detail-item chip-class";
      title.textContent = entry.name;
      const range = entry.start ? `${timeLabel(entry.start)}${entry.end ? `–${timeLabel(entry.end)}` : ""}` : "";
      meta.textContent = range ? `Class · ${range}` : "Class";
    }
    row.append(title, meta);
    body.append(row);
  });

  dayDetail.replaceChildren(heading, body);
  dayDetail.hidden = false;
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  calTitle.textContent = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const tasksByDate = new Map();
  items
    .filter((task) => !task.complete && task.dueDate)
    .forEach((task) => {
      if (!tasksByDate.has(task.dueDate)) {
        tasksByDate.set(task.dueDate, []);
      }
      tasksByDate.get(task.dueDate).push(task);
    });

  const lead = (new Date(year, month, 1).getDay() - WEEK_STARTS_ON + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((lead + daysInMonth) / 7) * 7;
  const todayISO = localISO(new Date());

  calendarEl.replaceChildren();
  DAY_ORDER.forEach((day) => {
    const head = document.createElement("div");
    head.className = "cal-dow";
    head.textContent = DAY_NAMES[day];
    calendarEl.append(head);
  });

  for (let i = 0; i < cellCount; i += 1) {
    const date = new Date(year, month, 1 - lead + i);
    const iso = localISO(date);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-day";
    cell.dataset.date = iso;
    cell.classList.toggle("is-other-month", date.getMonth() !== month);
    cell.classList.toggle("is-today", iso === todayISO);
    cell.classList.toggle("is-selected", iso === selectedDay);
    cell.setAttribute("aria-pressed", String(iso === selectedDay));
    cell.setAttribute("aria-label", date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));

    const number = document.createElement("span");
    number.className = "cal-num";
    number.textContent = String(date.getDate());
    cell.append(number);

    const entries = dayEntries(date, iso, tasksByDate);
    if (entries.length) {
      const chips = document.createElement("div");
      chips.className = "cal-chips";
      entries.slice(0, MAX_CHIPS).forEach((entry) => chips.append(entryChip(entry)));
      if (entries.length > MAX_CHIPS) {
        const more = document.createElement("span");
        more.className = "cal-more";
        more.textContent = `+${entries.length - MAX_CHIPS} more`;
        chips.append(more);
      }
      cell.append(chips);
    }

    cell.addEventListener("click", () => {
      selectedDay = selectedDay === iso ? "" : iso;
      renderCalendar();
      const selected = calendarEl.querySelector(".is-selected");
      if (selected) {
        selected.focus(); // keep keyboard focus after the grid is rebuilt
      }
    });
    calendarEl.append(cell);
  }
  renderDayDetail(tasksByDate);
}

$("cal-prev").addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});

$("cal-next").addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});

$("cal-today").addEventListener("click", () => {
  calendarMonth = startOfMonth(new Date());
  selectedDay = localISO(new Date());
  renderCalendar();
});

// On page load, resume the session if the browser still has a valid cookie.
(async () => {
  const result = await api("/api/me");
  if (result.ok) {
    showTracker(result.data);
  } else {
    showAuth(result.status === 0 ? result.data.error : "");
  }
})();
