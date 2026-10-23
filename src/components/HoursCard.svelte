<script lang="ts">
  import { conn } from '../lib/connection.svelte';
  import { duration, mmss, splitHours, usageTime } from '../lib/format';
  import { usage } from '../lib/usage.svelte';

  const d = $derived(conn.device);
  const life = $derived(usage.lifetimeSec(usage.now));
  const parts = $derived(life === null ? null : splitHours(life));
  const months = $derived(usage.months(8, usage.now));
  const max = $derived(Math.max(3.5, ...months.map((w) => w.hours ?? 0)));
  const thisMonth = $derived(months[months.length - 1]?.hours);
  const known = $derived(months.filter((w) => w.hours !== null && !w.current));
  const avg = $derived(known.length ? known.reduce((a, w) => a + (w.hours ?? 0), 0) / known.length : null);
  // Time left until the device switches itself off, when it reports it; nothing while it is off.
  const left = $derived(conn.autoOffLeft(usage.now));
  const autoOff = $derived(
    !d?.heaterOn
      ? '–'
      : left !== undefined
        ? mmss(left)
        : d.autoShutoffSec !== undefined
          ? `after ${duration(d.autoShutoffSec)}`
          : '–',
  );
</script>

<section class="card rise d3">
  <div class="top">
    <div>
      <div class="label">Hours of operation</div>
      {#if parts}
        <div class="life num">
          <span class="h">{parts.h}</span><span class="u">h</span>
          <span class="m">{parts.m}</span><span class="u">m</span>
          <span class="s">{parts.s}</span><span class="u small">s</span>
        </div>
      {:else}
        <div class="life num"><span class="h">–</span></div>
      {/if}
    </div>
    <div class="side">
      <div class="live" class:on={usage.heating}><span></span>{usage.heating ? 'COUNTING' : 'PAUSED'}</div>
      <div class="week-label">this month</div>
      <div class="week num">{thisMonth === null || thisMonth === undefined ? '–' : `+${usageTime(thisMonth)}`}</div>
    </div>
  </div>
  <div class="bars" role="img" aria-label="Hours used per month, last 8 months">
    {#each months as w, i (w.label)}
      <div class="col">
        <div class="bar" class:current={w.current} class:empty={w.hours === null}
          style:height="{w.hours === null ? 4 : Math.max(6, Math.round((w.hours / max) * 44))}px"
          style:animation-delay="{i * 0.05}s"></div>
        <div class="wk" class:current={w.current}>{w.label}</div>
      </div>
    {/each}
  </div>
  <div class="foot num">
    <div><span>Session</span><strong>{mmss(usage.sessionSec(usage.now))}</strong></div>
    <div><span>Avg per month</span><strong>{avg === null ? '–' : usageTime(avg)}</strong></div>
    <div><span>Auto-off</span><strong>{autoOff}</strong></div>
  </div>
</section>

<style>
  section {
    padding: 16px 18px 14px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .life {
    margin-top: 4px;
    color: var(--navy);
    display: flex;
    align-items: baseline;
    gap: 3px;
  }
  .h {
    font-size: 38px;
    font-weight: 300;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .m {
    font-size: 24px;
    font-weight: 400;
    margin-left: 6px;
  }
  .s {
    font-size: 17px;
    font-weight: 500;
    margin-left: 6px;
    color: var(--orange-ink);
  }
  .u {
    font-size: 15px;
    font-weight: 600;
    color: var(--muted);
  }
  .u.small {
    font-size: 13px;
  }
  .side {
    text-align: right;
  }
  .live {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
  }
  .live span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .live.on {
    color: var(--orange-ink);
    animation: blink 1.4s ease-in-out infinite;
  }
  .week-label {
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .week {
    font-size: 18px;
    font-weight: 700;
    color: var(--orange-ink);
  }
  .bars {
    margin-top: 12px;
    height: 62px;
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 8px;
    align-items: end;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    height: 62px;
  }
  .bar {
    width: 100%;
    border-radius: 5px;
    background: var(--orange-soft);
    transform-origin: bottom;
    animation: grow 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    transition: height 0.4s ease;
  }
  .bar.current {
    background: var(--orange);
  }
  .bar.empty {
    background: #ececec;
  }
  @keyframes grow {
    from { transform: scaleY(0); }
    to { transform: scaleY(1); }
  }
  .wk {
    font-size: 10px;
    font-weight: 700;
    color: var(--muted);
  }
  .wk.current {
    color: var(--orange-ink);
  }
  .foot {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .foot div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .foot div:nth-child(2) {
    text-align: center;
  }
  .foot div:last-child {
    text-align: right;
  }
  .foot span {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }
  .foot strong {
    font-size: 13px;
    color: var(--navy);
    white-space: nowrap;
  }
</style>
