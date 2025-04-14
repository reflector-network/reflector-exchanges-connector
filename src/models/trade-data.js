/**
 * Convert arbitrary stringified amount to int64 representation
 * @param {string|number} value - amount to convert
 * @param {number} decimals - number of decimal places
 * @return {BigInt}
 */
function volumeToBigInt(value, decimals = 7) {
    if (!value)
        return 0n
    if (typeof value === 'number') {
        value = value.toFixed(decimals)
    }
    if (typeof value !== 'string' || !/^-?[\d.,]+$/.test(value))
        return 0n //invalid format
    try {
        const [int, decimal] = value.split('.', 2)
        let res = BigInt(int) * (10n ** BigInt(decimals))
        if (decimal) {
            res += BigInt(decimal.slice(0, decimals).padEnd(decimals, '0'))
        }
        return res
    } catch (e) {
        return 0n
    }
}


class TradeData {
    /**
     *
     * @param {{volume: (number|string), quoteVolume: (number|string), inversed: boolean, source: string, completed: boolean}} raw - raw data
     */
    constructor(raw) {
        const {volume, quoteVolume, inversed, source, completed} = raw
        this.volume = volumeToBigInt(inversed ? quoteVolume : volume)
        this.quoteVolume = volumeToBigInt(inversed ? volume : quoteVolume)
        this.source = source
        this.completed = completed
        this.ts = raw.ts
    }

    /**
     * @type {BigInt}
     * @readonly
     */
    volume

    /**
     * @type {BigInt}
     * @readonly
     */
    quoteVolume

    /**
     * @type {string}
     * @readonly
     */
    source

    /**
     * @type {boolean}
     * @readonly
     */
    completed

    toJSON() {
        return JSON.stringify(this.toPlainObject())
    }

    toPlainObject() {
        return {
            volume: this.volume,
            quoteVolume: this.quoteVolume,
            source: this.source
        }
    }
}

module.exports = TradeData