<script lang="ts">
  // A suit pip drawn to match the card faces exactly: same shapes, same German
  // 4-colour scheme (♦ orange, ♥ red, ♠ green, ♣ black) used in /cards/french.
  // `outline` adds a white stroke so dark pips (♣ black, ♠ green) stay legible
  // when shown on a green button instead of a white card tile.
  let { suit, size = 26, outline = false }: { suit: 'D' | 'H' | 'S' | 'C'; size?: number; outline?: boolean } = $props();
  const COLOR: Record<string, string> = { D: '#e6820a', H: '#d11', S: '#1f7a1f', C: '#1a1a1a' };
</script>

<svg
  viewBox="0 0 100 100"
  width={size}
  height={size}
  fill={COLOR[suit]}
  stroke={outline ? '#fffdf7' : 'none'}
  stroke-width={outline ? 7 : 0}
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if suit === 'D'}
    <path d="M50 2 L94 50 L50 98 L6 50 Z" />
  {:else if suit === 'H'}
    <path d="M50 86 C 18 64 4 46 4 28 C 4 15 14 6 26 6 C 36 6 44 12 50 22 C 56 12 64 6 74 6 C 86 6 96 15 96 28 C 96 46 82 64 50 86 Z" />
  {:else if suit === 'S'}
    <path d="M50 5 C 50 25 90 40 90 62 C 90 74 81 82 70 82 C 64 82 58 79 54 74 C 55 84 60 92 68 96 L32 96 C 40 92 45 84 46 74 C 42 79 36 82 30 82 C 19 82 10 74 10 62 C 10 40 50 25 50 5 Z" />
  {:else}
    <circle cx="50" cy="30" r="17" />
    <circle cx="29" cy="52" r="17" />
    <circle cx="71" cy="52" r="17" />
    <path d="M50 46 C 47 64 41 78 33 96 L67 96 C 59 78 53 64 50 46 Z" />
  {/if}
</svg>
