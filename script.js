const signIn = document.getElementById("sign-in");
const signInForm = document.getElementById("sign-in-form");
const signInError = document.getElementById("sign-in-error");
const existingUsers = document.getElementById("existing-users");
const userButtons = document.getElementById("user-buttons");
const tracker = document.getElementById("tracker");
const signedInAs = document.getElementById("signed-in-as");
const switchUserButton = document.getElementById("switch-user");
const form = document.getElementById("item-form");
const list = document.getElementById("item-list");

const USER_KEY = "assignment-tracker-user";
let currentUser = "";
let items = [];

function sortItems(taskList) {
  return [...taskList].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    return a.title.localeCompare(b.title);
  });
}

function showError(message) {
  signInError.hidden = !message;
  signInError.textContent = message;
}

function userUrl(name) {
  return `/api/users/${encodeURIComponent(name)}`;
}

async function loadSavedUsers() {
  try {
    const response = await fetch("/api/users");
    if (!response.ok) {
      throw new Error("Could not load saved users.");
    }
    const data = await response.json();
    const users = data.users || [];
    userButtons.replaceChildren();
    existingUsers.hidden = users.length === 0;
    users.forEach((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.addEventListener("click", () => openUser(name));
      userButtons.append(button);
    });
  } catch {
    existingUsers.hidden = true;
    showError("Could not reach the tracker server. Run python3 server.py, then refresh.");
  }
}

function renderItems() {
  list.replaceChildren();
  sortItems(items).forEach((task) => {
    const item = document.createElement("li");
    item.className = "item";
    if (task.complete) {
      item.classList.add("is-complete");
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = task.id;
    checkbox.checked = task.complete;
    checkbox.addEventListener("change", () => {
      task.complete = checkbox.checked;
      item.classList.toggle("is-complete", task.complete);
      saveItems();
    });

    const label = document.createElement("label");
    label.htmlFor = task.id;

    const titleEl = document.createElement("strong");
    titleEl.textContent = task.title;

    const typeLabel = task.type.charAt(0).toUpperCase() + task.type.slice(1);
    const details = document.createElement("span");
    details.textContent = `${task.className} · ${typeLabel} · due ${task.dueDate}`;

    label.append(titleEl, details);
    item.append(checkbox, label);
    list.append(item);
  });
}

async function saveItems() {
  items = sortItems(items);
  renderItems();
  const response = await fetch(userUrl(currentUser), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    showError("Could not save your tasks.");
  }
}

async function openUser(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }

  try {
    const response = await fetch(userUrl(trimmed));
    const data = await response.json();
    if (!response.ok) {
      showError(data.error || "Could not load that user.");
      return;
    }

    currentUser = data.name;
    items = sortItems(data.items || []);
    sessionStorage.setItem(USER_KEY, currentUser);
    signedInAs.textContent = `Signed in as ${currentUser}. Tasks are sorted by due date.`;
    showError("");
    signIn.hidden = true;
    tracker.hidden = false;
    await saveItems();
  } catch {
    showError("Could not reach the tracker server. Run python3 server.py, then refresh.");
  }
}

function showSignIn() {
  currentUser = "";
  items = [];
  sessionStorage.removeItem(USER_KEY);
  tracker.hidden = true;
  signIn.hidden = false;
  signInForm.reset();
  loadSavedUsers();
}

signInForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = new FormData(signInForm).get("userName");
  openUser(String(name || ""));
});

switchUserButton.addEventListener("click", showSignIn);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentUser) {
    return;
  }

  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  const className = String(data.get("className") || "").trim();
  const type = String(data.get("type") || "");
  const dueDate = String(data.get("dueDate") || "");

  if (!title || !className || !type || !dueDate) {
    return;
  }

  items.push({
    id: `item-${Date.now()}`,
    title,
    className,
    type,
    dueDate,
    complete: false,
  });
  form.reset();
  saveItems();
});

const remembered = sessionStorage.getItem(USER_KEY);
if (remembered) {
  openUser(remembered);
} else {
  loadSavedUsers();
}
