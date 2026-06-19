<script lang="ts">
  import { conn, setNick, quickMatch, cancelMatch, createTable, joinTable } from './ws.ts';
  import type { MatchFormat } from './types.ts';
  import Feedback from './Feedback.svelte';
  import Account from './Account.svelte';

  const account = $derived($conn.account);
  const searching = $derived($conn.searching);

  let joinId = $state('');
  let showCreate = $state(false);
  let createMsg = $state('');

  const QUICK: { label: string; sub: string; format: MatchFormat }[] = [
    { label: '6 deals', sub: 'quick', format: { kind: 'deals', deals: 6 } },
    { label: '12 deals', sub: 'standard', format: { kind: 'deals', deals: 12 } },
    { label: '36 deals', sub: 'long', format: { kind: 'deals', deals: 36 } },
    { label: 'Race 250', sub: 'first to 250', format: { kind: 'race', target: 250 } },
    { label: 'Race 1000', sub: 'first to 1000', format: { kind: 'race', target: 1000 } },
  ];

  // Your name on a table: your account username, or "Anonymous" otherwise.
  function ensureNick(): void {
    setNick(account ?? 'Anonymous');
  }

  function onQuick(format: MatchFormat) {
    ensureNick();
    quickMatch(format);
  }
  function onCreatePrivate() {
    if (!account) {
      createMsg = 'You need an account to create a private game';
      return;
    }
    showCreate = true;
  }
  function chooseCreate(format: MatchFormat) {
    ensureNick();
    createTable('private', format);
    showCreate = false;
  }
  function onJoin() {
    const id = joinId.trim().replace(/.*\//, '').replace(/\?table=/, '');
    if (!id) return;
    ensureNick();
    joinTable(id);
  }

  function fmtLabel(f: MatchFormat): string {
    return f.kind === 'deals' ? `${f.deals} deals` : `race to ${f.target}`;
  }
</script>

<div class="brand" style="position:fixed; top:16px; left:20px; font-size:26px; font-weight:800; letter-spacing:0.5px; color:#f2f5f3;">liskat</div>
<div class="topright"><Account /><Feedback /></div>

<div class="lobby">
  <section class="quick">
    <h2>Quick match</h2>
    <div class="grid">
      {#each QUICK as q}
        <button class="qbtn" onclick={() => onQuick(q.format)}>
          <span class="big">{q.label}</span>
          <span class="sub">{q.sub}</span>
        </button>
      {/each}
    </div>
  </section>

  <section class="row">
    <button class="secondary" class:greyed={!account} onclick={onCreatePrivate}>Create private table</button>
    <input bind:value={joinId} placeholder="Paste a table link or id" />
    <button onclick={onJoin} disabled={!joinId.trim()}>Join</button>
  </section>

  {#if createMsg && !account}
    <p class="hint">{createMsg}</p>
  {/if}

  {#if $conn.error}
    <p class="error">{$conn.error}</p>
  {/if}

  <footer>
    <span class:on={$conn.connected}>{$conn.connected ? 'connected' : 'connecting…'}</span>
  </footer>
</div>

{#if searching}
  <div class="overlay">
    <div class="modal searching">
      <div class="spinner" aria-label="searching"></div>
      <h2>Finding a match…</h2>
      <p class="muted">{fmtLabel(searching)} · matching you with players of similar strength</p>
      <button class="cancel" onclick={cancelMatch}>Cancel</button>
    </div>
  </div>
{/if}

{#if showCreate}
  <div class="overlay" role="presentation" onclick={() => (showCreate = false)}>
    <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <h2>Private table — choose a game type</h2>
      <div class="grid">
        {#each QUICK as q}
          <button class="qbtn" onclick={() => chooseCreate(q.format)}>
            <span class="big">{q.label}</span>
            <span class="sub">{q.sub}</span>
          </button>
        {/each}
      </div>
      <button class="cancel" onclick={() => (showCreate = false)}>Cancel</button>
    </div>
  </div>
{/if}

<style>
  .topright {
    position: fixed;
    top: 20px;
    right: 20px;
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .lobby {
    max-width: 560px;
    margin: 12vh auto 0;
    padding: 24px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 4px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .hint {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 14px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
  }
  .qbtn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    cursor: pointer;
    transition: background 0.12s, transform 0.12s;
  }
  .qbtn:hover {
    background: var(--accent);
    transform: translateY(-2px);
  }
  .qbtn .big {
    font-size: 20px;
    font-weight: 700;
  }
  .qbtn .sub {
    font-size: 12px;
    color: var(--muted);
  }
  .qbtn:hover .sub {
    color: #e8f5ee;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 26px;
  }
  .row input {
    flex: 1;
  }
  input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font-size: 15px;
    box-sizing: border-box;
  }
  button {
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    font-size: 15px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .secondary {
    white-space: nowrap;
  }
  /* Greyed but still clickable, so it can explain that an account is needed. */
  .secondary.greyed {
    opacity: 0.45;
  }
  .secondary.greyed:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: #ff8a80;
  }
  footer {
    margin-top: 20px;
    font-size: 12px;
    color: var(--muted);
  }
  footer .on {
    color: #7fe3a3;
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .modal {
    background: #0c3b25;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 16px;
    padding: 24px;
    width: min(520px, 92vw);
  }
  .modal h2 {
    margin: 0 0 14px;
  }
  .cancel {
    margin-top: 14px;
  }
  .searching {
    text-align: center;
  }
  .searching h2 {
    color: #f2f5f3;
    text-transform: none;
    letter-spacing: 0;
    font-size: 20px;
    margin: 4px 0;
  }
  .spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 12px;
    border: 4px solid rgba(255, 255, 255, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
