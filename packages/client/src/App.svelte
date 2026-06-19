<script lang="ts">
  import { conn, connect, joinTable } from './lib/ws.ts';
  import { page } from './lib/ui.ts';
  import Lobby from './lib/Lobby.svelte';
  import Table from './lib/Table.svelte';
  import AccountPage from './lib/AccountPage.svelte';
  import HowTo from './lib/HowTo.svelte';

  connect();

  // If arriving via a shared table link (?table=ID), remember it so the lobby
  // can offer to join once a nickname is set.
  const params = new URLSearchParams(location.search);
  const invitedTable = params.get('table');
</script>

<main>
  {#if $conn.view}
    <Table />
  {:else if $page === 'account'}
    <AccountPage />
  {:else if $page === 'howto'}
    <HowTo />
  {:else}
    <Lobby />
    {#if invitedTable}
      <p class="invite">You were invited to table <code>{invitedTable}</code> — set a nickname above, then join with this id.</p>
    {/if}
  {/if}
</main>

<style>
  .invite {
    max-width: 460px;
    margin: 0 auto;
    text-align: center;
    color: var(--muted);
    font-size: 14px;
  }
  code {
    background: rgba(255, 255, 255, 0.12);
    padding: 1px 6px;
    border-radius: 6px;
  }
</style>
