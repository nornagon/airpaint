export class CoordinateMap {
  _map = new Map
  constructor(other) {
    if (other)
      this._map = new Map([...other._map.entries()].map(([k, v]) => [k, new Map(v)]))
  }

  get(x, y) {
    return this._map.get(y)?.get(x)
  }

  set(x, y, v) {
    if (!this._map.has(y)) this._map.set(y, new Map)
    this._map.get(y).set(x, v)
  }

  delete(x, y) {
    if (this._map.has(y)) {
      const row = this._map.get(y)
      row.delete(x)
      if (row.size === 0)
        this._map.delete(y)
    }
  }

  *entries() {
    for (const [y, row] of this._map.entries())
      for (const [x, v] of row.entries())
        yield [[x, y], v]
  }

  *keys() {
    for (const [y, row] of this._map.entries())
      for (const x of row.keys())
        yield [x, y]
  }
}

