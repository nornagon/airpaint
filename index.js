import { SpriteBatch, Texture, ImageTextureSource, createProgram } from './gl.js'
import { apcaContrast } from './contrast.js'
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

const WHITE = {r: 1, g: 1, b: 1}
const BLACK = {r: 0, g: 0, b: 0}
const palette = parseREXPalette(await fetch('Palette.txt').then(x => x.text()))

function parseREXPalette(txt) {
  const colors = []
  const re = /\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/g
  let m
  while (m = re.exec(txt)) {
    const [, r, g, b] = m
    colors.push({r: +r/255, g: +g/255, b: +b/255})
  }
  return colors
}

const BoxDrawing = {
  // The CP437 box drawing characters are arranged in this ridiculous way because on the original IBM PC MDA adapter,
  // characters were 8x8 but the display put a pixel of space between them. So David J. Bradley, Andy Saenz and Lew
  // Eggebrecht, in their infinite wisdom, decided to hardcode, _into the graphics card_, that when displaying
  // characters in the range 0xC0-0xDF, the rightmost column of pixels would be duplicated into the 9th column on the
  // screen, to avoid a gap in the line.
  LURD: 0xc0 + 5,
  LUR_: 0xc0 + 1,
  LU_D: 0xb0 + 4,
  L_RD: 0xc0 + 2,
  _URD: 0xc0 + 3,
  __RD: 0xd0 + 10,
  _UR_: 0xc0 + 0,
  LU__: 0xd0 + 9,
  L__D: 0xb0 + 15,
  L_R_: 0xc0 + 4,
  _U_D: 0xb0 + 3,
}


const App = {
  map: new Map,
  mouse: null,
  get tmouse() {
    return this.mouse ? { x: (this.mouse.x / tileset.tileWidth)|0, y: (this.mouse.y / tileset.tileHeight)|0 } : null;
  },
  mouseButtons: 0,
  paint: {
    char: 1,
    fg: 191,
    bg: 184,
  },
  skin: {
    borders: {r: 0, g: 0, b: 0},
    background: {r: 13/255, g: 24/255, b: 33/255},
    glyphs: {
      selected: {r: 246/255,g: 234/255,b: 189/255},
      aligned: {r: 59/255,g: 55/255,b: 42/255},
      other: {r: 84/255,g: 79/255,b: 61/255}
    }
  },
  ui: [
    // -- Font --
    {
      x: 0, y: 1,
      draw(ctx) {
        [...'Font'].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), 2+i, 0, WHITE)
        })
        const borderFg = App.skin.borders
        const borderBg = App.skin.background
        const height = 16
        const width = 16
        ctx.drawChar(BoxDrawing.__RD, 0, 0, borderFg, borderBg)
        for (let i = 0; i < height; i++) {
          ctx.drawChar(BoxDrawing._U_D, 0, 1+i, borderFg, borderBg)
          ctx.drawChar(BoxDrawing._U_D, width + 1, 1+i, borderFg, borderBg)
        }
        ctx.drawChar(BoxDrawing._UR_, 0, height + 1, borderFg, borderBg)
        for (let i = 0; i < width; i++)
          ctx.drawChar(BoxDrawing.L_R_, 1+i, height + 1, borderFg, borderBg)
        ctx.drawChar(BoxDrawing.LU__, width + 1, height + 1, borderFg, borderBg)
        ctx.drawChar(BoxDrawing.L__D, width + 1, 0, borderFg, borderBg)
        ctx.drawChar(BoxDrawing.LU_D, 1, 0, borderFg, borderBg)
        ctx.drawChar(BoxDrawing._URD, 1 + 'Font'.length + 1, 0, borderFg, borderBg)
        for (let i = 1 + 'Font'.length + 1 + 1; i < width + 1; i++)
          ctx.drawChar(BoxDrawing.L_R_, i, 0, borderFg, borderBg)
      }
    },
    {
      x: 1, y: 2,
      width: 16, height: 16,
      draw(ctx) {
        const selectedX = App.paint.char % 16
        const selectedY = (App.paint.char / 16)|0
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const color =
            (x === selectedX && y === selectedY) || (this.tmouse?.x === x && this.tmouse?.y === y)
            ? App.skin.glyphs.selected
            : x === selectedX || y === selectedY
            ? App.skin.glyphs.aligned
            : App.skin.glyphs.other
          ctx.drawChar(y*16+x, x, y, color, App.skin.background)
        }
      },
      mousedown(x, y, button) {
        if (button === 0) {
          App.paint.char = y * 16 + x
        }
      }
    },

    // -- Palette --
    {
      x: 0,
      y: 19,
      draw(ctx) {
        [...'Palette'].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), 2+i, 0, WHITE)
        })
        const borderFg = App.skin.borders
        const borderBg = App.skin.background
        const height = 12
        const width = 16
        ctx.drawChar(BoxDrawing.__RD, 0, 0, borderFg, borderBg)
        for (let i = 0; i < height; i++) {
          ctx.drawChar(BoxDrawing._U_D, 0, 1+i, borderFg, borderBg)
          ctx.drawChar(BoxDrawing._U_D, width + 1, 1+i, borderFg, borderBg)
        }
        ctx.drawChar(BoxDrawing._UR_, 0, height + 1, borderFg, borderBg)
        for (let i = 0; i < width; i++)
          ctx.drawChar(BoxDrawing.L_R_, 1+i, height + 1, borderFg, borderBg)
        ctx.drawChar(BoxDrawing.LU__, width + 1, height + 1, borderFg, borderBg)
        ctx.drawChar(BoxDrawing.L__D, width + 1, 0, borderFg, borderBg)
        ctx.drawChar(BoxDrawing.LU_D, 1, 0, borderFg, borderBg)
        ctx.drawChar(BoxDrawing._URD, 1 + 'Palette'.length + 1, 0, borderFg, borderBg)
        for (let i = 1 + 'Palette'.length + 1 + 1; i < width + 1; i++)
          ctx.drawChar(BoxDrawing.L_R_, i, 0, borderFg, borderBg)
      }
    },
    {
      x: 1,
      y: 20,
      width: 16,
      height: 16,
      draw(ctx) {
        for (let y = 0; y < (palette.length / 16)|0; y++) for (let x = 0; x < 16; x++) {
          const i = y * 16 + x
          const color = palette[i]
          ctx.drawChar(0, x, y, null, color)
          if (i === App.paint.fg) {
            const cw = Math.abs(apcaContrast(WHITE, color))
            const cb = Math.abs(apcaContrast(BLACK, color))
            const wb = cb > cw ? BLACK : WHITE
            ctx.drawChar('f'.charCodeAt(0), x, y, wb)
          } else if (i === App.paint.bg) {
            const cw = Math.abs(apcaContrast(WHITE, color))
            const cb = Math.abs(apcaContrast(BLACK, color))
            const wb = cb > cw ? BLACK : WHITE
            ctx.drawChar('b'.charCodeAt(0), x, y, wb)
          }
        }
      },
      mousedown(x, y, button) {
        if (button === 0) {
          App.paint.fg = y * 16 + x
        } else if (button === 2) {
          App.paint.bg = y * 16 + x
        }
      },
      mousemove(x, y, buttons) {
        if (buttons & 1) {
          App.paint.fg = y * 16 + x
        }
        if (buttons & 2) {
          App.paint.bg = y * 16 + x
        }
      },
    },

    // -- Canvas --
    {
      x: 18,
      y: 0,
      width: Infinity,
      height: Infinity,
      draw(ctx) {
        for (const [k, v] of App.map.entries()) {
          const [x, y] = k.split(',')
          const { char, fg, bg } = v
          ctx.drawChar(char, +x, +y, palette[fg], palette[bg])
        }
        if (this.tmouse)
          ctx.drawChar(App.paint.char, this.tmouse.x, this.tmouse.y, palette[App.paint.fg], palette[App.paint.bg])
      },
      mousedown(x, y, button) {
        if (button === 0) {
          App.map.set(`${x},${y}`, { ...App.paint })
        }
      },
      mousemove(x, y, buttons) {
        if (buttons & 1) {
          App.map.set(`${x},${y}`, { ...App.paint })
        }
      },
    },
  ],
  init() {
    for (const el of this.ui)
      Object.setPrototypeOf(el, {
        get tmouse() {
          const atm = App.tmouse
          if (!atm || atm.x < this.x || atm.y < this.y || atm.x > this.x + this.width || atm.y > this.y + this.height)
            return null
          return {x: atm.x - this.x, y: atm.y - this.y}
        },
      })
  },
  draw(drawChar) {
    this.ui.forEach((el) => {
      if (el.draw) {
        el.draw({
          drawChar(c, x, y, fg, bg) {
            drawChar(c, x + el.x, y + el.y, fg, bg)
          }
        })
      }
    });
  },
  mousemove() {
    const { x, y } = this.tmouse
    for (const el of this.ui) {
      if (x >= el.x && x < el.x + el.width && y >= el.y && y < el.y + el.height)
        if (el.mousemove)
          el.mousemove(x - el.x, y - el.y, this.mouseButtons)
    }
  },
  mousedown(button) {
    const { x, y } = this.tmouse
    for (const el of this.ui) {
      if (x >= el.x && x < el.x + el.width && y >= el.y && y < el.y + el.height)
        if (el.mousedown)
          el.mousedown(x - el.x, y - el.y, button)
    }
  }
}

function start() {
  App.init()
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

    function drawChar(c, dx, dy, fg, bg) {
      const tw = tileset.tileWidth, th = tileset.tileHeight
      const sx = c % 16
      const sy = (c / 16) | 0
      if (bg != null) {
        const bgsx = 0xdb % 16
        const bgsy = (0xdb / 16) | 0
        // TODO: not all fonts might have 0xdb be the full square? maybe have
        // to fix this one at some point.
        spriteBatch.drawRegion(tex, bgsx * tw, bgsy * th, tw, th, dx, dy, tw, th, bg)
      }
      if (fg != null)
        spriteBatch.drawRegion(tex, sx * tw, sy * th, tw, th, dx, dy, tw, th, fg)
    }

    console.time('draw')
    spriteBatch.begin()
    App.draw((c, tx, ty, fg, bg) => {
      drawChar(c, tx * tileset.tileWidth, ty * tileset.tileHeight, fg, bg)
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
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('blur', () => {
    App.mouseButtons = 0
    App.mouse = null
    dirty()
  })
}

start()
