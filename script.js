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
const list = $("item-list");
const listError = $("list-error");

let mode = "login"; // "login" or "signup"
let items = [];

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
  authForm.reset();
  setMessage(authError, "");
  setMessage(listError, "");
  renderItems();
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
  itemForm.reset();
  saveItems();
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
