<script lang="ts">
  import { cardId } from '@liskat/engine';
  import type { Card } from './types.ts';

  interface Props {
    card?: Card;
    back?: boolean;
    deck?: string;
    width?: number;
    fill?: boolean; // size to the parent (width:100%) instead of a fixed px width
    selected?: boolean;
    dim?: boolean;
    onclick?: () => void;
  }

  let { card, back = false, deck = 'french', width = 92, fill = false, selected = false, dim = false, onclick }: Props = $props();

  const src = $derived(back || !card ? `/cards/${deck}/back.svg` : `/cards/${deck}/${cardId(card)}.svg`);
</script>

<button
  class="card"
  class:selected
  class:dim
  class:clickable={!!onclick}
  style={fill ? 'width:100%' : `width:${width}px`}
  onclick={onclick}
>
  <img {src} alt={card ? cardId(card) : 'card back'} draggable="false" />
</button>

<style>
  .card {
    padding: 0;
    border: none;
    background: none;
    border-radius: 8%;
    cursor: default;
    line-height: 0;
    -webkit-tap-highlight-color: transparent; /* no blue tap-flash on iOS */
    /* Keep card proportions even when a flex row squeezes the width (e.g. the
       12-card hand on a phone); otherwise the fixed height made them tall. */
    aspect-ratio: 250 / 350;
    min-width: 0;
    flex-shrink: 1;
  }
  /* The lift lives on the IMG, not the button. If the button itself moved, its
     hover hit-box would slide out from under a cursor near the card's bottom
     edge -- hover ends, the card drops, the cursor is over it again: jitter.
     Keeping the button geometry fixed makes hover stable; only the image (with
     its shadow and selected ring) travels. */
  .card img {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    display: block;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .clickable {
    cursor: pointer;
  }
  .selected img {
    transform: translateY(-16px);
    outline: 3px solid #ffd54a;
    outline-offset: 2px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.45);
  }
  /* Hover lifts are gated to real pointers: on touch, :hover LATCHES after a tap and
     never clears, so a tapped card would stay stuck up. `@media (hover: hover)` keeps
     the effect on mouse/trackpad and drops it on touch. */
  @media (hover: hover) {
    .card:hover img {
      transform: translateY(-4px);
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
    }
    .clickable:hover img {
      transform: translateY(-10px);
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.45);
    }
    /* keep a hovered-selected card lifted and ringed */
    .clickable.selected:hover img {
      transform: translateY(-18px);
    }
  }
  .dim {
    opacity: 0.45;
    filter: grayscale(0.4);
  }
</style>
