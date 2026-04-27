/**
 * LogScope — Admin panel logic
 * Requires: window.LogScope.getAuthToken() and window.LogScope.authenticatedFetch()
 */
(function () {
  const API = 'http://localhost:3000';

  // Current user being reset (for modal)
  let resetTargetId = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmt(iso) {
    if (!iso) return '<span style="color:var(--text-3)">—</span>';
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function roleBadge(role) {
    return role === 'admin'
      ? '<span class="role-badge role-admin">Admin</span>'
      : '<span class="role-badge role-user">Utilisateur</span>';
  }

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
  }

  function setSuccess(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
  }

  function clearMessages(...ids) {
    ids.forEach(id => { setError(id, ''); setSuccess(id, ''); });
  }

  // ── Load & render users ───────────────────────────────────────────────────

  async function loadUsers() {
    const tbody = document.getElementById('adminUsersBody');
    tbody.innerHTML = '<tr><td colspan="6" class="admin-loading">Chargement…</td></tr>';

    try {
      const res = await window.LogScope.authenticatedFetch(`${API}/admin/users`);
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const users = await res.json();
      renderUsers(users);
      renderStats(users);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="admin-loading" style="color:var(--error)">${err.message}</td></tr>`;
    }
  }

  function renderStats(users) {
    const admins = users.filter(u => u.role === 'admin').length;
    const regular = users.filter(u => u.role !== 'admin').length;
    const lastWeek = users.filter(u => {
      if (!u.last_login_at) return false;
      return (Date.now() - new Date(u.last_login_at).getTime()) < 7 * 24 * 3600 * 1000;
    }).length;

    document.getElementById('adminStats').innerHTML = `
      <div class="admin-stat-card">
        <div class="admin-stat-value">${users.length}</div>
        <div class="admin-stat-label">Utilisateurs total</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">${admins}</div>
        <div class="admin-stat-label">Administrateurs</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">${regular}</div>
        <div class="admin-stat-label">Utilisateurs standard</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">${lastWeek}</div>
        <div class="admin-stat-label">Actifs (7 jours)</div>
      </div>
    `;
  }

  function renderUsers(users) {
    const tbody = document.getElementById('adminUsersBody');
    const currentUser = window.LogScope.getCurrentUser();

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-loading">Aucun utilisateur.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const isSelf = currentUser && u.id === currentUser.id;
      const isAdmin = u.role === 'admin';

      return `
        <tr class="${isSelf ? 'admin-row-self' : ''}">
          <td class="admin-td-id">${u.id}</td>
          <td class="admin-td-user">
            <div class="admin-username">${escapeHtml(u.username)}</div>
            ${isSelf ? '<div class="admin-self-tag">Vous</div>' : ''}
          </td>
          <td>${roleBadge(u.role)}</td>
          <td class="admin-td-date">${fmt(u.created_at)}</td>
          <td class="admin-td-date">${fmt(u.last_login_at)}</td>
          <td>
            <div class="admin-actions">
              <button class="btn-action btn-action-role"
                data-id="${u.id}"
                data-role="${u.role}"
                ${isSelf ? 'disabled title="Impossible de modifier votre propre rôle"' : ''}
                title="${isAdmin ? 'Rétrograder en utilisateur' : 'Promouvoir en admin'}">
                ${isAdmin ? '↓ Utilisateur' : '↑ Admin'}
              </button>
              <button class="btn-action btn-action-reset"
                data-id="${u.id}"
                data-username="${escapeHtml(u.username)}"
                title="Réinitialiser le mot de passe">
                Mot de passe
              </button>
              <button class="btn-action btn-action-delete"
                data-id="${u.id}"
                ${isSelf ? 'disabled title="Impossible de supprimer votre propre compte"' : ''}
                title="Supprimer l'utilisateur">
                Supprimer
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Bind actions
    tbody.querySelectorAll('.btn-action-role').forEach(btn => {
      btn.addEventListener('click', () => handleRoleToggle(
        Number(btn.dataset.id),
        btn.dataset.role === 'admin' ? 'user' : 'admin'
      ));
    });
    tbody.querySelectorAll('.btn-action-reset').forEach(btn => {
      btn.addEventListener('click', () => openResetModal(
        Number(btn.dataset.id), btn.dataset.username
      ));
    });
    tbody.querySelectorAll('.btn-action-delete').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(Number(btn.dataset.id)));
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleRoleToggle(id, newRole) {
    try {
      const res = await window.LogScope.authenticatedFetch(
        `${API}/admin/users/${id}/role`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: newRole }) }
      );
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await loadUsers();
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer cet utilisateur ? Cette action est irréversible.')) return;
    try {
      const res = await window.LogScope.authenticatedFetch(
        `${API}/admin/users/${id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      await loadUsers();
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  }

  function openResetModal(id, username) {
    resetTargetId = id;
    document.getElementById('resetPassTarget').textContent = `Utilisateur : ${username}`;
    document.getElementById('resetPassInput').value = '';
    clearMessages('resetPassError', 'resetPassSuccess');
    document.getElementById('resetPassModal').classList.add('active');
    document.getElementById('resetPassInput').focus();
  }

  // ── Create user form ──────────────────────────────────────────────────────

  async function handleCreateUser(e) {
    e.preventDefault();
    clearMessages('createUserError', 'createUserSuccess');

    const username = document.getElementById('newUserName').value.trim();
    const password = document.getElementById('newUserPass').value;
    const role = document.getElementById('newUserRole').value;

    if (!username || !password) {
      setError('createUserError', 'Tous les champs sont requis.');
      return;
    }

    try {
      const res = await window.LogScope.authenticatedFetch(
        `${API}/admin/users`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role }) }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);

      setSuccess('createUserSuccess', `Utilisateur « ${data.username} » créé avec succès.`);
      document.getElementById('newUserName').value = '';
      document.getElementById('newUserPass').value = '';
      document.getElementById('newUserRole').value = 'user';
      await loadUsers();
    } catch (err) {
      setError('createUserError', err.message);
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    // Open/close panel
    document.getElementById('adminPanelBtn').addEventListener('click', () => {
      document.getElementById('adminPanel').hidden = false;
      document.getElementById('appMain').style.display = 'none';
      document.getElementById('compareSection').style.display = 'none';
      loadUsers();
    });

    document.getElementById('adminCloseBtn').addEventListener('click', () => {
      document.getElementById('adminPanel').hidden = true;
      document.getElementById('appMain').style.display = '';
    });

    // Refresh
    document.getElementById('refreshUsersBtn').addEventListener('click', loadUsers);

    // Create form
    document.getElementById('adminCreateForm').addEventListener('submit', handleCreateUser);

    // Reset password modal
    document.getElementById('resetPassModalClose').addEventListener('click', () => {
      document.getElementById('resetPassModal').classList.remove('active');
    });

    document.getElementById('resetPassConfirmBtn').addEventListener('click', async () => {
      clearMessages('resetPassError', 'resetPassSuccess');
      const password = document.getElementById('resetPassInput').value;
      if (!password || password.length < 6) {
        setError('resetPassError', 'Le mot de passe doit contenir au moins 6 caractères.');
        return;
      }
      try {
        const res = await window.LogScope.authenticatedFetch(
          `${API}/admin/users/${resetTargetId}/reset-password`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }
        );
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        setSuccess('resetPassSuccess', 'Mot de passe réinitialisé avec succès.');
        document.getElementById('resetPassInput').value = '';
        setTimeout(() => document.getElementById('resetPassModal').classList.remove('active'), 1500);
      } catch (err) {
        setError('resetPassError', err.message);
      }
    });
  }

  // Expose pour accès externe (ex: bandeau admin)
  window.LogScope.loadAdminUsers = function () {
    document.getElementById('appMain').style.display = 'none';
    document.getElementById('compareSection').style.display = 'none';
    loadUsers();
  };

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
