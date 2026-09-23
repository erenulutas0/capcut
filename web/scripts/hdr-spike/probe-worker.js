/*
 * HDR spike worker: decodes sampled frames with mediabunny (the same library
 * the export worker uses) and records what the browser does with them on its
 * own. Every output is POSTed to the local spike server.
 */
import * as mb from '/mb/mediabunny.mjs';

async function upload(name, data) {
  const response = await fetch(`/upload/${encodeURIComponent(name)}`, { method: 'POST', body: data });
  if (!response.ok) throw new Error(`upload ${name}: ${response.status}`);
}

function describeColorSpace(cs) {
  if (!cs) return null;
  return { primaries: cs.primaries, transfer: cs.transfer, matrix: cs.matrix, fullRange: cs.fullRange };
}

/**
 * The app's runtime check (src/domain/hdr.ts, transpiled by the runner): a
 * synthetic PQ/HLG frame drawn through VideoSample.draw into an sRGB canvas.
 */
async function selfTest(transfer) {
  const hdr = await import('/spike-domain/hdr.mjs');
  const frame = hdr.buildProbeFrame(transfer);
  let videoFrame;
  try {
    videoFrame = new VideoFrame(frame.data, {
      format: 'I420P10',
      codedWidth: frame.width,
      codedHeight: frame.height,
      timestamp: 0,
      colorSpace: { primaries: 'bt2020', transfer, matrix: 'bt2020-ncl', fullRange: false },
    });
  } catch (error) {
    return { transfer, error: `construct: ${error.name}: ${error.message}` };
  }
  const reported = describeColorSpace(videoFrame.colorSpace);
  const sample = new mb.VideoSample(videoFrame);
  // 8-bit canvas: the browser's conversion as is.
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  sample.draw(ctx, 0, 0);
  const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
  const plain = hdr.judgeHdrProbe(hdr.readProbePatches(pixels, frame.width));
  // The app's path: float16 canvas + soft clip (src/adapters/export/hdrCanvas.ts).
  const wide = new OffscreenCanvas(frame.width, frame.height).getContext('2d', { alpha: false, colorType: 'float16' });
  sample.draw(wide, 0, 0);
  sample.close();
  const floats = wide.getImageData(0, 0, frame.width, frame.height, { pixelFormat: 'rgba-float16' }).data;
  const image = new ImageData(frame.width, frame.height);
  hdr.softClipToRgba8(floats, image.data);
  const verdict = hdr.judgeHdrProbe(hdr.readProbePatches(image.data, frame.width));
  return { transfer, colorSpace: reported, ...verdict, plain8bit: { pass: plain.pass, failures: plain.failures, orange600: plain.patches.orange600 } };
}

/**
 * Does an extended-range (float16) canvas receive the HDR frame without the
 * browser's SDR tone mapping, i.e. linear-ish values above 1.0?
 */
async function float16Test(transfer) {
  const hdr = await import('/spike-domain/hdr.mjs');
  const frame = hdr.buildProbeFrame(transfer);
  const videoFrame = new VideoFrame(frame.data, {
    format: 'I420P10',
    codedWidth: frame.width,
    codedHeight: frame.height,
    timestamp: 0,
    colorSpace: { primaries: 'bt2020', transfer, matrix: 'bt2020-ncl', fullRange: false },
  });
  const out = { transfer };
  for (const colorSpace of ['srgb', 'srgb-extended']) {
    try {
      const canvas = new OffscreenCanvas(frame.width, frame.height);
      const ctx = canvas.getContext('2d', colorSpace === 'srgb-extended'
        ? { alpha: false, colorType: 'float16', colorSpace: 'srgb', toneMapping: { mode: 'extended' } }
        : { alpha: false, colorType: 'float16', colorSpace });
      out[`${colorSpace}-attrs`] = ctx.getContextAttributes?.();
      ctx.drawImage(videoFrame, 0, 0);
      const data = ctx.getImageData(0, 0, frame.width, frame.height, { pixelFormat: 'rgba-float16' }).data;
      out[`${colorSpace}-arrayType`] = data.constructor.name;
      const size = hdr.PROBE_PATCH_SIZE;
      const patches = {};
      hdr.PROBE_PATCHES.forEach((patch, index) => {
        const o = ((size / 2) * frame.width + index * size + size / 2) * 4;
        patches[patch.id] = [data[o], data[o + 1], data[o + 2]].map((v) => Number(Number(v).toFixed(4)));
      });
      out[colorSpace] = patches;
    } catch (error) {
      out[colorSpace] = `${error.name}: ${error.message}`;
    }
  }
  // WebGL2: upload into a half-float texture, render it 1:1 into a float
  // framebuffer and read the floats back. Values above 1.0 would mean the
  // browser hands over HDR light instead of its SDR conversion.
  try {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const gl = canvas.getContext('webgl2');
    gl.getExtension('EXT_color_buffer_float');
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, frame.width, frame.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, videoFrame);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const pixels = new Float32Array(frame.width * frame.height * 4);
    gl.readPixels(0, 0, frame.width, frame.height, gl.RGBA, gl.FLOAT, pixels);
    const size = hdr.PROBE_PATCH_SIZE;
    const patches = {};
    hdr.PROBE_PATCHES.forEach((patch, index) => {
      const o = ((size / 2) * frame.width + index * size + size / 2) * 4;
      patches[patch.id] = [pixels[o], pixels[o + 1], pixels[o + 2]].map((v) => Number(v.toFixed(4)));
    });
    out.webgl2HalfFloat = { error: gl.getError(), patches };
  } catch (error) {
    out.webgl2HalfFloat = `${error.name}: ${error.message}`;
  }
  // WebGPU: sample importExternalTexture into an rgba16float target.
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('no adapter');
    const device = await adapter.requestDevice();
    const target = device.createTexture({
      size: [frame.width, frame.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const shader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var ext: texture_external;
        @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
          var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
          return vec4f(p[i], 0, 1);
        }
        @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          return textureLoad(ext, vec2u(pos.xy));
        }`,
    });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    });
    const external = device.importExternalTexture({ source: videoFrame });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: external }] });
    const bytesPerRow = Math.ceil((frame.width * 8) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * frame.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [frame.width, frame.height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const halves = new Float16Array(buffer.getMappedRange().slice(0));
    const size = hdr.PROBE_PATCH_SIZE;
    const patches = {};
    hdr.PROBE_PATCHES.forEach((patch, index) => {
      const o = (size / 2) * (bytesPerRow / 2) + (index * size + size / 2) * 4;
      patches[patch.id] = [halves[o], halves[o + 1], halves[o + 2]].map((v) => Number(Number(v).toFixed(4)));
    });
    out.webgpuExternal = patches;
  } catch (error) {
    out.webgpuExternal = `${error.name}: ${error.message}`;
  }
  videoFrame.close();
  return out;
}

async function run({ file, tag, times, drawWidth, drawHeight, raw, rgbaCopy }) {
  const env = {
    webgl2: (() => { try { return !!new OffscreenCanvas(4, 4).getContext('webgl2'); } catch { return false; } })(),
    webgpu: typeof navigator.gpu !== 'undefined',
    webgpuAdapter: null,
  };
  if (env.webgpu) {
    try { env.webgpuAdapter = !!(await navigator.gpu.requestAdapter()); } catch { env.webgpuAdapter = false; }
  }
  env.selfTest = [];
  for (const transfer of ['pq', 'hlg']) {
    try {
      env.selfTest.push(await selfTest(transfer));
    } catch (error) {
      env.selfTest.push({ transfer, error: `${error.name}: ${error.message}` });
    }
  }

  env.float16 = [];
  for (const transfer of ['pq', 'hlg']) {
    try { env.float16.push(await float16Test(transfer)); } catch (error) { env.float16.push({ transfer, error: String(error) }); }
  }
  if (!file) return { env, frames: [] };
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.UrlSource(`/media/${file}`) });
  const track = await input.getPrimaryVideoTrack();
  const sink = new mb.VideoSampleSink(track);
  const frames = [];
  for (const t of times) {
    const entry = { requested: t };
    try {
      const sample = await sink.getSample(t);
      if (!sample) { entry.error = 'null sample'; frames.push(entry); continue; }
      entry.timestamp = sample.timestamp;
      entry.duration = sample.duration;
      entry.rotation = sample.rotation;
      entry.codedWidth = sample.codedWidth;
      entry.codedHeight = sample.codedHeight;
      const frame = sample.toVideoFrame();
      entry.format = frame.format;
      entry.colorSpace = describeColorSpace(frame.colorSpace);

      // P1: the current export path — VideoSample.draw into an sRGB 2D canvas.
      const canvas = new OffscreenCanvas(drawWidth, drawHeight);
      const ctx = canvas.getContext('2d', { alpha: false });
      sample.draw(ctx, 0, 0, drawWidth, drawHeight);
      await upload(`${tag}-t${t}-p1-draw.png`, await canvas.convertToBlob({ type: 'image/png' }));

      // P6: the same draw into a float16 canvas (overshoot kept), then the
      // app's highlight soft clip (src/domain/hdr.ts softClipToRgba8).
      try {
        const hdr = await import('/spike-domain/hdr.mjs');
        const started = performance.now();
        const wide = new OffscreenCanvas(drawWidth, drawHeight);
        const wctx = wide.getContext('2d', { alpha: false, colorType: 'float16' });
        sample.draw(wctx, 0, 0, drawWidth, drawHeight);
        const floats = wctx.getImageData(0, 0, drawWidth, drawHeight, { pixelFormat: 'rgba-float16' }).data;
        let over = 0;
        let max = 0;
        for (let i = 0; i < floats.length; i += 4) {
          const m = Math.max(floats[i], floats[i + 1], floats[i + 2]);
          if (m > 1) over += 1;
          if (m > max) max = m;
        }
        const image = new ImageData(drawWidth, drawHeight);
        const clipStarted = performance.now();
        hdr.softClipToRgba8(floats, image.data);
        entry.p6 = {
          overshootFraction: over / (floats.length / 4),
          maxEncoded: max,
          drawReadMs: clipStarted - started,
          softClipMs: performance.now() - clipStarted,
        };
        const out = new OffscreenCanvas(drawWidth, drawHeight);
        out.getContext('2d').putImageData(image, 0, 0);
        await upload(`${tag}-t${t}-p6-softclip.png`, await out.convertToBlob({ type: 'image/png' }));
      } catch (error) {
        entry.p6 = `${error.name}: ${error.message}`;
      }

      // P4: the browser's own RGBA conversion, coded orientation.
      if (rgbaCopy) {
        try {
          const options = { format: 'RGBA', colorSpace: 'srgb' };
          const size = frame.allocationSize(options);
          const buffer = new Uint8Array(size);
          await frame.copyTo(buffer, options);
          await upload(`${tag}-t${t}-p4-rgba-${frame.codedWidth}x${frame.codedHeight}.raw`, buffer);
          entry.p4 = 'ok';
        } catch (error) {
          entry.p4 = `${error.name}: ${error.message}`;
        }
      }

      // P5: the decoder's own planes, untouched, for an offline tonemap.
      if (raw) {
        try {
          const size = frame.allocationSize();
          const buffer = new Uint8Array(size);
          const layout = await frame.copyTo(buffer);
          entry.rawLayout = layout;
          await upload(`${tag}-t${t}-p5-${frame.format}-${frame.codedWidth}x${frame.codedHeight}.raw`, buffer);
          entry.p5 = 'ok';
        } catch (error) {
          entry.p5 = `${error.name}: ${error.message}`;
        }
      }
      frame.close();
      sample.close();
    } catch (error) {
      entry.error = `${error.name}: ${error.message}`;
    }
    frames.push(entry);
  }
  return { env, frames };
}

self.onmessage = async (event) => {
  try {
    self.postMessage({ ok: true, ...(await run(event.data)) });
  } catch (error) {
    self.postMessage({ ok: false, error: `${error.name}: ${error.message}` });
  }
};
