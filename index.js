import { CoordinateMap } from './coordinate-map.js'
import { SpriteBatch, Texture, ImageTextureSource, createProgram } from './gl.js'
import { apcaContrast } from './contrast.js'
import { bresenhamLine, ellipse, filledEllipse } from './bresenham.js'
import { BoxDrawing, BoxDrawingDouble, boxDrawingChar, boxDrawingDoubleChar, isSingleBoxDrawingChar, isDoubleBoxDrawingChar } from './cp437.js'
import defaultPalette from './default-palette.js'
import * as idb from './idb.js'
import * as xp from './xp.js'

const MAX_UNDO_STEPS = 2048

const fontConfig = parseFontConfig(await fetch('fonts/_config.xt').then(t => t.text()))

function parseFontConfig(text) {
  const fonts = []
  for (const line of text.split(/\n/).map(l => l.replace(/\/\/.*/, '').trim()).filter(x => x)) {
    const [name, guiFile, guiColumns, guiRows, artFile, artColumns, artRows, unicode, mirror, available] = line.split(/\t+/)
    fonts.push({
      name,
      gui: {
        file: guiFile,
        columns: +guiColumns,
        rows: +guiRows,
      },
      art: {
        file: artFile,
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

const WHITE = {r: 1, g: 1, b: 1}
const BLACK = {r: 0, g: 0, b: 0}

const UiInitialized = Symbol('UiInitialized')
function initUi(el) {
  if (el[UiInitialized]) return
  Object.setPrototypeOf(el, {
    get tmouse() {
      const atm = App.tmouse
      const ox = this._px + this.x
      const oy = this._py + this.y
      if (!atm || !this.width || !this.height || atm.x < ox || atm.y < oy || atm.x >= ox + this.width || atm.y >= oy + this.height)
        return null
      return {x: atm.x - ox, y: atm.y - oy}
    },
    [UiInitialized]: true
  })
  return el
}

function button({title, active, click, ...rest}) {
  return initUi({
    height: 1,
    drawButton(ctx) {
      const fg = active ? active() ? App.skin.buttons.active : App.skin.buttons.inactive : App.skin.buttons.usable;
      const bg = this.tmouse ? App.skin.buttons.highlight : App.skin.background;
      ctx.drawText(title(), 0, 0, fg, bg)
    },
    draw(ctx) {
      this.drawButton(ctx)
    },
    mousedown({button}) {
      if (button === 0) this.click()
    },
    click,
    active,
    title,
    ...rest
  })
}

function numberButton({value, setValue, fg, width, align = 'right', pattern = /^[0-9]*$/, ...rest}) {
  return button({
    height: 1,
    width,
    pattern,
    click() {
      this.captureKeys = true
      this.text = ''
    },
    stopEditing() {
      this.captureKeys = false
    },
    draw(ctx) {
      if (this.captureKeys)  {
        ctx.drawText(align === 'right' ? this.text.padStart(this.width, ' ') : this.text.padEnd(this.width, ' '), 0, 0,
          fg ?? App.skin.buttons.usable, App.skin.buttons.highlight)
        ctx.drawText('_', align === 'right' ? this.width - 1 : Math.min(this.text.length, this.width - 1), 0, WHITE)
      } else
        ctx.drawText(
          value().padStart(this.width, ' '),
          0, 0,
          App.skin.buttons.usable, this.tmouse ? App.skin.buttons.highlight : App.skin.background)
    },
    keypress(e) {
      if (!this.captureKeys) return
      if (e.key === 'Enter') {
        try {
          setValue(this.text)
        } finally {
          this.stopEditing()
        }
      }
      if (this.text.length < this.width && this.pattern.test(this.text + e.key))
        this.text += e.key
    },
    keydown(e) {
      if (!this.captureKeys) return
      if (e.code === 'Backspace') this.text = this.text.substring(0, this.text.length - 1)
      if (e.code === 'Escape') this.stopEditing()
    },
    ...rest
  })
}

function textToolOverlay({x, y, tx, ty}) {
  // TODO: hidden textarea...?
  return {
    x,
    y,
    height: 1,
    text: '',
    draw(ctx) {
      const lines = this.text.split('\n')
      lines.forEach((line, y) => {
        for (let i = 0; i < line.length; i++) {
          const { char = 0x20, fg, bg } = this.applied(tx + i, ty + y, line.charCodeAt(i))
          ctx.drawChar(char, i, y, fg, bg)
        }
        if (y === lines.length - 1)
          ctx.drawText('_', line.length, y, WHITE, BLACK)
      })
    },
    captureKeys: true,
    exit() { App.ui.splice(App.ui.lastIndexOf(this), 1) },
    keydown(e) {
      if (e.code === 'Escape') this.exit()
      if (e.code === 'Backspace') this.text = this.text.substring(0, this.text.length - 1)
    },
    keypress(e) {
      if (e.key === 'Enter') {
        if (e.ctrlKey || e.shiftKey) {
          this.text += '\n'
          return
        }
        App.beginChange()
        const lines = this.text.split('\n')
        lines.forEach((line, y) => {
          for (let i = 0; i < line.length; i++) {
            App.currentLayer.data.set(tx + i,ty + y, this.applied(tx + i, ty + y, line.charCodeAt(i)))
          }
        })
        App.finishChange()
        this.exit()
        return
      }
      this.text += e.key
    },
    applied(x, y, c) {
      const paint = { fg: DefaultForeground, bg: DefaultBackground, char: 0, ...(App.currentLayer.data.get(x,y) ?? {}) }
      if (App.apply.glyph) paint.char = c
      if (App.apply.fg) paint.fg = App.paint.fg
      if (App.apply.bg) paint.bg = App.paint.bg
      return paint
    },
  }
}

function renameDialog(file) {
  // TODO: hidden textarea...?
  return {
    x: 20,
    y: 2,
    text: file.name,
    draw(ctx) {
      const title = 'Enter Name'
      ctx.drawText(title, 2, 0, WHITE)
      const borderFg = App.skin.borders
      const borderBg = App.skin.background
      const height = 1
      const width = 20
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
      ctx.fill(1, 1, width, height, App.skin.background)

      ctx.drawText(this.text + '_', 1, 1, WHITE)
    },
    captureKeys: true,
    exit() { App.ui.splice(App.ui.lastIndexOf(this), 1) },
    keydown(e) {
      if (e.code === 'Escape') this.exit()
      if (e.code === 'Backspace') this.text = this.text.substring(0, this.text.length - 1)
    },
    keypress(e) {
      if (e.key === 'Enter') {
        file.name = this.text
        App.save()
        this.exit()
        return
      }
      this.text += e.key
    },
  }
}

function newFile() {
  return {
    name: 'unnamed',
    layers: [
      { data: new CoordinateMap, name: 'Layer 1' },
    ],
    selectedLayer: 0,
    undoStack: [],
    redoStack: [],
  }
}

function deleteDialog(file) {
  function doDeletion() {
    const idx = App.files.indexOf(file)
    if (idx >= 0) {
      App.files.splice(idx, 1)
      if (App.files.length === 0)
        App.files.push(newFile())
      while (App.selectedFile >= App.files.length)
        App.selectedFile--
      App.save()
    }
  }
  const dialog = {
    x: 20,
    y: 2,
    draw(ctx) {
      const title = 'Confirm Deletion';
      ctx.drawText(title, 2, 0, App.skin.headers, App.skin.background)
      const borderFg = App.skin.borders
      const borderBg = App.skin.background
      const height = 3
      const width = Math.max(20, file.name.length + 9)
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

      ctx.drawText(`Delete ${file.name}?`, 2, 1, WHITE)
    },
    captureKeys: true,
    exit() { App.ui.splice(App.ui.lastIndexOf(this), 1) },
    keydown(e) {
      if (e.code === 'Escape') this.exit()
      if (e.code === 'Enter') {
        doDeletion()
        this.exit()
      }
    },
    children: [
      button({
        x: 2,
        y: 3,
        width: 6,
        title() { return 'Delete' },
        click() {
          doDeletion()
          dialog.exit()
        },
      }),
      button({
        x: 9,
        y: 3,
        width: 6,
        title() { return 'Cancel' },
        click() { dialog.exit() },
      }),
    ],
  }
  return dialog
}

// https://stackoverflow.com/a/54070620
function rgb2hsv(r,g,b) {
  let v=Math.max(r,g,b), c=v-Math.min(r,g,b);
  let h= c && ((v==r) ? (g-b)/c : ((v==g) ? 2+(b-r)/c : 4+(r-g)/c));
  return [60*(h<0?h+6:h), v&&c/v, v];
}
// https://stackoverflow.com/a/54024653
function hsv2rgb(h,s,v) {
  let f= (n,k=(n+h/60)%6) => v - v*s*Math.max(Math.min(k,4-k,1), 0);
  return [f(5),f(3),f(1)];
}

// Color chooser / picker
function colorChooser(initial, choose) {
  let [h, s, v] = rgb2hsv(initial.r, initial.g, initial.b)
  let major = 'hue'
  const dialog = initUi({
    x: 19,
    y: 1,
    captureKeys: true,
    exit() { App.ui.splice(App.ui.lastIndexOf(this), 1) },
    keydown(e) {
      if (e.code === 'Escape') this.exit()
      e.stopPropagation()
    },
    draw(ctx) {
      ctx.drawBorder(-1, -1, 56, 42, App.skin.borders, App.skin.background)
    },
    children: [
      // Color grid
      {
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        draw(ctx) {
          for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
            const ts = x / (this.width - 1)
            const tv = 1 - (y / (this.height - 1))
            const [r, g, b] = hsv2rgb(h, ts, tv)
            ctx.drawText(' ', x, y, {r: 1, g: 1, b: 1}, { r, g, b })
          }
          const selectedS = Math.min(this.width - 1, (s * this.width) | 0)
          const selectedV = Math.max(0, this.height - 1 - ((v * this.height)|0))
          const [sr, sg, sb] = hsv2rgb(h, s, v)
          const color = {r: sr, g: sg, b: sb}
          const cw = Math.abs(apcaContrast(WHITE, color))
          const cb = Math.abs(apcaContrast(BLACK, color))
          const wb = cb > cw ? BLACK : WHITE
          ctx.drawText('|', selectedS, selectedV-1, wb)
          ctx.drawText('/', selectedS-1, selectedV+1, wb)
          ctx.drawText('\\', selectedS+1, selectedV+1, wb)
        },
        mousedown({x, y, button}) {
          if (button === 0) {
            if (((s*this.width)|0) === x && (((1 - v) * this.height)|0) === y) {
              const [r, g, b] = hsv2rgb(h, s, v)
              choose({r, g, b})
              dialog.exit()
            }
            s = x / (this.width - 1)
            v = 1 - y / (this.height - 1)
          }
        },
        mousemove({x, y, buttons}) {
          if (buttons & 1) {
            s = x / (this.width - 1)
            v = 1 - y / (this.height - 1)
          }
        },
      },
      // Hue slider
      {
        x: 42,
        y: 0,
        width: 2,
        height: 40,
        draw(ctx) {
          for (let y = 0; y < this.height; y++) {
            const th = y / (this.height - 1) * 360
            const [r, g, b] = hsv2rgb(th, 1, 1)
            ctx.drawText('  ', -2, y, null, BLACK)
            ctx.drawText('  ', 0, y, null, { r, g, b })
            ctx.drawText('  ', 2, y, null, BLACK)
          }
          const selectedH = Math.min(this.height - 1, (h / 360 * (this.height)) | 0)
          ctx.drawText('-  -', -1, selectedH, WHITE)
        },
        mousedown({y, button}) {
          if (button === 0)
            h = y / (this.height - 1) * 360
        },
        mousemove({y, buttons}) {
          if (buttons & 1)
            h = y / (this.height - 1) * 360
        },
      },
      // Sidebar
      {
        x: 46,
        y: 0,
        height: 40,
        draw(ctx) {
          for (let y = 0; y < 40; y++) for (let x = 0; x < 8; x++)
            ctx.drawChar(0, x, y, null, App.skin.background)
        },
        children: [
          button({
            x: 1,
            y: 1,
            width: 5,
            title() { return 'OK    ' },
            click() {
              const [r, g, b] = hsv2rgb(h, s, v)
              choose({r, g, b})
              dialog.exit()
            },
            keydown(e) {
              if (e.code === 'Enter') this.click()
            }
          }),
          button({
            x: 1,
            y: 2,
            width: 5,
            title() { return 'Cancel' },
            click() {
              dialog.exit()
            }
          }),
          {
            x: 1,
            y: 4,
            draw(ctx) {
              ctx.drawText('New', 0, 0, App.skin.headers)
              const [r,g,b] = hsv2rgb(h, s, v)
              ctx.drawText('      ', 0, 1, null, { r, g, b })
              ctx.drawText('      ', 0, 2, null, { r, g, b })
              ctx.drawText('      ', 0, 3, null, initial)
              ctx.drawText('      ', 0, 4, null, initial)
              ctx.drawText('Old', 0, 5, App.skin.headers)
            }
          },

          button({
            display: false, // TODO: make this work
            x: 1,
            y: 11,
            width: 1,
            title() { return '\u00fe' },
            active() { return major === 'hue' },
            click() { major = 'hue' },
          }),
          numberButton({
            x: 4,
            y: 11,
            width: 3,
            value() { return h.toFixed(0) },
            setValue(v) { h = (Number(v)|0) % 360 },
            // TODO: 'H' should select this box
          }),
          button({
            display: false, // TODO: make this work
            x: 1,
            y: 13,
            width: 1,
            title() { return '\u00fe' },
            active() { return major === 'saturation' },
            click() { major = 'saturation' },
          }),
          numberButton({
            x: 4,
            y: 13,
            width: 3,
            value() { return (s * 100).toFixed(0) },
            setValue(v) { s = Math.max(0, Math.min(100, (Number(v)|0))) / 100 },
          }),
          button({
            display: false, // TODO: make this work
            x: 1,
            y: 15,
            width: 1,
            title() { return '\u00fe' },
            active() { return major === 'value' },
            click() { major = 'value' },
          }),
          numberButton({
            x: 4,
            y: 15,
            width: 3,
            value() { return (v * 100).toFixed(0) },
            setValue(x) { v = Math.max(0, Math.min(100, (Number(x)|0))) / 100 },
          }),
          {
            x: 2,
            y: 11,
            draw(ctx) {
              ctx.drawText('H', 0, 0, App.skin.headers)
              ctx.drawText('S', 0, 2, App.skin.headers)
              ctx.drawText('V', 0, 4, App.skin.headers)
            }
          },
          {
            x: 2,
            y: 18,
            draw(ctx) {
              ctx.drawText('R', 0, 0, App.skin.headers)
              ctx.drawText('G', 0, 2, App.skin.headers)
              ctx.drawText('B', 0, 4, App.skin.headers)
            }
          },
          numberButton({
            x: 4,
            y: 18,
            width: 3,
            value() { return (hsv2rgb(h,s,v)[0] * 255).toFixed(0) },
            setValue(nr) {
              const [, g, b] = hsv2rgb(h,s,v);
              [h, s, v] = rgb2hsv(Math.max(0, Math.min(255, Number(nr)))/255, g, b)
            }
          }),
          numberButton({
            x: 4,
            y: 20,
            width: 3,
            value() { return (hsv2rgb(h,s,v)[1] * 255).toFixed(0) },
            setValue(ng) {
              const [r, , b] = hsv2rgb(h,s,v);
              [h, s, v] = rgb2hsv(r, Math.max(0, Math.min(255, Number(ng)))/255, b)
            }
          }),
          numberButton({
            x: 4,
            y: 22,
            width: 3,
            value() { return (hsv2rgb(h,s,v)[2] * 255).toFixed(0) },
            setValue(nb) {
              const [r, g] = hsv2rgb(h,s,v);
              [h, s, v] = rgb2hsv(r, g, Math.max(0, Math.min(255, Number(nb)))/255)
            }
          }),
          numberButton({
            x: 1,
            y: 24,
            width: 6,
            pattern: /^[0-9a-f]*$/i,
            value() {
              const [r, g, b] = hsv2rgb(h, s, v)
              const hex = ((((r * 255)|0) << 16) | (((g * 255)|0) << 8) | ((b * 255)|0)).toString(16).padStart(6, '0')
              return hex
            },
            setValue(hex) {
              const num = parseInt(hex, 16)
              if (!isNaN(num)) {
                const r = (num & 0xff0000) >> 16
                const g = (num & 0x00ff00) >> 8
                const b = (num & 0x0000ff) >> 0
                ;[h, s, v] = rgb2hsv(r/255, g/255, b/255)
              }
            }
          }),
        ],
      }
    ],
  })
  return dialog
}


const DefaultForeground = { r: 0, g: 0, b: 0 }
const DefaultBackground = { r: 1, g: 0, b: 1 }
const App = {
  sidebar: 'paint',
  files: [
    newFile()
  ],
  selectedFile: 0,
  palette: defaultPalette,
  get currentFile() {
    return this.files[this.selectedFile]
  },
  get currentLayer() {
    return this.currentFile.layers[this.currentFile.selectedLayer]
  },
  get undoStack() {
    return this.currentFile.undoStack
  },
  set undoStack(x) {
    this.currentFile.undoStack = x
  },
  get redoStack() {
    return this.currentFile.redoStack
  },
  set redoStack(x) {
    this.currentFile.redoStack = x
  },
  beginChange({layerDataUnchanged, changingLayer} = {}) {
    if (this.changing) return
    this.changing = true
    if (changingLayer == null) changingLayer = this.currentFile.selectedLayer
    this.undoStack.push(this.currentFile.layers)
    this.currentFile.layers = this.currentFile.layers.map((x, i) => {
      if (i === changingLayer && !layerDataUnchanged) {
        return {...x, data: new CoordinateMap(x.data)}
      } else {
        return {...x}
      }
    })
    while (this.undoStack.length > MAX_UNDO_STEPS)
      this.undoStack.shift()
    this.redoStack = []
  },
  finishChange() {
    if (!this.changing) return
    this.changing = false
    this.save()
  },
  undo() {
    if (this.changing || !this.undoStack.length) return
    this.redoStack.push(this.currentFile.layers)
    this.currentFile.layers = this.undoStack.pop()
    this.currentFile.selectedLayer = Math.min(this.currentFile.selectedLayer, this.currentFile.layers.length - 1)
    this.save()
  },
  redo() {
    if (this.changing || !this.redoStack.length) return
    this.undoStack.push(this.currentFile.layers)
    this.currentFile.layers = this.redoStack.pop()
    this.currentFile.selectedLayer = Math.min(this.currentFile.selectedLayer, this.currentFile.layers.length - 1)
    this.save()
  },
  save() {
    idb.setItem('art', { files: this.files.map(f => {
      // Don't save pan info
      const {offsetX, offsetY, layers, ...rest} = f
      return {...rest, layers: layers.map(l => ({...l, data: l.data._map}))}
    }), selectedFile: this.selectedFile })
  },
  mergeDown(li) {
    if (li <= 0) return
    this.beginChange({changingLayer: li - 1})
    const top = this.currentFile.layers[li]
    const bot = this.currentFile.layers[li - 1]
    for (const [[x, y], v] of top.data.entries())
      bot.data.set(x, y, v)
    this.currentFile.layers.splice(li, 1)
    this.currentFile.selectedLayer = Math.min(this.currentFile.selectedLayer, this.currentFile.layers.length - 1)
    this.finishChange()
  },
  mouse: null,
  get tmouse() {
    return this.mouse ? { x: (this.mouse.x / App.font.tileWidth)|0, y: (this.mouse.y / App.font.tileHeight)|0 } : null;
  },
  mouseButtons: 0,
  paint: {
    char: 0,
    fg: DefaultForeground,
    bg: DefaultBackground,
  },
  selectedPalette: {
    fg: null,
    bg: null,
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
    fillEightNeighborhood: false,
  },
  selectTool(tool) {
    if (tool === 'cell' && this.tool === 'cell') this.toolOptions.joinCells = !this.toolOptions.joinCells
    if (tool === 'rect' && this.tool === 'rect') this.toolOptions.fillRect = !this.toolOptions.fillRect
    if (tool === 'oval' && this.tool === 'oval') this.toolOptions.fillOval = !this.toolOptions.fillOval
    if (tool === 'copy' && this.tool === 'copy') this.toolOptions.copyMode = this.toolOptions.copyMode === 'copy' ? 'cut' : 'copy'
    if (tool === 'fill' && this.tool === 'fill') this.toolOptions.fillEightNeighborhood = !this.toolOptions.fillEightNeighborhood
    this.tool = tool
  },
  skin: {
    borders: {r: 0, g: 0, b: 0},
    headers: {r: 222/255, g: 222/255, b: 222/255},
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
    info: {r: 222/255, g: 222/255, b: 222/255},
  },
  ui: [
    // -- Canvas --
    {
      name: 'canvas',
      x: 18,
      y: 0,
      width: Infinity,
      height: Infinity,
      get offsetX() {
        return App.files[App.selectedFile].offsetX ?? 0
      },
      set offsetX(x) {
        App.files[App.selectedFile].offsetX = x
      },
      get offsetY() {
        return App.files[App.selectedFile].offsetY ?? 0
      },
      set offsetY(y) {
        App.files[App.selectedFile].offsetY = y
      },
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
      get tmouse() {
        const f = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'tmouse')
        const p = f.get.call(this)
        if (!p) return p
        const {x, y} = p
        return {x: x + this.offsetX, y: y + this.offsetY}
      },
      currentChange(f) {
        if (App.tool === 'cell') {
          if (App.toolOptions.joinCells) {
            const {x, y} = this.tmouse
            const get = (tx, ty) => {
              if (tx === x && ty === y && App.apply.glyph) return App.paint.char
              else return App.currentLayer.data.get(tx,ty)?.char ?? 0
            }
            const {fg, bg, char: appliedChar} = this.applied(x, y)
            for (const [dx, dy] of App.apply.glyph ? [[0,0],[-1,0],[0,-1],[1,0],[0,1]] : [[0,0]]) {
              const char = App.apply.glyph ? this.joinedCellAt(x+dx, y+dy, get) : appliedChar
              f(char, x+dx, y+dy, fg, bg)
            }
          } else {
            const { char = 0, fg, bg } = this.applied(this.tmouse.x, this.tmouse.y)
            f(char, this.tmouse.x, this.tmouse.y, fg, bg)
          }
        }
        if (App.tool === 'line' && this.toolStart) {
          bresenhamLine(this.toolStart.x, this.toolStart.y, this.tmouse.x, this.tmouse.y, (x, y) => {
            const { char = 0, fg, bg } = this.applied(x, y)
            f(char, x, y, fg, bg)
          })
        }
        if (App.tool === 'rect' && this.toolStart) {
          const lx = Math.min(this.toolStart.x, this.tmouse.x)
          const hx = Math.max(this.toolStart.x, this.tmouse.x)
          const ly = Math.min(this.toolStart.y, this.tmouse.y)
          const hy = Math.max(this.toolStart.y, this.tmouse.y)
          for (let y = ly; y <= hy; y++) for (let x = lx; x <= hx; x++) {
            const p = {...App.paint}
            if (!App.toolOptions.fillRect) {
              if (isSingleBoxDrawingChar(p.char)) {
                if (y === ly) {
                  if (x === lx) p.char = BoxDrawing.__RD
                  else if (x === hx) p.char = BoxDrawing.L__D
                  else p.char = BoxDrawing.L_R_
                } else if (y === hy) {
                  if (x === lx) p.char = BoxDrawing._UR_
                  else if (x === hx) p.char = BoxDrawing.LU__
                  else p.char = BoxDrawing.L_R_
                } else p.char = BoxDrawing._U_D
              } else if (isDoubleBoxDrawingChar(p.char)) {
                if (y === ly) {
                  if (x === lx) p.char = BoxDrawingDouble.__RD
                  else if (x === hx) p.char = BoxDrawingDouble.L__D
                  else p.char = BoxDrawingDouble.L_R_
                } else if (y === hy) {
                  if (x === lx) p.char = BoxDrawingDouble._UR_
                  else if (x === hx) p.char = BoxDrawingDouble.LU__
                  else p.char = BoxDrawingDouble.L_R_
                } else p.char = BoxDrawingDouble._U_D
              }
            }
            const { char = 0, fg, bg } = this.applied(x, y, p)
            if (App.toolOptions.fillRect || x === lx || x === hx || y === ly || y === hy)
              f(char, x, y, fg, bg)
          }
        }
        if (App.tool === 'oval' && this.toolStart) {
          (App.toolOptions.fillOval ? filledEllipse : ellipse)(this.toolStart.x, this.toolStart.y, Math.abs(this.tmouse.x - this.toolStart.x), Math.abs(this.tmouse.y - this.toolStart.y), (x, y) => {
            const { char = 0, fg, bg } = this.applied(x, y)
            f(char, x, y, fg, bg)
          })
        }
        if (App.tool === 'paste' && App.pasteboard) {
          for (const [[x, y], v] of App.pasteboard.entries()) {
            const paint = { ...(App.currentLayer.data.get(x + this.tmouse.x,y + this.tmouse.y) ?? {}) }
            if (App.apply.glyph) paint.char = v.char
            if (App.apply.fg) paint.fg = v.fg
            if (App.apply.bg) paint.bg = v.bg
            f(paint.char, x + this.tmouse.x, y + this.tmouse.y, paint.fg, paint.bg)
          }
        }
      },
      draw(ctx) {
        const {offsetX, offsetY} = this
        const drawChar = (c, x, y, fg, bg) => {
          if (x - offsetX < 0 || y - offsetY < 0) return
          ctx.drawChar(c, x - offsetX, y - offsetY, fg, bg)
        }
        App.currentFile.layers.forEach((layer, i) => {
          if (layer.hidden) return
          for (const [[x, y], v] of layer.data.entries()) {
            const { char, fg, bg } = v
            drawChar(char ?? 0x20, +x, +y, fg, bg)
          }
          if (this.tmouse && i === App.currentFile.selectedLayer) {
            if (this.panMode) {
              const char = this.panStart ? '*' : '+'
              drawChar(char.charCodeAt(0), this.tmouse.x, this.tmouse.y, WHITE, BLACK)
              return
            }
            if (App.tool === 'copy' && this.toolStart) {
              const lx = Math.min(this.toolStart.x, this.tmouse.x)
              const hx = Math.max(this.toolStart.x, this.tmouse.x)
              const ly = Math.min(this.toolStart.y, this.tmouse.y)
              const hy = Math.max(this.toolStart.y, this.tmouse.y)
              for (let y = ly; y <= hy; y++) {
                drawChar(BoxDrawing._U_D, lx - 1, y, WHITE, BLACK)
                drawChar(BoxDrawing._U_D, hx + 1, y, WHITE, BLACK)
              }
              for (let x = lx; x <= hx; x++) {
                drawChar(BoxDrawing.L_R_, x, ly - 1, WHITE, BLACK)
                drawChar(BoxDrawing.L_R_, x, hy + 1, WHITE, BLACK)
              }
              drawChar(BoxDrawing.__RD, lx - 1, ly - 1, WHITE, BLACK)
              drawChar(BoxDrawing.L__D, hx + 1, ly - 1, WHITE, BLACK)
              drawChar(BoxDrawing._UR_, lx - 1, hy + 1, WHITE, BLACK)
              drawChar(BoxDrawing.LU__, hx + 1, hy + 1, WHITE, BLACK)
            } else {
              this.currentChange(drawChar)
            }
          }
        })
      },
      applied(x, y, p) {
        if (!p) p = App.paint
        const paint = { ...(App.currentLayer.data.get(x,y) ?? {}) }
        if (App.apply.glyph) paint.char = p.char
        if (App.apply.fg) paint.fg = p.fg
        if (App.apply.bg) paint.bg = p.bg
        return paint
      },
      paint(x, y) {
        if (!this.lastPaint) return
        bresenhamLine(this.lastPaint.x, this.lastPaint.y, x, y, (x, y) => {
          if (App.toolOptions.joinCells && App.apply.glyph) {
            const {x, y} = this.tmouse
            const get = (tx, ty) => {
              if (tx === x && ty === y && App.apply.glyph) return App.paint.char
              else return App.currentLayer.data.get(tx,ty)?.char ?? 0
            }
            for (const [dx, dy] of App.apply.glyph ? [[0,0],[-1,0],[0,-1],[1,0],[0,1]] : [[0,0]]) {
              const char = this.joinedCellAt(x+dx, y+dy, get)
              const applied = {...this.applied(x + dx, y + dy)}
              if (App.apply.glyph) applied.char = char
              App.currentLayer.data.set(x+dx,y+dy, applied)
            }
          } else {
            App.currentLayer.data.set(x,y, this.applied(x, y))
          }
        })
        this.lastPaint = { x, y }
      },
      mousedown({x, y, button}) {
        const ox = x
        const oy = y
        x = x + this.offsetX
        y = y + this.offsetY
        if (this.panMode) {
          if (button === 0) {
            this.panStart = {x: ox, y: oy, offsetX: this.offsetX, offsetY: this.offsetY}
          }
          return
        }
        if (button === 0) {
          if (App.tool === 'cell') {
            App.beginChange()
            this.lastPaint = {x, y}
            this.paint(x, y)
          } else if (App.tool === 'line' || App.tool === 'rect' || App.tool === 'oval' || App.tool === 'copy') {
            this.toolStart = { x, y }
          } else if (App.tool === 'text') {
            App.ui.push(textToolOverlay({x: this.x + ox, y: this.y + oy, tx: x, ty: y}))
          } else if (App.tool === 'paste') {
            App.beginChange()
            this.currentChange((char, x, y, fg, bg) => {
              App.currentLayer.data.set(x,y, {char, fg, bg})
            })
            App.finishChange()
          }
        } else if (button === 2) {
          if (this.toolStart) {
            this.toolStart = null
          } else {
            const paint = { char: 0, bg: DefaultBackground, fg: DefaultForeground, ...(App.currentLayer.data.get(x,y) ?? {}) }
            if (App.apply.glyph) App.paint.char = paint.char ?? 0
            if (App.apply.fg) {
              App.paint.fg = paint.fg ?? DefaultForeground
              const idx = App.palette.findIndex(c => c.r === App.paint.fg.r && c.g === App.paint.fg.g && c.b === App.paint.fg.b)
              if (idx >= 0) App.selectedPalette.fg = idx
              else App.selectedPalette.fg = null
            }
            if (App.apply.bg) {
              App.paint.bg = paint.bg ?? DefaultBackground
              const idx = App.palette.findIndex(c => c.r === App.paint.bg.r && c.g === App.paint.bg.g && c.b === App.paint.bg.b)
              if (idx >= 0) App.selectedPalette.bg = idx
              else App.selectedPalette.bg = null
            }
          }
        }
      },
      mouseup({x, y, button}) {
        if (this.panMode) {
          this.panStart = null
          return
        }
        x = x + this.offsetX
        y = y + this.offsetY
        if (button === 0) {
          this.lastPaint = null
          if (App.tool === 'cell') {
            App.finishChange()
          }
          if (App.tool === 'line' || App.tool === 'rect' || App.tool === 'oval' || App.tool === 'copy') {
            if (this.tmouse && this.toolStart) {
              if (App.tool === 'copy') {
                const pasteboard = new CoordinateMap
                const lx = Math.min(this.toolStart.x, x)
                const hx = Math.max(this.toolStart.x, x)
                const ly = Math.min(this.toolStart.y, y)
                const hy = Math.max(this.toolStart.y, y)
                if (App.toolOptions.copyMode === 'cut') App.beginChange()
                for (let y = ly; y <= hy; y++) for (let x = lx; x <= hx; x++) {
                  const a = App.currentLayer.data.get(x,y)
                  if (a) pasteboard.set(x-lx, y-ly, a)
                  if (App.toolOptions.copyMode === 'cut') App.currentLayer.data.delete(x, y)
                }
                if (App.toolOptions.copyMode === 'cut') App.finishChange()
                App.pasteboard = pasteboard
              } else {
                App.beginChange()
                this.currentChange((char, x, y, fg, bg) => {
                  App.currentLayer.data.set(x,y, {char, fg, bg})
                })
                App.finishChange()
              }
            }
            this.toolStart = null
          }
        }
      },
      keydown({code}) {
        if (code === 'Escape') this.toolStart = null
        if (code === 'Space') this.panMode = true
      },
      keyup({code}) {
        if (code === 'Space') this.panMode = false
      },
      blur() {
        this.toolStart = null
        this.panStart = null
        this.panMode = false
        this.lastPaint = null
        App.finishChange() // noop if there's no change happening.
      },
      mousemove({x, y, buttons}) {
        if (this.panStart) {
          if (!(buttons & 1)) {
            this.panStart = null
            return
          }
          const dx = this.panStart.x - x
          const dy = this.panStart.y - y
          this.offsetX = this.panStart.offsetX + dx
          this.offsetY = this.panStart.offsetY + dy
          return
        }
        if (App.tool === 'cell') {
          if (!(buttons & 1)) {
            App.finishChange() // noop if there's no change happening.
            this.lastPaint = null
          }
          if (this.lastPaint) this.paint(x + this.offsetX, y + this.offsetY)
        }
      },
    },

    // -- [PAINT|BROWSE] --
    {
      x: 0,
      y: 0,
      draw(ctx) {
        ctx.drawText('    [     |      ]', 0, 0, App.skin.headers, App.skin.background)
      },
      keydown(e) {
        if (e.code === 'Tab') {
          App.sidebar = App.sidebar === 'paint' ? 'browse' : 'paint'
        }
      }
    },
    button({
      x: 5,
      y: 0,
      width: 5,
      title() { return 'PAINT' },
      active() { return App.sidebar === 'paint' },
      click() { App.sidebar = 'paint' },
    }),
    button({
      x: 11,
      y: 0,
      width: 6,
      title() { return 'BROWSE' },
      active() { return App.sidebar === 'browse' },
      click() { App.sidebar = 'browse' },
    }),

    // -- Paint Sidebar --
    {
      name: 'sidebar/paint',
      display() { return App.sidebar === 'paint' },
      x: 0,
      y: 0,
      draw(ctx) {
        ctx.fill(this.x, this.y + 1, 18, ctx.height, App.skin.background)
      },
      children: [
        // -- Font --
        {
          x: 0, y: 1,
          draw(ctx) {
            const title = 'Font'
            const height = 16
            const width = 16
            const borderFg = App.skin.borders
            const borderBg = App.skin.background
            ctx.drawBorder(0, 0, width + 2, height + 2)
            ctx.drawText(title, 2, 0, App.skin.headers, App.skin.background)
            ctx.drawChar(BoxDrawing.LU_D, 1, 0, borderFg, borderBg)
            ctx.drawChar(BoxDrawing._URD, 1 + title.length + 1, 0, borderFg, borderBg)

            ctx.drawChar(BoxDrawing.LU_D, width - 3, height + 1, borderFg, borderBg)
            ctx.drawChar(BoxDrawing._URD, width, height + 1, borderFg, borderBg)

            ctx.drawChar(BoxDrawing.LU_D, 1, height + 1, borderFg, borderBg)
            ctx.drawText(App.paint.char.toString(16).padStart(2, '0'), 2, height + 1, App.skin.glyphs.aligned, borderBg)
            ctx.drawChar(BoxDrawing._URD, 4, height + 1, borderFg, borderBg)
          },
          keydown(e) {
            if (e.code === 'ArrowUp') {
              const y = (App.paint.char / 16)|0
              const x = App.paint.char % 16
              App.paint.char = ((y + 15) % 16) * 16 + x
            }
            if (e.code === 'ArrowDown') {
              const y = (App.paint.char / 16)|0
              const x = App.paint.char % 16
              App.paint.char = ((y + 1) % 16) * 16 + x
            }
            if (e.code === 'ArrowLeft') {
              const y = (App.paint.char / 16)|0
              const x = App.paint.char % 16
              App.paint.char = y * 16 + (x + 15) % 16
            }
            if (e.code === 'ArrowRight') {
              const y = (App.paint.char / 16)|0
              const x = App.paint.char % 16
              App.paint.char = y * 16 + (x + 1) % 16
            }
          },
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
          mousedown({x, y, button}) {
            if (button === 0) {
              App.paint.char = y * 16 + x
            }
          }
        },
        button({
          x: 14,
          y: 18,
          width: 1,
          title() { return '<' },
          click() {
            App.later(() => {
              const newIdx = (App.fontIdx + fontConfig.length - 1) % fontConfig.length
              App.fontIdx = newIdx
              const newFont = fontConfig[newIdx]
              App.setFont(newFont).then(App.requestRedraw)
            })
          },
          keydown(e) {
            if (e.code === 'Comma' || ((e.ctrlKey || e.metaKey) && e.code === 'PageUp' /* NB. only works in pwa */))
              this.click()
          }
        }),
        button({
          x: 15,
          y: 18,
          width: 1,
          title() { return '>' },
          click() {
            App.later(() => {
              const newIdx = (App.fontIdx + 1) % fontConfig.length
              App.fontIdx = newIdx
              const newFont = fontConfig[newIdx]
              App.setFont(newFont).then(App.requestRedraw)
            })
          },
          keydown(e) {
            if (e.code === 'Period' || ((e.ctrlKey || e.metaKey) && e.code === 'PageDown' /* NB. only works in pwa */))
              this.click()
          }
        }),

        // -- Palette --
        {
          x: 0,
          y: 19,
          draw(ctx) {
            const title = 'Palette'
            ctx.drawText(title, 2, 0, App.skin.headers, App.skin.background)
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
            ctx.drawChar(BoxDrawing._URD, 1 + title.length + 1, 0, borderFg, borderBg)
            for (let i = 1 + title.length + 1 + 1; i < width + 1; i++)
              ctx.drawChar(BoxDrawing.L_R_, i, 0, borderFg, borderBg)
          }
        },
        {
          x: 1,
          y: 20,
          width: 16,
          height: 12,
          draw(ctx) {
            for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
              const i = y * 16 + x
              const color = App.palette[i] ?? {r: 0, g: 0, b: 0}
              ctx.drawChar(0, x, y, null, color)
              if (i === App.selectedPalette.fg) {
                const cw = Math.abs(apcaContrast(WHITE, color))
                const cb = Math.abs(apcaContrast(BLACK, color))
                const wb = cb > cw ? BLACK : WHITE
                ctx.drawText(i === App.selectedPalette.bg ? 'x' : 'f', x, y, wb)
              } else if (i === App.selectedPalette.bg) {
                const cw = Math.abs(apcaContrast(WHITE, color))
                const cb = Math.abs(apcaContrast(BLACK, color))
                const wb = cb > cw ? BLACK : WHITE
                ctx.drawText('b', x, y, wb)
              }
            }
          },
          mousedown({x, y, button}) {
            this.mouseWentDownInPalette = true
            const i = y * 16 + x
            if (button === 0) {
              if (App.selectedPalette.fg === i) {
                App.ui.push(colorChooser(App.palette[i], (c) => {
                  App.paint.fg = App.palette[i] = c
                }))
                this.mouseWentDownInPalette = false
              } else {
                App.paint.fg = App.palette[i]
                App.selectedPalette.fg = i
              }
            } else if (button === 2) {
              if (App.selectedPalette.bg === i) {
                App.ui.push(colorChooser(App.palette[i], (c) => {
                  App.paint.bg = App.palette[i] = c
                }))
                this.mouseWentDownInPalette = false
              } else {
                App.paint.bg = App.palette[i]
                App.selectedPalette.bg = i
              }
            }
          },
          mousemove({x, y, buttons}) {
            if (!this.mouseWentDownInPalette) return
            if (buttons & 1) {
              App.paint.fg = App.palette[y * 16 + x]
              App.selectedPalette.fg = y * 16 + x
            }
            if (buttons & 2) {
              App.paint.bg = App.palette[y * 16 + x]
              App.selectedPalette.bg = y * 16 + x
            }
          },
          mouseup() {
            this.mouseWentDownInPalette = false
          },
          blur() {
            this.mouseWentDownInPalette = false
          },
        },

        // -- Tools --
        {
          x: 0,
          y: 33,
          draw(ctx) {
            const title = 'Tools'
            ctx.drawText(title, 2, 0, App.skin.headers, App.skin.background)
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
          keydown(e) {
            if (e.code === 'KeyZ') App.undo()
          },
        }),
        button({
          x: 1,
          y: 35,
          width: 7,
          title() { return ' Redo  ' },
          click() { App.redo() },
          keydown(e) {
            if (e.code === 'KeyY') App.redo()
          },
        }),

        // -- Image --
        {
          x: 0,
          y: 41,
          draw(ctx) {
            const title = 'Image';
            ctx.drawText(title, 2, 0, App.skin.headers, App.skin.background)
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
          click() {
            App.files.push(newFile())
            App.selectedFile = App.files.length - 1
            App.save()
          },
        }),
        button({
          x: 1,
          y: 43,
          width: 7,
          title() { return ' Import' },
          async click() {
            if (window.showOpenFilePicker) {
              const handles = await window.showOpenFilePicker({
                id: 'import',
                types: [
                  {
                    description: 'REXPaint Files',
                    accept: {
                      'application/octet-stream+rexpaint': ['.xp'],
                    },
                  },
                ],
                excludeAcceptAllOption: true,
              })
              for (const handle of handles) {
                try {
                  const { layers } = await xp.read(await handle.getFile())
                  if (layers.length > 0) {
                    const file = newFile()
                    file.name = handle.name.replace(/\.xp$/, '')
                    file.layers = layers.map(l => ({ data: l.data }))
                    file.selectedLayer = 0
                    App.files.push(file)
                    App.selectedFile = App.files.length - 1
                  }
                } catch (e) {
                  console.error(`Error importing ${handle.name}`, e)
                }
              }
              if (handles.length) App.save()
            } else {
              const input = document.createElement('input')
              input.type = 'file'
              input.setAttribute('multiple', 'multiple')
              input.setAttribute('accept', '.xp')
              input.click()
              input.onchange = async () => {
                for (const f of input.files) {
                  try {
                    const { layers } = await xp.read(f)
                    if (layers.length > 0) {
                      const file = newFile()
                      file.name = f.name.replace(/\.xp$/, '')
                      file.layers = layers.map(l => ({ data: l.data }))
                      file.selectedLayer = 0
                      App.files.push(file)
                      App.selectedFile = App.files.length - 1
                    }
                  } catch (e) {
                    console.error(`Error importing ${f.name}`, e)
                  }
                }
                if (input.files.length) App.save()
              }
            }
          },
        }),
        button({
          x: 1,
          y: 44,
          width: 7,
          title() { return ' Export' },
          async click() {
            if (window.showSaveFilePicker) {
              const handle = await window.showSaveFilePicker({
                id: 'save',
                suggestedName: App.files[App.selectedFile].name + '.xp',
                types: [
                  {
                    description: 'REXPaint Files',
                    accept: {
                      'application/octet-stream+rexpaint': ['.xp'],
                    },
                  },
                ],
              }).catch(() => null)
              if (handle) {
                const writable = await handle.createWritable()
                const rxpBlob = await xp.write({
                  version: 0xffffffff,
                  layers: App.currentFile.layers,
                })
                const buf = await rxpBlob.arrayBuffer()
                await writable.write(buf)
                await writable.close()
              }
            } else {
              const a = document.createElement('a')
              const rxpBlob = await xp.write({
                version: 0xffffffff,
                layers: App.currentFile.layers,
              })
              const url = URL.createObjectURL(rxpBlob)
              try {
                a.href = url
                a.setAttribute('download', App.files[App.selectedFile].name + '.xp')
                a.click()
              } finally {
                URL.revokeObjectURL(url)
              }
            }
          },
        }),

        // -- Apply --
        {
          x: 9,
          y: 33,
          draw(ctx) {
            ctx.drawText('Apply', 2, 0, App.skin.headers, App.skin.background)
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
            ctx.drawText(' Glyph ', 0, 0, fg, bg)
            ctx.drawChar(App.paint.char, 6, 0, WHITE)
          },
          mousedown({button}) {
            if (button === 0) {
              App.apply.glyph = !App.apply.glyph
            }
          },
          keydown(e) {
            if (e.code === 'KeyG') App.apply.glyph = !App.apply.glyph
          },
        },
        button({
          x: 10,
          y: 35,
          width: 6,
          active() { return App.apply.fg },
          title() { return ' Fore ' },
          click() { App.apply.fg = !App.apply.fg },
          keydown(e) { if (e.code === 'KeyF') this.click() },
        }),
        button({
          x: 16,
          y: 35,
          width: 1,
          draw(ctx) {
            ctx.drawChar(0, 0, 0, null, App.paint.fg)
          },
          click() {
            App.ui.push(colorChooser(App.paint.fg, (c) => {
              App.paint.fg = c
              // TODO: also update selectedPalette
            }))
          },
        }),
        button({
          x: 10,
          y: 36,
          width: 6,
          title() { return ' Back ' },
          active() { return App.apply.bg },
          click() { App.apply.bg = !App.apply.bg },
          keydown(e) { if (e.code === 'KeyB') this.click() },
        }),
        button({
          x: 16,
          y: 36,
          width: 1,
          draw(ctx) {
            ctx.drawChar(0, 0, 0, BLACK, App.paint.bg)
          },
          click() {
            App.ui.push(colorChooser(App.paint.bg, (c) => {
              App.paint.bg = c
              // TODO: also update selectedPalette
            }))
          },
        }),

        // -- Draw --
        {
          x: 9,
          y: 39,
          draw(ctx) {
            const title = 'Draw';
            ctx.drawText('Draw', 2, 0, App.skin.headers, App.skin.background)
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
          keydown: ({code, ctrlKey, metaKey}) => !ctrlKey && !metaKey && code === 'KeyC' && App.selectTool('cell'),
        }),
        button({
          x: 10,
          y: 41,
          width: 7,
          title: () => ' Line  ',
          active: () => App.tool === 'line',
          click: () => App.selectTool('line'),
          keydown: ({code, ctrlKey, metaKey}) => code === 'KeyL' && !ctrlKey && !metaKey && App.selectTool('line'),
        }),
        button({
          x: 10,
          y: 42,
          width: 7,
          title: () => ` Rect ${App.toolOptions.fillRect ? '\u00fe' : '\u00ff'}`,
          active: () => App.tool === 'rect',
          click: () => App.selectTool('rect'),
          keydown: ({code}) => code === 'KeyR' && App.selectTool('rect'),
        }),
        button({
          x: 10,
          y: 43,
          width: 7,
          title: () => ` Oval ${App.toolOptions.fillOval ? '\u00fe' : '\u00ff'}`,
          active: () => App.tool === 'oval',
          click: () => App.selectTool('oval'),
          keydown: ({code}) => code === 'KeyO' && App.selectTool('oval'),
        }),
        button({
          x: 10,
          y: 44,
          width: 7,
          title: () => ` Fill ${App.toolOptions.fillEightNeighborhood ? '*' : '+'}`,
          active: () => App.tool === 'fill',
          click: () => App.selectTool('fill'),
          keydown: ({code}) => code === 'KeyI' && App.selectTool('fill'),
        }),
        button({
          x: 10,
          y: 45,
          width: 7,
          title: () => ' Text  ',
          active: () => App.tool === 'text',
          click: () => App.selectTool('text'),
          keydown: ({code}) => code === 'KeyT' && App.selectTool('text'),
        }),
        button({
          x: 10,
          y: 46,
          width: 7,
          title: () => ` Copy ${App.toolOptions.copyMode === 'copy' ? 'c' : 'x'}`,
          active: () => App.tool === 'copy',
          click: () => App.selectTool('copy'),
          keydown: (e) => {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
              App.tool = 'copy'
              App.toolOptions.copyMode = 'copy'
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyX') {
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
          keydown: (e) => (e.ctrlKey || e.metaKey) && e.code === 'KeyV' && App.selectTool('paste'),
        }),

        // -- Info --
        {
          x: 0,
          y: 49,
          draw(ctx) {
            const title = 'Info';
            ctx.drawText(title, 2, 0, App.skin.headers, App.skin.background)
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

            const canvas = App.ui.find(x => x.name === 'canvas')
            ctx.drawText(`Fore`, 1, 1, {r: 0.5,g:0.5,b:0.5})
            ctx.drawText(`Back`, 1, 2, {r: 0.5,g:0.5,b:0.5})
            if (canvas.tmouse) {
              const {x, y} = canvas.tmouse
              const { fg, bg } = App.currentLayer.data.get(x,y) ?? {}
              if (fg) {
                const {r, g, b} = fg
                ctx.drawText(`${[r,g,b].map(c => ((c*255)|0).toString().padStart(3, ' ')).join(' ')}`, 6, 1, App.skin.headers)
              } else {
                ctx.drawText(`${['-','-','-'].map(c => c.padStart(3, ' ')).join(' ')}`, 6, 1, App.skin.headers)
              }
              if (bg) {
                const {r, g, b} = bg
                ctx.drawText(`${[r,g,b].map(c => ((c*255)|0).toString().padStart(3, ' ')).join(' ')}`, 6, 2, App.skin.headers)
              } else {
                ctx.drawText(`${['-','-','-'].map(c => c.padStart(3, ' ')).join(' ')}`, 6, 2, App.skin.headers)
              }
            } else {
              ctx.drawText(`${['-','-','-'].map(c => c.padStart(3, ' ')).join(' ')}`, 6, 1, App.skin.headers)
              ctx.drawText(`${['-','-','-'].map(c => c.padStart(3, ' ')).join(' ')}`, 6, 2, App.skin.headers)
            }
            ctx.drawText(`Mem:${(performance.memory.usedJSHeapSize/1024/1024)|0}M`, 1, 3, {r: 0.5,g:0.5,b:0.5})
            if (canvas.tmouse) {
              const coords = `${canvas.tmouse.x},${canvas.tmouse.y}`
              ctx.drawText(coords, 17 - coords.length, 3, App.skin.headers)
            }
          },
        },

        // -- Layers --
        {
          x: 0,
          y: 54,
          draw(ctx) {
            const title = 'Layers'
            ctx.drawBorder(0, 0, 18, 2 + App.currentFile.layers.length, App.skin.borders, App.skin.background)
            ctx.drawChar(BoxDrawing.LU_D, 1, 0, App.skin.borders, App.skin.background)
            ctx.drawText(title, 2, 0, App.skin.headers, App.skin.background)
            ctx.drawChar(BoxDrawing._URD, 2 + title.length, 0, App.skin.borders, App.skin.background)
            const numLayers = App.currentFile.layers.length
            for (let y = 0; y < numLayers; y++) for (let x = 0; x < 16; x++)
              ctx.drawChar(0, x + 1, y + 1, null, App.skin.background)
            ctx.drawChar(BoxDrawing.LU_D, 14, numLayers + 1, App.skin.borders, App.skin.background)
            ctx.drawChar(BoxDrawing._URD, 16, numLayers + 1, App.skin.borders, App.skin.background)
          },
        },
        button({
          x: 15,
          y: 0, // dynamically updated during draw
          width: 1,
          title() { return '+' },
          draw(ctx) {
            this.y = 54 + App.currentFile.layers.length + 1
            this.drawButton(ctx)
          },
          click() {
            App.beginChange({changingLayer: -1})
            const nextLayerName = () => {
              let n = 1
              while (App.currentFile.layers.some(l => l.name === `Layer ${n}`)) n++
              return `Layer ${n}`
            }
            App.currentFile.layers.push({data: new CoordinateMap, name: nextLayerName()})
            App.currentFile.selectedLayer = App.currentFile.layers.length - 1
            App.finishChange()
          },
          keydown(e) {
            if (e.code === 'KeyL' && (e.ctrlKey || e.metaKey)) this.click()
          },
        }),
        {
          x: 1,
          y: 55,
          width: 16,
          height: 0, // dynamically calculated during draw
          draw(ctx) {
            const numLayers = App.currentFile.layers.length
            this.height = numLayers
            const { active, inactive, usable, highlight } = App.skin.buttons
            App.currentFile.layers.forEach((l, i) => {
              const y = numLayers - i - 1
              const mx = this.tmouse?.y === y ? this.tmouse.x : null
              ctx.drawText(
                (l.name ?? (i + 1).toString()).padEnd(10, ' '),
                0, y,
                i === App.currentFile.selectedLayer ? active : inactive,
                mx && mx < 10 ? highlight : null)
              if (numLayers > 1) {
                if (i < numLayers - 1)
                  ctx.drawChar(0x18, 12, y, usable, mx === 12 ? highlight : null)
                if (i > 0)
                  ctx.drawChar(0x19, 11, y, usable, mx === 11 ? highlight : null)
              }
              ctx.drawText('L', 13, y, l.locked ? active : inactive, mx === 13 ? highlight : null)
              ctx.drawText(l.hidden ? '\u00ed' : '\u00ec', 14, y, !l.hidden ? active : inactive, mx === 14 ? highlight : null)
              if (numLayers > 1) ctx.drawText('X', 15, y, usable, mx === 15 ? highlight : null)
            })
          },
          mousedown({x, y, button, shiftKey}) {
            if (button === 0) {
              const numLayers = App.currentFile.layers.length
              const li = numLayers - y - 1
              if (x < 11) {
                if (App.currentFile.selectedLayer === li)
                  App.ui.push(numberButton({
                    x: this.x,
                    y: this.y + y,
                    width: 10,
                    fg: App.skin.buttons.active,
                    align: 'left',
                    text: '',
                    captureKeys: true,
                    pattern: /.*/,
                    stopEditing() {
                      App.ui.splice(App.ui.lastIndexOf(this), 1)
                    },
                    setValue(name) {
                      App.beginChange({layerDataUnchanged: true, changingLayer: li})
                      App.currentFile.layers[li].name = name
                      App.finishChange()
                    }
                  }))
                else
                  App.currentFile.selectedLayer = li
              }
              if (x === 11) { // Move down
                if (numLayers > 1 && li > 0) {
                  if (shiftKey) {
                    App.mergeDown(li)
                  } else {
                    App.beginChange({layerDataUnchanged: true, changingLayer: -1})
                    const tmp = App.currentFile.layers[li - 1]
                    App.currentFile.layers[li - 1] = App.currentFile.layers[li]
                    App.currentFile.layers[li] = tmp
                    App.finishChange()
                  }
                }
              }
              if (x === 12) { // Move up
                if (numLayers > 1 && li < numLayers - 1) {
                  if (shiftKey) {
                    App.mergeDown(li + 1)
                  } else {
                    App.beginChange({layerDataUnchanged: true, changingLayer: -1})
                    const tmp = App.currentFile.layers[li + 1]
                    App.currentFile.layers[li + 1] = App.currentFile.layers[li]
                    App.currentFile.layers[li] = tmp
                    App.finishChange()
                  }
                }
              }
              if (x === 13) { // Lock
                App.beginChange({layerDataUnchanged: true, changingLayer: li})
                App.currentFile.layers[li].locked = !App.currentFile.layers[li].locked
                App.finishChange()
              }
              if (x === 14) { // Toggle hidden
                App.beginChange({layerDataUnchanged: true, changingLayer: li})
                App.currentFile.layers[li].hidden = !App.currentFile.layers[li].hidden
                App.finishChange()
              }
              if (x === 15 && numLayers > 1) { // Delete
                App.beginChange({changingLayer: -1})
                App.currentFile.layers.splice(li, 1)
                App.currentFile.selectedLayer = Math.min(App.currentFile.layers.length - 1, App.currentFile.selectedLayer)
                App.finishChange()
              }
            }
          },
          keydown(e) {
            const m = /^Digit([0-9])$/.exec(e.code)
            if (m) {
              const n = +m[1]
              const li = n === 0 ? 9 : n - 1
              if (li < App.currentFile.layers.length) {
                if (e.shiftKey) {
                  App.beginChange({layerDataUnchanged: true, changingLayer: li})
                  App.currentFile.layers[li].locked = !App.currentFile.layers[li].locked
                  App.finishChange()
                } else {
                  App.currentFile.selectedLayer = li
                }
              }
            }
            if (e.code === 'KeyM' && e.ctrlKey && e.shiftKey) {
              App.mergeDown(App.currentFile.selectedLayer)
            }
          },
        },
      ],
    },

    // -- Browse Sidebar --
    {
      name: 'sidebar/browse',
      display() { return App.sidebar === 'browse' },
      children: [
        {
          x: 0,
          y: 1,
          draw(ctx) {
            const title = 'Images';
            ctx.drawText(title, 2, 0, App.skin.info, App.skin.background)
            const borderFg = App.skin.borders
            const borderBg = App.skin.background
            const height = ctx.height - 3
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
          },
        },
        {
          x: 1,
          y: 2,
          width: 16,
          height: Infinity,
          draw(ctx) {
            App.files.forEach((f, i) => {
              const fg = i === App.selectedFile ? App.skin.buttons.active : App.skin.buttons.inactive
              const hovered = this.tmouse?.y === i
              const bg = hovered ? App.skin.buttons.highlight : null
              const text = f.name.length <= 15 || hovered ? f.name : f.name.substring(0, 9) + '...' + f.name.substring(f.name.length - 3, f.name.length)
              ctx.drawText((' ' + text).padEnd(15, ' '), 0, i, fg, bg)
              if (hovered) {
                ctx.drawText('x', 0, i, App.skin.buttons.usable)
              }
            })
          },
          mousedown({x, y, button}) {
            if (button === 0) {
              if (y < App.files.length) {
                if (x === 0) {
                  App.ui.push(deleteDialog(App.files[y]))
                } else {
                  App.selectedFile = y
                }
              }
            } else if (button === 2) {
              if (y === App.selectedFile)
                App.ui.push(renameDialog(App.files[App.selectedFile]))
            }
          },
          keydown({code}) {
            if (code === 'ArrowDown') {
              App.selectedFile = (App.selectedFile + 1) % App.files.length
            } else if (code === 'ArrowUp') {
              App.selectedFile = (App.selectedFile + App.files.length - 1) % App.files.length
            }
          },
        },
      ],
    },
  ],
  async setFont(font) {
    const image = await new Promise((resolve, reject) => {
      const img = new Image
      img.src = `fonts/${font.art.file}.png`
      img.onload = () => resolve(img)
      img.onerror = reject
    })

    this.font = {
      image,
      tileWidth: image.width / font.art.columns,
      tileHeight: image.height / font.art.rows,
    }
  },
  init() {
    for (const el of this.eachUiIncludingInvisible())
      initUi(el)
  },

  *eachUiIncludingInvisible() {
    yield* iterate(this.ui)
    function* iterate(els) {
      for (const el of els) {
        yield el
        if (el.children) {
          yield* iterate(el.children)
        }
      }
    }
  },

  *eachUi() {
    yield* iterate(this.ui, [])
    function* iterate(els, ancestors) {
      for (const el of els.slice()) {
        const display = el.display ?? true
        if (display && (typeof display !== 'function' || display())) {
          yield [el, ancestors]
          yield* iterate(el.children ?? [], [...ancestors, el])
        }
      }
    }
  },
  *eachUiReverse() {
    yield* iterate(this.ui, [])
    function* iterate(els, ancestors) {
      for (const el of els.slice().reverse()) {
        const display = el.display ?? true
        if (display && (typeof display !== 'function' || display())) {
          yield* iterate(el.children ?? [], [...ancestors, el])
          yield [el, ancestors]
        }
      }
    }
  },

  laters: [],
  later(fn) {
    this.laters.push(fn)
  },
  doLaters() {
    this.laters.forEach(f => f())
    this.laters.length = 0
  },
  draw({width, height, drawChar, fill}) {
    for (const [el, ancestors] of this.eachUi()) {
      if (el.draw) {
        const px = ancestors.reduce((m, o) => m + (o.x ?? 0), 0)
        const py = ancestors.reduce((m, o) => m + (o.y ?? 0), 0)
        el._px = px
        el._py = py
        el.draw({
          width, height,
          drawChar(c, x, y, fg, bg) {
            drawChar(App.font.image, c, x + px + el.x, y + py + el.y, fg, bg)
          },
          drawText(str, x, y, fg, bg) {
            str = '' + str
            for (let i = 0; i < str.length; i++) {
              this.drawChar(str.charCodeAt(i), x+i, y, fg, bg)
            }
          },
          drawBorder(x, y, width, height, fg = App.skin.borders, bg = App.skin.background) {
            for (let i = 0; i < height - 1; i++) {
              this.drawChar(BoxDrawing._U_D, x, y+i, fg, bg)
              this.drawChar(BoxDrawing._U_D, x + width - 1, y+i, fg, bg)
            }
            for (let i = 0; i < width - 1; i++) {
              this.drawChar(BoxDrawing.L_R_, x + i, y, fg, bg)
              this.drawChar(BoxDrawing.L_R_, x + i, y + height - 1, fg, bg)
            }
            this.drawChar(BoxDrawing.__RD, x, y, fg, bg)
            this.drawChar(BoxDrawing._UR_, x, y + height - 1, fg, bg)
            this.drawChar(BoxDrawing.L__D, x + width - 1, y, fg, bg)
            this.drawChar(BoxDrawing.LU__, x + width - 1, y + height - 1, fg, bg)
          },
          fill(x, y, width, height, color) {
            fill(x + px + el.x, y + py + el.y, width, height, color)
          }
        })
      }
    }
    this.doLaters()
  },
  mousemove(e) {
    const { x, y } = this.tmouse
    for (const [el, ancestors] of this.eachUiReverse()) {
      if (el.mousemove) {
        const ox = el.x + ancestors.reduce((m, o) => m + (o.x ?? 0), 0)
        const oy = el.y + ancestors.reduce((m, o) => m + (o.y ?? 0), 0)
        if (x >= ox && x < ox + el.width && y >= oy && y < oy + el.height) {
          e.x = x - ox
          e.y = y - oy
          el.mousemove(e)
        }
      }
      if (e.propagationStopped) break
    }
    this.doLaters()
  },
  mousedown(e) {
    const { x, y } = this.tmouse
    for (const [el, ancestors] of this.eachUiReverse()) {
      const keyWasCaptured = el.captureKeys
      if (el.mousedown) {
        const ox = el.x + ancestors.reduce((m, o) => m + (o.x ?? 0), 0)
        const oy = el.y + ancestors.reduce((m, o) => m + (o.y ?? 0), 0)
        if (x >= ox && x < ox + el.width && y >= oy && y < oy + el.height) {
          e.x = x - ox
          e.y = y - oy
          el.mousedown(e)
        }
      }
      if (e.propagationStopped || keyWasCaptured) break
    }
    this.doLaters()
  },
  mouseup(e) {
    if (this.tmouse) {
      const { x, y } = this.tmouse
      for (const [el, ancestors] of this.eachUiReverse()) {
        const keyWasCaptured = el.captureKeys
        if (el.mouseup) {
          const ox = el.x + ancestors.reduce((m, o) => m + (o.x ?? 0), 0)
          const oy = el.y + ancestors.reduce((m, o) => m + (o.y ?? 0), 0)
          if (x >= ox && x < ox + el.width && y >= oy && y < oy + el.height) {
            e.x = x - ox
            e.y = y - oy
            el.mouseup(e)
          }
        }
        if (e.propagationStopped || keyWasCaptured) break
      }
    }
    this.doLaters()
  },
  keydown(e) {
    for (const [el] of this.eachUiReverse()) {
      const keyWasCaptured = el.captureKeys
      if (el.keydown)
        el.keydown(e)
      if (e.propagationStopped || keyWasCaptured) break
    }
    this.doLaters()
  },
  keyup(e) {
    for (const [el] of this.eachUiReverse()) {
      const keyWasCaptured = el.captureKeys
      if (el.keyup)
        el.keyup(e)
      if (e.propagationStopped || keyWasCaptured) break
    }
    this.doLaters()
  },
  keypress(e) {
    for (const [el] of this.eachUiReverse()) {
      const keyWasCaptured = el.captureKeys
      if (el.keypress)
        el.keypress(e)
      if (e.propagationStopped || keyWasCaptured) break
    }
    this.doLaters()
  },
  blur() {
    for (const [el] of this.eachUiReverse())
      if (el.blur)
        el.blur()
    this.doLaters()
  }
}
window.App = App

async function start() {
  App.init()
  const art = await idb.getItem('art')
  if (art) {
    App.files = art.files.map(f => (
      {
        ...f,
        layers: f.layers.map(l => {
          if (typeof [...l.data.keys()][0] === 'string') {
            const data = new CoordinateMap()
            for (const [k, v] of l.data.entries()) {
              const [x, y] = k.split(',')
              data.set(+x, +y, v)
            }
            return {...l, data}
          }
          return {...l, data: new CoordinateMap({_map: l.data})}
        })
      }
    ))
    App.selectedFile = art.selectedFile
  }
  App.fontIdx = 0
  await App.setFont(fontConfig[0])
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.imageRendering = 'pixelated'
  document.body.appendChild(canvas)
  const gl = canvas.getContext('webgl')
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
  App.requestRedraw = dirty

  const textureForImage = new WeakMap
  function getTexture(img) {
    if (!textureForImage.get(img))
      textureForImage.set(img, new Texture(gl, new ImageTextureSource(img)))
    return textureForImage.get(img)
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height)
    spriteBatch.resize(canvas.width, canvas.height)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    function drawChar(img, c, dx, dy, fg, bg) {
      const tex = getTexture(img)
      const tw = App.font.tileWidth, th = App.font.tileHeight
      if (dx < -tw || dy < -th || dx >= canvas.width || dy >= canvas.height) return
      const sx = c % 16
      const sy = (c / 16) | 0
      const isTransparent = ({r, g, b}) => r === 1 && g === 0 && b === 1
      const realBg =
        bg && isTransparent(bg)
        ? fg && !isTransparent(fg)
          ? BLACK // fg on transparent bg needs to be black to avoid overlaying
          : null
        : bg;
      if (realBg != null) {
        const bgsx = 0xdb % 16
        const bgsy = (0xdb / 16) | 0
        // TODO: not all fonts might have 0xdb be the full square? maybe have
        // to fix this one at some point.
        spriteBatch.drawRegion(tex, bgsx * tw, bgsy * th, tw, th, dx, dy, tw, th, realBg)
      }
      if (fg != null)
        if (!(fg.r === 1 && fg.g === 0 && fg.b === 1))
          spriteBatch.drawRegion(tex, sx * tw, sy * th, tw, th, dx, dy, tw, th, fg)
    }

    console.time('draw')
    spriteBatch.begin()
    App.draw({
      width: (canvas.width / App.font.tileWidth) | 0,
      height: (canvas.height / App.font.tileHeight) | 0,
      drawChar(img, c, tx, ty, fg, bg) {
        drawChar(img, c, tx * App.font.tileWidth, ty * App.font.tileHeight, fg, bg)
      },
      fill(tx, ty, w, h, color) {
        const tex = getTexture(App.font.image)
        const tw = App.font.tileWidth, th = App.font.tileHeight
        const bgsx = 0xdb % 16
        const bgsy = (0xdb / 16) | 0
        // TODO: not all fonts might have 0xdb be the full square? maybe have
        // to fix this one at some point.
        spriteBatch.drawRegion(tex, bgsx * tw, bgsy * th, tw, th, tx * tw, ty * tw, tw * w, th * h, color)
      }
    })
    spriteBatch.end()
    console.timeEnd('draw')
  }

  window.addEventListener('mousemove', (e) => {
    if (document.hasFocus()) {
      App.mouse = { x: e.clientX, y: e.clientY }
      App.mousemove({
        x: e.clientX,
        y: e.clientY,
        buttons: e.buttons,
        stopPropagation() {
          this.propagationStopped = true
        }
      })
      dirty()
    }
  })

  canvas.addEventListener('mousedown', (e) => {
    App.mouse = { x: e.clientX, y: e.clientY }
    App.mouseButtons = e.buttons
    App.mousedown({
      x: e.clientX,
      y: e.clientY,
      button: e.button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      stopPropagation() {
        this.propagationStopped = true
      }
    })
    dirty()
  })
  window.addEventListener('mouseup', (e) => {
    App.mouseButtons = e.buttons
    App.mouseup({
      x: e.clientX,
      y: e.clientY,
      button: e.button,
      buttons: e.buttons,
      stopPropagation() {
        this.propagationStopped = true
      }
    })
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
    if (e.code === 'Tab') e.preventDefault()
    App.keydown({
      code: e.code,
      metaKey: e.metaKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      stopPropagation() {
        this.propagationStopped = true
      }
    })
    dirty()
  })
  window.addEventListener('keyup', (e) => {
    App.keyup({
      code: e.code,
      metaKey: e.metaKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      stopPropagation() {
        this.propagationStopped = true
      }
    })
    dirty()
  })

  window.addEventListener('keypress', (e) => {
    App.keypress({
      code: e.code,
      key: e.key,
      metaKey: e.metaKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      stopPropagation() {
        this.propagationStopped = true
      }
    })
    dirty()
  })
}

start()
