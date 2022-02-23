function createShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    return shader
  throw new Error(`failed to compile shader: ${gl.getShaderInfoLog(shader)}`)
}

/**
 * @param {WebGLRenderingContext} gl
 */
export function createProgram(gl, vsource, fsource, shaderAttribs) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsource)
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsource)
  const prog = gl.createProgram()
  for (const {index, name} of shaderAttribs) {
    gl.bindAttribLocation(prog, index, name)
  }
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(`failed to link program: ${gl.getProgramInfoLog(prog)}`)

  const uniforms = new Map
  const numUniforms = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS)

  for (let i = 0; i < numUniforms; i++) {
    const {name} = gl.getActiveUniform(prog, i)
    const id = gl.getUniformLocation(prog, name)
    uniforms.set(name, id)
  }

  const attribs = new Map
  const numAttributes = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES)
  for (let i = 0; i < numAttributes; i++) {
    const {name, size, type} = gl.getActiveAttrib(prog, i)
    const location = gl.getAttribLocation(prog, name)
    attribs.set(name, {name, size, type, location})
  }

  return new ShaderProgram(gl, prog, uniforms, attribs, shaderAttribs)
}

class ShaderProgram {
  constructor(gl, program, uniforms, attribs, shaderAttribs) {
    this.gl = gl
    this.program = program
    this.uniforms = uniforms
    this.attribs = attribs
    this.shaderAttribs = shaderAttribs // TODO redundant with attribs?
  }
  use() { this.gl.useProgram(this.program) }
}


class VertexArray {
  constructor(gl, count, attributes) {
    this.gl = gl
    this.attributes = attributes
    const stride = attributes.map(a => a.size).reduce((m, o) => m + o, 0)
    this.buffer = new Float32Array(count * stride)
    this._bufPos = 0
    this.stride = stride
    this.bufferId = gl.createBuffer()
  }
  put(...xs) {
    //this.buffer.set(xs, this._bufPos)
    //this._bufPos += xs.length
    for (const x of xs)
      this.buffer[this._bufPos++] = x
  }
  flip() { this._bufPos = 0 }
  bind() {
    const {gl} = this
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferId)
    gl.bufferData(gl.ARRAY_BUFFER, this.buffer, gl.STREAM_DRAW)
    let offset = 0
    const sizeOfFloatInBytes = 4
    this.attributes.forEach(({index, size}) => {
      gl.enableVertexAttribArray(index)
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, this.stride * 4, offset * sizeOfFloatInBytes)
      offset += size
    })
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }
  draw(geom, first, count) {
    this.gl.drawArrays(geom, first, count)
  }
  unbind() {
    this.attributes.forEach(a => this.gl.disableVertexAttribArray(a.index))
  }
}

export class ImageTextureSource {
  constructor(image) {
    this.image = image
  }

  get width() { return this.image.width }
  get height() { return this.image.height }

  upload(gl) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image)
    this.image = null // release
  }
}

export class Texture {
  constructor(gl, textureSource) {
    this.gl = gl
    this.width = textureSource.width
    this.height = textureSource.height
    this.textureSource = textureSource
    this.id = this.upload()
  }

  upload() {
    const {gl} = this
    const id = gl.createTexture()
    const previouslyBound = gl.getParameter(gl.TEXTURE_BINDING_2D)
    gl.bindTexture(gl.TEXTURE_2D, id)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.textureSource.upload(gl)
    gl.bindTexture(gl.TEXTURE_2D, previouslyBound)
    return id
  }

  bind() { this.gl.bindTexture(this.gl.TEXTURE_2D, this.id) }

  dispose() { this.gl.deleteTextures(this.id) }
}

export class SpriteBatch {
  maxIndex = 1000 * 6
  drawing = false
  idx = 0
  texture = null
  constructor(gl, program) {
    this.gl = gl
    this.program = program
    this.shaderAttribs = program.shaderAttribs
    this.data = new VertexArray(gl, this.maxIndex, this.shaderAttribs)
  }

  resize(width, height) {
    const {gl} = this
    this.program.use()
    const left = 0
    const right = width
    const top = 0
    const bottom = height
    const zFar = -1
    const zNear = 1
    const tx = -(right + left) / (right - left)
    const ty = -(top + bottom) / (top - bottom)
    const tz = -(zFar + zNear) / (zFar - zNear)
    const projMat = [
      2 / (right - left), 0, 0, 0,
      0, 2 / (top - bottom), 0, 0,
      0, 0, -2 / (zFar - zNear), 0,
      tx, ty, tz, 1
    ]
    gl.uniformMatrix4fv(this.program.uniforms.get("u_projView"), false, projMat)
    gl.uniform1i(this.program.uniforms.get("u_texture"), 0)
  }

  drawRegion(
    tex,
    srcX,
    srcY,
    srcWidth,
    srcHeight,
    dstX,
    dstY,
    dstWidth,
    dstHeight,
    color,
  ) {
    const u = srcX / tex.width
    const v = srcY / tex.height
    const u2 = (srcX + srcWidth) / tex.width
    const v2 = (srcY + srcHeight) / tex.height
    this.draw(tex, dstX, dstY, dstWidth, dstHeight, u, v, u2, v2, color)
  }

  draw(
    tex,
    x,
    y,
    width,
    height,
    u,
    v,
    u2,
    v2,
    color,
  ) {
    this.checkFlush(tex)

    const x1 = x
    const y1 = y

    const x2 = x + width
    const y2 = y

    const x3 = x + width
    const y3 = y + height

    const x4 = x
    const y4 = y + height

    const {r, g, b, a = 1} = color

    this.vertex(x1, y1, r, g, b, a, u, v)
    this.vertex(x2, y2, r, g, b, a, u2, v)
    this.vertex(x4, y4, r, g, b, a, u, v2)

    this.vertex(x2, y2, r, g, b, a, u2, v)
    this.vertex(x3, y3, r, g, b, a, u2, v2)
    this.vertex(x4, y4, r, g, b, a, u, v2)
  }

  vertex(x, y, r, g, b, a, u, v) {
    this.data.put(x, y, r, g, b, a, u, v)
    this.idx += 1
  }

  begin() {
    if (this.drawing) throw new Error("Already drawing!")
    this.drawing = true
    this.program.use()
    this.idx = 0
    this.texture = null
  }

  end() {
    if (!this.drawing) throw new Error("Not drawing!")
    this.drawing = false
    this.flush()
  }

  checkFlush(tex) {
    if (!(this.texture === tex) || this.idx >= this.maxIndex) {
      this.flush()
      this.texture = tex
    }
  }

  flush() {
    if (this.idx > 0) {
      this.data.flip()
      this.render()
      this.idx = 0
      //this.data.buffer.clear()
    }
  }

  render() {
    if (this.texture != null)
      this.texture.bind()
    this.data.bind()
    this.data.draw(this.gl.TRIANGLES, 0, this.idx)
    this.data.unbind()
  }
}
