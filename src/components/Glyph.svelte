<script lang="ts">
  import type { DeviceKind } from '../lib/devices/types';
  let { kind, scale = 1 }: { kind: DeviceKind | null; scale?: number } = $props();
</script>

<!-- A plain silhouette of the device family, never a product photo. -->
<div class="glyph {kind ?? 'venty'}" style:transform="scale({scale})" aria-hidden="true">
  <span class="band"></span>
  <span class="led"></span>
</div>

<style>
  .glyph {
    position: relative;
    background: var(--navy);
    box-shadow: 0 8px 18px rgba(0, 40, 125, 0.2), inset -5px 0 0 rgba(255, 255, 255, 0.08);
  }
  .venty, .veazy {
    width: 44px;
    height: 92px;
    border-radius: 22px;
  }
  .crafty {
    width: 56px;
    height: 76px;
    border-radius: 18px;
  }
  .volcano {
    width: 74px;
    height: 74px;
    border-radius: 18px 18px 26px 26px;
    clip-path: polygon(22% 0, 78% 0, 100% 100%, 0 100%);
  }
  .band {
    position: absolute;
    left: 0;
    right: 0;
    top: 18px;
    height: 6px;
    background: var(--orange);
  }
  .volcano .band {
    top: 26px;
  }
  .led {
    position: absolute;
    left: 50%;
    bottom: 14px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    border-radius: 50%;
    background: #ff8a3d;
  }
</style>
