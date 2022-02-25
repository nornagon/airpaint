import { SpriteBatch, Texture, ImageTextureSource, createProgram } from './gl.js'
import { apcaContrast } from './contrast.js'
import { bresenhamLine, ellipse, filledEllipse } from './bresenham.js'
import { BoxDrawing, boxDrawingChar, boxDrawingDoubleChar, isSingleBoxDrawingChar, isDoubleBoxDrawingChar } from './cp437.js'
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


function button({title, active, click, ...rest}) {
  return {
    height: 1,
    draw(ctx) {
      const fg = active ? active() ? App.skin.buttons.active : App.skin.buttons.inactive : App.skin.buttons.usable;
      const bg = this.tmouse ? App.skin.buttons.highlight : null;
      [...title()].forEach((c, i) => {
        ctx.drawChar(c.charCodeAt(0), i, 0, fg, bg)
      })
    },
    mousedown(_x, _y, button) {
      if (button === 0) click()
    },
    ...rest
  }
}

function textToolOverlay({x, y}) {
  // TODO: hidden textarea...?
  return {
    x,
    y,
    height: 1,
    text: '',
    offset() {
      return App.ui.find(e => e.name === 'canvas').x
    },
    draw(ctx) {
      const offset = this.offset()
      for (let i = 0; i < this.text.length; i++) {
        const { char = 0x20, fg, bg } = this.applied(this.x + i - offset, this.y, this.text.charCodeAt(i))
        ctx.drawChar(char, i, 0, fg != null ? palette[fg] : null, bg != null ? palette[bg] : null)
      }
      ctx.drawChar('_'.charCodeAt(0), this.text.length, 0, WHITE, BLACK)
    },
    captureKeys: true,
    exit() { App.ui.splice(App.ui.lastIndexOf(this), 1) },
    keydown(code) {
      if (code === 'Escape') this.exit()
      if (code === 'Backspace') this.text = this.text.substring(0, this.text.length - 1)
    },
    keypress(key) {
      if (key === 'Enter') {
        const offset = this.offset()
        App.beginChange()
        for (let i = 0; i < this.text.length; i++) {
          App.map.set(`${this.x+i - offset},${this.y}`, this.applied(this.x + i - offset, this.y, this.text.charCodeAt(i)))
        }
        App.finishChange()
        this.exit()
      }
      this.text += key
    },
    applied(x, y, c) {
      const paint = { ...(App.map.get(`${x},${y}`) ?? {}) }
      if (App.apply.glyph) paint.char = c
      if (App.apply.fg) paint.fg = App.paint.fg
      if (App.apply.bg) paint.bg = App.paint.bg
      return paint
    },
  }
}


const DefaultForeground = 191
const DefaultBackground = 184
const App = {
  map: new Map,
  undoStack: [],
  redoStack: [],
  beginChange() {
    if (this.changing) return
    this.changing = true
    this.undoStack.push(new Map(this.map))
    this.redoStack = []
  },
  finishChange() {
    if (!this.changing) return
    this.changing = false
  },
  undo() {
    if (this.changing || !this.undoStack.length) return
    this.redoStack.push(this.map)
    this.map = this.undoStack.pop()
  },
  redo() {
    if (this.changing || !this.redoStack.length) return
    this.undoStack.push(this.map)
    this.map = this.redoStack.pop()
  },
  mouse: null,
  get tmouse() {
    return this.mouse ? { x: (this.mouse.x / tileset.tileWidth)|0, y: (this.mouse.y / tileset.tileHeight)|0 } : null;
  },
  mouseButtons: 0,
  paint: {
    char: 1,
    fg: DefaultForeground,
    bg: DefaultBackground,
  },
  apply: {
    glyph: true,
    fg: true,
    bg: true,
  },
  tool: 'cell',
  toolOptions: {
    fillRect: false,
    fillOval: false,
    joinCells: false,
    copyMode: 'copy',
  },
  selectTool(tool) {
    if (tool === 'cell' && this.tool === 'cell') this.toolOptions.joinCells = !this.toolOptions.joinCells
    if (tool === 'rect' && this.tool === 'rect') this.toolOptions.fillRect = !this.toolOptions.fillRect
    if (tool === 'oval' && this.tool === 'oval') this.toolOptions.fillOval = !this.toolOptions.fillOval
    if (tool === 'copy' && this.tool === 'copy') this.toolOptions.copyMode = this.toolOptions.copyMode === 'copy' ? 'cut' : 'copy'
    this.tool = tool
  },
  skin: {
    borders: {r: 0, g: 0, b: 0},
    background: {r: 13/255, g: 24/255, b: 33/255},
    glyphs: {
      selected: {r: 246/255,g: 234/255,b: 189/255},
      aligned: {r: 59/255,g: 55/255,b: 42/255},
      other: {r: 84/255,g: 79/255,b: 61/255},
    },
    buttons: {
      usable: {r: 118/255,g: 126/255,b: 167/255},
      active: {r: 184/255,g: 175/255,b: 140/255},
      inactive: {r: 84/255,g: 79/255,b: 61/255},
      highlight: {r: 24/255,g: 38/255,b: 54/255},
    },
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
      height: 12,
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
        this.mouseWentDownInPalette = true
        if (button === 0) {
          App.paint.fg = y * 16 + x
        } else if (button === 2) {
          App.paint.bg = y * 16 + x
        }
      },
      mousemove(x, y, buttons) {
        if (!this.mouseWentDownInPalette) return
        if (buttons & 1) {
          App.paint.fg = y * 16 + x
        }
        if (buttons & 2) {
          App.paint.bg = y * 16 + x
        }
      },
      mouseup() {
        this.mouseWentDownInPalette = false
      }
    },

    // -- Tools --
    {
      x: 0,
      y: 33,
      draw(ctx) {
        const title = 'Tools';
        [...title].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), 2+i, 0, WHITE)
        })
        const borderFg = App.skin.borders
        const borderBg = App.skin.background
        const height = 6
        const width = 7
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
        ctx.drawChar(BoxDrawing._URD, 1 + title.length + 1, 0, borderFg, borderBg)
        for (let i = 1 + title.length + 1 + 1; i < width + 1; i++)
          ctx.drawChar(BoxDrawing.L_R_, i, 0, borderFg, borderBg)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
          ctx.drawChar(0, 1+x, 1+y, null, App.skin.background)
      },
    },
    button({
      x: 1,
      y: 34,
      width: 7,
      title() { return ' Undo  ' },
      click() { App.undo() },
      keydown(code, mods) {
        if (mods && code === 'KeyZ') App.undo()
      },
    }),
    button({
      x: 1,
      y: 35,
      width: 7,
      title() { return ' Redo  ' },
      click() { App.redo() },
      keydown(code, mods) {
        if (mods && code === 'KeyY') App.redo()
      },
    }),

    // -- Image --
    {
      x: 0,
      y: 41,
      draw(ctx) {
        const title = 'Image';
        [...title].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), 2+i, 0, WHITE)
        })
        const borderFg = App.skin.borders
        const borderBg = App.skin.background
        const height = 6
        const width = 7
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
        ctx.drawChar(BoxDrawing._URD, 1 + title.length + 1, 0, borderFg, borderBg)
        for (let i = 1 + title.length + 1 + 1; i < width + 1; i++)
          ctx.drawChar(BoxDrawing.L_R_, i, 0, borderFg, borderBg)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
          ctx.drawChar(0, 1+x, 1+y, null, App.skin.background)
      },
    },
    button({
      x: 1,
      y: 42,
      width: 7,
      title() { return ' New   ' },
      click() { },
    }),
    button({
      x: 1,
      y: 43,
      width: 7,
      title() { return ' Save  ' },
      click() { },
    }),
    button({
      x: 1,
      y: 44,
      width: 7,
      title() { return ' Export' },
      click() { },
    }),

    // -- Apply --
    {
      x: 9,
      y: 33,
      draw(ctx) {
        [...'Apply'].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), 2+i, 0, WHITE)
        })
        const borderFg = App.skin.borders
        const borderBg = App.skin.background
        const height = 4
        const width = 7
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
        ctx.drawChar(BoxDrawing._URD, 1 + 'Apply'.length + 1, 0, borderFg, borderBg)
        for (let i = 1 + 'Apply'.length + 1 + 1; i < width + 1; i++)
          ctx.drawChar(BoxDrawing.L_R_, i, 0, borderFg, borderBg)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
          ctx.drawChar(0, 1+x, 1+y, null, App.skin.background)
      },
    },
    {
      x: 10,
      y: 34,
      width: 7,
      height: 1,
      draw(ctx) {
        const fg = App.apply.glyph ? App.skin.buttons.active : App.skin.buttons.inactive;
        const bg = this.tmouse ? App.skin.buttons.highlight : null;
        [...' Glyph '].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), i, 0, fg, bg)
        })
        ctx.drawChar(App.paint.char, 6, 0, WHITE)
      },
      mousedown(_x, _y, button) {
        if (button === 0) {
          App.apply.glyph = !App.apply.glyph
        }
      },
    },
    {
      x: 10,
      y: 35,
      width: 7,
      height: 1,
      draw(ctx) {
        const fg = App.apply.fg ? App.skin.buttons.active : App.skin.buttons.inactive;
        const bg = this.tmouse ? App.skin.buttons.highlight : null;
        [...' Fore  '].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), i, 0, fg, bg)
        })
        ctx.drawChar(0, 6, 0, null, palette[App.paint.fg])
      },
      mousedown(_x, _y, button) {
        if (button === 0) {
          App.apply.fg = !App.apply.fg
        }
      },
    },
    {
      x: 10,
      y: 36,
      width: 7,
      height: 1,
      draw(ctx) {
        const fg = App.apply.bg ? App.skin.buttons.active : App.skin.buttons.inactive;
        const bg = this.tmouse ? App.skin.buttons.highlight : null;
        [...' Back  '].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), i, 0, fg, bg)
        })
        ctx.drawChar(0, 6, 0, null, palette[App.paint.bg])
      },
      mousedown(_x, _y, button) {
        if (button === 0) {
          App.apply.bg = !App.apply.bg
        }
      },
    },

    // -- Draw --
    {
      x: 9,
      y: 39,
      draw(ctx) {
        const title = 'Draw';
        [...title].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), 2+i, 0, WHITE)
        })
        const borderFg = App.skin.borders
        const borderBg = App.skin.background
        const height = 8
        const width = 7
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
        ctx.drawChar(BoxDrawing._URD, 1 + title.length + 1, 0, borderFg, borderBg)
        for (let i = 1 + title.length + 1 + 1; i < width + 1; i++)
          ctx.drawChar(BoxDrawing.L_R_, i, 0, borderFg, borderBg)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
          ctx.drawChar(0, 1+x, 1+y, null, App.skin.background)
      },
    },
    button({
      x: 10,
      y: 40,
      width: 7,
      title: () => ` Cell ${App.toolOptions.joinCells ? '\u00c5' : '\u00c4'}`,
      active: () => App.tool === 'cell',
      click: () => App.selectTool('cell'),
      keydown: (code) => code === 'KeyC' && App.selectTool('cell'),
    }),
    button({
      x: 10,
      y: 41,
      width: 7,
      title: () => ' Line  ',
      active: () => App.tool === 'line',
      click: () => App.selectTool('line'),
      keydown: (code) => code === 'KeyL' && App.selectTool('line'),
    }),
    button({
      x: 10,
      y: 42,
      width: 7,
      title: () => ` Rect ${App.toolOptions.fillRect ? '\u00fe' : '\u00ff'}`,
      active: () => App.tool === 'rect',
      click: () => App.selectTool('rect'),
      keydown: (code) => code === 'KeyR' && App.selectTool('rect'),
    }),
    button({
      x: 10,
      y: 43,
      width: 7,
      title: () => ` Oval ${App.toolOptions.fillOval ? '\u00fe' : '\u00ff'}`,
      active: () => App.tool === 'oval',
      click: () => App.selectTool('oval'),
      keydown: (code) => code === 'KeyO' && App.selectTool('oval'),
    }),
    button({
      x: 10,
      y: 44,
      width: 7,
      title: () => ' Fill  ',
      active: () => App.tool === 'fill',
      click: () => App.selectTool('fill'),
      keydown: (code) => code === 'KeyI' && App.selectTool('fill'),
    }),
    button({
      x: 10,
      y: 45,
      width: 7,
      title: () => ' Text  ',
      active: () => App.tool === 'text',
      click: () => App.selectTool('text'),
      keydown: (code) => code === 'KeyT' && App.selectTool('text'),
    }),
    button({
      x: 10,
      y: 46,
      width: 7,
      title: () => ` Copy ${App.toolOptions.copyMode === 'copy' ? 'c' : 'x'}`,
      active: () => App.tool === 'copy',
      click: () => App.selectTool('copy'),
      keydown: (code, mods) => {
        if (mods && code === 'KeyC') {
          App.tool = 'copy'
          App.toolOptions.copyMode = 'copy'
        }
        if (mods && code === 'KeyX') {
          App.tool = 'copy'
          App.toolOptions.copyMode = 'cut'
        }
      },
    }),
    button({
      x: 10,
      y: 47,
      width: 7,
      title: () => ' Paste ',
      active: () => App.tool === 'paste',
      click: () => App.selectTool('paste'),
      keydown: (code, mods) => mods && code === 'KeyV' && App.selectTool('paste'),
    }),

    // -- Info --
    {
      x: 0,
      y: 49, // TODO: move down
      draw(ctx) {
        const title = 'Info';
        [...title].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), 2+i, 0, WHITE)
        })
        const borderFg = App.skin.borders
        const borderBg = App.skin.background
        const height = 3
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
        ctx.drawChar(BoxDrawing._URD, 1 + title.length + 1, 0, borderFg, borderBg)
        for (let i = 1 + title.length + 1 + 1; i < width + 1; i++)
          ctx.drawChar(BoxDrawing.L_R_, i, 0, borderFg, borderBg)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
          ctx.drawChar(0, 1+x, 1+y, null, App.skin.background)

        ;[...`${App.paint.char.toString(16).padStart(2, '0')}`].forEach((c, i) => {
          ctx.drawChar(c.charCodeAt(0), 1 + i, 1, WHITE)
        })
      },
    },


    // -- Canvas --
    {
      name: 'canvas',
      x: 18,
      y: 0,
      width: Infinity,
      height: Infinity,
      joinedCellAt(x, y, get) {
        function bdt(c) { return isSingleBoxDrawingChar(c) ? 1 : isDoubleBoxDrawingChar(c) ? 2 : 0 }
        const c = get(x, y)
        const boxDrawingType = bdt(c)
        const connectLeft = bdt(get(x-1,y)) === boxDrawingType
        const connectRight = bdt(get(x+1,y)) === boxDrawingType
        const connectUp = bdt(get(x,y-1)) === boxDrawingType
        const connectDown = bdt(get(x,y+1)) === boxDrawingType
        if (!(connectLeft || connectRight || connectUp || connectDown)) return c
        const char =
          boxDrawingType === 0
          ? c
          : boxDrawingType === 1
            ? boxDrawingChar(connectLeft, connectUp, connectRight, connectDown)
            : boxDrawingDoubleChar(connectLeft, connectUp, connectRight, connectDown)
        return char
      },
      draw(ctx) {
        for (const [k, v] of App.map.entries()) {
          const [x, y] = k.split(',')
          const { char, fg, bg } = v
          ctx.drawChar(
            char ?? ' '.charCodeAt(0),
            +x, +y,
            fg != null ? palette[fg] : null,
            bg != null ? palette[bg] : null
          )
        }
        if (this.tmouse) {
          if (App.tool === 'cell') {
            if (App.toolOptions.joinCells) {
              const {x, y} = this.tmouse
              const get = (tx, ty) => {
                if (tx === x && ty === y && App.apply.glyph) return App.paint.char
                else return App.map.get(`${tx},${ty}`)?.char ?? 0
              }
              const {fg, bg, char: appliedChar} = this.applied(x, y)
              for (const [dx, dy] of App.apply.glyph ? [[0,0],[-1,0],[0,-1],[1,0],[0,1]] : [[0,0]]) {
                const char = App.apply.glyph ? this.joinedCellAt(x+dx, y+dy, get) : appliedChar
                ctx.drawChar(char, x+dx, y+dy, fg != null ? palette[fg] : null, bg != null ? palette[bg] : null)
              }
            } else {
              const { char = ' '.charCodeAt(0), fg, bg } = this.applied(this.tmouse.x, this.tmouse.y)
              ctx.drawChar(char, this.tmouse.x, this.tmouse.y, fg != null ? palette[fg] : null, bg != null ? palette[bg] : null)
            }
          }
          if (App.tool === 'line' && this.toolStart) {
            bresenhamLine(this.toolStart.x, this.toolStart.y, this.tmouse.x, this.tmouse.y, (x, y) => {
              const { char = ' '.charCodeAt(0), fg, bg } = this.applied(x, y)
              ctx.drawChar(char, x, y, fg != null ? palette[fg] : null, bg != null ? palette[bg] : null)
            })
          }
          if (App.tool === 'rect' && this.toolStart) {
            const lx = Math.min(this.toolStart.x, this.tmouse.x)
            const hx = Math.max(this.toolStart.x, this.tmouse.x)
            const ly = Math.min(this.toolStart.y, this.tmouse.y)
            const hy = Math.max(this.toolStart.y, this.tmouse.y)
            for (let y = ly; y <= hy; y++) for (let x = lx; x <= hx; x++) {
              const { char = ' '.charCodeAt(0), fg, bg } = this.applied(x, y)
              if (App.toolOptions.fillRect || x === lx || x === hx || y === ly || y === hy)
                ctx.drawChar(char, x, y, fg != null ? palette[fg] : null, bg != null ? palette[bg] : null)
            }
          }
          if (App.tool === 'oval' && this.toolStart) {
            (App.toolOptions.fillOval ? filledEllipse : ellipse)(this.toolStart.x, this.toolStart.y, Math.abs(this.tmouse.x - this.toolStart.x), Math.abs(this.tmouse.y - this.toolStart.y), (x, y) => {
              const { char = ' '.charCodeAt(0), fg, bg } = this.applied(x, y)
              ctx.drawChar(char, x, y, fg != null ? palette[fg] : null, bg != null ? palette[bg] : null)
            })
          }
          if (App.tool === 'copy' && this.toolStart) {
            const lx = Math.min(this.toolStart.x, this.tmouse.x)
            const hx = Math.max(this.toolStart.x, this.tmouse.x)
            const ly = Math.min(this.toolStart.y, this.tmouse.y)
            const hy = Math.max(this.toolStart.y, this.tmouse.y)
            for (let y = ly; y <= hy; y++) {
              ctx.drawChar(BoxDrawing._U_D, lx - 1, y, WHITE, BLACK)
              ctx.drawChar(BoxDrawing._U_D, hx + 1, y, WHITE, BLACK)
            }
            for (let x = lx; x <= hx; x++) {
              ctx.drawChar(BoxDrawing.L_R_, x, ly - 1, WHITE, BLACK)
              ctx.drawChar(BoxDrawing.L_R_, x, hy + 1, WHITE, BLACK)
            }
            ctx.drawChar(BoxDrawing.__RD, lx - 1, ly - 1, WHITE, BLACK)
            ctx.drawChar(BoxDrawing.L__D, hx + 1, ly - 1, WHITE, BLACK)
            ctx.drawChar(BoxDrawing._UR_, lx - 1, hy + 1, WHITE, BLACK)
            ctx.drawChar(BoxDrawing.LU__, hx + 1, hy + 1, WHITE, BLACK)
          }
          if (App.tool === 'paste' && App.pasteboard) {
            for (const [k, v] of App.pasteboard.entries()) {
              const [x, y] = k.split(',').map(i => +i)
              const paint = { ...(App.map.get(`${x + this.tmouse.x},${y + this.tmouse.y}`) ?? {}) }
              if (App.apply.glyph) paint.char = v.char
              if (App.apply.fg) paint.fg = v.fg
              if (App.apply.bg) paint.bg = v.bg
              ctx.drawChar(paint.char, x + this.tmouse.x, y + this.tmouse.y, paint.fg != null ? palette[paint.fg] : null, paint.bg != null ? palette[paint.bg] : null)
            }
          }
        }
      },
      applied(x, y) {
        const paint = { ...(App.map.get(`${x},${y}`) ?? {}) }
        if (App.apply.glyph) paint.char = App.paint.char
        if (App.apply.fg) paint.fg = App.paint.fg
        if (App.apply.bg) paint.bg = App.paint.bg
        return paint
      },
      paint(x, y) {
        bresenhamLine(this.lastPaint.x, this.lastPaint.y, x, y, (x, y) => {
          if (App.toolOptions.joinCells && App.apply.glyph) {
            const {x, y} = this.tmouse
            const get = (tx, ty) => {
              if (tx === x && ty === y && App.apply.glyph) return App.paint.char
              else return App.map.get(`${tx},${ty}`)?.char ?? 0
            }
            for (const [dx, dy] of App.apply.glyph ? [[0,0],[-1,0],[0,-1],[1,0],[0,1]] : [[0,0]]) {
              const char = this.joinedCellAt(x+dx, y+dy, get)
              const applied = {...this.applied(x + dx, y + dy)}
              if (App.apply.glyph) applied.char = char
              App.map.set(`${x+dx},${y+dy}`, applied)
            }
          } else {
            App.map.set(`${x},${y}`, this.applied(x, y))
          }
        })
        this.lastPaint = { x, y }
      },
      paste(x, y) {
        App.beginChange()
        for (const [k, v] of App.pasteboard.entries()) {
          const [dx, dy] = k.split(',').map(i => +i)
          const paint = { ...(App.map.get(`${x+dx},${y+dy}`) ?? {}) }
          if (App.apply.glyph) paint.char = v.char
          if (App.apply.fg) paint.fg = v.fg
          if (App.apply.bg) paint.bg = v.bg
          App.map.set(`${x+dx},${y+dy}`, paint)
        }
        App.finishChange()
      },
      mousedown(x, y, button) {
        if (button === 0) {
          if (App.tool === 'cell') {
            App.beginChange()
            this.lastPaint = {x, y}
            this.paint(x, y)
          } else if (App.tool === 'line' || App.tool === 'rect' || App.tool === 'oval' || App.tool === 'copy') {
            this.toolStart = { x, y }
          } else if (App.tool === 'text') {
            App.ui.push(textToolOverlay({x: this.x + x, y: this.y + y}))
          } else if (App.tool === 'paste') {
            this.paste(x, y)
          }
        } else if (button === 2) {
          const paint = { ...(App.map.get(`${x},${y}`) ?? {}) }
          if (App.apply.glyph) App.paint.char = paint.char ?? 0
          if (App.apply.fg) App.paint.fg = paint.fg ?? DefaultForeground
          if (App.apply.bg) App.paint.bg = paint.bg ?? DefaultBackground
        }
      },
      mouseup(x, y, button) {
        if (button === 0) {
          if (App.tool === 'cell') {
            App.finishChange()
          }
          if (App.tool === 'line' || App.tool === 'rect' || App.tool === 'oval' || App.tool === 'copy') {
            if (this.tmouse && this.toolStart) {
              if (App.tool === 'line') {
                App.beginChange()
                bresenhamLine(this.toolStart.x, this.toolStart.y, x, y, (x, y) => {
                  App.map.set(`${x},${y}`, this.applied(x, y))
                })
                App.finishChange()
              } else if (App.tool === 'rect') {
                App.beginChange()
                const lx = Math.min(this.toolStart.x, x)
                const hx = Math.max(this.toolStart.x, x)
                const ly = Math.min(this.toolStart.y, y)
                const hy = Math.max(this.toolStart.y, y)
                for (let y = ly; y <= hy; y++) for (let x = lx; x <= hx; x++) {
                  if (App.toolOptions.fillRect || x === lx || x === hx || y === ly || y === hy)
                    App.map.set(`${x},${y}`, this.applied(x, y))
                }
                App.finishChange()
              } else if (App.tool === 'oval') {
                App.beginChange()
                ;(App.toolOptions.fillOval ? filledEllipse : ellipse)(this.toolStart.x, this.toolStart.y, Math.abs(x - this.toolStart.x), Math.abs(y - this.toolStart.y), (x, y) => {
                  App.map.set(`${x},${y}`, this.applied(x, y))
                })
                App.finishChange()
              } else if (App.tool === 'copy') {
                // TODO: should App.apply apply to copying into the pasteboard?
                // What about cutting?
                const pasteboard = new Map
                const lx = Math.min(this.toolStart.x, x)
                const hx = Math.max(this.toolStart.x, x)
                const ly = Math.min(this.toolStart.y, y)
                const hy = Math.max(this.toolStart.y, y)
                for (let y = ly; y <= hy; y++) for (let x = lx; x <= hx; x++) {
                  const a = App.map.get(`${x},${y}`)
                  if (a) pasteboard.set(`${x-lx},${y-ly}`, a)
                  if (App.toolOptions.copyMode === 'cut') App.map.delete(`${x},${y}`)
                }
                App.pasteboard = pasteboard
              }
            }
            this.toolStart = null
          }
        }
      },
      keydown(code) {
        if (code === 'Escape') this.toolStart = null
      },
      blur() {
        this.toolStart = null
        App.finishChange() // noop if there's no change happening.
      },
      mousemove(x, y, buttons) {
        if (App.tool === 'cell') {
          if (buttons & 1) this.paint(x, y)
        }
      },
    },
  ],
  init() {
    for (const el of this.ui)
      Object.setPrototypeOf(el, {
        get tmouse() {
          const atm = App.tmouse
          if (!atm || !this.width || !this.height || atm.x < this.x || atm.y < this.y || atm.x >= this.x + this.width || atm.y >= this.y + this.height)
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
    for (const el of this.ui)
      if (x >= el.x && x < el.x + el.width && y >= el.y && y < el.y + el.height)
        if (el.mousedown)
          el.mousedown(x - el.x, y - el.y, button)
  },
  mouseup(button) {
    if (this.tmouse) {
      const { x, y } = this.tmouse
      for (const el of this.ui)
        if (el.mouseup)
          el.mouseup(x - el.x, y - el.y, button)
    }
  },
  keydown(code, mods) {
    for (const el of this.ui)
      if (el.captureKeys) {
        if (el.keydown) el.keydown(code, mods)
        return
      }
    for (const el of this.ui)
      if (el.keydown)
        el.keydown(code, mods)
    if (code === 'KeyG') App.apply.glyph = !App.apply.glyph
    if (code === 'KeyF') App.apply.fg = !App.apply.fg
    if (code === 'KeyB') App.apply.bg = !App.apply.bg
    if (code === 'ArrowUp') {
      const y = (App.paint.char / 16)|0
      const x = App.paint.char % 16
      App.paint.char = ((y + 15) % 16) * 16 + x
    }
    if (code === 'ArrowDown') {
      const y = (App.paint.char / 16)|0
      const x = App.paint.char % 16
      App.paint.char = ((y + 1) % 16) * 16 + x
    }
    if (code === 'ArrowLeft') {
      const y = (App.paint.char / 16)|0
      const x = App.paint.char % 16
      App.paint.char = y * 16 + (x + 15) % 16
    }
    if (code === 'ArrowRight') {
      const y = (App.paint.char / 16)|0
      const x = App.paint.char % 16
      App.paint.char = y * 16 + (x + 1) % 16
    }
  },
  keypress(key) {
    for (const el of this.ui)
      if (el.captureKeys) {
        if (el.keypress) el.keypress(key)
        return
      }
    for (const el of this.ui)
      if (el.keypress)
        el.keypress(key)
  },
  blur() {
    for (const el of this.ui)
      if (el.blur)
        el.blur()
  }
}
window.App = App

function start() {
  App.init()
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.imageRendering = 'pixelated'
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
    const ratio = 1;//devicePixelRatio
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

  window.addEventListener('mousemove', (e) => {
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
  window.addEventListener('mouseup', (e) => {
    App.mouseButtons = e.buttons
    App.mouseup(e.button)
    dirty()
  })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('blur', () => {
    App.mouseButtons = 0
    App.mouse = null
    App.blur()
    dirty()
  })

  window.addEventListener('keydown', (e) => {
    App.keydown(e.code, e.ctrlKey || e.metaKey /* TODO */)
    dirty()
  })

  window.addEventListener('keypress', (e) => {
    App.keypress(e.key)
    dirty()
  })
}

start()
