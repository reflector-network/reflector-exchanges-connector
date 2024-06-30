class TradeData {
    /**
     *
     * @param {{volume: number, quoteVolume: number, inversed: boolean, source: string, completed: boolean}} raw - raw data
     */
    constructor(raw) {
        //normalize data
        raw = {
            ...raw,
            quoteVolume: Number(raw.quoteVolume),
            volume: Number(raw.volume)
        }
        const {volume, quoteVolume, inversed, source, completed} = raw
        this.volume = inversed ? quoteVolume : volume
        this.quoteVolume = inversed ? volume : quoteVolume
        this.source = source
        this.completed = completed
        this.ts = raw.ts
    }

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
            source: this.source,
            completed: this.completed
        }
    }
}

module.exports = TradeData