<script lang="ts">
  import Icon from './Icon.svelte';
  import { energyOf, energySplit, PHASES } from '../lib/battery';
  import { decimal, mmss } from '../lib/format';
  import type { SessionDetail, SessionSummary } from '../lib/sessions.svelte';

  // Where a session's battery energy went: voltage × current added up (battery.ts), split by what the
  // session was doing. Only for a device that reports both (CRAFTY); Stats leaves it out otherwise.

  interface Props {
    summary: SessionSummary;
    detail: SessionDetail;
    unit: 'C' | 'F';
  }
  let { summary, detail, unit }: Props = $props();

  const energy = $derived(energyOf(detail.battery));
  const endSec = $derived(summary.end === null ? null : (summary.end - summary.id) / 1000);
  const phases = $derived(energy ? energySplit(energy, summary.readySec, endSec, detail.events) : []);
  const pct = $derived.by(() => {
    const p = (detail.battery?.p ?? []).filter((v): v is number => v !== null);
    return p.length ? { from: p[0], to: p[p.length - 1] } : null;
  });
  // The battery's warmth: how much it rose, and when it was warmest.
  const warm = $derived.by(() => {
    const b = detail.battery;
    if (!b?.t) return null;
    const pts = b.ts.map((t, i) => ({ t, v: b.t![i] })).filter((p): p is { t: number; v: number } => p.v !== null);
    if (pts.length < 2) return null;
    const top = pts.reduce((a, p) => (p.v > a.v ? p : a));
    const rise = (top.v - pts[0].v) / 10;
    return { rise: unit === 'F' ? (rise * 9) / 5 : rise, after: endSec !== null && top.t > endSec ? top.t - endSec : null, at: top.t };
  });
  const cap = $derived(
    summary.capStart !== undefined && summary.capEnd !== undefined ? { from: summary.capStart, to: summary.capEnd } : null,
  );
</script>

{#if energy}
  <section class="card energy rise d2" aria-label="Energy used in the session">
    <div class="label">Where the battery went</div>
    <div class="top num">
      <div class="wh"><span class="n">{decimal(energy.wh, 2)}</span><span class="u">Wh</span></div>
      {#if pct && pct.from > pct.to}
        <div class="drop">
          <strong>−{pct.from - pct.to} %</strong>
          <span>{pct.from} → {pct.to} %</span>
        </div>
      {/if}
    </div>
    <div class="how">Voltage × current, as the device reported them</div>
    <div class="bar" aria-hidden="true">
      {#each phases as p (p.phase)}<div class={p.phase} style:width="{Math.max(0.6, p.share * 100)}%"></div>{/each}
    </div>
    <ul class="num">
      {#each phases as p (p.phase)}
        <li>
          <span class="sw {p.phase}"></span>
          <span class="name">{PHASES[p.phase]}</span>
          <span class="v">{decimal(p.wh, 2)} Wh</span>
          <strong>{Math.round(p.share * 100)} %</strong>
        </li>
      {/each}
    </ul>
    {#if cap}
      <p class="cap num">
        The device counted {cap.from} → {cap.to} mAh ({cap.to <= cap.from ? '−' : '+'}{Math.abs(cap.from - cap.to)}); the current
        adds up to {Math.round(energy.mah)} mAh.
      </p>
    {/if}
    {#if warm && warm.rise >= 0.5}
      <div class="note">
        <Icon name="thermometer" size={20} color="var(--orange-ink)" />
        <span>
          Battery warmed by {decimal(warm.rise, 0)} °{unit} and was warmest
          {warm.after !== null ? `${mmss(warm.after)} after the heater went off` : `at ${mmss(warm.at)}`}.
        </span>
      </div>
    {/if}
  </section>
{/if}

<style>
  .energy {
    padding: 16px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }
  .wh {
    display: flex;
    align-items: baseline;
    gap: 4px;
    color: var(--navy);
    line-height: 1;
  }
  .wh .n {
    font-size: 40px;
    font-weight: 300;
    letter-spacing: -0.03em;
  }
  .wh .u {
    font-size: 18px;
    font-weight: 600;
    color: var(--muted);
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .drop strong {
    font-size: 20px;
    font-weight: 800;
    color: var(--orange-ink);
  }
  .drop span {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-2);
  }
  .how {
    margin-top: -6px;
    font-size: 12px;
    color: var(--muted);
  }
  .bar {
    display: flex;
    gap: 2px;
    height: 16px;
    border-radius: 8px;
    overflow: hidden;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 14px;
  }
  li {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) 72px 44px;
    align-items: center;
    gap: 8px;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .name {
    color: var(--navy);
    font-weight: 600;
  }
  .v {
    text-align: right;
    color: var(--muted-2);
  }
  li strong {
    text-align: right;
    color: var(--navy);
  }
  .heatup {
    background: var(--orange);
  }
  .holding {
    background: color-mix(in srgb, var(--orange) 50%, #ffffff);
  }
  .boost {
    background: var(--orange-ink);
  }
  .superboost {
    background: var(--led-heat);
  }
  .after {
    background: var(--track);
  }
  .cap {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--muted);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--card-2);
    font-size: 14px;
    color: var(--ink);
  }
  .note :global(svg) {
    flex-shrink: 0;
  }
</style>
