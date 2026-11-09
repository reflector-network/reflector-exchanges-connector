/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://whitebit.com/api'

/**
 * @param {any} message - WhiteBIT error message: a string, or an object of field name to messages
 * @returns {string}
 */
function formatMessage(message) {
    if (message && typeof message === 'object')
        return Object.values(message).flat().join(', ')
    return String(message)
}

class WhitebitPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'whitebit'

    quoteOrder = ['USDT', 'USDC', 'USD']

    /**
     * WhiteBIT answers errors with {success: false, message}.
     * @param {any} data - response payload
     * @param {Function} pick - picks the expected list out of the payload
     * @returns {any[]}
     */
    __requireList(data, pick) {
        if (data && data.success === false)
            throw new Error(`whitebit: ${formatMessage(data.message)}`)
        return this.__requireArray(pick(data))
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/v4/public/markets`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data, data => data)
        return markets
            .filter(market => market.type === 'spot' && market.tradesEnabled === true)
            .map(market => market.name)
    }

    async __getTradeData(market, timestamp, timeframe, count, timeout) {
        const interval = timeframe === 60 ? '1h' : `${timeframe}m`
        //the answer is the last `limit` closed candles that end by `end`; an `end` in the future is refused
        const end = timestamp + count * timeframe * 60
        const klinesUrl = `${baseApiUrl}/v1/public/kline?market=${market.symbol}&interval=${interval}&start=${timestamp}&end=${end}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data, data => data?.result)
        return this.__processKlines(klines, timestamp, market.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        //[time, open, close, high, low, volume, quote volume]
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline[0], 'timestamp'),
            volume: PriceProviderBase.validateAmount(kline[5], 'volume'),
            quoteVolume: PriceProviderBase.validateAmount(kline[6], 'quote volume'),
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }

    __formatSymbol(base, quote) {
        return `${base}_${quote}`
    }
}

module.exports = WhitebitPriceProvider
