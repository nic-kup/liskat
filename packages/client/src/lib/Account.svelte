<script lang="ts">
  import { conn, login, register, logout } from './ws.ts';
  import { page } from './ui.ts';

  let open = $state(false);
  let mode = $state<'login' | 'register'>('login');
  let username = $state('');
  let password = $state('');
  let email = $state('');
  let error = $state('');
  let busy = $state(false);

  const account = $derived($conn.account);

  function openModal(m: 'login' | 'register') {
    mode = m;
    error = '';
    open = true;
  }
  function close() {
    open = false;
    password = '';
    error = '';
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) close();
  }

  async function submit() {
    if (busy || !username || !password) return;
    busy = true;
    error = '';
    const r = mode === 'login' ? await login(username, password) : await register(username, password, email);
    busy = false;
    if (r.ok) {
      close();
      username = password = email = '';
    } else {
      error = r.error ?? 'Something went wrong.';
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if account}
  <button class="navlink name" onclick={() => ($page = 'account')} title="View your account">{account}</button>
  <button class="navlink" onclick={logout}>Log out</button>
{:else}
  <button class="navlink" onclick={() => openModal('login')}>Log in</button>
{/if}

{#if open}
  <div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <div class="tabs">
        <button class:active={mode === 'login'} onclick={() => ((mode = 'login'), (error = ''))}>Log in</button>
        <button class:active={mode === 'register'} onclick={() => ((mode = 'register'), (error = ''))}>Create account</button>
      </div>
      <form onsubmit={(e) => (e.preventDefault(), submit())}>
        <label>
          <span>Username</span>
          <input bind:value={username} autocomplete="username" maxlength="20" placeholder="3–20 letters, digits, _ or -" />
        </label>
        <label>
          <span>Password</span>
          <input type="password" bind:value={password} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {#if mode === 'register'}
          <label>
            <span>Email <em>(optional, for password reset)</em></span>
            <input type="email" bind:value={email} autocomplete="email" />
          </label>
        {/if}
        {#if error}<p class="err">{error}</p>{/if}
        <button class="primary" type="submit" disabled={busy || !username || !password}>
          {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
      <p class="note">Accounts are optional. You can always play anonymously. We only keep your username and, if you add one, an email for password resets.</p>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }
  .modal {
    background: #18382a;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 16px;
    padding: 22px;
    width: min(380px, 92vw);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  }
  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 14px;
  }
  .tabs button {
    flex: 1;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
  }
  .tabs button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  label em {
    font-style: normal;
    opacity: 0.7;
  }
  input {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: #f2f5f3;
    font-size: 15px;
  }
  .primary {
    margin-top: 4px;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .err {
    color: #ff8a80;
    font-size: 13px;
    margin: 0;
  }
  .note {
    margin: 14px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
