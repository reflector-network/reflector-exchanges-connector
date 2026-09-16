/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.exchange.coinbase.com'

class CoinbasePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'coinbase'

    /**
     * Coinbase answers errors with an object {message} where a list is expected.
     * @param {any} data - response payload
     * @returns {any[]}
     */
    __requireList(data) {
        if (data && !Array.isArray(data) && data.message !== undefined)
            throw new Error(`coinbase: ${data.message}`)
        return this.__requireArray(data)
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/products`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data)
        return markets
            .filter(market => market.status.toUpperCase() === 'ONLINE')
            .map(market => market.id)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const timeframeSeconds = timeframe * 60
        const end = timestamp + ((count - 1) * timeframeSeconds) //end is inclusive, so we need to subtract 1
        const klinesUrl = `${baseApiUrl}/products/${symbolInfo.symbol}/candles?granularity=${timeframe}m&start=${timestamp}&end=${end}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data)
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        const [ts, low, high, open, close, volume] = [
            PriceProviderBase.toNumber(kline[0], 'timestamp'),
            PriceProviderBase.toNumber(kline[1], 'low'),
            PriceProviderBase.toNumber(kline[2], 'high'),
            PriceProviderBase.toNumber(kline[3], 'open'),
            PriceProviderBase.toNumber(kline[4], 'close'),
            PriceProviderBase.toNumber(kline[5], 'volume')
        ]
        return new TradeData({
            ts,
            volume: PriceProviderBase.validateAmount(kline[5], 'volume'),
            quoteVolume: volume * ((close + open + high + low) / 4), //volume * average price; coinbase has no quote volume
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }

    __formatSymbol(base, quote) {
        return `${base}-${quote}`
    }
}

module.exports = CoinbasePriceProvider
