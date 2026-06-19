<script lang="ts">
  import { conn, setNick, quickMatch, createTable, joinTable, listTables } from './ws.ts';
  import type { MatchFormat } from './types.ts';
  import Feedback from './Feedback.svelte';

  let nick = $state(localStorage.getItem('liskat.nick') ?? '');
  let joinId = $state('');

  const QUICK: { label: string; sub: string; format: MatchFormat }[] = [
    { label: '6 deals', sub: 'quick', format: { kind: 'deals', deals: 6 } },
    { label: '12 deals', sub: 'standard', format: { kind: 'deals', deals: 12 } },
    { label: '36 deals', sub: 'long', format: { kind: 'deals', deals: 36 } },
    { label: 'Race 250', sub: 'first to 250', format: { kind: 'race', target: 250 } },
    { label: 'Race 1000', sub: 'first to 1000', format: { kind: 'race', target: 1000 } },
  ];

  // Settles on a nickname, defaulting to "Anonymous" if left blank.
  function ensureNick(): void {
    const n = nick.trim() || 'Anonymous';
    nick = n;
    localStorage.setItem('liskat.nick', n);
    setNick(n);
  }

  function onQuick(format: MatchFormat) {
    ensureNick();
    quickMatch(format);
  }
  function onCreatePrivate() {
    ensureNick();
    createTable('private', QUICK[1].format);
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

  listTables();
</script>

<div class="brand">liskat</div>

<div class="lobby">
  <section class="quick">
    <h2>Quick match</h2>
    <p class="hint">One click — you're in a table, waiting for two more players.</p>
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
    <label class="field">
      <span>Nickname</span>
      <input bind:value={nick} maxlength="24" placeholder="Anonymous" />
    </label>
    <button class="secondary" onclick={onCreatePrivate}>Create private table</button>
  </section>

  <section class="join">
    <input bind:value={joinId} placeholder="Paste a table link or id to join friends" />
    <button onclick={onJoin} disabled={!joinId.trim()}>Join</button>
  </section>

  {#if $conn.error}
    <p class="error">{$conn.error}</p>
  {/if}

  <section class="public">
    <h2>Open public tables</h2>
    {#if $conn.tables.length === 0}
      <p class="muted">None open — quick-match above to start one.</p>
    {:else}
      <ul>
        {#each $conn.tables as t}
          <li>
            <span><strong>{t.hostNick}</strong> · {fmtLabel(t.format)} · {t.seated}/3</span>
            <button onclick={() => { ensureNick(); joinTable(t.id); }}>Join</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <footer>
    <span class:on={$conn.connected}>{$conn.connected ? 'connected' : 'connecting…'}</span>
    <span class="feedback"><Feedback /> · or email <a href="mailto:feedback@liskat.com">feedback@liskat.com</a></span>
  </footer>
</div>

<style>
  .brand {
    position: fixed;
    top: 16px;
    left: 20px;
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #f2f5f3;
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
    align-items: flex-end;
    margin-top: 26px;
  }
  .field {
    flex: 1;
  }
  .field span {
    display: block;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 4px;
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
  .join {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }
  .join input {
    flex: 1;
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
  .public {
    margin-top: 26px;
  }
  .public ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .public li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 14px;
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
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  footer .on {
    color: #7fe3a3;
  }
  footer .feedback a {
    color: var(--muted);
  }
</style>
