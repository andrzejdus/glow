<script lang="ts">
  interface Props {
    on: boolean;
    label: string;
    id?: string;
    onchange: (on: boolean) => void;
  }
  let { on, label, id, onchange }: Props = $props();
</script>

<button {id} type="button" role="switch" aria-checked={on} aria-label={label} class="toggle press" class:on
  onclick={() => onchange(!on)}>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    width: 56px;
    height: 34px;
    border-radius: 999px;
    border: 0;
    padding: 3px;
    background: #d5d5d5;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.25s ease;
  }
  .toggle.on {
    background: var(--orange);
  }
  .knob {
    display: block;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    transition: transform 0.35s cubic-bezier(0.3, 1.5, 0.5, 1);
  }
  .on .knob {
    transform: translateX(22px);
  }
</style>
