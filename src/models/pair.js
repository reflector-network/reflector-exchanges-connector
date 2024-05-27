class Pair {
    /**
     *
     * @param {Asset} base - base asset
     * @param {Asset} quote - quote asset
     */
    constructor(base, quote) {
        this.base = base
        this.quote = quote
        this.name = `${quote.name}/${base.name}`
    }

    /**
     * @type {Asset}
     * @readonly
     */
    base
    /**
     * @type {Asset}
     * @readonly
     */
    quote
    /**
     * @type {string}
     * @readonly
     */
    name
}

module.exports = Pair