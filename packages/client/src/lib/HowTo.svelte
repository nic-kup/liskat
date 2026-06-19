<script lang="ts">
  import { page } from './ui.ts';

  // Card faces are served from /cards/french/<ID>.svg.
  const EYES = [
    { id: 'HA', v: '11' },
    { id: 'H10', v: '10' },
    { id: 'HK', v: '4' },
    { id: 'HQ', v: '3' },
    { id: 'HJ', v: '2' },
    { id: 'H9', v: '0' },
  ];
  const JACKS = ['CJ', 'SJ', 'HJ', 'DJ'];
  const SUIT_RANK = ['SA', 'S10', 'SK', 'SQ', 'S9', 'S8', 'S7'];
  const CLUB_TRUMPS = ['CJ', 'SJ', 'HJ', 'DJ', 'CA', 'C10', 'CK', 'CQ', 'C9', 'C8', 'C7'];
  const NULL_ORDER = ['HA', 'HK', 'HQ', 'HJ', 'H10', 'H9', 'H8', 'H7'];
  const SORTED_HAND = ['CJ', 'SJ', 'CA', 'C10', 'C7', 'SA', 'SK', 'HA', 'H9', 'DK'];
</script>

{#snippet card(id: string)}
  <img class="gcard" src="/cards/french/{id}.svg" alt={id} />
{/snippet}

<button class="brand" style="position:fixed; top:16px; left:20px; font-size:26px; font-weight:800; letter-spacing:0.5px; color:#f2f5f3; background:none; border:none; padding:0; cursor:pointer; font-family:inherit;" onclick={() => ($page = 'lobby')} title="Home">liskat</button>
<div class="topright"><button class="link" onclick={() => ($page = 'lobby')}>← Lobby</button></div>

<div class="howto">
  <h1>How to play Skat</h1>
  <p class="intro">Skat is a trick-taking card game for three players. One player (the declarer) plays alone against the other two, who form a team for that deal. Here is what you need to know to start.</p>

  <section>
    <h2>1. The cards: eyes and strength</h2>
    <p>Skat uses 32 cards: 7, 8, 9, 10, Jack, Queen, King and Ace in four suits. Two separate things about a card matter, and they are not the same.</p>

    <h3>Eyes (card points)</h3>
    <p>Each card is worth a number of "eyes". They add up to 120 in the whole deck. As the declarer you need 61 eyes to win the deal.</p>
    <div class="row">
      {#each EYES as e}
        <div class="eye">
          {@render card(e.id)}
          <span class="v">{e.v}</span>
        </div>
      {/each}
    </div>
    <p class="note">The 9, 8 and 7 are worth nothing. Notice the 10 is the second most valuable card, worth more than the King or Queen.</p>

    <h3>Strength (who wins a trick)</h3>
    <p>Strength is a different order. The four Jacks are always the strongest cards, ranked Clubs, Spades, Hearts, Diamonds.</p>
    <div class="row">{#each JACKS as id}{@render card(id)}{/each}</div>
    <p>After the Jacks, the cards of a suit rank like this, high to low:</p>
    <div class="row">{#each SUIT_RANK as id}{@render card(id)}{/each}</div>
    <p class="note">So the 10 sits just below the Ace in both eyes and strength, while the Jacks jump to the very top.</p>
  </section>

  <section>
    <h2>2. Suit games</h2>
    <p>In a suit game you choose a trump suit. The trumps are that whole suit plus all four Jacks, so eleven cards are trumps. Any trump beats any non-trump.</p>
    <p>Here is a hand sorted for a Clubs game. Trumps are on the left (the Jacks first, then the clubs), followed by the side suits:</p>
    <div class="row hand">{#each SORTED_HAND as id}{@render card(id)}{/each}</div>
    <p>The full trump order in a Clubs game runs:</p>
    <div class="row">{#each CLUB_TRUMPS as id}{@render card(id)}{/each}</div>
    <p class="note">Each suit has a base value: Diamonds 9, Hearts 10, Spades 11, Clubs 12. You win the deal by taking at least 61 eyes.</p>
  </section>

  <section>
    <h2>3. Grand and Null</h2>
    <h3>Grand</h3>
    <p>In a Grand only the four Jacks are trumps. Every other card simply follows its suit, ranking A, 10, K, Q, 9, 8, 7. Grand has the highest base value, 24, and you still need 61 eyes to win.</p>
    <h3>Null</h3>
    <p>In a Null there are no trumps and the goal flips: you win only by losing every single trick. The cards rank plainly, so the Jack drops back into its normal place between Queen and 10:</p>
    <div class="row">{#each NULL_ORDER as id}{@render card(id)}{/each}</div>
    <p class="note">Null is worth a fixed value and does not use eyes at all.</p>
  </section>

  <section>
    <h2>4. Bidding</h2>
    <p>Before play, the three players bid to decide who becomes the declarer. Players call rising numbers: 18, 20, 22, 23, 24 and so on. Your number is a promise that your game will be worth at least that much.</p>
    <p>The highest bidder wins the auction and becomes the declarer. They may pick up the two cards in the Skat and then discard two, or play the hand as dealt. Then they name the game: a suit, Grand or Null.</p>
    <p class="note">A game value is the base value times a multiplier that depends on how many top trumps (matadors) you hold, plus a few extras. You win if you take 61 eyes and your game is worth at least your bid.</p>
  </section>

  <section>
    <h2>5. A match</h2>
    <p>A match is several deals with the deal rotating each time, so everyone takes a turn in each seat. Scores add up across the deals. You can play a set number of deals (6, 12 or 36) or race to a target score (250 or 1000).</p>
  </section>

  <div class="cta">
    <button class="primary" onclick={() => ($page = 'lobby')}>Back to the lobby</button>
  </div>
</div>

<style>
  .brand:hover {
    color: #ffa733 !important;
  }
  .topright {
    position: fixed;
    top: 20px;
    right: 20px;
  }
  .link {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    padding: 0;
  }
  .link:hover {
    color: #f2f5f3;
  }
  .howto {
    max-width: 720px;
    margin: 0 auto;
    padding: 84px 20px 60px;
  }
  h1 {
    font-size: 30px;
    margin: 0 0 10px;
  }
  .intro {
    color: var(--muted);
    margin: 0 0 8px;
  }
  section {
    margin-top: 30px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 18px;
  }
  h2 {
    font-size: 20px;
    margin: 0 0 8px;
  }
  h3 {
    font-size: 15px;
    margin: 18px 0 4px;
    color: #f2f5f3;
  }
  p {
    line-height: 1.5;
    margin: 8px 0;
  }
  .note {
    color: var(--muted);
    font-size: 14px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: flex-end;
    margin: 10px 0;
  }
  .gcard {
    width: 50px;
    border-radius: 6px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    display: block;
  }
  .eye {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .eye .v {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 15px;
  }
  .cta {
    margin-top: 34px;
    text-align: center;
  }
  .primary {
    padding: 11px 18px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
  }
</style>
