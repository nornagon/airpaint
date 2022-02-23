// https://www.w3.org/WAI/GL/task-forces/silver/wiki/Visual_Contrast_of_Text_Subgroup/APCA_model
// https://github.com/Myndex/SAPC-APCA/blob/master/src/JS/SAPC_0_98G_4g_minimal.js
export function sRGBtoY(color) {
  const { r, g, b } = color
  function gamma(c) { return Math.pow(c, 2.4); }
  return 0.2126729 * gamma(r) + 0.7151522 * gamma(g) + 0.0721750 * gamma(b);
}
export function apcaContrast(txtColor, bgColor) {
  return _apcaContrast(sRGBtoY(txtColor), sRGBtoY(bgColor))
}
function _apcaContrast(txtY, bgY) {
  const blkThrs = 0.022,
    blkClmp = 1.414, 
    scaleBoW = 1.14,
    scaleWoB = 1.14,
    loWoBthresh = 0.035991,
    loBoWthresh = 0.035991,
    loWoBfactor = 27.7847239587675,
    loBoWfactor = 27.7847239587675,
    loBoWoffset = 0.027,
    loWoBoffset = 0.027,
    loClip = 0.001,
    deltaYmin = 0.0005;
  const normBG = 0.56, 
    normTXT = 0.57,
    revTXT = 0.62,
    revBG = 0.65;

  var SAPC = 0.0;
  var outputContrast = 0.0;
  txtY = (txtY > blkThrs) ? txtY :
                            txtY + Math.pow(blkThrs - txtY, blkClmp);
  bgY = (bgY > blkThrs) ? bgY :
                          bgY + Math.pow(blkThrs - bgY, blkClmp);

  if ( Math.abs(bgY - txtY) < deltaYmin ) { return 0.0; }

  if ( bgY > txtY ) {
    SAPC = ( Math.pow(bgY, normBG) - Math.pow(txtY, normTXT) ) * scaleBoW;
    outputContrast = (SAPC < loClip) ? 0.0 :
                     (SAPC < loBoWthresh) ?
                      SAPC - SAPC * loBoWfactor * loBoWoffset :
                      SAPC - loBoWoffset;

  } else {
    SAPC = ( Math.pow(bgY, revBG) - Math.pow(txtY, revTXT) ) * scaleWoB;

    outputContrast = (SAPC > -loClip) ? 0.0 :
                     (SAPC > -loWoBthresh) ?
                      SAPC - SAPC * loWoBfactor * loWoBoffset :
                      SAPC + loWoBoffset;
  }
  return outputContrast * 100.0;
}

// https://www.w3.org/WAI/GL/wiki/Relative_luminance#Definition_as_Stated_in_WCAG_2.x
// see also https://stackoverflow.com/a/56678483
export function relativeLuminance(color) {
  const { r, g, b } = color
  const R = r <= 0.04045 ? r/12.92 : Math.pow((r+0.055)/1.055, 2.4)
  const G = g <= 0.04045 ? g/12.92 : Math.pow((g+0.055)/1.055, 2.4)
  const B = b <= 0.04045 ? b/12.92 : Math.pow((b+0.055)/1.055, 2.4)
  return 0.2126*R + 0.7152*G + 0.0722*B
}
