import { SpriteBatch, Texture, ImageTextureSource, createProgram } from './gl.js'
const tileset = {
  image: 'fonts/cp437_8x8.png',
  tileWidth: 8,
  tileHeight: 8,
}

const font = new Image
font.src = tileset.image
await new Promise(resolve => {
  font.onload = resolve
})

const palette = parseREXPalette(await fetch('Palette.txt').then(x => x.text()))

function parseREXPalette(txt) {
  const colors = []
  const re = /\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/g
  let m
  while (m = re.exec(txt)) {
    const [, r, g, b] = m
    colors.push({r: +r/255, g: +g/255, b: +b/255, a: 1})
  }
  return colors
}

const sidebarWidth = 18
const App = {
  map: new Map,
  mouse: null,
  get tmouse() {
    return this.mouse ? { x: (this.mouse.x / tileset.tileWidth)|0, y: (this.mouse.y / tileset.tileHeight)|0 } : null;
  },
  mouseButtons: 0,
  paint: {
    char: 1
  },
  draw(drawChar) {
    // draw sidebar

    // -- Font --
    [...'Font'].forEach((c, i) => {
      drawChar(c.charCodeAt(0), 2+i, 1)
    })
    const selectedX = this.paint.char % 16
    const selectedY = (this.paint.char / 16)|0
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const color =
        x === selectedX && y === selectedY
        ? {r:1,g:1,b:1,a:1}
        : x === selectedX || y === selectedY
        ? {r:1,g:1,b:1,a:0.5}
        : {r:1,g:1,b:1,a:0.2}
      drawChar(y*16+x, x + 1, y + 2, color)
    }

    // -- Palette --
    [...'Palette'].forEach((c, i) => {
      drawChar(c.charCodeAt(0), 2+i, 19)
    })
    for (let y = 0; y < (palette.length / 16)|0; y++) for (let x = 0; x < 16; x++) {
      const color = palette[y * 16 + x]
      drawChar(0xdb, x + 1, y + 20, color)
    }


    // draw image
    for (const [k, v] of this.map.entries()) {
      const [x, y] = k.split(',')
      drawChar(v, +x + sidebarWidth, +y)
    }
    //for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) drawChar(0x1, x, y)
    if (this.mouse && this.tmouse.x >= sidebarWidth) {
      drawChar(this.paint.char, this.tmouse.x, this.tmouse.y)
    }
  },
  mousemove() {
    if (this.mouseButtons & 1) {
      const { x, y } = this.tmouse
      const tx = x - sidebarWidth
      const ty = y
      if (tx >= 0 && ty >= 0) {
        this.map.set(`${tx},${ty}`, this.paint.char)
      }
    }
  },
  mousedown(button) {
    if (button === 0) {
      const mtx = (this.mouse.x/tileset.tileWidth)|0
      const mty = (this.mouse.y/tileset.tileHeight)|0
      if (mtx >= 1 && mtx <= 16 && mty >= 2 && mty <= 17) {
        this.paint.char = (mty - 2) * 16 + mtx - 1
      } else if (mtx >= sidebarWidth) {
        this.map.set(`${mtx - sidebarWidth},${mty}`, this.paint.char)
      }
    }
  }
}

function start() {
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  document.body.appendChild(canvas)
  const gl = canvas.getContext('webgl')
  const tex = new Texture(gl, new ImageTextureSource(font))
  const prog = createProgram(gl,
    `
      #version 100
      precision lowp float;
      uniform mat4 u_projView;
      attribute vec4 Color;
      attribute vec2 Position;
      attribute vec2 TexCoord;
      varying vec4 vColor;
      varying vec2 vTexCoord;
      void main() {
        vColor = Color;
        vTexCoord = TexCoord;
        gl_Position = u_projView * vec4(Position.xy, 0.0, 1.0);
      }
    `,
    `
      #version 100
      precision lowp float;
      uniform sampler2D u_texture;
      varying vec4 vColor;
      varying vec2 vTexCoord;
      void main() {
        vec4 texColor = texture2D(u_texture, vTexCoord);
        if (texColor == vec4(0., 0., 0., 1.)) texColor.a = 0.;
        gl_FragColor = vColor * texColor;
      }
    `,
    [
      {index: 0, name: "Position", size: 2},
      {index: 1, name: "Color", size: 4},
      {index: 2, name: "TexCoord", size: 2}
    ]
  )
  const spriteBatch = new SpriteBatch(gl, prog)

  new ResizeObserver(entries => {
    const ratio = devicePixelRatio
    canvas.width = entries[0].contentRect.width * ratio
    canvas.height = entries[0].contentRect.height * ratio
    dirty()
  }).observe(canvas)

  let isDirty = false
  function dirty() {
    if (!isDirty) requestAnimationFrame(() => {
      try {
        draw()
      } finally {
        isDirty = false
      }
    })
    isDirty = true
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height)
    spriteBatch.resize(canvas.width, canvas.height)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    const WHITE = {r: 1, g: 1, b: 1, a: 1}
    function drawChar(c, dx, dy, color = WHITE) {
      const tw = tileset.tileWidth, th = tileset.tileHeight
      const sx = c % 16
      const sy = (c / 16) | 0
      spriteBatch.drawRegion(tex, sx * tw, sy * th, tw, th, dx, dy, tw, th, color)
    }

    console.time('draw')
    spriteBatch.begin()
    App.draw((c, tx, ty, color = WHITE) => {
      drawChar(c, tx * tileset.tileWidth, ty * tileset.tileHeight, color)
    })
    spriteBatch.end()
    console.timeEnd('draw')
  }

  canvas.addEventListener('mousemove', (e) => {
    if (document.hasFocus()) {
      App.mouse = { x: e.clientX, y: e.clientY }
      App.mousemove()
      dirty()
    }
  })

  canvas.addEventListener('mousedown', (e) => {
    App.mouse = { x: e.clientX, y: e.clientY }
    App.mouseButtons = e.buttons
    App.mousedown(e.button)
    dirty()
  })
  canvas.addEventListener('mouseup', (e) => {
    App.mouseButtons = e.buttons
    dirty()
  })
  window.addEventListener('blur', () => {
    App.mouseButtons = 0
    App.mouse = null
    dirty()
  })
}

start()
