/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.bitget.com/api/v2/spot'

class BitgetPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'bitget'

    quoteOrder = ['USDT', 'USDC', 'USD']

    /**
     * Bitget answers {code, msg, data}; any code other than '00000' is a failure.
     * @param {any} data - response payload
     * @returns {any[]} data list
     */
    __requireList(data) {
        if (!data || data.code !== '00000')
            throw new Error(`bitget: ${data?.code} ${data?.msg}`)
        return this.__requireArray(data.data)
    }

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/public/symbols`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data)
        return markets
            .filter(market => market.status === 'online')
            .map(market => market.symbol)
    }

    async __getTradeData(market, timestamp, timeframe, count, timeout) {
        const granularity = timeframe === 60 ? '1h' : `${timeframe}min`
        //endTime is inclusive, and with a limit the answer is the last `limit` candles up to it
        const endTime = (timestamp + (count - 1) * timeframe * 60) * 1000
        const klinesUrl = `${baseApiUrl}/market/candles?symbol=${market.symbol}&granularity=${granularity}&endTime=${endTime}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data)
        return this.__processKlines(klines, timestamp, market.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        //[time in ms, open, high, low, close, base volume, USDT volume, quote volume]
        return new TradeData({
            ts: PriceProviderBase.toNumber(kline[0], 'timestamp') / 1000,
            volume: PriceProviderBase.validateAmount(kline[5], 'volume'),
            quoteVolume: PriceProviderBase.validateAmount(kline[7], 'quote volume'),
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }
}

module.exports = BitgetPriceProvider
