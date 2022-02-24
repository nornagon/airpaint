export const BoxDrawing = {
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
export const BoxDrawingDouble = {
  LURD: 0xce,
  LUR_: 0xca,
  LU_D: 0xb9,
  L_RD: 0xcb,
  _URD: 0xcc,
  __RD: 0xc9,
  _UR_: 0xc8,
  LU__: 0xbc,
  L__D: 0xbb,
  L_R_: 0xcd,
  _U_D: 0xba,
}
export const BoxDrawingB = [
  BoxDrawing.LURD, // ____
  BoxDrawing._U_D, // ___D
  BoxDrawing.L_R_, // __R_
  BoxDrawing.__RD,
  BoxDrawing._U_D, // _U__
  BoxDrawing._U_D,
  BoxDrawing._UR_,
  BoxDrawing._URD,
  BoxDrawing.L_R_, // L___
  BoxDrawing.L__D,
  BoxDrawing.L_R_,
  BoxDrawing.L_RD,
  BoxDrawing.LU__,
  BoxDrawing.LU_D,
  BoxDrawing.LUR_,
  BoxDrawing.LURD,
]
export const BoxDrawingDoubleB = [
  BoxDrawingDouble.LURD, // ____
  BoxDrawingDouble._U_D, // ___D
  BoxDrawingDouble.L_R_, // __R_
  BoxDrawingDouble.__RD,
  BoxDrawingDouble._U_D, // _U__
  BoxDrawingDouble._U_D,
  BoxDrawingDouble._UR_,
  BoxDrawingDouble._URD,
  BoxDrawingDouble.L_R_, // L___
  BoxDrawingDouble.L__D,
  BoxDrawingDouble.L_R_,
  BoxDrawingDouble.L_RD,
  BoxDrawingDouble.LU__,
  BoxDrawingDouble.LU_D,
  BoxDrawingDouble.LUR_,
  BoxDrawingDouble.LURD,
]
export function boxDrawingChar(cl, cu, cr, cd) {
  return BoxDrawingB[(cl << 3) | (cu << 2) | (cr << 1) | cd]
}
export function boxDrawingDoubleChar(cl, cu, cr, cd) {
  return BoxDrawingDoubleB[(cl << 3) | (cu << 2) | (cr << 1) | cd]
}
export function isSingleBoxDrawingChar(c) {
  return (c >= 0xbf && c <= 0xc5) || (c >= 0xb3 && c <= 0xb4) || (c >= 0xd9 && c <= 0xda)
}
export function isDoubleBoxDrawingChar(c) {
  return (c >= 0xb9 && c <= 0xbc) || (c >= 0xc8 && c <= 0xce)
}
