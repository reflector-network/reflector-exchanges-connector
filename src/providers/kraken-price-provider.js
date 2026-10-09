/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.kraken.com/0'

class KrakenPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'kraken'

    /**
     * Kraken always answers {error: [], result: {...}}; a non-empty error list is a failure.
     * @param {any} data - response payload
     * @returns {object} result
     */
    __requireResult(data) {
        if (!data || !Array.isArray(data.error) || data.error.length > 0)
            throw new Error(`kraken: ${Array.isArray(data?.error) ? data.error.join(', ') : 'unexpected payload'}`)
        if (!data.result || typeof data.result !== 'object')
            throw new Error('kraken: unexpected klines payload')
        return data.result
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/public/AssetPairs`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireResult(response.data)
        return Object.keys(markets)
            .filter(market => markets[market].status.toUpperCase() === 'ONLINE')
            .map(market => markets[market].altname)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const timeframeSeconds = timeframe * 60
        const to = timestamp + timeframeSeconds * count
        //since is exclusive, so we need to subtract a second to get the kline that matches the timestamp
        const klinesUrl = `${baseApiUrl}/public/OHLC?pair=${symbolInfo.symbol}&interval=${timeframe}&since=${timestamp - 1}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const result = this.__requireResult(response.data)
        //Kraken API returns an object with the last and the pair name. Pair name is not always the same as the symbol
        const pairKey = Object.keys(result).filter(k => k !== 'last')[0]
        const klines = this.__requireArray(result[pairKey])
            //Kraken API doesn't have limit=1, so we need to filter the klines
            .filter(kline => PriceProviderBase.toNumber(kline[0], 'timestamp') >= timestamp && PriceProviderBase.toNumber(kline[0], 'timestamp') < to)

        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline[0], 'timestamp'),
            volume: PriceProviderBase.validateAmount(kline[6], 'volume'),
            quoteVolume: PriceProviderBase.toNumber(kline[5], 'vwap') * PriceProviderBase.toNumber(kline[6], 'volume'), //volume * vwap
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }

    __formatSymbol(base, quote) {
        return `${base}${quote}`
    }
}

module.exports = KrakenPriceProvider
