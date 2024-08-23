const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.binance.com/api/v3'

class BinancePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'binance'

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/exchangeInfo`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = response.data.symbols
        return markets
            .filter(market => market.status === 'TRADING')
            .map(market => market.symbol)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const klinesUrl = `${baseApiUrl}/klines?symbol=${symbolInfo.symbol}&interval=${timeframe}m&startTime=${timestamp * 1000}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = response.data
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: Number(kline[0]) / 1000,
            volume: kline[5],
            quoteVolume: kline[7],
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }
}

module.exports = BinancePriceProvider