// UndoToast.js — Toast noir bottom-center avec bouton "Annuler" + progress bar.
// Auto-dismiss après `duration` ms. Slide-in from bottom.
// Props: message, actionLabel, duration
// Events: undo (user clicked cancel), dismiss (auto-dismissed or manual close)
import { ref, onMounted, onBeforeUnmount, watch } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'UndoToast',
  props: {
    message: { type: String, required: true },
    actionLabel: { type: String, default: 'Annuler' },
    duration: { type: Number, default: 5000 }
  },
  emits: ['undo', 'dismiss'],
  setup(props, { emit }) {
    const progress = ref(100); // 100 → 0 over duration
    let rafId = null;
    let startAt = 0;
    let dismissed = false;

    function tick(now) {
      if (dismissed) return;
      const elapsed = now - startAt;
      const pct = Math.max(0, 100 - (elapsed / props.duration) * 100);
      progress.value = pct;
      if (elapsed >= props.duration) {
        dismissed = true;
        emit('dismiss');
        return;
      }
      rafId = requestAnimationFrame(tick);
    }

    function onUndo() {
      if (dismissed) return;
      dismissed = true;
      cancelAnimationFrame(rafId);
      emit('undo');
      // Give the parent a tick to handle the restore; then clear the toast.
      setTimeout(() => emit('dismiss'), 0);
    }

    onMounted(() => {
      startAt = performance.now();
      rafId = requestAnimationFrame(tick);
    });

    onBeforeUnmount(() => {
      if (rafId) cancelAnimationFrame(rafId);
    });

    // Reset timer if props change (e.g. message swapped for a new deletion).
    watch(() => [props.message, props.duration], () => {
      dismissed = false;
      progress.value = 100;
      startAt = performance.now();
    });

    return { progress, onUndo };
  },
  template: `
    <div class="undo-toast" role="status" aria-live="polite">
      <div class="undo-toast-inner">
        <div class="undo-toast-msg">{{ message }}</div>
        <button class="undo-toast-action" @click="onUndo">{{ actionLabel }}</button>
      </div>
      <div class="undo-toast-progress">
        <div class="undo-toast-progress-fill" :style="{ width: progress + '%' }"></div>
      </div>
    </div>
  `
};
