const {getInversedPrice, getBigIntPrice, getVWAP} = require('../price-utils')

class OHLCV {
    /**
     *
     * @param {{open: any, high: any, low: any, close: any, volume: number, quoteVolume: number, inversed: boolean, source: string}} raw - raw data
     */
    constructor(raw) {
        //normalize data
        raw = {
            ...raw,
            open: getBigIntPrice(raw.open, raw.decimals),
            high: getBigIntPrice(raw.high, raw.decimals),
            low: getBigIntPrice(raw.low, raw.decimals),
            close: getBigIntPrice(raw.close, raw.decimals),
            quoteVolume: Number(raw.quoteVolume),
            volume: Number(raw.volume)
        }
        const {open, high, low, close, volume, quoteVolume, inversed, source, decimals} = raw
        this.open = inversed ? getInversedPrice(open, decimals) : open
        this.high = inversed ? getInversedPrice(low, decimals) : high
        this.low = inversed ? getInversedPrice(high, decimals) : low
        this.close = inversed ? getInversedPrice(close, decimals) : close
        this.volume = inversed ? quoteVolume : volume
        this.quoteVolume = inversed ? volume : quoteVolume
        this.decimals = decimals
        this.source = source
    }

    /**
     * @type {BigInt}
     * @readonly
     */
    open
    /**
     * @type {BigInt}
     * @readonly
     */
    high
    /**
     * @type {BigInt}
     * @readonly
     */
    low
    /**
     * @type {BigInt}
     * @readonly
     */
    close
    /**
     * @type {number}
     * @readonly
     */
    volume
    /**
     * @type {number}
     * @readonly
     */
    quoteVolume
    /**
     * @type {string}
     * @readonly
     */
    source
    /**
     * @type {number}
     * @readonly
     */
    decimals

    /**
     * Returns VWAP price for the OHLCV
     * @returns {BigInt}
     */
    price() {
        if (this.volume === 0 || this.quoteVolume === 0)
            return this.close
        return getVWAP(this.volume, this.quoteVolume, this.decimals)
    }

    toJSON() {
        return JSON.stringify({
            open: this.open.toString(),
            high: this.high.toString(),
            low: this.low.toString(),
            close: this.close.toString(),
            volume: this.volume,
            quoteVolume: this.quoteVolume,
            source: this.source,
            decimals: this.decimals
        })
    }
}

module.exports = OHLCV