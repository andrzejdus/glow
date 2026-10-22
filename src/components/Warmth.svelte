<script lang="ts">
  // The whole top of the screen warms up as the device heats.
  let { warmth }: { warmth: number } = $props();
</script>

<div class="warm" style:opacity={warmth} aria-hidden="true"></div>

<style>
  .warm {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background: radial-gradient(ellipse 120% 55% at 50% 26%, rgba(255, 102, 0, 0.22) 0%, rgba(255, 138, 61, 0) 70%);
    transition: opacity 1.2s ease;
  }
</style>
