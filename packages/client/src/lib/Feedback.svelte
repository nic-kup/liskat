<script lang="ts">
  let open = $state(false);
  let message = $state('');
  let contact = $state('');
  let website = $state(''); // honeypot; real users never see/fill this
  let status = $state<'idle' | 'sending' | 'sent' | 'error'>('idle');
  let error = $state('');

  function close() {
    open = false;
    if (status === 'sent') {
      message = '';
      contact = '';
      status = 'idle';
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) close();
  }

  async function submit() {
    if (message.trim().length < 2) return;
    status = 'sending';
    error = '';
    try {
      const res = await fetch('/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, contact, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) status = 'sent';
      else {
        status = 'error';
        error = data.error || 'Something went wrong.';
      }
    } catch {
      status = 'error';
      error = 'Could not reach the server.';
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<button class="navlink" onclick={() => (open = true)}>Send feedback</button>

{#if open}
  <div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <h2>Feedback</h2>
      {#if status === 'sent'}
        <p class="thanks">Thank you!</p>
        <div class="row"><button class="primary" onclick={close}>Close</button></div>
      {:else}
        <p class="muted">Found a bug or have an idea? Let us know.</p>
        <textarea bind:value={message} rows="5" maxlength="4000" placeholder="Your feedback…"></textarea>
        <input bind:value={contact} maxlength="200" placeholder="Email (optional, if you'd like a reply)" />
        <!-- honeypot, visually hidden -->
        <input class="hp" bind:value={website} tabindex="-1" autocomplete="off" placeholder="Leave this empty" />
        {#if status === 'error'}<p class="err">{error}</p>{/if}
        <div class="row">
          <button onclick={close}>Cancel</button>
          <button class="primary" onclick={submit} disabled={status === 'sending' || message.trim().length < 2}>
            {status === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p class="email-note">Or email at feedback@liskat.com</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .modal {
    width: min(440px, 92vw);
    background: #123b29;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    padding: 22px;
  }
  h2 {
    margin: 0 0 6px;
  }
  .muted {
    color: var(--muted);
    margin: 0 0 12px;
    font-size: 14px;
  }
  textarea,
  input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font-size: 15px;
    box-sizing: border-box;
    margin-bottom: 10px;
    font-family: inherit;
    resize: vertical;
  }
  .hp {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button:not(.navlink) {
    padding: 9px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    font-size: 15px;
    cursor: pointer;
  }
  button:not(.navlink):hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
  }
  button:not(.navlink):disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }
  .thanks {
    font-size: 17px;
    margin: 8px 0 16px;
  }
  .err {
    color: #ff8a80;
    font-size: 14px;
    margin: 0 0 10px;
  }
  .email-note {
    color: var(--muted);
    font-size: 13px;
    margin: 14px 0 0;
    text-align: center;
  }
</style>
