import { CoordinateMap } from './coordinate-map.js'
export async function read(blob) {
  const inflated = await decompressBlob(blob)
  const buf = await inflated.arrayBuffer()
  const d = new DataView(buf)
  const version = d.getUint32(0, true)
  const numLayers = d.getUint32(4, true)
  let offset = 8
  const layers = []
  for (let i = 0; i < numLayers; i++) {
    const width = d.getUint32(offset, true)
    const height = d.getUint32(offset + 4, true)
    offset += 8
    const data = new CoordinateMap
    const layer = {width, height, data}
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const char = d.getUint32(offset, true)
      offset += 4
      const fr = d.getUint8(offset++, true)
      const fg = d.getUint8(offset++, true)
      const fb = d.getUint8(offset++, true)
      const br = d.getUint8(offset++, true)
      const bg = d.getUint8(offset++, true)
      const bb = d.getUint8(offset++, true)
      if (!(fr === 0 && fg === 0 && fb === 0 && br === 255 && bg === 0 && bb === 255))
        data.set(x, y, {
          char,
          fg: {r: fr/255, g: fg/255, b: fb/255},
          bg: {r: br/255, g: bg/255, b: bb/255},
        })
    }
    layers.push(layer)
  }
  return {version, layers}
}

async function decompressBlob(blob) {
  const ds = new DecompressionStream('gzip');
  const decompressedStream = blob.stream().pipeThrough(ds);
  return await new Response(decompressedStream).blob();
}

function compressArrayBuffer(input) {
  const stream = new Response(input).body
    .pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export function write({version, layers}) {
  const e = new Encoder
  e.appendUint32(version)
  e.appendUint32(layers.length)
  for (const layer of layers) {
    // TODO: allow negative x/y and offset?
    let width = 0, height = 0
    for (const [x, y] of layer.data.keys()) {
      if (x + 1 > width) width = x + 1
      if (y + 1 > height) height = y + 1
    }
    e.appendUint32(width)
    e.appendUint32(height)
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      let { char, fg, bg } = layer.data.get(x, y) ?? {}
      if (char == null) char = 0
      if (fg == null) fg = {r: 0, g: 0, b: 0}
      if (bg == null) bg = {r: 1, g: 0, b: 1}
      e.appendUint32(char)
      e.appendByte((fg.r * 255) | 0)
      e.appendByte((fg.g * 255) | 0)
      e.appendByte((fg.b * 255) | 0)
      e.appendByte((bg.r * 255) | 0)
      e.appendByte((bg.g * 255) | 0)
      e.appendByte((bg.b * 255) | 0)
    }
  }
  return compressArrayBuffer(e.buffer)
}

/**
 * Wrapper around an Uint8Array that allows values to be appended to the buffer,
 * and that automatically grows the buffer when space runs out.
 * Ref https://github.com/automerge/automerge/blob/main/backend/encoding.js
 */
class Encoder {
  constructor() {
    this.buf = new Uint8Array(16)
    this.dataView = new DataView(this.buf.buffer)
    this.offset = 0
  }

  /**
   * Returns the byte array containing the encoded data.
   */
  get buffer() {
    return this.buf.subarray(0, this.offset)
  }

  /**
   * Reallocates the encoder's buffer to be bigger.
   */
  grow(minSize = 0) {
    let newSize = this.buf.byteLength * 4
    while (newSize < minSize) newSize *= 2
    const newBuf = new Uint8Array(newSize)
    newBuf.set(this.buf, 0)
    this.buf = newBuf
    this.dataView = new DataView(this.buf.buffer)
    return this
  }

  reserve(n) {
    if (this.offset + n > this.buf.byteLength) this.grow(this.offset + n)
  }

  /**
   * Appends one byte (0 to 255) to the buffer.
   */
  appendByte(value) {
    this.reserve(1)
    this.buf[this.offset] = value
    this.offset += 1
  }

  appendUint32(value) {
    this.reserve(4)
    this.dataView.setUint32(this.offset, value, true)
    this.offset += 4
  }
}

export function parseREXPalette(txt) {
  const colors = []
  const re = /\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/g
  let m
  while (m = re.exec(txt)) {
    const [, r, g, b] = m
    colors.push({r: +r/255, g: +g/255, b: +b/255})
  }
  return colors
}

export function parseFontConfig(text) {
  const fonts = []
  for (const line of text.split(/\n/).map(l => l.replace(/\/\/.*/, '').trim()).filter(x => x)) {
    const [name, guiFile, guiColumns, guiRows, artFile, artColumns, artRows, unicode, mirror, available] = line.split(/\t+/)
    fonts.push({
      name: name.replace(/^"|"$/g, ""),
      gui: {
        file: guiFile + '.png',
        columns: +guiColumns,
        rows: +guiRows,
      },
      art: {
        file: artFile + '.png',
        columns: +artColumns,
        rows: +artRows,
      },
      unicode,
      mirror,
      available
    })
  }
  return fonts
}
