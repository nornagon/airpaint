// https://github.com/madbence/node-bresenham
// MIT licensed
export function bresenhamLine(x0, y0, x1, y1, fn) {
  if(!fn) {
    var arr = [];
    fn = function(x, y) { arr.push({ x: x, y: y }); };
  }
  var dx = x1 - x0;
  var dy = y1 - y0;
  var adx = Math.abs(dx);
  var ady = Math.abs(dy);
  var eps = 0;
  var sx = dx > 0 ? 1 : -1;
  var sy = dy > 0 ? 1 : -1;
  if(adx > ady) {
    for(var x = x0, y = y0; sx < 0 ? x >= x1 : x <= x1; x += sx) {
      fn(x, y);
      eps += ady;
      if((eps<<1) >= adx) {
        y += sy;
        eps -= adx;
      }
    }
  } else {
    for(var x = x0, y = y0; sy < 0 ? y >= y1 : y <= y1; y += sy) {
      fn(x, y);
      eps += adx;
      if((eps<<1) >= ady) {
        x += sx;
        eps -= ady;
      }
    }
  }
  return arr;
};

/**
 * Ref https://github.com/w8r/bresenham-zingl/blob/master/src/ellipse.js
 * Draws ellipse
 * @param  {number} xm
 * @param  {number} ym
 * @param  {number} a
 * @param  {number} b
 * @param  {Function} setPixel
 */
export function ellipse(xm, ym, a, b, setPixel) {
  var x = -a, y = 0; /* II. quadrant from bottom left to top right */
  var e2 = b * b, err = x * (2 * e2 + x) + e2; /* error of 1.step */

  do {
    setPixel(xm - x, ym + y); /*   I. Quadrant */
    setPixel(xm + x, ym + y); /*  II. Quadrant */
    setPixel(xm + x, ym - y); /* III. Quadrant */
    setPixel(xm - x, ym - y); /*  IV. Quadrant */
    e2 = 2 * err;
    if (e2 >= (x * 2 + 1) * b * b) /* e_xy+e_x > 0 */
      err += (++x * 2 + 1) * b * b;
    if (e2 <= (y * 2 + 1) * a * a) /* e_xy+e_y < 0 */
      err += (++y * 2 + 1) * a * a;
  } while (x <= 0);

  while (y++ < b) { /* too early stop of flat ellipses a=1, */
    setPixel(xm, ym + y); /* -> finish tip of ellipse */
    setPixel(xm, ym - y);
  }
}

export function filledEllipse(xm, ym, a, b, setPixel) {
  var x = -a, y = 0; /* II. quadrant from bottom left to top right */
  var e2 = b * b, err = x * (2 * e2 + x) + e2; /* error of 1.step */

  do {
    for (let yi = ym - y; yi <= ym + y; yi++) {
    setPixel(xm - x, yi);
    setPixel(xm + x, yi);
    }
    e2 = 2 * err;
    if (e2 >= (x * 2 + 1) * b * b) /* e_xy+e_x > 0 */
      err += (++x * 2 + 1) * b * b;
    if (e2 <= (y * 2 + 1) * a * a) /* e_xy+e_y < 0 */
      err += (++y * 2 + 1) * a * a;
  } while (x <= 0);

  while (y++ < b) { /* too early stop of flat ellipses a=1, */
    setPixel(xm, ym + y); /* -> finish tip of ellipse */
    setPixel(xm, ym - y);
  }
}
