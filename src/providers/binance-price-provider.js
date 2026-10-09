/*eslint-disable class-methods-use-this */
const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.binance.com/api/v3'

class BinancePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'binance'

    /**
     * Binance answers errors with HTTP 200 and an object {code, msg} where a list is expected.
     * @param {any} data - response payload
     * @returns {any[]}
     */
    __requireList(data) {
        if (data && !Array.isArray(data) && data.code !== undefined)
            throw new Error(`binance: ${data.code} ${data.msg}`)
        return this.__requireArray(data)
    }

    async __loadMarkets(timeout) {
        //permission sets make the full list ~17 MiB, above the 5 MiB body cap; trading symbols without them are ~2.4 MiB
        const marketsUrl = `${baseApiUrl}/exchangeInfo?showPermissionSets=false&symbolStatus=TRADING`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = this.__requireList(response.data?.symbols ?? response.data)
        return markets
            .filter(market => market.status === 'TRADING')
            .map(market => market.symbol)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const klinesUrl = `${baseApiUrl}/klines?symbol=${symbolInfo.symbol}&interval=${timeframe}m&startTime=${timestamp * 1000}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = this.__requireList(response.data)
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
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

module.exports = BinancePriceProvider
