let token = localStorage.getItem("bbtips_admin_token") || "";

const qs = id => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "erro");
  return data;
}

function showPanel() {
  qs("login").hidden = true;
  qs("panel").hidden = false;
  loadUsers();
}

async function loadUsers() {
  const data = await api("/api/admin/users");
  qs("users").innerHTML = data.users.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td class="${u.active ? "ok" : "bad"}">${u.active ? "ativo" : "bloqueado"}</td>
      <td>${u.expires_at ? new Date(u.expires_at).toLocaleDateString("pt-BR") : "-"}</td>
      <td>${u.note || ""}</td>
      <td>
        <button data-block="${u.id}" data-active="${u.active}">${u.active ? "Bloquear" : "Ativar"}</button>
        <button data-del="${u.id}">Excluir</button>
      </td>
    </tr>
  `).join("");
}

qs("loginBtn").onclick = async () => {
  qs("loginMsg").textContent = "";
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: qs("adminUser").value,
        password: qs("adminPass").value
      })
    });
    token = data.token;
    localStorage.setItem("bbtips_admin_token", token);
    showPanel();
  } catch (e) {
    qs("loginMsg").textContent = e.message;
  }
};

qs("saveBtn").onclick = async () => {
  qs("saveMsg").textContent = "";
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: qs("username").value,
        password: qs("password").value,
        active: qs("active").value === "true",
        expiresAt: qs("expiresAt").value || null,
        note: qs("note").value
      })
    });
    qs("saveMsg").textContent = "Usuario salvo.";
    qs("password").value = "";
    loadUsers();
  } catch (e) {
    qs("saveMsg").textContent = e.message;
  }
};

qs("reloadBtn").onclick = loadUsers;

qs("users").onclick = async event => {
  const del = event.target.dataset.del;
  const block = event.target.dataset.block;
  if (del && confirm("Excluir usuario?")) {
    await api(`/api/admin/users/${del}`, { method: "DELETE" });
    loadUsers();
  }
  if (block) {
    await api(`/api/admin/users/${block}`, {
      method: "PATCH",
      body: JSON.stringify({ active: event.target.dataset.active !== "true" })
    });
    loadUsers();
  }
};

if (token) showPanel();
