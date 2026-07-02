<script lang="ts">
  import { conn, connect, joinTable } from './lib/ws.ts';
  import { page } from './lib/ui.ts';
  import Lobby from './lib/Lobby.svelte';
  import Table from './lib/Table.svelte';
  import AccountPage from './lib/AccountPage.svelte';
  import HowTo from './lib/HowTo.svelte';

  connect();

  // If arriving via a shared table link (?table=ID), auto-join once the socket
  // is connected and our identity is established. Guarded so it fires once.
  const params = new URLSearchParams(location.search);
  const invitedTable = params.get('table');
  let joinTried = $state(false);
  let inviteDone = $state(false); // once we've joined, stop showing the banner for good
  $effect(() => {
    if (invitedTable && $conn.connected && $conn.playerId && !$conn.view && !joinTried) {
      joinTried = true;
      joinTable(invitedTable);
    }
  });
  // Latch the banner closed as soon as the join lands, so it doesn't reappear (nor
  // misattribute an unrelated lobby error to the invite) after you later leave the table.
  $effect(() => {
    if (joinTried && $conn.view) inviteDone = true;
  });
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
    {#if invitedTable && !inviteDone}
      <p class="invite">
        {#if $conn.error}
          Couldn't join table <code>{invitedTable}</code>: {$conn.error}
        {:else}
          Joining table <code>{invitedTable}</code>…
        {/if}
      </p>
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
