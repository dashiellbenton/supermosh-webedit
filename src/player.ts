/**
 * Live datamosh preview. Because every frame depends on all the previous ones,
 * showing frame N means decoding 0..N. Moving forward is incremental, moving
 * backward (or editing before the current frame) restarts from the key-frame.
 */
export class MoshPlayer {
  private canvas: HTMLCanvasElement | null = null;
  private chunks: EncodedVideoChunk[] = [];
  private config: VideoDecoderConfig | null = null;
  private decoder: VideoDecoder | null = null;
  private outputs = { count: 0 };
  private pos = -1;
  private shown = -1;
  private target = -1;
  private busy = false;
  private needsReset = true;
  private version = 0;
  private drawTarget = -1;
  private drawn = false;
  private wake: (() => void) | null = null;

  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.shown = -1;
  }

  setSource(chunks: EncodedVideoChunk[], config: VideoDecoderConfig | null) {
    let common = 0;
    const max = Math.min(chunks.length, this.chunks.length);
    while (common < max && chunks[common] === this.chunks[common]) common++;
    if (config !== this.config || this.pos >= common || this.busy) {
      this.needsReset = true;
    }
    if (this.needsReset || this.shown >= common) this.shown = -1;
    this.version++;
    this.chunks = chunks;
    this.config = config;
    if (chunks.length === 0) this.clear();
  }

  seek(index: number) {
    this.target = index;
    if (!this.busy) void this.run();
  }

  destroy() {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
  }

  private clear() {
    const canvas = this.canvas;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  private async run() {
    this.busy = true;
    try {
      for (;;) {
        const t = this.target;
        if (t < 0 || t >= this.chunks.length || !this.config) break;
        if (this.shown !== t) await this.decodeTo(t);
        if (this.target === t && this.shown === t) break;
      }
    } catch (e) {
      console.error(e);
      this.needsReset = true;
    } finally {
      this.busy = false;
    }
  }

  private reset(config: VideoDecoderConfig) {
    this.destroy();
    const outputs = { count: 0 };
    this.outputs = outputs;
    const decoder = new VideoDecoder({
      error: (e) => {
        console.error(e);
        this.needsReset = true;
        this.wake?.();
      },
      output: (frame) => {
        const idx = outputs.count++;
        if (outputs === this.outputs) {
          if (idx === this.drawTarget) {
            const canvas = this.canvas;
            canvas
              ?.getContext("2d")
              ?.drawImage(frame, 0, 0, canvas.width, canvas.height);
            this.drawn = true;
          }
          if (idx >= this.drawTarget) this.wake?.();
        }
        frame.close();
      },
    });
    decoder.configure(config);
    this.decoder = decoder;
    this.pos = -1;
    this.shown = -1;
    this.needsReset = false;
  }

  private async decodeTo(t: number) {
    const { version, chunks } = this;
    const config = this.config!;
    if (
      this.needsReset ||
      !this.decoder ||
      this.decoder.state === "closed" ||
      t <= this.pos
    ) {
      this.reset(config);
    }
    const decoder = this.decoder!;
    this.drawTarget = t;
    this.drawn = false;
    let signal: () => void = () => {};
    const woken = new Promise<void>((resolve) => (signal = resolve));
    this.wake = signal;
    for (let k = this.pos + 1; k <= t; k++) decoder.decode(chunks[k]);
    this.pos = t;

    // wait for the target frame; if the decoder goes idle without emitting it
    // (frame reordering / buffering), flush and restart next time
    let idle = 0;
    while (!this.drawn && !this.needsReset) {
      await Promise.race([woken, new Promise((r) => setTimeout(r, 50))]);
      if (this.drawn) break;
      idle = decoder.decodeQueueSize === 0 ? idle + 1 : 0;
      if (idle >= 3) break;
    }
    if (!this.drawn && !this.needsReset) {
      await decoder.flush();
      this.needsReset = true;
    }
    if (this.drawn && version === this.version) this.shown = t;
  }
}
